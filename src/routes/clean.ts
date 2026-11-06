import Anthropic from "@anthropic-ai/sdk";
import { type Env, HttpError, json } from "../env";
import { CLEAN_PROMPT } from "../prompt";
import { requirePage } from "./pages";

// Models that accept the server-side refusal fallback (`fallbacks: "default"`) on the Claude API.
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);
const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Pull the JSON object out of the reply, tolerating ```json fences or a stray sentence. */
export function parseWorksheet(text: string): { sections: unknown[] } & Record<string, unknown> {
  const t = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  const start = t.indexOf("{"), end = t.lastIndexOf("}");
  if (start < 0 || end <= start) throw new HttpError(502, "invalid_json");
  let data: unknown;
  try { data = JSON.parse(t.slice(start, end + 1)); } catch { throw new HttpError(502, "invalid_json"); }
  if (!data || typeof data !== "object" || !Array.isArray((data as { sections?: unknown }).sections)) {
    throw new HttpError(502, "invalid_json");
  }
  const d = data as { sections: unknown[] } & Record<string, unknown>;
  if (!d.sections.length) throw new HttpError(422, "empty");
  return d;
}

/** POST /api/pages/:id/clean — read the photo with Claude, store and return the worksheet JSON. */
export async function makeClean(env: Env, pageId: string): Promise<Response> {
  if (!env.ANTHROPIC_API_KEY) throw new HttpError(503, "not_configured", "The Anthropic API key is not set on the server.");
  const page = await requirePage(env, pageId);
  const obj = await env.PAGES.get(page.r2_key);
  if (!obj) throw new HttpError(404, "not_found", "The page image is missing.");
  const image = toBase64(await obj.arrayBuffer());

  const model = env.CLAUDE_MODEL || "claude-opus-5-5";
  const effort = EFFORTS.has(env.CLAUDE_EFFORT || "") ? (env.CLAUDE_EFFORT as "low" | "medium" | "high") : "medium";
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 170_000 });

  let msg;
  try {
    msg = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      output_config: { effort },
      ...(FALLBACK_MODELS.has(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
          { type: "text", text: CLEAN_PROMPT },
        ],
      }],
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, "rate_limited");
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      throw new HttpError(503, "not_configured", "The Anthropic API key was rejected.");
    }
    if (e instanceof Anthropic.BadRequestError) {
      console.error("clean: bad request", e.message);
      throw new HttpError(400, "bad_photo", e.message);
    }
    if (e instanceof Anthropic.APIError && (e.status === 529 || (e.status ?? 0) >= 500)) {
      throw new HttpError(503, "overloaded");
    }
    if (e instanceof Anthropic.APIConnectionError) throw new HttpError(504, "timeout");
    throw e;
  }

  if (msg.stop_reason === "refusal") throw new HttpError(422, "refused");
  if (msg.stop_reason === "max_tokens") throw new HttpError(502, "invalid_json", "The worksheet was too long to read in one go.");
  const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const data = parseWorksheet(text);

  const at = Date.now();
  // A new clean copy renumbers the fields (b0, w1, c2…), so old typed values no longer line up.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO clean_copies (page_id, data, model, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(page_id) DO UPDATE SET data = excluded.data, model = excluded.model, created_at = excluded.created_at`,
    ).bind(page.id, JSON.stringify(data), msg.model || model, at),
    env.DB.prepare("DELETE FROM typed_values WHERE page_id = ?").bind(page.id),
  ]);
  return json({ data, at, model: msg.model || model });
}
