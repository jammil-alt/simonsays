import Anthropic from "@anthropic-ai/sdk";
import { type Env, HttpError, json, readJson } from "../env";
import { requirePage } from "./pages";

const MAX_TAGS = 4;

/** Trim, collapse spaces, cap length, drop duplicates (case-insensitive). */
export function normTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [], seen = new Set<string>();
  for (const x of v) {
    const t = String(x ?? "").replace(/[\s|]+/g, " ").replace(/[<>]/g, "").trim().slice(0, 24);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase()); out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

const TAG_PROMPT = (existing: string[]) => `This is a photo of one page of 2nd-grade homework. Give 1 to 3 short tags a parent would use to find it later.
- First tag: the subject. Use one of Math, Reading, Phonics, Spelling, Writing, Grammar, Science, Social Studies, or another one- or two-word subject if none fits.
- Then at most 2 tags for what the page practises, e.g. "Addition", "Telling Time", "Th Words", "Main Idea".
- Reuse these tags already in use when one fits, spelled the same: ${existing.length ? existing.join(", ") : "(none yet)"}.
- Title Case, at most 3 words each. Ignore handwriting.
Reply with only JSON: {"tags": ["…"]}`;

/** Tags already used on any page, most used first, so the model reuses them and the filter stays short. */
async function tagsInUse(env: Env): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT tags FROM pages WHERE tags IS NOT NULL AND tags != '[]'").all<{ tags: string }>();
  const n = new Map<string, number>();
  for (const r of results) for (const t of normTags(JSON.parse(r.tags))) n.set(t, (n.get(t) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([t]) => t);
}

/** POST /api/pages/:id/autotag — read the page photo with a small, cheap model and store its tags. */
export async function autoTag(env: Env, pageId: string): Promise<Response> {
  if (!env.ANTHROPIC_API_KEY) throw new HttpError(503, "not_configured", "The Anthropic API key is not set on the server.");
  const page = await requirePage(env, pageId);
  const obj = await env.PAGES.get(page.r2_key);
  if (!obj) throw new HttpError(404, "not_found", "The page image is missing.");
  const bytes = new Uint8Array(await obj.arrayBuffer());
  let b64 = "";
  for (let i = 0; i < bytes.length; i += 0x8000) b64 += String.fromCharCode(...bytes.subarray(i, i + 0x8000));

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 60_000 });
  let msg;
  try {
    msg = await client.messages.create({
      model: env.CLAUDE_TAG_MODEL || "claude-haiku-5-5",
      max_tokens: 4000,
      output_config: { effort: "low" },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: btoa(b64) } },
          { type: "text", text: TAG_PROMPT(await tagsInUse(env)) },
        ],
      }],
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, "rate_limited");
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      throw new HttpError(503, "not_configured", "The Anthropic API key was rejected.");
    }
    if (e instanceof Anthropic.APIError && (e.status === 529 || (e.status ?? 0) >= 500)) throw new HttpError(503, "overloaded");
    if (e instanceof Anthropic.APIConnectionError) throw new HttpError(504, "timeout");
    throw e;
  }
  let tags: string[] = [];
  if (msg.stop_reason !== "refusal") {
    const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const m = /\{[\s\S]*\}/.exec(text);
    try { tags = normTags((JSON.parse(m?.[0] ?? "{}") as { tags?: unknown }).tags); } catch { tags = []; }
  }
  // Stored even when empty, so the page isn't sent again.
  await env.DB.prepare("UPDATE pages SET tags = ? WHERE id = ?").bind(JSON.stringify(tags), page.id).run();
  return json({ tags });
}

/** PUT /api/pages/:id/tags { tags } — a parent edited the tags by hand. */
export async function putTags(req: Request, env: Env, pageId: string): Promise<Response> {
  const page = await requirePage(env, pageId);
  const tags = normTags((await readJson<{ tags?: unknown }>(req)).tags);
  await env.DB.prepare("UPDATE pages SET tags = ? WHERE id = ?").bind(JSON.stringify(tags), page.id).run();
  return json({ tags });
}
