# Deploying this

Written for someone who has never used Vercel. No terminal required except for
one optional step at the end.

You need three things:

1. An Anthropic API key — [console.anthropic.com](https://console.anthropic.com) → **API keys** → **Create key**
2. A GitHub account with this repository pushed to it
3. A Vercel account — sign in *with GitHub* so there is no separate password

---

## Before anything else: set a spend limit

In [console.anthropic.com](https://console.anthropic.com) → **Settings** → **Limits**, set
a monthly spend limit.

This application has its own daily cap (see below), but that cap is enforced by
this application's own accounting. A bug in that accounting cannot be caught by
the thing that has the bug. The Console limit is enforced by Anthropic and is
the only cap that holds regardless. Set it low — $20 is more than enough for a
demonstration.

---

## Step 1 — get the code onto GitHub

If it is already there, skip to step 2.

**The easy way, no terminal:** install
[GitHub Desktop](https://desktop.github.com), sign in with your GitHub account,
then **File → Add local repository**, point it at this folder, and press
**Push origin**. That preserves the commit history, which matters — see
[the regression PR](#step-5--the-deliberate-regression) below.

**If you prefer the terminal:**

```bash
git push -u origin main
```

---

## Step 2 — import into Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Find this repository in the list and press **Import**
3. Leave every build setting alone. Vercel detects Next.js and gets it right —
   framework preset Next.js, build command `next build`, output `.next`
4. **Do not press Deploy yet.** Open **Environment Variables** first (step 3)

---

## Step 3 — the three environment variables

Still on the import screen, expand **Environment Variables** and add these
three. Vercel encrypts them; they are never exposed to the browser.

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your key from the Console. Starts `sk-ant-` |
| `DEMO_PASSCODE` | Anything memorable. This goes in the email alongside the link |
| `SESSION_SECRET` | A long random string — see below |

For `SESSION_SECRET`, any long random text works. If you want to generate one
properly:

```bash
openssl rand -hex 32
```

Or just mash together 50-odd random characters. It only needs to be unguessable
and it only signs the passcode cookie.

Now press **Deploy**. It takes about two minutes.

### What happens if you forget one

- **No `ANTHROPIC_API_KEY`** — the site loads, and every live call returns a
  clear "the server is not configured with an API key" message. Nothing
  crashes, and the term-normalisation panel still works because it runs in the
  browser.
- **No `DEMO_PASSCODE` or `SESSION_SECRET`** — the site is **open to anyone with
  the URL**. The passcode gate switches itself off when either is missing,
  because that is the right behaviour for local development. Set both before
  sending the link to anyone.

---

## Step 4 — check it works

Open the URL Vercel gives you. You should get the passcode screen, then the
main page.

Then, in order of how much they tell you:

1. **Type** `Is Emek Dairy whole milk under your hashgacha?` into the live agent.
   Watch the trace rail on the right fill in: triage, the agent it routed to,
   the `lookup_product` call with its arguments and result, the verifier's
   verdict, and what the turn cost.
2. **Press "Ask about a product we don't certify"** in the Break It panel. The
   reply must say we do not certify it and must *not* say it is not kosher.
   That distinction is the single most important behaviour in the system.
3. **Press "Run all 12 cases now"** in the evals section. It takes a minute or
   two and costs a few cents. The timestamp comes from the server at the moment
   you click, so it cannot be a cached report.

If the microphone button is greyed out, that browser has no speech recognition.
That is expected on many phones. Text input works everywhere.

---

## Step 5 — the deliberate regression

The repository contains a branch that loosens a guardrail, watches CI fail, then
tightens it and watches CI pass. To make it a visible artifact:

1. Add your API key as a repository secret so CI can run the evals:
   GitHub → your repo → **Settings** → **Secrets and variables** → **Actions**
   → **New repository secret** → name it `ANTHROPIC_API_KEY`
2. Open a pull request from the `regression/loosen-absence-guardrail` branch to
   `main`
3. The first commit's CI run fails with two red evals. The second commit's run
   passes. Both are visible in the PR's checks history.

Without the secret, CI still runs types, lint, unit tests and the build — the
eval job skips itself with a warning rather than failing for a reason nobody
can fix.

---

## Step 6 — capture the recorded calls (optional, one command)

The recorded-calls panel is empty until real traces are captured. It says so
rather than showing invented data. To populate it, run this once against the
deployed URL:

```bash
npm run capture -- --url https://YOUR-APP.vercel.app --passcode YOUR-PASSCODE
```

That runs the four scenarios against the live system, writes the real traces to
`data/recorded-sessions.json`, and derives the annotations from the events that
actually fired. Commit the file and Vercel redeploys with the panel populated.

This needs Node installed locally. If you would rather not, the panel simply
stays in its "not captured yet" state, and the live agent covers the same ground
for anyone who will not use a microphone.

---

## Cost, and what stops it running away

Four layers, listed from the one you control to the one the application
controls:

| Layer | Where | What it does |
|---|---|---|
| Console spend limit | Anthropic Console | Hard stop. Survives any bug here |
| Daily cap | `config/agent.config.json` → `limits.dailySpendCapUsd`, default $15 | Degrades to scripted mode with a banner rather than erroring |
| Per-session caps | Same file | 25 turns, $0.75, 20 minutes per visitor |
| Rate limits | Same file | Per-IP, per minute and per hour, plus eval-run limits |

A typical turn costs well under a cent — triage and the verifier run on Haiku
4.5, and only the specialist runs on Sonnet 5. A full 12-case eval run costs a
few cents.

`/api/usage` on the deployed site reports live spend, the limits in force, and
which counter backend is active.

### Making the caps durable (optional)

By default the counters live in memory on each serverless instance. They work,
but instances are not shared, so the daily cap and rate limits are approximate
rather than global, and the cross-visitor attempt log is short-lived. The
`/api/usage` endpoint and the architecture panel both say so rather than
implying otherwise.

To make them global, create a free Redis database at
[upstash.com](https://upstash.com), open its **REST API** tab, and add two more
environment variables in Vercel:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

The application detects them and switches backend with no code change.

---

## Changing the vertical

Everything that makes this about kosher certification lives in two places:

- `config/agent.config.json` — the organisation, every agent's prompt, model
  tiering, which tools each agent may call, guardrail patterns, limits
- `data/*.json` — the products, establishments, alerts, symbols, stores

Replace those and the same pipeline runs a different hotline. The tool
*implementations* in `src/lib/tools/` are domain-specific and would need
rewriting; the pipeline, verifier, guardrail engine, normaliser, eval harness
and UI would not.
