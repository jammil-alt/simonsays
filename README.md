# Homework Desk

Snap a worksheet, type the answers. Parents upload a photo or PDF of a 2nd-grade worksheet. Claude rebuilds
it as a clean copy with boxes to type in, or you can tap anywhere on the photo to type an answer right there.

- **Stack:** one Cloudflare Worker (static UI + REST API), D1 for data, R2 for page images, the Anthropic API
  for clean copies, and Cloudflare Access for a family-only login.
- **Typing Arcade:** `/games/`. Letter Lane and Meteor Words, from "find F and J" up to words from his own worksheets.
- **Comic Maker:** `/comic/`. Simon types a story and gets a 4–6 panel comic with read-aloud. Claude writes the
  script, Gemini draws it, and the words are laid over the pictures so they're always spelled right.
- **Live:** https://simonswork.app
- **Set up Cloudflare:** [docs/CLOUDFLARE_SETUP.md](docs/CLOUDFLARE_SETUP.md)
- **Plan / roadmap:** [docs/PLAN.md](docs/PLAN.md)

## Run locally

```bash
npm install
cp .dev.vars.example .dev.vars     # add ANTHROPIC_API_KEY to try clean copies
npm run db:migrate:local
npm run dev                         # http://localhost:8787
```

Local D1 and R2 are simulated by wrangler under `.wrangler/`.

## Comic Maker setup

The Comic Maker uses the same `ANTHROPIC_API_KEY` for the script. For pictures it needs a Gemini API key
(Google AI Studio → Get API key). Add it in the Cloudflare dashboard: Workers & Pages → homework-desk →
Settings → Variables and Secrets → Add → Secret, name `GEMINI_API_KEY`. Without it, comics still work as
text panels.

Settings in `wrangler.jsonc` → `vars`:
- `GEMINI_IMAGE_MODEL`: the image model (default `gemini-3-pro-image-preview`, "Nano Banana Pro"). Check the
  current id in Google AI Studio.
- `COMIC_DAILY_LIMIT`: comics per day (default 3). The day follows the visitor's own time zone.
