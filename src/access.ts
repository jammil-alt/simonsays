import type { Env } from "./env";

/**
 * Cloudflare Access check. Access puts a signed JWT on every request it lets through
 * (header Cf-Access-Jwt-Assertion). Verifying it here means the workers.dev and
 * preview URLs, which Access does not cover, cannot be used to reach the data.
 *
 * Fails closed: if ACCESS_TEAM_DOMAIN / ACCESS_AUD are not set, every API request is
 * refused, unless DEV_NO_ACCESS=1 (set only in .dev.vars for `wrangler dev`).
 */

type Jwk = JsonWebKey & { kid?: string };
let certs: { keys: Jwk[]; at: number } | null = null;

const b64urlToBytes = (s: string): Uint8Array => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
const b64urlJson = (s: string) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

async function getKeys(team: string, force = false): Promise<Jwk[]> {
  if (!force && certs && Date.now() - certs.at < 60 * 60 * 1000) return certs.keys;
  const r = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error("Could not fetch Access certs");
  const body = (await r.json()) as { keys: Jwk[] };
  certs = { keys: body.keys, at: Date.now() };
  return body.keys;
}

export function accessEnabled(env: Env): boolean {
  return Boolean(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD);
}

export async function verifyAccess(req: Request, env: Env): Promise<boolean> {
  if (!accessEnabled(env)) return env.DEV_NO_ACCESS === "1";
  const team = env.ACCESS_TEAM_DOMAIN!.replace(/^https?:\/\//, "").replace(/\/$/, "");
  let token = req.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) {
    const m = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(req.headers.get("Cookie") || "");
    token = m?.[1] ?? null;
  }
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const header = b64urlJson(parts[0]);
    const payload = b64urlJson(parts[1]);
    if (header.alg !== "RS256") return false;
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== "number" || payload.exp < now) return false;
    if (payload.nbf && payload.nbf > now + 60) return false;
    const aud: string[] = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(env.ACCESS_AUD!)) return false;
    if (payload.iss !== `https://${team}`) return false;

    let jwk = (await getKeys(team)).find((k) => k.kid === header.kid);
    if (!jwk) jwk = (await getKeys(team, true)).find((k) => k.kid === header.kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey(
      "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"],
    );
    return await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5", key, b64urlToBytes(parts[2]),
      new TextEncoder().encode(parts[0] + "." + parts[1]),
    );
  } catch {
    return false;
  }
}
