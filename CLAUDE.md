# Homework Desk — notes for Claude Code

A homework helper for a 2nd grader. Parents upload a photo or PDF of a worksheet; Claude rebuilds it
as a "clean copy" with boxes to type in. Single Cloudflare Worker + static assets, D1, R2, Cloudflare Access.
Live at https://simonswork.app. Full plan: `docs/PLAN.md`. Original claude.ai prototype: `docs/prototype.html`.

## Layout
- `public/index.html` — markup + CSS. Keep the Groundwork tokens in `:root`. No framework, no build step.
- `public/api.js` — the only place the browser talks to the server (`window.API`).
- `public/switcher.js` — the app dropdown (top right). The list of apps lives here; pages only hold an empty
  `<details class="switcher" data-current="homework|arcade|comic">`.
- `public/app.js` — UI logic, ported from the prototype.
- `src/index.ts` — Worker router. Only `/api/*` and `/img/*` run the Worker (`run_worker_first`); everything else is a static asset.
- `src/routes/*.ts` — assignments, pages (+ image serving), answers/typed values, clean copy (build, Fix, Put it back).
- `src/prompt.ts` — `PAGE_PROMPT` (build a page) and `fixPrompt` (the child's Fix button).
- `src/routes/tags.ts` — page tags (subject/topic) read off each photo by `CLAUDE_TAG_MODEL` (Haiku); they drive the
  sidebar filter. Assignments have no subject in the UI any more (the column stays, unused).
- `src/access.ts` — Cloudflare Access JWT check. Fails closed unless `DEV_NO_ACCESS=1` (local only).
- `migrations/` — D1 schema. Add a new numbered file; never edit an applied one.
- `public/games/` — the Typing Arcade (`/games/`): `shared.js` (levels, word lists, finger-colour keyboard, sounds,
  menu/countdown/results flow), one file per game (`letter-lane.js`, `meteor-words.js`), `games.css`.
  Plain canvas, 320×180 logical pixels; pixel art is built in code with `sprite()`, no image or audio files.
- `src/routes/games.ts` — game scores and the "My homework" word list (pulled from clean copies).
- Comic Maker (`/comic/`, plan in `docs/COMIC_PLAN.md`): `public/comic/` (one page, hash routes `#/`, `#/c/<id>`,
  `#/library`), `src/routes/comics.ts`, `src/comic-prompt.ts` (script prompt, JSON schema, content rules, word list,
  image prompts), `src/gemini.ts` (Nano Banana Pro images), `src/voice.ts` (read-aloud: voice director + Gemini
  text-to-speech), `src/comic-mock.ts` (fake AI for local dev).

## Rules
- All reads and writes go through `/api/*`. The client never calls Anthropic directly; the key is a Worker secret.
- Clean copies are HTML that Claude writes: `{v: 2, title, html}`. The tags/attributes allowed in `RULES`
  (`src/prompt.ts`) must match `sanitizePage` in `public/app.js`, which is the only thing standing between Claude's
  HTML and the DOM; never render a page without it. Interactive parts: `<input data-f>`, `<textarea data-f>`,
  `data-paint` (colourable) inside `data-group="one|many"`. Change prompt and renderer together.
- Older clean copies are the JSON worksheet (`line`, `vertical`, `write`, `choice`, `table`, `wordbank`, `text`,
  `figure`) drawn by `renderWorksheet`; keep it working. A Fix on one rebuilds it as HTML.
- Fix keeps typed values (Claude keeps the ids of parts it doesn't change) and saves the previous page in
  `clean_copies.prev_data` for "Put it back".
- Field ids (`b1`, `w1`, `p1`… on HTML pages, `b0`, `c2`… on older ones) must match `/^[a-z]\d{1,4}$/` (the
  typed-values allow-list). Rebuilding a page (Redo) clears `typed_values` for it; Fix doesn't.
- Model and effort come from `CLAUDE_MODEL` / `CLAUDE_EFFORT` in `wrangler.jsonc` vars; tagging uses `CLAUDE_TAG_MODEL`.
- Comic Maker: the browser drives the steps (POST /api/comics writes the script, then one
  POST /api/comics/:id/draw/<char-N|panel-N> per picture, 3 at a time), so no Worker request runs long and an
  unfinished comic resumes when reopened. Words are never drawn into the pictures: captions and bubbles are HTML
  over the art, so spelling is exact. The script JSON shape is a contract between `src/comic-prompt.ts` and
  `public/comic/comic.js`. Keep it calm: no points, streaks or timers. No daily cap by default (`COMIC_DAILY_LIMIT` turns one on).
  Without `GEMINI_API_KEY` comics show as text panels.
- Read-aloud: POST /api/comics/:id/voice makes the voice plan once (CLAUDE_TAG_MODEL picks a Gemini voice per
  speaker and a "Say …" direction per line; lines come from `scriptLines()` so their numbers are stable), then
  POST /api/comics/:id/voice/:k records line k once (GEMINI_TTS_MODEL, PCM wrapped as WAV, stored as slot voice-k).
  The page plays clips with Web Audio, unlocked inside the tap (iPad rule), and falls back to speechSynthesis.
- Games are for a beginner on a physical keyboard: every level shows the next key and which finger to use.
  Level ids in `public/games/shared.js` (LEVELS) must match the allow-list in `src/routes/games.ts`.
  Letters are shown UPPERCASE (like the keycaps); words are lowercase.
- Don't re-enable `workers_dev` or `preview_urls`: they would bypass Cloudflare Access. The Worker also verifies
  the Access JWT itself, so leave that check in place.

## Commands
- `cp .dev.vars.example .dev.vars && npm run db:migrate:local && npm run dev` — local app at http://localhost:8787
  (`MOCK_AI=1` in `.dev.vars` fakes Claude and Gemini for the Comic Maker)
- `npm run typecheck`
- `npm run deploy` — applies remote D1 migrations, then deploys (Workers Builds runs this on push to `main`).

## Parallel work
API routes, the front-end adapter and infra config are independent and can go to separate agents/worktrees.
