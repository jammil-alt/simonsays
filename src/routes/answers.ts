import { type Env, HttpError, checkId, json, readJson } from "../env";
import { requirePage } from "./pages";

const num = (v: unknown, lo: number, hi: number): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new HttpError(400, "bad_box", "Answer box position is not a number.");
  return Math.max(lo, Math.min(hi, n));
};

/** PUT /api/answers/:id { pageId, x, y, w, t } — upsert a tap-to-type box on the photo. */
export async function putAnswer(req: Request, env: Env, id: string): Promise<Response> {
  checkId(id);
  const b = await readJson<{ pageId?: string; x?: unknown; y?: unknown; w?: unknown; t?: unknown }>(req);
  const page = await requirePage(env, String(b.pageId ?? ""));
  const text = String(b.t ?? "").slice(0, 5000);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO answers (id, page_id, x, y, w, text, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET page_id = excluded.page_id, x = excluded.x, y = excluded.y,
       w = excluded.w, text = excluded.text, updated_at = excluded.updated_at`,
  ).bind(id, page.id, num(b.x, 0, 100), num(b.y, 0, 100), num(b.w, 1, 100), text, now).run();
  return json({ ok: true, at: now });
}

/** DELETE /api/answers/:id */
export async function deleteAnswer(env: Env, id: string): Promise<Response> {
  await env.DB.prepare("DELETE FROM answers WHERE id = ?").bind(checkId(id)).run();
  return json({ ok: true });
}

/** PUT /api/pages/:id/typed { vals } — answers typed on the clean copy. */
export async function putTyped(req: Request, env: Env, pageId: string): Promise<Response> {
  const page = await requirePage(env, pageId);
  const b = await readJson<{ vals?: unknown }>(req);
  if (!b.vals || typeof b.vals !== "object" || Array.isArray(b.vals)) throw new HttpError(400, "bad_vals");
  const vals: Record<string, string> = {};
  for (const [k, v] of Object.entries(b.vals as Record<string, unknown>)) {
    if (/^[a-z]\d{1,4}$/.test(k)) vals[k] = String(v ?? "").slice(0, 5000);
  }
  const s = JSON.stringify(vals);
  if (s.length > 200_000) throw new HttpError(413, "too_big");
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO typed_values (page_id, vals, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(page_id) DO UPDATE SET vals = excluded.vals, updated_at = excluded.updated_at`,
  ).bind(page.id, s, now).run();
  return json({ ok: true, at: now });
}
