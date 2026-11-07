import { Buffer } from "node:buffer";
import { type Env, HttpError } from "./env";

/**
 * Image generation with Gemini ("Nano Banana Pro"), raw REST.
 * Model id comes from GEMINI_IMAGE_MODEL so it can change without a code change.
 */
export type Picture = { bytes: Uint8Array; mime: string };

const SAFETY = ["HARASSMENT", "HATE_SPEECH", "SEXUALLY_EXPLICIT", "DANGEROUS_CONTENT"].map((c) => ({
  category: `HARM_CATEGORY_${c}`,
  threshold: "BLOCK_LOW_AND_ABOVE",
}));

type Part = { text?: string; inlineData?: { mimeType: string; data: string }; inline_data?: { mime_type: string; data: string } };
type GenResponse = {
  candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
};

export async function drawPicture(env: Env, prompt: string, refs: Picture[], aspectRatio: "1:1" | "4:3"): Promise<Picture> {
  if (!env.GEMINI_API_KEY) throw new HttpError(503, "art_off", "Pictures are not set up yet: the server has no Gemini API key.");
  const model = env.GEMINI_IMAGE_MODEL || "gemini-3-pro-image-preview";
  const body = {
    contents: [{
      role: "user",
      parts: [
        ...refs.map((r) => ({ inlineData: { mimeType: r.mime, data: Buffer.from(r.bytes).toString("base64") } })),
        { text: prompt },
      ],
    }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio, imageSize: "1K" } },
    safetySettings: SAFETY,
  };
  let r: Response;
  try {
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(170_000),
    });
  } catch {
    throw new HttpError(504, "timeout");
  }
  if (!r.ok) {
    const detail = (await r.text()).slice(0, 500);
    console.error("gemini", r.status, detail);
    if (r.status === 429) throw new HttpError(429, "rate_limited");
    if (r.status === 401 || r.status === 403) throw new HttpError(503, "art_off", "The Gemini API key was rejected.");
    if (r.status === 404) throw new HttpError(503, "art_off", `Gemini model "${model}" was not found. Check GEMINI_IMAGE_MODEL.`);
    if (r.status >= 500) throw new HttpError(503, "overloaded");
    throw new HttpError(502, "art_failed", detail);
  }
  const data = (await r.json()) as GenResponse;
  const cand = data.candidates?.[0];
  for (const p of cand?.content?.parts ?? []) {
    const inline = p.inlineData ?? (p.inline_data && { mimeType: p.inline_data.mime_type, data: p.inline_data.data });
    if (inline?.data) return { bytes: new Uint8Array(Buffer.from(inline.data, "base64")), mime: inline.mimeType || "image/png" };
  }
  console.error("gemini: no image", data.promptFeedback?.blockReason, cand?.finishReason);
  if (data.promptFeedback?.blockReason || /SAFETY|PROHIBITED|BLOCKLIST/.test(cand?.finishReason || "")) {
    throw new HttpError(422, "art_blocked");
  }
  throw new HttpError(502, "art_failed");
}
