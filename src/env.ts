export interface Env {
  DB: D1Database;
  PAGES: R2Bucket;
  ASSETS: Fetcher;
  ANTHROPIC_API_KEY?: string;
  /** Comic Maker art (Gemini "Nano Banana Pro"). Without it, comics show as text panels. */
  GEMINI_API_KEY?: string;
  GEMINI_IMAGE_MODEL?: string;
  /** Comics Simon can make per day (parents set this in wrangler.jsonc / the dashboard). */
  COMIC_DAILY_LIMIT?: string;
  /** "1" in .dev.vars only: fake Claude and Gemini so the Comic Maker runs locally without keys. */
  MOCK_AI?: string;
  CLAUDE_MODEL: string;
  CLAUDE_EFFORT?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /** Set to "1" in .dev.vars only. Lets `wrangler dev` run without Cloudflare Access. */
  DEV_NO_ACCESS?: string;
}

/** Error with a stable `code` the front end maps to a friendly message. */
export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

export const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export const fail = (status: number, code: string, message?: string): Response =>
  json({ error: { code, message: message ?? code } }, status);

export const uid = (): string => {
  const b = crypto.getRandomValues(new Uint8Array(9));
  return Date.now().toString(36) + Array.from(b, (x) => (x % 36).toString(36)).join("");
};

const ID_RE = /^[a-z0-9]{6,40}$/;
export function checkId(id: string): string {
  if (!ID_RE.test(id)) throw new HttpError(400, "bad_id", "That id does not look right.");
  return id;
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    const v = await req.json();
    if (!v || typeof v !== "object") throw new Error();
    return v as T;
  } catch {
    throw new HttpError(400, "bad_json", "The request body was not JSON.");
  }
}
