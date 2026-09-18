# Kehilla Hotline

[![CI](https://github.com/watmannoah/kosher-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/watmannoah/kosher-agent/actions/workflows/ci.yml)

A live multi-agent voice system for a kosher certification agency's consumer
hotline. Triage on a cheap model routes each turn to a specialist with a scoped
tool set; a separate verifier audits the drafted reply against the raw tool
results and blocks it if a claim is not supported.

**Kehilla Kosher Certification is fictional.** Every product, brand,
establishment, symbol, alert and status is synthetic demonstration data. It is
not a kosher certification reference. No real certifying body's name, symbol or
trade dress is used.

**[DEPLOY.md](./DEPLOY.md)** — how to host it, written for someone who has never
used Vercel.
**[ARCHITECTURE.md](./ARCHITECTURE.md)** — why it is shaped this way, and the
cost and latency trade-offs.
**[ROADMAP.md](./ROADMAP.md)** — what real telephony takes, and what breaks at
Pesach.

---

## The problem this is built around

Telling someone a product is certified when it isn't causes religious harm, not
a bad user experience. Three behaviours follow from that, and they are what the
system is actually organised around:

**No agent may assert certification status without a tool lookup in the same
turn.** Enforced in code. A drafted reply that asserts status with nothing
backing it is blocked before the caller hears it, logged, and retried with the
reason injected. Blocked drafts are shown in the UI, because a caught
hallucination someone can read is worth more than a hundred clean turns.

**"Not in our database" is not "not kosher."** Absence means we do not certify
it — it may well be certified elsewhere. This is the classic naive-bot failure
and it is guarded three ways: the tool result carries the interpretation in
words, a string guardrail catches the specific phrasings that cause the harm,
and an eval asserts it.

**Halachic questions are never answered.** A shailah is detected at triage,
hard-stops the pipeline from any state, and routes to the Rav on call with
after-hours handling. Not a partial answer, not a hedge, not "generally
speaking".

---

## Architecture

```
                    ┌──────────────┐
   caller  ─────▶   │   TRIAGE     │  Haiku 4.5 — forced tool call, strict JSON
                    │ classify +   │  intent, urgency, shailah detection
                    │    route     │
                    └──────┬───────┘
                           │
     ┌─────────────┬───────┴────────┬──────────────┐
     ▼             ▼                ▼              ▼
┌─────────┐  ┌───────────┐   ┌───────────┐  ┌───────────┐
│ PRODUCT │  │ESTABLISH- │   │  SALES    │  │ COMPLAINT │   Sonnet 5
│ STATUS  │  │  MENT     │   │  INTAKE   │  │  INTAKE   │   scoped tools
│ 5 tools │  │  3 tools  │   │  3 tools  │  │  4 tools  │   per agent
└────┬────┘  └─────┬─────┘   └─────┬─────┘  └─────┬─────┘
     └─────────────┴───────┬───────┴──────────────┘
                           ▼
                  ┌─────────────────┐
                  │    VERIFIER     │  Haiku 4.5 — audits the draft against
                  │ claim ↔ tool    │  the RAW tool results
                  │ result match    │  BLOCKS on mismatch, retries once
                  └────────┬────────┘
                           ▼
                        caller

   ┌──────────────────────────────────────────────┐
   │ SHAILAH ROUTER — fires from any state,       │
   │ hard-stops the pipeline, routes to the Rav   │
   └──────────────────────────────────────────────┘
```

Model tiering is deliberate. Triage and the verifier are high-frequency,
low-token classification calls and run on Haiku 4.5. Only the specialist —
which composes consumer-facing phrasing where precision is a religious-harm
concern — runs on Sonnet 5. Per-turn cost is displayed in the UI.

---

## Running locally

```bash
npm install
cp .env.example .env.local     # then put your key in .env.local
npm run dev
```

Then either open <http://localhost:3000>, or drive it from the terminal:

```bash
npm run trace "is Emek Dairy whole milk certified?"
```

`npm run trace` decodes the SSE stream into a readable trace — routing, tool
calls with arguments and results, the verifier verdict, the latency breakdown
and the cost. It talks to the HTTP route, so it exercises exactly what the
browser exercises.

### Environment variables

| Variable | Required | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Server-side only. Never reaches the browser |
| `DEMO_PASSCODE` | For hosting | Shared passcode. **Omit it and the site is open** |
| `SESSION_SECRET` | For hosting | Signs the passcode cookie |
| `UPSTASH_REDIS_REST_URL` | No | Makes rate limits and the spend cap durable |
| `UPSTASH_REDIS_REST_TOKEN` | No | As above |
| `DAILY_SPEND_CAP_USD` | No | Overrides the config default of $15 |

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm test` | Unit tests. Free, no network, ~300ms |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run check:models` | Pings each configured model with the exact request shape its tier builds |
| `npm run trace "..."` | One turn against a running dev server, decoded |
| `npm run evals` | The 12-case suite against real models. **Costs money** |
| `npm run capture -- --url <url> --passcode <pc>` | Captures the four recorded sessions |

---

## Evals

`config/evals.json` holds 12 cases, run against the same `runTurn()` generator
the browser drives. There is deliberately no eval-only code path, which is what
makes a pass evidence about the deployed system rather than about a test double.

Scoring is two gates that must both agree:

- **Deterministic assertions** read the real event stream — which agent was
  routed to, which tools actually ran, whether a status claim was backed by a
  lookup in the same turn, which guardrails fired, which phrases are absent.
- **An LLM judge** on the strong tier grades quality 1–5 against each case's own
  rubric, and must return 4 or better.

Assertions catch mechanical failures a judge waves through. The judge catches
phrasing that satisfies every regex and would still mislead a caller.

Each case pins a date, so the calendar-dependent cases — Erev Shabbos closure,
establishment expiry — are reproducible instead of passing or failing according
to the day CI happens to run.

CI runs types, lint, unit tests and a production build on every push. The eval
job is gated on the `ANTHROPIC_API_KEY` secret and skips with a warning when it
is absent.

---

## Honest limitations

**Speech recognition is the browser's.** `webkitSpeechRecognition` is not
available everywhere, notably on many phones, and quality varies a lot. The UI
detects what the browser actually has and says so rather than guessing from a
user-agent table. Text input is always available and never gated on voice.

**Playback is synthesis, not recording.** Recorded calls replay real captured
event traces, but the voice is browser speech synthesis reading the captured
transcript. The panel says so.

**The 1500ms turn target is not reachable.** A tool-using turn is two sequential
model round trips — the model asks for the lookup, then writes the answer from
it — plus triage in front and the verifier behind. The latency strip reports
measured numbers against calibrated thresholds and shows the brief's target
alongside rather than quietly dropping it. Real telephony infrastructure
(Deepgram, Cartesia) is where sub-900ms becomes plausible; see ROADMAP.md.

**Streaming audio and a blocking verifier are mutually exclusive.** Speaking
sentence one means a blocked draft has already been read aloud. The choice is
made per turn from triage: turns that cannot carry a certification claim speak
immediately; turns that can hold the audio for the verdict. The trace rail shows
which path ran and why.

**Counters are per-instance without Redis.** Serverless instances share nothing,
so the daily cap and rate limits are approximate by default. `/api/usage`
reports which backend is live. The Anthropic Console spend limit is the real
backstop.

**The data is synthetic and the agency is fictional.** This cannot be used to
check anything.

---

## Code layout

```
config/agent.config.json   The whole vertical: prompts, models, tool grants,
                           guardrail patterns, limits, latency budget
config/evals.json          12 cases, assertions and rubrics
data/*.json                Synthetic products, establishments, alerts, symbols

src/lib/normalise/         STT term recovery: dictionary, phonetics, engine
src/lib/tools/             The 10 tools, matching, Hebrew calendar
src/lib/agents/            Triage, specialist, verifier, pipeline, wire protocol
src/lib/guardrails/        Pattern checks, pre- and post-model
src/lib/evals/             Runner, assertions, judge
src/lib/limits/            Spend cap, rate limits, attempt log
src/lib/client/            Browser: session hook, voice, telemetry export
src/app/api/               turn, evals, usage, attempts, auth
src/components/            The panels
```

Swapping the vertical means replacing `config/` and `data/`. The tool
implementations are domain-specific; the pipeline, verifier, guardrail engine,
normaliser, eval harness and UI are not.

