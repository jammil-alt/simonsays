# Prompts for Claude in the browser

Run these one at a time in Claude in Chrome, with you signed in to Cloudflare, Google AI Studio and the
Anthropic Console. Each one ends with a short report so you can paste the result back to Claude Code.

API key values never go through Claude. You click the button that reveals or copies a key and paste it
yourself into the secret field. Claude in the browser does the navigation and checking.

---

## 1. Check the deploy

```text
In the Cloudflare dashboard, open Workers & Pages → homework-desk → Deployments (and the Builds tab).
1. Find the newest build for the main branch (commit "Add the Comic Maker" or later). Tell me if it succeeded.
2. Open its build log. Find the step that runs "wrangler d1 migrations apply homework-db --remote" and tell me
   which migrations it applied (expect 0002_game_scores.sql and 0003_comics.sql, or "No migrations to apply").
3. If the build failed, copy the last 40 lines of the log into your reply, word for word.
Don't change any settings. Finish with: build status, migrations applied, and any error text.
```

## 2. Create the Gemini API key and store it in Cloudflare

```text
Help me give the homework-desk Cloudflare Worker a Gemini API key. I'll handle the key itself: never read,
copy, type or repeat the key value, and stop and wait for me whenever a key is on screen.

1. Go to https://aistudio.google.com/apikey. If there's already a key named "simonswork comic maker",
   tell me and skip to step 3. Otherwise click "Create API key", pick (or create) a project named
   "simonswork", and name the key "simonswork comic maker" if naming is offered.
2. STOP and tell me: "Copy the key now." Wait until I say "copied".
3. In a new tab, open the Cloudflare dashboard → Workers & Pages → homework-desk → Settings →
   Variables and Secrets. Click Add. Set Type = Secret, Variable name = GEMINI_API_KEY.
   Put the cursor in the Value field, then STOP and tell me: "Paste the key and press Save (or Deploy)."
   Wait until I say "saved".
4. Confirm GEMINI_API_KEY now appears in the list as a Secret (the value stays hidden). Also confirm that
   ANTHROPIC_API_KEY is still listed as a Secret.
5. Back in Google AI Studio, find the image model list (Models, or the model picker in the playground) and
   tell me the exact model id of "Nano Banana Pro" / Gemini 3 Pro Image. Is it "gemini-3-pro-image-preview",
   or has it been renamed (for example, a stable id without "-preview")?
Finish with: secret saved yes/no, Anthropic secret still there yes/no, and the exact image model id.
```

## 3. Billing and spending limits (recommended)

```text
Help me put spending limits on the two AI services used by simonswork.app. Don't enter or change payment
details: if a page asks for a card, stop and tell me.

Google (Gemini):
1. In Google AI Studio, open the billing / usage page for the "simonswork" project. Tell me if image
   generation needs billing turned on (paid tier) for this project and whether it's on.
2. If the project has billing on, go to Google Cloud console → Billing → Budgets & alerts and create a budget
   for the "simonswork" project: name "simonswork comics", amount $10 per month, alerts at 50%, 90% and 100%,
   emailed to the billing admins. Stop before the final Create/Save and show me the summary.
3. Tell me the current price per image for the Gemini 3 Pro Image model at 1K resolution, from Google's
   pricing page.

Anthropic:
4. In the Anthropic Console (console.anthropic.com) → Settings → Limits (or Billing), tell me the current
   monthly spend limit and this month's usage. If there's a setting for a spend limit or email alert,
   show it to me and stop. I'll decide the number.
Finish with: Gemini billing status, budget created yes/no, price per image, Anthropic limit and usage.
```

## 4. Test the Comic Maker for real

```text
Open https://simonswork.app/comic/ (sign in with the emailed PIN if asked; tell me if it asks for a code
and wait for me to type it).
1. Type this story in the big box: "My hero is a dog named Rocket who can fly. Then a giant pudding monster
   eats all the cookies in town! In the end, Rocket burps so loud the monster runs away."
2. Click "Make my comic!" and wait up to 3 minutes. Watch the status line ("Writing the story…",
   "Drawing panel 2 of 5…").
3. When it's done, tell me: the comic title, how many panels, whether every panel has a real picture
   (not a description in text), whether the characters look the same from panel to panel, and whether any
   picture has letters or words drawn into it (it shouldn't).
4. If any panel shows "Oops!" or an error, copy the exact message.
5. Open "For grown-ups" at the bottom and tell me what it says under "What Claude changed".
Don't delete the comic. Finish with a short report I can paste to Claude Code.
```

## 4b. Test the read-aloud voices

```text
Open https://simonswork.app/comic/#/library and open the newest comic.
1. Turn the computer's sound on. Click "Read it to me". The button should say "Warming up the voices…" for a
   few seconds, then "Stop reading", and panels should light up one after another.
2. Tell me: did the narrator and each character sound different? Did any line sound like it read out an
   instruction (for example the words "Say it like…") instead of just the story? Did it stop partway?
3. Click "Read it to me" again: it should start right away this time.
4. If it fell back to the old robotic voice, open Workers & Pages → homework-desk → Observability (or Logs)
   and copy any error lines that mention "gemini tts" or "voice", word for word.
Finish with a short report I can paste to Claude Code.
```

## 5. If something fails: read the Worker logs

```text
In the Cloudflare dashboard → Workers & Pages → homework-desk → Observability (or Logs), show the errors
from the last hour. For each distinct error, give me the request path (like /api/comics/…/draw/panel-2),
the status code and the error message text, word for word. Point out anything that says "exceeded CPU",
"gemini", "D1_ERROR" or "art_failed". Don't change any settings. Finish with the list so I can paste it
to Claude Code.
```

## 6. Only if the logs say "exceeded CPU"

```text
In the Cloudflare dashboard, open Workers & Pages → Plans (or Account → Billing → Subscriptions) and tell me
whether this account is on Workers Free or Workers Paid, and what Workers Paid costs per month. Don't
change the plan; I'll decide.
```

## Changing settings later

These live in `wrangler.jsonc` in the repo (ask Claude Code to change them, or edit and push to `main`):
- `COMIC_DAILY_LIMIT` — optional comics-per-day cap (not set = no limit)
- `GEMINI_IMAGE_MODEL` — image model id
- `CLAUDE_MODEL` — model for clean copies and comic scripts

Secrets (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`) live only in the Cloudflare dashboard.
