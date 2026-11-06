import { accessEnabled, verifyAccess } from "./access";
import { type Env, HttpError, fail } from "./env";
import { deleteAnswer, putAnswer, putTyped } from "./routes/answers";
import { createAssignment, deleteAssignment, getAssignment, listAssignments, updateAssignment } from "./routes/assignments";
import { makeClean } from "./routes/clean";
import { addPage, deletePage, movePage, serveImage } from "./routes/pages";

type Handler = (req: Request, env: Env, p: string[]) => Promise<Response>;
const routes: [string, RegExp, Handler][] = [
  ["GET", /^\/api\/assignments$/, (_r, env) => listAssignments(env)],
  ["POST", /^\/api\/assignments$/, (r, env) => createAssignment(r, env)],
  ["GET", /^\/api\/assignments\/([^/]+)$/, (_r, env, [id]) => getAssignment(env, id)],
  ["PATCH", /^\/api\/assignments\/([^/]+)$/, (r, env, [id]) => updateAssignment(r, env, id)],
  ["DELETE", /^\/api\/assignments\/([^/]+)$/, (_r, env, [id]) => deleteAssignment(env, id)],
  ["POST", /^\/api\/assignments\/([^/]+)\/pages$/, (r, env, [id]) => addPage(r, env, id)],
  ["PATCH", /^\/api\/pages\/([^/]+)$/, (r, env, [id]) => movePage(r, env, id)],
  ["DELETE", /^\/api\/pages\/([^/]+)$/, (_r, env, [id]) => deletePage(env, id)],
  ["PUT", /^\/api\/pages\/([^/]+)\/typed$/, (r, env, [id]) => putTyped(r, env, id)],
  ["POST", /^\/api\/pages\/([^/]+)\/clean$/, (_r, env, [id]) => makeClean(env, id)],
  ["PUT", /^\/api\/answers\/([^/]+)$/, (r, env, [id]) => putAnswer(r, env, id)],
  ["DELETE", /^\/api\/answers\/([^/]+)$/, (_r, env, [id]) => deleteAnswer(env, id)],
  ["GET", /^\/img\/(.+)$/, (r, env, [key]) => serveImage(r, env, key)],
];

export default {
  async fetch(req, env): Promise<Response> {
    const url = new URL(req.url);
    const isApi = url.pathname.startsWith("/api/") || url.pathname.startsWith("/img/");
    if (!isApi) return env.ASSETS.fetch(req);

    if (!accessEnabled(env) && env.DEV_NO_ACCESS !== "1") {
      return fail(503, "access_not_configured", "Set ACCESS_TEAM_DOMAIN and ACCESS_AUD before using the app.");
    }
    if (!(await verifyAccess(req, env))) return fail(403, "signed_out", "Sign in again to keep going.");

    // Cheap CSRF guard: browsers always send Origin on cross-site writes.
    if (req.method !== "GET" && req.method !== "HEAD") {
      const origin = req.headers.get("Origin");
      if (origin && origin !== url.origin) return fail(403, "bad_origin");
    }

    for (const [method, re, handler] of routes) {
      const m = re.exec(url.pathname);
      if (!m) continue;
      if (req.method !== method && !(method === "GET" && req.method === "HEAD")) continue;
      try {
        return await handler(req, env, m.slice(1).map(decodeURIComponent));
      } catch (e) {
        if (e instanceof HttpError) return fail(e.status, e.code, e.message);
        console.error(url.pathname, e);
        return fail(500, "server_error", "Something went wrong on the server.");
      }
    }
    return fail(404, "no_route");
  },
} satisfies ExportedHandler<Env>;
