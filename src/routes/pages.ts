import { type Env, HttpError, checkId, json, readJson, uid } from "../env";
import { requireAssignment } from "./assignments";

const MAX_BYTES = 15 * 1024 * 1024;
const KEY_RE = /^[a-z0-9]{6,40}\/[a-z0-9]{6,40}\.jpg$/;

type PageRow = { id: string; assignment_id: string; position: number; r2_key: string; w: number; h: number };

export async function requirePage(env: Env, id: string): Promise<PageRow> {
  const p = await env.DB.prepare("SELECT * FROM pages WHERE id = ?").bind(checkId(id)).first<PageRow>();
  if (!p) throw new HttpError(404, "not_found", "That page no longer exists.");
  return p;
}

/** POST /api/assignments/:id/pages?w=&h= — body is the JPEG. */
export async function addPage(req: Request, env: Env, assignmentId: string): Promise<Response> {
  const a = await requireAssignment(env, assignmentId);
  const url = new URL(req.url);
  const w = Math.round(Number(url.searchParams.get("w")) || 0);
  const h = Math.round(Number(url.searchParams.get("h")) || 0);
  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_BYTES) throw new HttpError(413, "too_big", "That page image is too large.");
  const buf = await req.arrayBuffer();
  if (!buf.byteLength || buf.byteLength > MAX_BYTES) throw new HttpError(413, "too_big", "That page image is too large.");
  const head = new Uint8Array(buf, 0, 3);
  if (head[0] !== 0xff || head[1] !== 0xd8 || head[2] !== 0xff) throw new HttpError(415, "not_jpeg", "Pages must be uploaded as JPEG.");

  const id = uid();
  const key = `${a.id}/${id}.jpg`;
  await env.PAGES.put(key, buf, { httpMetadata: { contentType: "image/jpeg" } });
  try {
    await env.DB.prepare(
      `INSERT INTO pages (id, assignment_id, position, r2_key, w, h)
       VALUES (?, ?, (SELECT COALESCE(MAX(position) + 1, 0) FROM pages WHERE assignment_id = ?), ?, ?, ?)`,
    ).bind(id, a.id, a.id, key, w || null, h || null).run();
  } catch (e) {
    await env.PAGES.delete(key);
    throw e;
  }
  return json({ id, key, w, h }, 201);
}

/** PATCH /api/pages/:id { position } — move a page to a new index. */
export async function movePage(req: Request, env: Env, id: string): Promise<Response> {
  const p = await requirePage(env, id);
  const body = await readJson<{ position?: unknown }>(req);
  const target = Number(body.position);
  if (!Number.isInteger(target) || target < 0) throw new HttpError(400, "bad_position");
  const { results } = await env.DB.prepare("SELECT id FROM pages WHERE assignment_id = ? ORDER BY position")
    .bind(p.assignment_id).all<{ id: string }>();
  const order = results.map((r) => r.id).filter((x) => x !== p.id);
  order.splice(Math.min(target, order.length), 0, p.id);
  await env.DB.batch(order.map((pid, i) => env.DB.prepare("UPDATE pages SET position = ? WHERE id = ?").bind(i, pid)));
  return json({ ok: true, order });
}

/** DELETE /api/pages/:id */
export async function deletePage(env: Env, id: string): Promise<Response> {
  const p = await requirePage(env, id);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM typed_values WHERE page_id = ?").bind(p.id),
    env.DB.prepare("DELETE FROM clean_copies WHERE page_id = ?").bind(p.id),
    env.DB.prepare("DELETE FROM answers WHERE page_id = ?").bind(p.id),
    env.DB.prepare("DELETE FROM pages WHERE id = ?").bind(p.id),
  ]);
  await env.PAGES.delete(p.r2_key);
  return json({ ok: true });
}

/** GET /img/:assignmentId/:pageId.jpg — streams the page image from R2. */
export async function serveImage(req: Request, env: Env, key: string): Promise<Response> {
  if (!KEY_RE.test(key)) return new Response("Not found", { status: 404 });
  const obj = await env.PAGES.get(key, { onlyIf: req.headers });
  if (!obj) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  // Keys never change content, so the browser can keep them forever. Private: the site is behind a login.
  headers.set("cache-control", "private, max-age=31536000, immutable");
  if (!("body" in obj)) return new Response(null, { status: 304, headers });
  return new Response(obj.body, { headers });
}
