import Anthropic from "@anthropic-ai/sdk";
import { type Env, HttpError, json, readJson } from "../env";
import { FIX_PROBLEMS, PAGE_PROMPT, fixPrompt } from "../prompt";
import { requirePage } from "./pages";

// Models that accept the server-side refusal fallback (`fallbacks: "default"`) on the Claude API.
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);
const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
const MAX_PAGE = 300_000; // characters of HTML

/** A clean copy is either the original JSON worksheet (v1) or a page of HTML (v2). */
type PageV2 = { v: 2; title: string; html: string };

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const decode = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Pull <page title="…">…</page> out of the reply. The HTML is sanitized in the browser before it is shown. */
export function parsePage(text: string): PageV2 {
  const m = /<page\b([^>]*)>([\s\S]*)<\/page>/i.exec(text);
  if (!m) throw new HttpError(502, "invalid_json");
  const html = m[2].trim();
  if (!html) throw new HttpError(422, "empty");
  if (html.length > MAX_PAGE) throw new HttpError(502, "invalid_json", "The worksheet came back too long.");
  const title = decode(/title\s*=\s*"([^"]*)"/i.exec(m[1])?.[1] ?? "").trim().slice(0, 200);
  return { v: 2, title, html };
}

/** One request to Claude with the page photo and a prompt; returns the reply text. */
async function askClaude(env: Env, photo: R2ObjectBody, prompt: string): Promise<{ text: string; model: string }> {
  if (!env.ANTHROPIC_API_KEY) throw new HttpError(503, "not_configured", "The Anthropic API key is not set on the server.");
  const image = toBase64(await photo.arrayBuffer());
  const model = env.CLAUDE_MODEL || "claude-opus-5-5";
  const effort = EFFORTS.has(env.CLAUDE_EFFORT || "") ? (env.CLAUDE_EFFORT as "low" | "medium" | "high") : "medium";
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 240_000 });

  let msg;
  try {
    // Streamed so a long page (max_tokens 32k) doesn't run into the HTTP timeout; we only need the final message.
    msg = await client.beta.messages.stream({
      model,
      max_tokens: 32000,
      output_config: { effort },
      ...(FALLBACK_MODELS.has(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
          { type: "text", text: prompt },
        ],
      }],
    }).finalMessage();
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
  return { text, model: msg.model || model };
}

async function photoFor(env: Env, key: string): Promise<R2ObjectBody> {
  const obj = await env.PAGES.get(key);
  if (!obj) throw new HttpError(404, "not_found", "The page image is missing.");
  return obj;
}

/** POST /api/pages/:id/clean — read the photo with Claude, store and return a fresh page. */
export async function makeClean(env: Env, pageId: string): Promise<Response> {
  const page = await requirePage(env, pageId);
  const { text, model } = await askClaude(env, await photoFor(env, page.r2_key), PAGE_PROMPT);
  const data = parsePage(text);
  const at = Date.now();
  // A rebuilt page has new field ids, so old typed values no longer line up.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO clean_copies (page_id, data, model, created_at, prev_data) VALUES (?, ?, ?, ?, NULL)
       ON CONFLICT(page_id) DO UPDATE SET data = excluded.data, model = excluded.model, created_at = excluded.created_at, prev_data = NULL`,
    ).bind(page.id, JSON.stringify(data), model, at),
    env.DB.prepare("DELETE FROM typed_values WHERE page_id = ?").bind(page.id),
  ]);
  return json({ data, at, model, canUndo: false });
}

/**
 * POST /api/pages/:id/fix { problem, note?, page?, snippet? } — the child tapped Fix on part of the page.
 * `page` is the current HTML with data-fix-here on the tapped element (v2 pages); `snippet` is the tapped
 * text (older JSON pages). Typed answers are kept: Claude keeps the ids of the parts it doesn't touch.
 */
export async function fixClean(req: Request, env: Env, pageId: string): Promise<Response> {
  const page = await requirePage(env, pageId);
  const b = await readJson<{ problem?: unknown; note?: unknown; page?: unknown; snippet?: unknown }>(req);
  const problem = typeof b.problem === "string" && b.problem in FIX_PROBLEMS ? b.problem : "other";
  const note = typeof b.note === "string" ? b.note.replace(/\s+/g, " ").trim().slice(0, 300) : "";
  const row = await env.DB.prepare("SELECT data FROM clean_copies WHERE page_id = ?").bind(page.id).first<{ data: string }>();
  if (!row) throw new HttpError(404, "not_found", "Make a clean copy first.");
  const stored = JSON.parse(row.data) as Partial<PageV2>;
  const legacy = stored.v !== 2;

  let current: string;
  if (legacy) current = row.data;
  else if (typeof b.page === "string" && b.page.length <= MAX_PAGE) current = b.page;
  else current = stored.html ?? "";
  const snippet = typeof b.snippet === "string" ? b.snippet.replace(/\s+/g, " ").trim().slice(0, 500) : "";

  const { text, model } = await askClaude(env, await photoFor(env, page.r2_key), fixPrompt({ problem, note, current, legacy, snippet }));
  const data = parsePage(text);
  if (!data.title && stored.title) data.title = stored.title;
  const at = Date.now();
  await env.DB.prepare("UPDATE clean_copies SET prev_data = data, data = ?, model = ?, created_at = ? WHERE page_id = ?")
    .bind(JSON.stringify(data), model, at, page.id).run();
  return json({ data, at, model, canUndo: true });
}

/** POST /api/pages/:id/unfix — put back the page as it was before the last Fix. */
export async function unfixClean(env: Env, pageId: string): Promise<Response> {
  const page = await requirePage(env, pageId);
  const row = await env.DB.prepare("SELECT prev_data FROM clean_copies WHERE page_id = ?").bind(page.id).first<{ prev_data: string | null }>();
  if (!row?.prev_data) throw new HttpError(409, "nothing_to_undo", "There is nothing to put back.");
  const at = Date.now();
  await env.DB.prepare("UPDATE clean_copies SET data = prev_data, prev_data = NULL, created_at = ? WHERE page_id = ?").bind(at, page.id).run();
  return json({ data: JSON.parse(row.prev_data), at, canUndo: false });
}
