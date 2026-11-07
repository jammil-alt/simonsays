import Anthropic from "@anthropic-ai/sdk";
import { type Env, HttpError, checkId, json, readJson, uid } from "../env";
import { SCRIPT_SCHEMA, SCRIPT_SYSTEM, type Script, blockedWords, characterPrompt, panelPrompt, scriptText } from "../comic-prompt";
import { type Picture, drawPicture } from "../gemini";
import { mockPicture, mockScript } from "../comic-mock";
import { type VoicePlan, directVoices, speakLine } from "../voice";

const MAX_PANELS = 6, MAX_CHARS = 3;
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);
const EXT: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg",
  "audio/wav": "wav", "audio/x-wav": "wav", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/ogg": "ogg", "audio/webm": "webm",
};

type ComicRow = {
  id: string; story: string; title: string | null; script: string | null; status: string;
  flags: string | null; error: string | null; day: string; created_at: number; voice: string | null;
};

const mock = (env: Env) => env.MOCK_AI === "1";
const artOn = (env: Env) => mock(env) || Boolean(env.GEMINI_API_KEY);
const dailyLimit = (env: Env) => Math.max(0, Number(env.COMIC_DAILY_LIMIT ?? 3) || 0);

/** Today's date where he is (Cloudflare knows the visitor's time zone), for the daily cap. */
function today(req: Request): string {
  const tz = (req as Request & { cf?: { timezone?: string } }).cf?.timezone || "UTC";
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

async function usedToday(env: Env, day: string): Promise<number> {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM comics WHERE day = ? AND status != 'failed'").bind(day).first<{ n: number }>();
  return r?.n ?? 0;
}

/** Clamp the script to what the viewer can show nicely. */
function tidy(s: Script): Script {
  const t = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
  const characters = (s.characters || []).slice(0, MAX_CHARS).map((c) => ({ name: t(c.name, 40), look: t(c.look, 300) })).filter((c) => c.name);
  const panels = (s.panels || []).slice(0, MAX_PANELS).map((p) => {
    const dialogue = (p.dialogue || []).slice(0, 2).map((d) => ({ speaker: t(d.speaker, 40), text: t(d.text, 120), side: d.side === "right" ? "right" as const : "left" as const }));
    if (dialogue.length === 2 && dialogue[0].side === dialogue[1].side) dialogue[1].side = dialogue[0].side === "left" ? "right" : "left";
    return { scene: t(p.scene, 900), characters: (p.characters || []).map((n) => t(n, 40)).slice(0, MAX_CHARS), caption: t(p.caption, 140), dialogue };
  });
  if (panels.length < 3) throw new HttpError(502, "script_failed");
  return { title: t(s.title, 80) || "My Comic", characters, panels, changes: (s.changes || []).map((c) => t(c, 200)).slice(0, 10) };
}

/** Ask Claude for the comic script. Retries once if the backstop word list catches anything. */
async function writeScript(env: Env, story: string): Promise<Script> {
  if (mock(env)) return tidy(await mockScript(story));
  if (!env.ANTHROPIC_API_KEY) throw new HttpError(503, "not_configured", "The Anthropic API key is not set on the server.");
  const model = env.CLAUDE_MODEL || "claude-opus-5-5";
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 120_000 });
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: `Here is the story Simon typed:\n\n<story>\n${story}\n</story>` },
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
    let msg;
    try {
      msg = await client.beta.messages.create({
        model,
        max_tokens: 16000,
        system: SCRIPT_SYSTEM,
        output_config: { effort: "medium", format: { type: "json_schema", schema: SCRIPT_SCHEMA as unknown as Record<string, unknown> } },
        ...(FALLBACK_MODELS.has(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        messages,
      });
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, "rate_limited");
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new HttpError(503, "not_configured");
      if (e instanceof Anthropic.APIError && (e.status ?? 0) >= 500) throw new HttpError(503, "overloaded");
      if (e instanceof Anthropic.APIConnectionError) throw new HttpError(504, "timeout");
      throw e;
    }
    if (msg.stop_reason === "refusal") throw new HttpError(422, "script_refused");
    const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    let script: Script;
    try { script = tidy(JSON.parse(text)); } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(502, "script_failed"); }
    const hits = blockedWords(scriptText(script));
    if (!hits.length) return script;
    console.warn("comic script hit blocklist", hits);
    messages.push(
      { role: "assistant", content: text },
      { role: "user", content: `Please rewrite it without these words or anything like them: ${hits.join(", ")}. Follow the content rules and return the whole comic again.` },
    );
  }
  throw new HttpError(422, "script_refused");
}

type ImageRow = { slot: string; r2_key: string };

async function loadComic(env: Env, id: string): Promise<{ row: ComicRow; images: Record<string, string> }> {
  const row = await env.DB.prepare("SELECT * FROM comics WHERE id = ?").bind(checkId(id)).first<ComicRow>();
  if (!row) throw new HttpError(404, "not_found", "That comic no longer exists.");
  const { results } = await env.DB.prepare("SELECT slot, r2_key FROM comic_images WHERE comic_id = ?").bind(row.id).all<ImageRow>();
  return { row, images: Object.fromEntries(results.map((r) => [r.slot, r.r2_key])) };
}

const view = (row: ComicRow, images: Record<string, string>, env: Env) => {
  const flags = row.flags ? JSON.parse(row.flags) : {};
  return {
    id: row.id, title: row.title, status: row.status, createdAt: row.created_at,
    story: row.story, script: row.script ? JSON.parse(row.script) : null, images,
    storyWords: flags.storyWords ?? [], changes: flags.changes ?? [], art: artOn(env),
  };
};

/** GET /api/comics — library plus today's count. */
export async function listComics(req: Request, env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.title, c.status, c.created_at, c.script,
       (SELECT r2_key FROM comic_images i WHERE i.comic_id = c.id AND i.slot = 'panel-0') AS cover,
       (SELECT COUNT(*) FROM comic_images i WHERE i.comic_id = c.id AND i.slot LIKE 'panel-%') AS drawn
     FROM comics c WHERE c.status != 'failed' AND c.script IS NOT NULL ORDER BY c.created_at DESC LIMIT 300`,
  ).all<{ id: string; title: string; status: string; created_at: number; script: string; cover: string | null; drawn: number }>();
  const day = today(req);
  return json({
    comics: results.map((r) => {
      let panels = 0; try { panels = JSON.parse(r.script).panels.length; } catch {}
      return { id: r.id, title: r.title, createdAt: r.created_at, cover: r.cover, panels, drawn: r.drawn };
    }),
    today: { used: await usedToday(env, day), limit: dailyLimit(env) },
    art: artOn(env),
  });
}

/** POST /api/comics { story } — writes the script. Pictures are drawn one request at a time after this. */
export async function createComic(req: Request, env: Env): Promise<Response> {
  const b = await readJson<{ story?: unknown }>(req);
  const story = String(b.story ?? "").replace(/\r\n/g, "\n").trim();
  if (story.length < 15) throw new HttpError(400, "too_short", "Tell me a little more of the story!");
  if (story.length > 2000) throw new HttpError(400, "too_long", "That story is too long for one comic.");
  const day = today(req);
  if ((await usedToday(env, day)) >= dailyLimit(env)) throw new HttpError(429, "daily_limit");

  const id = uid();
  const storyWords = blockedWords(story);
  await env.DB.prepare("INSERT INTO comics (id, story, status, flags, day, created_at) VALUES (?, ?, 'scripting', ?, ?, ?)")
    .bind(id, story, JSON.stringify({ storyWords }), day, Date.now()).run();
  try {
    const script = await writeScript(env, story);
    const flags = { storyWords, changes: script.changes };
    await env.DB.prepare("UPDATE comics SET title = ?, script = ?, status = 'drawing', flags = ? WHERE id = ?")
      .bind(script.title, JSON.stringify(script), JSON.stringify(flags), id).run();
  } catch (e) {
    const code = e instanceof HttpError ? e.code : "server_error";
    await env.DB.prepare("UPDATE comics SET status = 'failed', error = ? WHERE id = ?").bind(code, id).run();
    throw e;
  }
  const { row, images } = await loadComic(env, id);
  return json(view(row, images, env), 201);
}

/** GET /api/comics/:id */
export async function getComic(env: Env, id: string): Promise<Response> {
  const { row, images } = await loadComic(env, id);
  return json(view(row, images, env));
}

/** POST /api/comics/:id/draw/:slot[?redo=1] — draw one character sheet (char-N) or panel (panel-N). */
export async function drawSlot(req: Request, env: Env, id: string, slot: string): Promise<Response> {
  const m = /^(char|panel)-(\d)$/.exec(slot);
  if (!m) throw new HttpError(400, "bad_slot");
  const { row, images } = await loadComic(env, id);
  if (!row.script) throw new HttpError(409, "no_script");
  const script = JSON.parse(row.script) as Script;
  const kind = m[1], i = Number(m[2]);
  const redo = new URL(req.url).searchParams.get("redo") === "1";
  if (images[slot] && !redo) return json({ slot, key: images[slot] });
  if (!artOn(env)) throw new HttpError(503, "art_off");

  let prompt: string, refs: Picture[] = [], refNames: string[] = [];
  if (kind === "char") {
    const c = script.characters[i]; if (!c) throw new HttpError(400, "bad_slot");
    prompt = characterPrompt(c);
  } else {
    const p = script.panels[i]; if (!p) throw new HttpError(400, "bad_slot");
    // Character sheets keep everyone looking the same from panel to panel.
    for (const [ci, c] of script.characters.entries()) {
      const key = images[`char-${ci}`];
      if (!key || !p.characters.some((n) => n.toLowerCase() === c.name.toLowerCase())) continue;
      const obj = await env.PAGES.get(key);
      if (!obj) continue;
      refs.push({ bytes: new Uint8Array(await obj.arrayBuffer()), mime: obj.httpMetadata?.contentType || "image/png" });
      refNames.push(c.name);
    }
    prompt = panelPrompt(script, i, refNames);
  }
  const aspect = kind === "char" ? "1:1" : "4:3";
  const pic = mock(env) ? await mockPicture(prompt, aspect, slot) : await drawPicture(env, prompt, refs, aspect);

  const key = `comics/${row.id}/${slot}-${uid().slice(-8)}.${EXT[pic.mime] || "png"}`;
  await env.PAGES.put(key, pic.bytes, { httpMetadata: { contentType: pic.mime } });
  // The comic may have been deleted while this picture was being drawn (it takes a while).
  const still = await env.DB.prepare("SELECT 1 AS ok FROM comics WHERE id = ?").bind(row.id).first();
  if (!still) { await env.PAGES.delete(key); throw new HttpError(404, "not_found", "That comic was deleted."); }
  await env.DB.prepare(
    `INSERT INTO comic_images (comic_id, slot, r2_key, prompt, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(comic_id, slot) DO UPDATE SET r2_key = excluded.r2_key, prompt = excluded.prompt, created_at = excluded.created_at`,
  ).bind(row.id, slot, key, prompt, Date.now()).run();
  if (images[slot]) await env.PAGES.delete(images[slot]);
  const drawn = Object.keys(images).filter((s) => s.startsWith("panel-")).length + (kind === "panel" && !images[slot] ? 1 : 0);
  if (drawn >= script.panels.length && row.status !== "done") {
    await env.DB.prepare("UPDATE comics SET status = 'done' WHERE id = ?").bind(row.id).run();
  }
  return json({ slot, key });
}

/** DELETE /api/comics/:id — rows and pictures. */
export async function deleteComic(env: Env, id: string): Promise<Response> {
  const { row } = await loadComic(env, id);
  const listed = await env.PAGES.list({ prefix: `comics/${row.id}/` });
  await env.DB.batch([
    env.DB.prepare("DELETE FROM comic_images WHERE comic_id = ?").bind(row.id),
    env.DB.prepare("DELETE FROM comics WHERE id = ?").bind(row.id),
  ]);
  if (listed.objects.length) await env.PAGES.delete(listed.objects.map((o) => o.key));
  return json({ ok: true });
}

/* ---------- read-aloud voices ---------- */

const planView = (plan: VoicePlan, images: Record<string, string>) => ({
  voices: plan.voices,
  lines: plan.lines.map((l, k) => ({ k, panel: l.panel, who: l.who, text: l.text, key: images[`voice-${k}`] || null })),
});

/** POST /api/comics/:id/voice — the voice plan (made once by the voice director), with any clips already recorded. */
export async function comicVoice(env: Env, id: string): Promise<Response> {
  const { row, images } = await loadComic(env, id);
  if (!row.script) throw new HttpError(409, "no_script");
  if (row.voice) return json(planView(JSON.parse(row.voice), images));
  if (env.MOCK_AI !== "1" && !env.GEMINI_API_KEY) throw new HttpError(503, "voice_off");
  const plan = await directVoices(env, JSON.parse(row.script) as Script);
  await env.DB.prepare("UPDATE comics SET voice = ? WHERE id = ?").bind(JSON.stringify(plan), row.id).run();
  return json(planView(plan, images));
}

/** POST /api/comics/:id/voice/:k — record line k (once) and return its clip. */
export async function comicVoiceLine(env: Env, id: string, kStr: string): Promise<Response> {
  const k = Number(kStr);
  if (!/^\d{1,2}$/.test(kStr)) throw new HttpError(400, "bad_line");
  const { row, images } = await loadComic(env, id);
  if (!row.voice) throw new HttpError(409, "no_voice_plan");
  const slot = `voice-${k}`;
  if (images[slot]) return json({ k, key: images[slot] });
  const plan = JSON.parse(row.voice) as VoicePlan;
  const line = plan.lines[k];
  if (!line) throw new HttpError(400, "bad_line");
  const clip = await speakLine(env, line, plan.voices[line.who] || plan.voices.Narrator);
  const key = `comics/${row.id}/${slot}-${uid().slice(-8)}.${EXT[clip.mime] || "wav"}`;
  await env.PAGES.put(key, clip.bytes, { httpMetadata: { contentType: clip.mime } });
  const still = await env.DB.prepare("SELECT 1 AS ok FROM comics WHERE id = ?").bind(row.id).first();
  if (!still) { await env.PAGES.delete(key); throw new HttpError(404, "not_found"); }
  const res = await env.DB.prepare(
    "INSERT INTO comic_images (comic_id, slot, r2_key, prompt, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(comic_id, slot) DO NOTHING",
  ).bind(row.id, slot, key, `${line.how}: ${line.text}`, Date.now()).run();
  if (!res.meta.changes) {   // two requests raced; keep the first clip
    await env.PAGES.delete(key);
    const kept = await env.DB.prepare("SELECT r2_key FROM comic_images WHERE comic_id = ? AND slot = ?").bind(row.id, slot).first<{ r2_key: string }>();
    return json({ k, key: kept?.r2_key });
  }
  return json({ k, key });
}
