# Handover

What is built, what is verified, and what you need to do.

---

## What you have

`~/Claude/kosher-agent.zip` — 864K, 14 commits on `main` plus the
`regression/loosen-absence-guardrail` branch. No API key inside; `.env.local` is
excluded.

## What you need to do

On your personal laptop, one download and about ten minutes:

1. Unzip
2. [GitHub Desktop](https://desktop.github.com) → sign in → **File → Add local
   repository** → point at the folder → **Push origin**.
   Then switch to the `regression/loosen-absence-guardrail` branch in the
   branch dropdown and push that too.
3. [vercel.com/new](https://vercel.com/new) → **Import** the repo → open
   **Environment Variables** *before* deploying and add three:
   `ANTHROPIC_API_KEY`, `DEMO_PASSCODE`, `SESSION_SECRET` → **Deploy**
4. Open the URL, enter the passcode, type
   *"Is Tzofim Honey Wafers kosher?"* into the live agent

Full detail, written for someone who has never used Vercel, is in
[DEPLOY.md](./DEPLOY.md). The variable values and what happens if you forget one
are there too.

**Also worth two minutes:** set a monthly spend limit at
console.anthropic.com → Settings → Limits. The app caps itself at $15/day, but
that cap is enforced by the app's own accounting, and a bug in that accounting
can't be caught by the thing that has the bug.

---

## What is verified, and what is not

This is the part that matters most, so it is blunt.

api.anthropic.com is blocked from your work laptop by network policy — the same
403 you saw. So **no code path that calls a model has ever executed.** Not once.

| Verified | How |
|---|---|
| 109 unit tests pass | Ran repeatedly |
| TypeScript compiles clean | `tsc --noEmit`, no errors |
| ESLint clean | Including the React rules, which caught two real bugs |
| Production build succeeds | You ran it — it produced `/` and `/api/turn` |
| Tools, normaliser, Hebrew calendar, guardrail patterns, matching | Unit tested, including sunset verified against published NYC times at both solstices and both equinoxes |

| NOT verified | Why it matters |
|---|---|
| Any model call | The two model IDs (`claude-sonnet-5`, `claude-haiku-4-5`) and the per-tier request shapes are unconfirmed |
| The 12 evals | **"12 cases passing" is a claim I have not earned.** They have never run |
| Triage routing quality | Whether it actually detects a shailah reliably is unmeasured |
| The verifier | Whether it blocks what it should, and passes what it should, is unmeasured |
| Any browser behaviour | Mic, speech, waveform, streaming, mobile layout — never rendered |

**The first thing to do after deploying is press "Run all 12 cases now."** That
single button is what converts the second table into the first. If cases fail,
the report names the case, the assertion, what it expected and what it got —
paste that back and it is a quick fix.

**Do not send the email until you have watched the evals pass.** EMAIL_KIT.md
opens by saying so, because the email invites the recipient to press that same
button.

---

## Likeliest failure, and the two-second check

If the model IDs are wrong, everything fails identically and immediately. From a
network that can reach the API:

```bash
npm run check:models
```

It sends the exact request body each tier builds and prints what it sent. A 404
means the model ID needs changing in `config/agent.config.json`; a 400 means a
parameter is wrong for that tier and the message says which.

The two tiers legitimately need different request shapes — Sonnet 5 rejects
`temperature`, Haiku 4.5 rejects `output_config.effort`, and both are 400s
rather than degradations. That is handled in code, but handled-untested.

---

## Against the brief

**Built and complete:** config-driven vertical · synthetic dataset with the
deliberate traps · 10 tools with typed failures · term normalisation layer ·
triage/specialist/verifier/shailah pipeline · 9 guardrails · passcode gate ·
spend cap, rate limits, session caps · `/api/usage` · telemetry with JSON export
· 12-case eval harness with assertions + judge · CI workflow · the deliberate
regression PR · the full UI (live agent, trace rail, latency strip, Break It
with cross-visitor log, live eval runner, normalisation panel, architecture and
cost) · voice with barge-in and audio-reactive waveform · README, DEPLOY,
ARCHITECTURE, EMAIL_KIT, ROADMAP.

**Built but needs one command after deploy:** recorded calls. The capture script
and the replayer are done; until it runs, the panel says it has nothing rather
than showing invented data. `npm run capture -- --url <url> --passcode <pc>`.

**Deliberately not built — `demo.html`.** The brief wanted a self-contained
offline fallback in case hosting failed. I skipped it, and the reason is that
building it properly means duplicating the normaliser and the trace renderer
into a standalone file, which creates two copies that drift. Since you are
deploying to Vercel rather than gambling on hosting, the insurance is not worth
the duplication. Say the word if you want it.

**Not started — the phone number (§8).** The brief is explicit that this comes
only after the web version is live. It needs a Twilio account, a purchased
number (~$1/month plus per-minute), and a decision about who answers escalations.
ROADMAP.md §1 has the two-stage plan: `<Gather input="speech">` first at 2–3s
turns, then Media Streams with Deepgram and Cartesia for 700–900ms.

---

## Three judgment calls you should know about

**Next 16, not the brief's Next 14.** 14.2.35 is the latest 14.x and carries an
unpatched advisory list including unauthenticated RCE. This is a publicly
reachable deployment. App Router is unchanged; `middleware` became `proxy` and
request APIs became async, both handled.

**The 1500ms turn target is not reachable, and the UI says so.** A tool-using
turn is four sequential model calls, none parallelisable. The latency strip
shows measured numbers against calibrated thresholds with the brief's target
displayed alongside, and prints the reasoning underneath. Colouring against an
impossible target would leave a healthy system permanently red.

**Streaming audio and a blocking verifier are mutually exclusive.** Speaking
sentence one means a blocked draft was already read aloud. Resolved per turn
from triage: turns that cannot carry a certification claim speak immediately;
turns that can hold the audio until the verdict. The trace rail shows which path
ran and why. This is the most interesting design decision in the build and it is
documented in `src/lib/agents/protocol.ts`.
