# Homework Desk — notes for Claude Code

A homework helper for a 2nd grader. Parents upload a photo or PDF of a worksheet; Claude rebuilds it
as a "clean copy" with boxes to type in. Single Cloudflare Worker + static assets, D1, R2, Cloudflare Access.
Live at https://simonswork.app. Full plan: `docs/PLAN.md`. Original claude.ai prototype: `docs/prototype.html`.

## Layout
- `public/index.html` — markup + CSS. Keep the Groundwork tokens in `:root`. No framework, no build step.
- `public/api.js` — the only place the browser talks to the server (`window.API`).
- `public/app.js` — UI logic, ported from the prototype.
- `src/index.ts` — Worker router. Only `/api/*` and `/img/*` run the Worker (`run_worker_first`); everything else is a static asset.
- `src/routes/*.ts` — assignments, pages (+ image serving), answers/typed values, clean copy.
- `src/prompt.ts` — `CLEAN_PROMPT`.
- `src/access.ts` — Cloudflare Access JWT check. Fails closed unless `DEV_NO_ACCESS=1` (local only).
- `migrations/` — D1 schema. Add a new numbered file; never edit an applied one.
- `public/games/` — the Typing Arcade (`/games/`): `shared.js` (levels, word lists, finger-colour keyboard, sounds,
  menu/countdown/results flow), one file per game (`letter-lane.js`, `meteor-words.js`), `games.css`.
  Plain canvas, 320×180 logical pixels; pixel art is built in code with `sprite()`, no image or audio files.
- `src/routes/games.ts` — game scores and the "My homework" word list (pulled from clean copies).

## Rules
- All reads and writes go through `/api/*`. The client never calls Anthropic directly; the key is a Worker secret.
- The clean-copy JSON shape (`line`, `vertical`, `write`, `choice`, `wordbank`, `text`, `figure`) is a contract
  between `src/prompt.ts` and `renderWorksheet` in `public/app.js`. Change both together.
- Field ids on the clean copy (`b0`, `w1`, `c2`…) are assigned in render order. Rebuilding a clean copy clears
  `typed_values` for that page (server-side, in `src/routes/clean.ts`).
- Model and effort come from `CLAUDE_MODEL` / `CLAUDE_EFFORT` in `wrangler.jsonc` vars.
- Games are for a beginner on a physical keyboard: every level shows the next key and which finger to use.
  Level ids in `public/games/shared.js` (LEVELS) must match the allow-list in `src/routes/games.ts`.
  Letters are shown UPPERCASE (like the keycaps); words are lowercase.
- Don't re-enable `workers_dev` or `preview_urls`: they would bypass Cloudflare Access. The Worker also verifies
  the Access JWT itself, so leave that check in place.

## Commands
- `cp .dev.vars.example .dev.vars && npm run db:migrate:local && npm run dev` — local app at http://localhost:8787
- `npm run typecheck`
- `npm run deploy` — applies remote D1 migrations, then deploys (Workers Builds runs this on push to `main`).

## Parallel work
API routes, the front-end adapter and infra config are independent and can go to separate agents/worktrees.
