import { type Env, HttpError, checkId, json, readJson, uid } from "../env";

const SUBJECTS = ["Math", "Writing", "Reading", "Other"];
const SIZES = ["s", "m", "l"];

type AssignmentRow = {
  id: string; title: string; subject: string | null; due: string | null;
  done: number; size: string; created_at: number;
};

const toAssignment = (r: AssignmentRow) => ({
  id: r.id, title: r.title, subject: r.subject, due: r.due || "",
  done: !!r.done, size: r.size || "m", createdAt: r.created_at,
});

export async function requireAssignment(env: Env, id: string): Promise<AssignmentRow> {
  const row = await env.DB.prepare("SELECT * FROM assignments WHERE id = ?").bind(checkId(id)).first<AssignmentRow>();
  if (!row) throw new HttpError(404, "not_found", "That assignment no longer exists.");
  return row;
}

/** GET /api/assignments — sidebar list. */
export async function listAssignments(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT a.*,
       (SELECT COUNT(*) FROM pages p WHERE p.assignment_id = a.id) AS page_count,
       (SELECT r2_key FROM pages p WHERE p.assignment_id = a.id ORDER BY position LIMIT 1) AS thumb_key
     FROM assignments a ORDER BY a.created_at DESC`,
  ).all<AssignmentRow & { page_count: number; thumb_key: string | null }>();
  return json(results.map((r) => ({ ...toAssignment(r), pageCount: r.page_count, thumbKey: r.thumb_key })));
}

function cleanFields(body: Record<string, unknown>): Partial<AssignmentRow> {
  const out: Partial<AssignmentRow> = {};
  if ("title" in body) {
    const t = String(body.title ?? "").trim().slice(0, 200);
    out.title = t || "Untitled";
  }
  if ("subject" in body) {
    if (body.subject !== null && !SUBJECTS.includes(String(body.subject))) throw new HttpError(400, "bad_subject");
    out.subject = body.subject as string | null;
  }
  if ("due" in body) {
    const d = String(body.due ?? "");
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new HttpError(400, "bad_due");
    out.due = d;
  }
  if ("done" in body) out.done = body.done ? 1 : 0;
  if ("size" in body) {
    if (!SIZES.includes(String(body.size))) throw new HttpError(400, "bad_size");
    out.size = String(body.size);
  }
  return out;
}

/** POST /api/assignments */
export async function createAssignment(req: Request, env: Env): Promise<Response> {
  const body = await readJson(req).catch(() => ({}));
  const f = cleanFields(body);
  const row: AssignmentRow = {
    id: uid(),
    title: f.title ?? "Homework",
    subject: f.subject ?? "Math",
    due: f.due ?? "",
    done: f.done ?? 0,
    size: f.size ?? "m",
    created_at: Date.now(),
  };
  await env.DB.prepare(
    "INSERT INTO assignments (id, title, subject, due, done, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(row.id, row.title, row.subject, row.due, row.done, row.size, row.created_at).run();
  return json({ ...toAssignment(row), pageCount: 0, thumbKey: null }, 201);
}

/** GET /api/assignments/:id — everything the detail view needs, in one payload. */
export async function getAssignment(env: Env, id: string): Promise<Response> {
  const a = await requireAssignment(env, id);
  const [pages, answers, clean, typed] = await env.DB.batch([
    env.DB.prepare("SELECT id, r2_key, w, h FROM pages WHERE assignment_id = ? ORDER BY position").bind(a.id),
    env.DB.prepare(
      `SELECT ans.id, ans.page_id, ans.x, ans.y, ans.w, ans.text FROM answers ans
       JOIN pages p ON p.id = ans.page_id WHERE p.assignment_id = ?`,
    ).bind(a.id),
    env.DB.prepare(
      `SELECT c.page_id, c.data, c.model, c.created_at, c.prev_data IS NOT NULL AS can_undo FROM clean_copies c
       JOIN pages p ON p.id = c.page_id WHERE p.assignment_id = ?`,
    ).bind(a.id),
    env.DB.prepare(
      `SELECT t.page_id, t.vals FROM typed_values t
       JOIN pages p ON p.id = t.page_id WHERE p.assignment_id = ?`,
    ).bind(a.id),
  ]);
  type P = { id: string; r2_key: string; w: number; h: number };
  type A = { id: string; page_id: string; x: number; y: number; w: number; text: string };
  type C = { page_id: string; data: string; model: string; created_at: number; can_undo: number };
  type T = { page_id: string; vals: string };
  return json({
    ...toAssignment(a),
    pages: (pages.results as P[]).map((p) => ({ id: p.id, key: p.r2_key, w: p.w, h: p.h })),
    answers: (answers.results as A[]).map((r) => ({ id: r.id, pageId: r.page_id, x: r.x, y: r.y, w: r.w, t: r.text ?? "" })),
    clean: Object.fromEntries((clean.results as C[]).map((r) => [r.page_id, { data: JSON.parse(r.data), at: r.created_at, model: r.model, canUndo: !!r.can_undo }])),
    typed: Object.fromEntries((typed.results as T[]).map((r) => [r.page_id, JSON.parse(r.vals)])),
  });
}

/** PATCH /api/assignments/:id */
export async function updateAssignment(req: Request, env: Env, id: string): Promise<Response> {
  const a = await requireAssignment(env, id);
  const f = cleanFields(await readJson(req));
  const keys = Object.keys(f) as (keyof AssignmentRow)[];
  if (keys.length) {
    await env.DB.prepare(`UPDATE assignments SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
      .bind(...keys.map((k) => f[k]), a.id).run();
  }
  return json(toAssignment({ ...a, ...f }));
}

/** DELETE /api/assignments/:id — rows and R2 images. */
export async function deleteAssignment(env: Env, id: string): Promise<Response> {
  const a = await requireAssignment(env, id);
  const { results } = await env.DB.prepare("SELECT r2_key FROM pages WHERE assignment_id = ?").bind(a.id).all<{ r2_key: string }>();
  const sub = "SELECT id FROM pages WHERE assignment_id = ?";
  // Child rows are deleted explicitly so this does not depend on foreign-key cascades.
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM typed_values WHERE page_id IN (${sub})`).bind(a.id),
    env.DB.prepare(`DELETE FROM clean_copies WHERE page_id IN (${sub})`).bind(a.id),
    env.DB.prepare(`DELETE FROM answers WHERE page_id IN (${sub})`).bind(a.id),
    env.DB.prepare("DELETE FROM pages WHERE assignment_id = ?").bind(a.id),
    env.DB.prepare("DELETE FROM assignments WHERE id = ?").bind(a.id),
  ]);
  if (results.length) await env.PAGES.delete(results.map((r) => r.r2_key));
  return json({ ok: true });
}
