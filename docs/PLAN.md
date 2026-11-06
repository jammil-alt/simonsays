# Homework Desk — Cloudflare build plan

## Summary

Port the claude.ai prototype (`homework-desk.html`) to a single Cloudflare Worker with static assets, deployed from GitHub on every push.

- The UI stays almost as it is.
- The four claude.ai runtime services the page uses (`db`, `assets`, `sample`, `downloads`) are replaced with a small REST API:
  - **D1** holds the data.
  - **R2** holds the page images.
  - **The Anthropic API**, called from the Worker, makes the clean copies.
- **Cloudflare Access** puts the whole site behind a family-only login.

Rough effort: a weekend for v1, most of it in the API and the front-end adapter.

---

## 1. What changes from the prototype

| Prototype (claude.ai runtime) | Cloudflare replacement | Notes |
|---|---|---|
| `claude.use("db")`: collections `assignments`, `answers`, `clean`, `typed` | D1 (SQLite) + REST routes | Live `onSnapshot` sync becomes fetch-on-load plus a refetch on window focus. Optional later: a Durable Object for live sync. |
| `claude.use("assets")`: upload page JPEGs, served at `/_blob/<id>` | R2 bucket, served by the Worker at `/img/<key>` | Keep the browser-side resize and JPEG step (max 2000px) and the PDF-to-pages step with pdf.js. |
| `claude.use("sample")`: vision call that returns worksheet JSON | `POST /api/pages/:id/clean` → Worker → Anthropic Messages API | The prompt moves server-side, and the API key stays a Worker secret. |
| `claude.use("downloads")`: save page as image | Plain `<a download>` with a blob URL | Works normally outside the claude.ai sandbox. |
| Access limited to the owner on claude.ai | Cloudflare Access (Zero Trust), email one-time PIN | The free tier covers up to 50 users. Allow your family's emails only. |

Everything else carries over as-is: the list, the detail view, tap-to-type answers on the photo, the clean-copy renderer, the progress count, the Groundwork tokens and the Andika answer font.

---

## 2. Architecture

```
Browser (index.html + app.js)
   │  fetch /api/*        │  <img src=/img/*>
   ▼                      ▼
Cloudflare Worker (static assets + API router)
   ├── D1  homework-db     (assignments, pages, answers, clean, typed)
   ├── R2  homework-pages  (page JPEGs)
   └── Anthropic API       (clean copy; ANTHROPIC_API_KEY secret)
Cloudflare Access in front of the custom domain
```

There is one Worker. It serves the assets with `assets: { directory: "./public" }` and handles `/api/*` and `/img/*` in code. Use this setup instead of Pages, because it is Cloudflare's current recommended way to run static files plus an API together.

---

## 3. Repo layout

```
homework-desk/
├── public/
│   ├── index.html          # markup + CSS from the prototype
│   └── app.js              # prototype script, using api.js instead of window.claude
├── src/
│   ├── index.ts            # Worker: router
│   ├── routes/assignments.ts
│   ├── routes/pages.ts     # upload, reorder, delete, image serving
│   ├── routes/answers.ts   # photo answers + clean-copy typed values
│   ├── routes/clean.ts     # Anthropic call
│   └── prompt.ts           # CLEAN_PROMPT, moved from the page
├── migrations/0001_init.sql
├── wrangler.jsonc
├── CLAUDE.md               # conventions for Claude Code agents
└── package.json
```

---

## 4. Data model (D1)

```sql
CREATE TABLE assignments (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, subject TEXT, due TEXT,
  done INTEGER DEFAULT 0, size TEXT DEFAULT 'm', created_at INTEGER NOT NULL
);
CREATE TABLE pages (
  id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  position INTEGER NOT NULL, r2_key TEXT NOT NULL, w INTEGER, h INTEGER
);
CREATE TABLE answers (            -- tap-to-type boxes on the photo
  id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  x REAL, y REAL, w REAL, text TEXT, updated_at INTEGER
);
CREATE TABLE clean_copies (       -- worksheet JSON from Claude
  page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
  data TEXT NOT NULL, model TEXT, created_at INTEGER
);
CREATE TABLE typed_values (       -- answers on the clean copy, keyed b0, w1, c2…
  page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
  vals TEXT NOT NULL, updated_at INTEGER
);
CREATE INDEX pages_by_assignment ON pages(assignment_id, position);
CREATE INDEX answers_by_page ON answers(page_id);
```

Turn on foreign keys with `PRAGMA foreign_keys = ON` so that deleting a row cascades. Deleting an assignment also deletes its page images from R2.

---

## 5. API

| Method | Route | Does |
|---|---|---|
| GET | `/api/assignments` | Returns the list for the sidebar, with page count and first-page thumbnail key |
| POST | `/api/assignments` | Creates an assignment |
| GET | `/api/assignments/:id` | Returns the assignment with its pages, answers, clean copies and typed values in one payload |
| PATCH | `/api/assignments/:id` | Updates title, subject, due, done or size |
| DELETE | `/api/assignments/:id` | Deletes the rows and the R2 objects |
| POST | `/api/assignments/:id/pages` | Takes a JPEG body, stores it in R2, adds a row, returns the page |
| PATCH | `/api/pages/:id` | Changes the page's position |
| DELETE | `/api/pages/:id` | Deletes the page and its R2 object |
| GET | `/img/:key` | Streams the image from R2 with a long cache header |
| PUT | `/api/answers/:id` | Upserts a photo answer box |
| DELETE | `/api/answers/:id` | Removes a photo answer box |
| PUT | `/api/pages/:id/typed` | Saves typed values on the clean copy (debounced from the client) |
| POST | `/api/pages/:id/clean` | Runs the Anthropic call, stores the JSON, returns it |

**Clean copy route:**

1. Read the JPEG from R2 and base64 it.
2. Call `messages.create` with one image block plus `CLEAN_PROMPT`.
3. Parse the JSON, check that it has `sections[]`, and store it.
4. Set the model with a `CLAUDE_MODEL` environment variable so you can switch models without a code change.
5. Return friendly errors for a bad photo, a rate limit or unparseable output, the same way the prototype does.

---

## 6. Front-end port (app.js)

Write a small `api.js` adapter and change the call sites. Don't rewrite the UI.

- `db.collection(...).onSnapshot` becomes `load()`, which calls GET `/api/assignments/:id`. Call it again after each write and on `visibilitychange`.
- `db.doc(...).set/update/delete` becomes the matching `fetch` calls.
- `assets.upload(blob)` becomes POST `/api/assignments/:id/pages` with the JPEG blob. It returns `{id, w, h, key}`.
- `/_blob/<id>` becomes `/img/<key>`.
- `sample.json(prompt, {images})` becomes POST `/api/pages/:id/clean`. Keep the Stop button with an `AbortController`.
- `downloads.save` becomes a blob URL plus `<a download>`.
- pdf.js still loads from cdnjs. In a normal browser the real web worker works, so set `GlobalWorkerOptions.workerSrc` instead of the main-thread fallback.
- Delete the "can't load in this view" branch.

---

## 7. Cloudflare setup

1. Create a GitHub repo `homework-desk` and push the layout above.
2. Create the D1 database and run the migrations:
   ```
   npx wrangler d1 create homework-db
   npx wrangler d1 migrations apply homework-db --remote
   ```
3. Create the image bucket: `npx wrangler r2 bucket create homework-pages`
4. Add the API key: `npx wrangler secret put ANTHROPIC_API_KEY`
5. In `wrangler.jsonc`, set:
   - `main: "src/index.ts"`
   - `assets: { directory: "./public", binding: "ASSETS" }`
   - the `d1_databases` and `r2_buckets` bindings
   - `vars.CLAUDE_MODEL`
6. In the Cloudflare dashboard (Workers & Pages → the Worker → Settings → Builds), connect the GitHub repo:
   - pushes to `main` deploy
   - pull requests get preview URLs
7. Add a custom domain or subdomain on a zone you already have on Cloudflare.
8. In Zero Trust → Access → Applications, add a self-hosted app for that domain:
   - set the policy to "Emails" with your family's addresses
   - use one-time PIN login
9. Optional: in the Worker, also reject requests that lack a valid `Cf-Access-Jwt-Assertion` header, so the `workers.dev` URL can't be used to get around Access. Or turn `workers.dev` off.

---

## 8. Phases

**Phase 1: port (v1)**
- [ ] Scaffold the repo, wrangler config, D1 migration and R2 bucket
- [ ] Assignment and page CRUD routes, plus image serving
- [ ] Split `index.html` and `app.js` out of the prototype and wire them to `api.js`
- [ ] Clean copy route with the Anthropic call
- [ ] GitHub → Workers Builds, custom domain, Access policy
- [ ] Test on the iPad: camera upload, a multi-page PDF, typing answers, reload, and checking from a second device

**Phase 2: make it nicer for a 7-year-old**
- [ ] Add a PWA manifest and icon so it opens full-screen from the iPad home screen
- [ ] Add "Print clean copy" with a print stylesheet. Printing works outside the claude.ai sandbox.
- [ ] Add "Save as image" for the clean copy, drawn to a canvas the same way as the photo version
- [ ] Let a parent edit the clean copy's text when Claude misreads something, instead of only Redo
- [ ] Add a simple edit lock while a clean copy is being rebuilt

**Phase 3: optional**
- [ ] Live sync between two open devices with one Durable Object per assignment
- [ ] A "Check my work" mode for parents only, which asks Claude for answers to the clean copy and shows them behind a toggle
- [ ] Per-child profiles if a sibling starts getting homework

---

## 9. Costs and limits

- **Workers, D1, R2 and Access:** the free tiers cover a family easily.
- **Anthropic API:** this is the only real cost, one vision call per page you clean. Pick the model with `CLAUDE_MODEL` and watch usage in the Anthropic console for the first couple of weeks.
- **Images:** they are stored at most 2000px wide as JPEG, roughly 300–600 KB per page.

---

## 10. Notes for Claude Code (put these in CLAUDE.md)

- **Source of truth:** the UI is `public/index.html` and `public/app.js`. Keep the Groundwork tokens in the `:root` block, and don't add a framework.
- **API:** all writes go through `/api/*`. The client never calls Anthropic directly.
- **Prompt:** keep `CLEAN_PROMPT` in `src/prompt.ts`. The JSON shape (`line`, `vertical`, `write`, `choice`, `wordbank`, `text`, `figure`) is a contract with the renderer, so change both together.
- **Field ids:** ids on the clean copy (`b0`, `w1`, `c2`…) are assigned in render order. Rebuilding a clean copy must clear `typed_values` for that page.
- **Parallel worktrees:** API routes, the front-end adapter and the infra config are independent and can go to separate agents.
