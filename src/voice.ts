import Anthropic from "@anthropic-ai/sdk";
import { Buffer } from "node:buffer";
import { type Env, HttpError } from "./env";
import type { Script } from "./comic-prompt";

/**
 * Comic Maker read-aloud.
 * 1. A voice director (Claude, the small CLAUDE_TAG_MODEL) picks a Gemini voice and a short style for each speaker,
 *    and an optional mood for each line.
 * 2. Lines are grouped into "takes": one panel at a time, at most two voices per take (Gemini's multi-speaker limit).
 *    Gemini performs each take in one request, so a comic is ~5–7 requests instead of one per line.
 * 3. Each take is recorded once and kept in R2 (slot voice-k); the page records them in the background as soon as
 *    the comic is drawn, so reading starts right away.
 * Bump VOICE_VERSION when the style or the take layout changes: old recordings are then thrown away and redone.
 */
export const VOICE_VERSION = 2;

// Gemini's prebuilt voices and their character, as Google describes them.
export const VOICES: Record<string, string> = {
  Zephyr: "bright", Puck: "upbeat", Charon: "informative", Kore: "firm", Fenrir: "excitable", Leda: "youthful",
  Orus: "firm", Aoede: "breezy", Callirrhoe: "easy-going", Autonoe: "bright", Enceladus: "breathy", Iapetus: "clear",
  Umbriel: "easy-going", Algieba: "smooth", Despina: "smooth", Erinome: "clear", Algenib: "gravelly",
  Rasalgethi: "informative", Laomedeia: "upbeat", Achernar: "soft", Alnilam: "firm", Schedar: "even", Gacrux: "mature",
  Pulcherrima: "forward", Achird: "friendly", Zubenelgenubi: "casual", Vindemiatrix: "gentle", Sadachbia: "lively",
  Sadaltager: "knowledgeable", Sulafat: "warm",
};
const NARRATOR_VOICES = ["Zubenelgenubi", "Umbriel", "Callirrhoe", "Achird", "Puck"];   // casual, not "storyteller"
const NARRATOR_DEFAULT = "Zubenelgenubi";
const CHARACTER_DEFAULTS = ["Puck", "Algenib", "Leda", "Fenrir", "Umbriel", "Sadachbia"];
const NARRATOR_STYLE = "chill and dry, a little sarcastic, like a funny older cousin";

/** How everything should sound. Sent with every take. */
const PERFORMANCE =
  "Read this bit of a funny kids' comic out loud like a funny older cousin reading it to a friend: natural, " +
  "relaxed and conversational, with good comic timing and a little deadpan. Not a teacher, not a bedtime story, " +
  "not over the top: no big dramatic swoops, no shouting. Let the jokes land by underplaying them.";

export type Line = { panel: number | "title" | "end"; who: string; text: string };
export type Take = { panel: number; lines: number[] };
export type VoicePlan = {
  v: number;
  voices: Record<string, string>;
  styles: Record<string, string>;
  moods: Record<string, string>;     // line number -> mood
  lines: Line[];
  takes: Take[];
};

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

/** Group lines into takes: one panel at a time (the title joins the first panel, "The End" the last), max 2 voices. */
export function makeTakes(lines: Line[], panelCount: number): Take[] {
  const panelOf = (l: Line) => (l.panel === "title" ? 0 : l.panel === "end" ? Math.max(0, panelCount - 1) : l.panel);
  const takes: Take[] = [];
  let cur: Take | null = null, who = new Set<string>();
  lines.forEach((l, n) => {
    const p = panelOf(l);
    if (!cur || cur.panel !== p || (!who.has(l.who) && who.size >= 2)) {
      cur = { panel: p, lines: [] }; takes.push(cur); who = new Set();
    }
    cur.lines.push(n); who.add(l.who);
  });
  return takes;
}

const DIRECTOR = `You are the voice director for a funny kids' comic that will be read aloud.
The sound we want: a funny older cousin reading a comic to a friend and doing the voices. Natural and
conversational, good comic timing, a bit deadpan. Never a teacher, never a bedtime story, never over the top.

For every speaker, pick a voice from this list (name: quality):
${Object.entries(VOICES).map(([n, q]) => `${n}: ${q}`).join(", ")}.
- Narrator: pick one of ${NARRATOR_VOICES.join(", ")}. Style: chill, dry, a little sarcastic.
- Every other speaker gets a different voice that fits them, and a short style (3 to 8 words) that is funny
  but understated, e.g. "overconfident, a bit goofy", "grumpy and mumbly", "sleepy and unimpressed",
  "fast-talking and nervous". Avoid "dramatic", "booming", "theatrical", "storyteller".
For each numbered line you may add a mood of 1 to 3 words when it helps the joke ("surprised", "deadpan",
"trying to sound brave", "very proud"). Leave the mood empty for most lines.`;

const PLAN_SCHEMA = {
  type: "object", additionalProperties: false, required: ["voices", "moods"],
  properties: {
    voices: { type: "array", items: { type: "object", additionalProperties: false, required: ["speaker", "voice", "style"],
      properties: { speaker: { type: "string" }, voice: { type: "string" }, style: { type: "string" } } } },
    moods: { type: "array", items: { type: "object", additionalProperties: false, required: ["n", "mood"],
      properties: { n: { type: "integer" }, mood: { type: "string" } } } },
  },
};

const clean = (s: unknown, max: number) => String(s ?? "").replace(/[\n:]+/g, " ").trim().slice(0, max);

/** Ask the voice director for voices, styles and moods. Falls back to sensible defaults if anything is off. */
export async function directVoices(env: Env, s: Script): Promise<VoicePlan> {
  const lines = scriptLines(s);
  const speakers = [...new Set(lines.map((l) => l.who))];
  const voices: Record<string, string> = {}, styles: Record<string, string> = {}, moods: Record<string, string> = {};
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
      const plan = JSON.parse(text) as { voices: { speaker: string; voice: string; style: string }[]; moods: { n: number; mood: string }[] };
      for (const v of plan.voices || []) {
        if (!speakers.includes(v.speaker)) continue;
        if (VOICES[v.voice]) voices[v.speaker] = v.voice;
        if (v.style) styles[v.speaker] = clean(v.style, 80);
      }
      for (const m of plan.moods || []) if (m.mood?.trim() && lines[m.n]) moods[String(m.n)] = clean(m.mood, 30);
    } catch (e) {
      console.error("voice director failed; using defaults", e);
    }
  }
  // Fill gaps: a casual narrator, then a distinct voice for everyone else.
  if (!NARRATOR_VOICES.includes(voices.Narrator)) voices.Narrator = NARRATOR_DEFAULT;
  styles.Narrator = styles.Narrator || NARRATOR_STYLE;
  const used = new Set([voices.Narrator]);
  for (const sp of speakers) {
    if (sp === "Narrator") continue;
    if (!voices[sp] || used.has(voices[sp])) voices[sp] = CHARACTER_DEFAULTS.find((v) => !used.has(v)) || "Puck";
    used.add(voices[sp]);
    styles[sp] = styles[sp] || "funny but natural";
  }
  return { v: VOICE_VERSION, voices, styles, moods, lines, takes: makeTakes(lines, s.panels.length) };
}

/** The text sent to Gemini for one take: the performance note, who is who, moods, then the lines. */
export function takePrompt(plan: VoicePlan, k: number): { prompt: string; speakers: string[] } {
  const take = plan.takes[k];
  const ls = take.lines.map((n) => ({ n, ...plan.lines[n] }));
  const speakers = [...new Set(ls.map((l) => l.who))];
  const alias = (s: string) => `Speaker${speakers.indexOf(s) + 1}`;
  const name = (s: string) => (s === "Narrator" ? "the narrator" : s);
  const cast = speakers.length > 1
    ? speakers.map((s) => `${alias(s)} is ${name(s)}: ${plan.styles[s]}.`).join("\n")
    : `This is ${name(speakers[0])}: ${plan.styles[speakers[0]]}.`;
  const moodNotes = ls.filter((l) => plan.moods[l.n])
    .map((l) => `"${l.text.slice(0, 40)}${l.text.length > 40 ? "…" : ""}" ${plan.moods[l.n]}`);
  const transcript = ls.map((l) => (speakers.length > 1 ? `${alias(l.who)}: ${l.text}` : l.text)).join("\n");
  const prompt = [PERFORMANCE, cast, moodNotes.length ? `Moods: ${moodNotes.join("; ")}.` : "", "", transcript]
    .filter((x, i) => x || i === 3).join("\n");
  return { prompt, speakers };
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

function mockClip(seconds: number): Uint8Array {
  // A short rising "bloop" so local tests have something to play.
  const rate = 24000, n = Math.floor(rate * Math.min(2.5, seconds));
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) pcm[i] = Math.sin(2 * Math.PI * (300 + 200 * (i / n)) * (i / rate)) * 6000 * Math.min(1, (n - i) / 800);
  return pcmToWav(new Uint8Array(pcm.buffer), rate);
}

/** Record one take. Two speakers use Gemini's multi-speaker mode; one speaker a single voice. */
export async function speakTake(env: Env, plan: VoicePlan, k: number): Promise<{ bytes: Uint8Array; mime: string }> {
  const { prompt, speakers } = takePrompt(plan, k);
  if (env.MOCK_AI === "1") return { bytes: mockClip(0.4 + prompt.length / 400), mime: "audio/wav" };
  if (!env.GEMINI_API_KEY) throw new HttpError(503, "voice_off", "Voices are not set up yet: the server has no Gemini API key.");
  const voiceOf = (s: string) => ({ prebuiltVoiceConfig: { voiceName: plan.voices[s] || NARRATOR_DEFAULT } });
  const configs = [
    speakers.length > 1
      ? { multiSpeakerVoiceConfig: { speakerVoiceConfigs: speakers.map((s, i) => ({ speaker: `Speaker${i + 1}`, voiceConfig: voiceOf(s) })) } }
      : { voiceConfig: voiceOf(speakers[0]) },
    { voiceConfig: { prebuiltVoiceConfig: { voiceName: NARRATOR_DEFAULT } } },   // last resort: one voice for the take
  ];
  const models = [...new Set([workingModel, env.GEMINI_TTS_MODEL, "gemini-3.1-flash-tts-preview", "gemini-2.5-flash-preview-tts"].filter(Boolean))] as string[];
  let lastDetail = "";
  for (const model of models) {
    for (const speechConfig of configs) {
      let r!: Response;
      // Gemini's speech models allow only a few requests a minute on lower tiers. When it says "too many",
      // wait as long as it asks (up to ~20s, twice) and try again instead of giving up.
      for (let tries = 0; ; tries++) {
        try {
          r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: { responseModalities: ["AUDIO"], speechConfig },
            }),
            signal: AbortSignal.timeout(60_000),
          });
        } catch { throw new HttpError(504, "timeout"); }
        if (r.status !== 429) break;
        const detail = await r.text();
        const perDay = /per.?day|PerDay/i.test(detail);
        const wait = retryAfterSeconds(r, detail) ?? 3 * 2 ** tries;
        console.warn("gemini tts 429", model, `wait ${wait}s`, perDay ? "(daily quota)" : "", detail.slice(0, 200));
        if (perDay) throw new HttpError(429, "voice_quota", "Gemini's daily speech quota is used up.");
        if (tries >= 2 || wait > 20) throw new HttpError(429, "rate_limited");
        await new Promise((res) => setTimeout(res, wait * 1000 + 250));
      }
      if (r.status === 404) { lastDetail = `model ${model} not found`; break; }          // try the next model
      if (r.status === 401 || r.status === 403) throw new HttpError(503, "voice_off", "The Gemini API key was rejected.");
      if (r.status >= 500) throw new HttpError(503, "overloaded");
      if (!r.ok) { lastDetail = (await r.text()).slice(0, 300); console.error("gemini tts", model, r.status, lastDetail); continue; }
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
