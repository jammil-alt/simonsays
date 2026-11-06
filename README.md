# Homework Desk

Snap a worksheet, type the answers. Parents upload a photo or PDF of a 2nd-grade worksheet. Claude rebuilds
it as a clean copy with boxes to type in, or you can tap anywhere on the photo to type an answer right there.

- **Stack:** one Cloudflare Worker (static UI + REST API), D1 for data, R2 for page images, the Anthropic API
  for clean copies, and Cloudflare Access for a family-only login.
- **Typing Arcade:** `/games/`. Letter Lane and Meteor Words, from "find F and J" up to words from his own worksheets.
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
