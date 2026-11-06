import { type Env, HttpError, json, readJson, uid } from "../env";

// Keep in sync with public/games/shared.js (LEVELS) and the game ids there.
const GAMES = new Set(["letter-lane", "meteor-words"]);
const LEVELS = new Set(["fj", "home", "reach", "abc", "tiny", "sight", "homework"]);

/** GET /api/games/scores — best score and stars per game and level. */
export async function getScores(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT game, level, MAX(score) AS best, MAX(stars) AS stars, COUNT(*) AS plays
     FROM game_scores GROUP BY game, level`,
  ).all<{ game: string; level: string; best: number; stars: number; plays: number }>();
  const out: Record<string, Record<string, { best: number; stars: number; plays: number }>> = {};
  for (const r of results) (out[r.game] ??= {})[r.level] = { best: r.best, stars: r.stars, plays: r.plays };
  return json(out);
}

/** POST /api/games/scores { game, level, score, hits, stars, accuracy } */
export async function saveScore(req: Request, env: Env): Promise<Response> {
  const b = await readJson<Record<string, unknown>>(req);
  const game = String(b.game), level = String(b.level);
  if (!GAMES.has(game) || !LEVELS.has(level)) throw new HttpError(400, "bad_game");
  const int = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
  const score = int(b.score, 10_000_000), hits = int(b.hits, 100_000), stars = int(b.stars, 3);
  const acc = Number(b.accuracy);
  const prev = await env.DB.prepare("SELECT MAX(score) AS best FROM game_scores WHERE game = ? AND level = ?")
    .bind(game, level).first<{ best: number | null }>();
  await env.DB.prepare(
    "INSERT INTO game_scores (id, game, level, score, hits, stars, accuracy, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(uid(), game, level, score, hits, stars, Number.isFinite(acc) ? Math.max(0, Math.min(1, acc)) : null, Date.now()).run();
  const best = Math.max(prev?.best ?? 0, score);
  return json({ best, isBest: prev?.best == null ? score > 0 : score > prev.best });
}

// Instruction words that show up on every worksheet; not useful as practice words.
const SKIP = new Set(
  ("the and for are but not you all any can had her was one our out has him his how its may new now old see two way who " +
   "did get let put say she too use that with have this will your from they been were said each which their what about " +
   "write words word answer circle color sentence sentences below above page name date read draw match fill blank blanks " +
   "number numbers question questions picture pictures box boxes line lines").split(" "),
);
const clean = (w: string) => w.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, "");
const ok = (w: string) => /^[a-z]{2,10}$/.test(w);

type Item = { type?: string; words?: unknown[]; options?: unknown[]; text?: string; prompt?: string; parts?: unknown[] };
type Sheet = { title?: string; instructions?: string; sections?: { heading?: string; instructions?: string; items?: Item[] }[] };

/** Pull practice words out of clean-copy JSON: word banks and choices first, then other words as filler. */
export function extractWords(sheets: Sheet[], max = 40): string[] {
  const strong: string[] = [], weak: string[] = [];
  const addWeak = (s: unknown) => {
    if (typeof s !== "string") return;
    for (const w of s.split(/\s+/).map(clean)) if (ok(w) && w.length >= 4 && !SKIP.has(w)) weak.push(w);
  };
  for (const d of sheets) {
    addWeak(d.title);
    for (const sec of d.sections ?? []) {
      for (const it of sec.items ?? []) {
        if (it.type === "wordbank") for (const w of it.words ?? []) { const c = clean(String(w)); if (ok(c)) strong.push(c); }
        else if (it.type === "choice") for (const o of it.options ?? []) { const c = clean(String(o)); if (ok(c) && !/\s/.test(String(o).trim())) strong.push(c); }
        else { addWeak(it.text); addWeak(it.prompt); for (const p of it.parts ?? []) addWeak(p); }
      }
    }
  }
  const out = [...new Set(strong)];
  if (out.length < 12) for (const w of new Set(weak)) { if (out.length >= max) break; if (!out.includes(w)) out.push(w); }
  return out.slice(0, max);
}

/** GET /api/games/words — practice words from the most recent clean copies. */
export async function getWords(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT c.data FROM clean_copies c
     JOIN pages p ON p.id = c.page_id JOIN assignments a ON a.id = p.assignment_id
     ORDER BY a.created_at DESC, p.position LIMIT 12`,
  ).all<{ data: string }>();
  const sheets: Sheet[] = [];
  for (const r of results) { try { sheets.push(JSON.parse(r.data)); } catch { /* skip bad rows */ } }
  return json({ words: extractWords(sheets) });
}
