# Cloudflare setup for simonswork.app

Paste the prompt below into **Claude Code running on your own computer**, in a clone of this repo.
It needs a browser for `wrangler login`. The Zero Trust (Access) and Workers Builds steps happen in the
Cloudflare dashboard, so Claude will walk you through those and wait for you.

Before you start:
- `simonswork.app` is in your Cloudflare account as an active zone (bought through Cloudflare Registrar, or its nameservers point at Cloudflare).
- You have an Anthropic API key from console.anthropic.com.
- This repo's code is merged to `main` on GitHub.

---

```text
Set up this repo (Homework Desk, a Cloudflare Worker) in my Cloudflare account and put it live at
https://simonswork.app behind Cloudflare Access. Read CLAUDE.md and wrangler.jsonc first. Do the steps
in order, run the commands yourself, and stop to walk me through each dashboard step and wait until
I confirm it's done. Don't commit secrets anywhere.

1. Run `npm install`, then `npx wrangler login` (I'll approve it in the browser) and `npx wrangler whoami`.
   Confirm with me that it's the account that owns the simonswork.app zone.

2. Create the database: `npx wrangler d1 create homework-db`. Put the database_id it prints into
   wrangler.jsonc (replace the 00000000-… placeholder). Then run
   `npx wrangler d1 migrations apply homework-db --remote`.

3. Create the image bucket: `npx wrangler r2 bucket create homework-pages`.
   (If R2 isn't enabled yet, tell me to turn it on under R2 in the dashboard. It's free at this size.)

4. Cloudflare Access — walk me through this in the dashboard (Zero Trust):
   a. If I've never opened Zero Trust, pick a team name (e.g. "simonswork") and the Free plan.
   b. Settings → Authentication → Login methods: make sure "One-time PIN" is on.
   c. Access → Applications → Add an application → Self-hosted.
      Name "Homework Desk", domain simonswork.app (no path), session duration 1 month.
   d. Add a policy: name "Family", action Allow, include → Emails → the family's email addresses
      (ask me for them).
   e. After saving, open the app's Overview/Basic info and copy the "Application Audience (AUD) Tag".
   Ask me for the AUD tag and the team domain (looks like <team>.cloudflareaccess.com), then put them in
   wrangler.jsonc vars ACCESS_AUD and ACCESS_TEAM_DOMAIN. These aren't secrets.

5. Add the Anthropic key as a Worker secret: run `npx wrangler secret put ANTHROPIC_API_KEY` and let me
   paste the key at the prompt myself. Don't ask me to paste it into chat. (If wrangler says the Worker
   doesn't exist yet, do step 6 first, then come back.)

6. Deploy: `npm run typecheck`, then `npm run deploy`. wrangler.jsonc already has the simonswork.app
   custom domain route, so this creates the DNS record and certificate. Then check:
   - `curl -sI https://simonswork.app/` should redirect to the Access login (302 to cloudflareaccess.com).
   - Ask me to open https://simonswork.app on my iPad, sign in with the emailed PIN, and confirm the
     Homework page loads and "New" works.

7. Commit and push the wrangler.jsonc changes (database_id, ACCESS_AUD, ACCESS_TEAM_DOMAIN) to main.

8. Auto-deploy from GitHub — walk me through it in the dashboard:
   Workers & Pages → homework-desk → Settings → Builds → Connect → pick the GitHub repo.
   Production branch: main. Build command: (empty). Deploy command: `npm run deploy`.
   Turn off non-production branch builds (preview URLs are disabled on purpose; they'd skip Access).
   If the first build fails on the D1 migration step with a permissions error, help me edit the build's
   API token to add "D1: Edit".

9. Finish with a short checklist of what's live, the Access policy's email list, and how to change
   the model (CLAUDE_MODEL in wrangler.jsonc) if Anthropic costs need watching.
```

---

## Doing it by hand

Same steps, without Claude:

```bash
npm install
npx wrangler login
npx wrangler d1 create homework-db          # paste database_id into wrangler.jsonc
npx wrangler d1 migrations apply homework-db --remote
npx wrangler r2 bucket create homework-pages
npx wrangler secret put ANTHROPIC_API_KEY
# set ACCESS_TEAM_DOMAIN and ACCESS_AUD in wrangler.jsonc (Zero Trust → Access → Applications)
npm run deploy
```

Until `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are set, the API answers every request with
`access_not_configured`, so the site can't leak data while you're halfway through setup.
