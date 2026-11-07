# Comic Maker Build Plan — simonswork.app

## Summary

Add a "Comic Maker" to simonswork.app. Simon types a story once and taps **Make my comic**. The app turns it into a 4–6 panel comic with consistent characters, captions, speech bubbles, and optional read-aloud narration. Stack: Cloudflare Worker (existing homework-desk), Claude for scripting and safety, Nano Banana Pro (Gemini API) for art, app-side text overlay for perfect spelling, R2 for storage.

## Goals

- Reward typing: his words become a real comic.
- Zero handwriting, zero re-typing: one input, fully automated pipeline.
- Cheeky but safe: Captain Underpants / Looney Tunes level humor.
- Not addictive: no points, streaks, leaderboards, or timers.

## User Flow

1. Simon opens Comic Maker and types a story (prompt helpers: "Who's your hero?", "What goes wrong?", "How does it end?").
2. Taps **Make my comic**.
3. Fun loading screen ("Drawing panel 2 of 5...").
4. Comic page appears; tap to hear it read aloud.
5. Comic saved to his library; parents can view all comics and source text.

## Architecture

- **Frontend:** existing app, new /comic route. Text box, generate button, comic viewer (CSS grid/canvas), library page.
- **Worker endpoints:**
  - POST /api/comic: accepts story, kicks off the job, returns a job ID.
  - GET /api/comic/:id: status plus panel URLs and script JSON.
- **Async jobs:** Cloudflare Queues or Durable Objects to run panel generation in parallel without hitting Worker time limits.
- **Storage:** R2 for images and audio; D1 or KV for comic metadata, script JSON, and logs.
- **Auth:** existing Cloudflare Access (family only).
- **Secrets:** ANTHROPIC\_API\_KEY, GEMINI\_API\_KEY as Worker secrets.

## Pipeline

### Step 1: Script (Claude)

Send Simon's raw story with a system prompt that:

- Keeps his ideas and words wherever possible.
- Applies the content rules (below) by **remixing, never refusing**.
- Returns strict JSON:

```json
{
  "title": "Captain Burp vs. the Slime King",
  "style": "bright flat cartoon, bold outlines, kid comic",
  "characters": [{"name": "Captain Burp", "look": "small boy hero, red cape, goggles"}],
  "panels": [
    {"scene": "Captain Burp lands on a giant pudding mountain", "caption": "One day...", "dialogue": [{"speaker": "Captain Burp", "text": "Time to save the day!"}]}
  ]
}
```

### Step 2: Character Sheet (Nano Banana Pro)

Generate one reference image per main character from the "look" plus the style. Store in R2.

### Step 3: Panels (Nano Banana Pro)

For each panel, send the scene + style + character reference image(s). Instruct: "Leave blank space at top for caption and an empty speech bubble near each speaker. No text in image." Run panels in parallel.

### Step 4: Text Overlay (App)

Render captions and speech bubbles from the JSON in HTML/CSS over each panel, so spelling is always exact and his words appear on the page. Optional later: let the model draw text directly and compare.

### Step 5: Narration (optional)

Text-to-speech (e.g., Google TTS, ElevenLabs, or the browser's speechSynthesis to start, free) reads the captions and dialogue panel by panel.

### Step 6: Export (later)

Download as PNG page or PDF; optional storybook video with pans and fades via Remotion/FFmpeg.

## Content Rules (System Prompt)

**Allowed:** burps, farts, slime, boogers, goo splats, cartoon slapstick (flattened and pops back up), water blasters, foam darts, paint and pudding cannons, silly villains.

**Remixed:** real guns become goo or jelly blasters; "kills" becomes "blasts away" or "turns into a frog"; scary becomes silly.

**Never:** blood, death, injury, real weapons, nudity or bathroom body parts, mean jokes about real people, scary or horror content.

**Backstops:** short keyword blocklist before and after Claude; Gemini safety settings at default or stricter; everything logged for parent review.

## Guardrails Against Hooking

- Daily cap (e.g., 2–3 comics/day), configurable by parents.
- No scores, streaks, badges, or timers.
- Each comic ends with a calm "The End" screen, no autoplay into another.
- Optional unlock: Comic Maker opens after homework is submitted.

## Build Phases

1. **Script only:** story to Claude to JSON, displayed as text panels. Tune the remix prompt with real Simon stories.
2. **Art:** add Nano Banana Pro panels (no character sheet yet), app overlay text.
3. **Consistency:** add character sheet references.
4. **Polish:** loading screen, library, read-aloud, parent log view, daily cap.
5. **Extras:** PDF export, storybook video, save favorite heroes for reuse.

## Cost and Performance Notes

- One comic = 1 Claude call + \~1 character sheet + 4–6 image calls. Check current Gemini pricing; budget cents per comic.
- Expect \~20–60 seconds per comic with parallel panel generation.
- Confirm the current Nano Banana Pro model ID in Google AI Studio before wiring.

## Open Questions

- Panel count: fixed (4) or chosen by story length?
- Narration voice: browser TTS vs. a paid voice?
- Where it lives in the nav: reward after homework, or always available?
