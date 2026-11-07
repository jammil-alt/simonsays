import Anthropic from "@anthropic-ai/sdk";
import { Buffer } from "node:buffer";
import { type Env, HttpError } from "./env";
import type { Script } from "./comic-prompt";

/**
 * Comic Maker read-aloud with real acting.
 * 1. A voice director (Claude, the small CLAUDE_TAG_MODEL) gives each speaker a voice and each line a direction.
 * 2. Gemini text-to-speech performs one line at a time ("Say it like a grumpy slime king: Blorp!").
 * The browser plays the clips in order; each clip is made once and kept in R2.
 */

// Gemini's prebuilt voices and their character, as Google describes them.
export const VOICES: Record<string, string> = {
  Zephyr: "bright", Puck: "upbeat", Charon: "informative", Kore: "firm", Fenrir: "excitable", Leda: "youthful",
  Orus: "firm", Aoede: "breezy", Callirrhoe: "easy-going", Autonoe: "bright", Enceladus: "breathy", Iapetus: "clear",
  Umbriel: "easy-going", Algieba: "smooth", Despina: "smooth", Erinome: "clear", Algenib: "gravelly",
  Rasalgethi: "informative", Laomedeia: "upbeat", Achernar: "soft", Alnilam: "firm", Schedar: "even", Gacrux: "mature",
  Pulcherrima: "forward", Achird: "friendly", Zubenelgenubi: "casual", Vindemiatrix: "gentle", Sadachbia: "lively",
  Sadaltager: "knowledgeable", Sulafat: "warm",
};
const NARRATOR_DEFAULT = "Sulafat";
const CHARACTER_DEFAULTS = ["Puck", "Algenib", "Leda", "Fenrir"];

export type Line = { panel: number | "title" | "end"; who: string; text: string };
export type VoicePlan = { voices: Record<string, string>; lines: (Line & { how: string })[] };

/** Everything that gets read out, in order. Deterministic from the script, so line numbers are stable. */
export function scriptLines(s: Script): Line[] {
  const out: Line[] = [{ panel: "title", who: "Narrator", text: s.title }];
  s.panels.forEach((p, i) => {
    if (p.caption) out.push({ panel: i, who: "Narrator", text: p.caption });
    for (const d of p.dialogue) out.push({ panel: i, who: d.speaker || "Narrator", text: d.text });
  });
  out.push({ panel: "end", who: "Narrator", text: "The End." });
  return out.filter((l) => l.text.trim());
}

const DIRECTOR = `You are the voice director for a funny kids' comic that will be read aloud to a 7-year-old.
Pick a voice for every speaker from this list (name: quality):
${Object.entries(VOICES).map(([n, q]) => `${n}: ${q}`).join(", ")}.
- The Narrator sounds warm and storybook-like, a little dramatic at exciting moments.
- Every other speaker gets a different voice that fits them: a little hero might be youthful or excitable,
  a silly villain gravelly or grumpy, a gentle animal soft or gentle.
- For every numbered line, write "how": a short acting direction that starts with "Say", e.g.
  "Say it like an excited little superhero", "Say in a grumpy, gloopy villain voice",
  "Say with wonder, like a storyteller at bedtime", "Say with a big burp-y laugh".
  Make it lively and fun, never scary. Don't repeat the line's words in "how".`;

const PLAN_SCHEMA = {
  type: "object", additionalProperties: false, required: ["voices", "lines"],
  properties: {
    voices: { type: "array", items: { type: "object", additionalProperties: false, required: ["speaker", "voice"],
      properties: { speaker: { type: "string" }, voice: { type: "string" } } } },
    lines: { type: "array", items: { type: "object", additionalProperties: false, required: ["n", "how"],
      properties: { n: { type: "integer" }, how: { type: "string" } } } },
  },
};

const tidyHow = (h: unknown) => {
  let s = String(h ?? "").replace(/[:\n]+/g, " ").trim().slice(0, 140);
  if (!/^say\b/i.test(s)) s = s ? `Say ${s}` : "Say it with feeling";
  return s;
};

/** Ask the voice director for voices and directions. Falls back to sensible defaults if anything is off. */
export async function directVoices(env: Env, s: Script): Promise<VoicePlan> {
  const lines = scriptLines(s);
  const speakers = [...new Set(lines.map((l) => l.who))];
  const voices: Record<string, string> = {};
  let hows: Record<number, string> = {};
  if (env.MOCK_AI !== "1" && env.ANTHROPIC_API_KEY) {
    try {
      const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 60_000 });
      const characters = s.characters.map((c) => `${c.name}: ${c.look}`).join("\n");
      const msg = await client.messages.create({
        model: env.CLAUDE_TAG_MODEL || "claude-haiku-5-5",
        max_tokens: 4000,
        system: DIRECTOR,
        output_config: { effort: "low", format: { type: "json_schema", schema: PLAN_SCHEMA } },
        messages: [{ role: "user", content:
          `Comic: "${s.title}"\nCharacters:\n${characters || "(none)"}\nSpeakers: ${speakers.join(", ")}\n\nLines:\n` +
          lines.map((l, n) => `${n}. ${l.who}: ${l.text}`).join("\n") }],
      });
      const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      const plan = JSON.parse(text) as { voices: { speaker: string; voice: string }[]; lines: { n: number; how: string }[] };
      for (const v of plan.voices || []) if (VOICES[v.voice]) voices[v.speaker] = v.voice;
      hows = Object.fromEntries((plan.lines || []).map((l) => [l.n, l.how]));
    } catch (e) {
      console.error("voice director failed; using defaults", e);
    }
  }
  // Fill gaps: narrator first, then distinct voices for everyone else.
  const used = new Set<string>();
  if (!voices.Narrator) voices.Narrator = NARRATOR_DEFAULT;
  used.add(voices.Narrator);
  for (const sp of speakers) {
    if (voices[sp] && (sp === "Narrator" || !used.has(voices[sp]))) { used.add(voices[sp]); continue; }
    voices[sp] = CHARACTER_DEFAULTS.find((v) => !used.has(v)) || "Puck";
    used.add(voices[sp]);
  }
  return {
    voices,
    lines: lines.map((l, n) => ({ ...l, how: tidyHow(hows[n] ?? (l.who === "Narrator" ? "Say it like a warm storyteller" : "Say it with lots of feeling")) })),
  };
}

/* ---------- Gemini text-to-speech ---------- */

/** Seconds Gemini asks us to wait: the Retry-After header, or RetryInfo.retryDelay ("17s") in the error body. */
function retryAfterSeconds(r: Response, body: string): number | null {
  const h = Number(r.headers.get("retry-after"));
  if (Number.isFinite(h) && h > 0) return h;
  const m = /"retryDelay"\s*:\s*"([\d.]+)s"/.exec(body);
  return m ? Math.ceil(Number(m[1])) : null;
}

let workingModel: string | null = null;   // remembered per Worker instance after the first success

/** Gemini returns raw 16-bit PCM; browsers need a WAV header in front of it. */
function pcmToWav(pcm: Uint8Array, rate: number, channels = 1): Uint8Array {
  const h = new DataView(new ArrayBuffer(44));
  const w = (o: number, s: string) => [...s].forEach((c, i) => h.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); h.setUint32(4, 36 + pcm.length, true); w(8, "WAVE"); w(12, "fmt ");
  h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, channels, true); h.setUint32(24, rate, true);
  h.setUint32(28, rate * channels * 2, true); h.setUint16(32, channels * 2, true); h.setUint16(34, 16, true);
  w(36, "data"); h.setUint32(40, pcm.length, true);
  const out = new Uint8Array(44 + pcm.length); out.set(new Uint8Array(h.buffer), 0); out.set(pcm, 44);
  return out;
}

function mockClip(text: string): Uint8Array {
  // A short rising "bloop" per line so local tests have something to play.
  const rate = 24000, secs = Math.min(1.2, 0.25 + text.length * 0.01), n = Math.floor(rate * secs);
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) pcm[i] = Math.sin(2 * Math.PI * (300 + 200 * (i / n)) * (i / rate)) * 6000 * Math.min(1, (n - i) / 800);
  return pcmToWav(new Uint8Array(pcm.buffer), rate);
}

export async function speakLine(env: Env, line: { text: string; how: string }, voice: string): Promise<{ bytes: Uint8Array; mime: string }> {
  if (env.MOCK_AI === "1") return { bytes: mockClip(line.text), mime: "audio/wav" };
  if (!env.GEMINI_API_KEY) throw new HttpError(503, "voice_off", "Voices are not set up yet: the server has no Gemini API key.");
  const candidates = [...new Set([workingModel, env.GEMINI_TTS_MODEL, "gemini-3.1-flash-tts-preview", "gemini-2.5-flash-preview-tts"].filter(Boolean))] as string[];
  const body = (v: string) => JSON.stringify({
    contents: [{ role: "user", parts: [{ text: `${line.how}: ${line.text}` }] }],
    generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: v } } } },
  });
  let lastDetail = "";
  for (const model of candidates) {
    for (const v of [voice, NARRATOR_DEFAULT]) {
      let r!: Response;
      // Gemini's speech models allow only a few requests a minute on lower tiers. When it says
      // "too many", wait as long as it asks (up to ~25s) and try again instead of giving up.
      for (let tries = 0; ; tries++) {
        try {
          r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
            body: body(v),
            signal: AbortSignal.timeout(60_000),
          });
        } catch { throw new HttpError(504, "timeout"); }
        if (r.status !== 429) break;
        const detail = await r.text();
        const perDay = /per.?day|PerDay/i.test(detail);
        const wait = retryAfterSeconds(r, detail) ?? 2 * 2 ** tries;
        console.warn("gemini tts 429", model, `wait ${wait}s`, perDay ? "(daily quota)" : "", detail.slice(0, 200));
        if (perDay) throw new HttpError(429, "voice_quota", "Gemini's daily speech quota is used up.");
        if (tries >= 3 || wait > 25) throw new HttpError(429, "rate_limited");
        await new Promise((res) => setTimeout(res, wait * 1000 + 250));
      }
      if (r.status === 404) { lastDetail = `model ${model} not found`; break; }        // try the next model
      if (r.status === 401 || r.status === 403) throw new HttpError(503, "voice_off", "The Gemini API key was rejected.");
      if (r.status >= 500) throw new HttpError(503, "overloaded");
      if (!r.ok) { lastDetail = (await r.text()).slice(0, 300); console.error("gemini tts", model, v, r.status, lastDetail); continue; } // e.g. unknown voice: retry with the default
      const data = (await r.json()) as { candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[] };
      const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
      if (!part?.data) { lastDetail = "no audio in response"; continue; }
      workingModel = model;
      const bytes = new Uint8Array(Buffer.from(part.data, "base64"));
      const mime = (part.mimeType || "").toLowerCase();
      if (/^audio\/(wav|x-wav|mpeg|mp3|ogg|webm)/.test(mime)) return { bytes, mime: mime.split(";")[0] };
      const rate = Number(/rate=(\d+)/.exec(mime)?.[1]) || 24000;     // audio/L16;codec=pcm;rate=24000
      return { bytes: pcmToWav(bytes, rate), mime: "audio/wav" };
    }
  }
  console.error("gemini tts gave up:", lastDetail);
  throw new HttpError(502, "voice_failed", lastDetail.includes("not found") ? "No Gemini speech model was found. Check GEMINI_TTS_MODEL." : undefined);
}
