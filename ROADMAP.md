# Roadmap

What this would need to be a production hotline rather than a demonstration of
one, roughly in the order the work would actually matter.

---

## 1. Real telephony

The web version is a proof of the agent core. A number someone can phone is a
different product, and it cannot be dismissed as a web toy.

**Ship the simple version first.** Twilio `<Gather input="speech">` is a few
hours of work: Twilio does the speech recognition, posts the transcript to a
webhook, and the same `runTurn()` pipeline answers. Turn latency lands around
2–3 seconds, which is usable and honest. A working number at 2.5s beats a broken
one at 800ms.

**Then upgrade to Media Streams.** A bidirectional WebSocket carrying raw audio,
with:

- **Deepgram** for STT, with a custom vocabulary boost. This is the single
  highest-leverage change in the whole roadmap — see §2.
- **Cartesia** or **ElevenLabs** for TTS, streaming, ~100ms to first audio
  against browser synthesis's 200–400ms.
- **VAD endpointing** instead of waiting for a recognition engine to decide the
  caller has stopped. Browser STT's finalise delay is often 500ms+ of pure dead
  air, and it is invisible in the current numbers because it happens before the
  server sees anything.

Realistic target with that stack: **700–900ms turns**, against the 1.6–2.6s the
current shape achieves. Most of the gain is STT and TTS, not the models.

Guarding it is not optional: a spoken passcode or a number allowlist, a hard
per-call minute cap, and a monthly spend cap. A phone number is a strictly more
abusable surface than a passcode-gated URL.

---

## 2. A kashrus vocabulary for STT

The term normalisation layer exists because browser speech recognition has no
kashrus vocabulary and reaches for the nearest English it knows. It recovers a
lot, and it is fundamentally a repair at the wrong layer.

Deepgram accepts keyword boosting and custom vocabulary. Feeding it `hashgacha`,
`hechsher`, `chalav yisrael`, `pas yisrael`, `mashgiach`, `yoshon`, `bishul
yisrael`, and every brand in the certification database moves the fix upstream —
the engine gets the word right rather than the application guessing what the
engine meant.

The normalisation layer should stay regardless, for two reasons: it handles
Ashkenazi/Sefardi variation that is a *transliteration* choice rather than a
recognition error, and it is the only defence when a caller's accent defeats
even a boosted model. But it should be catching the tail, not the bulk.

Brand phonetics would also improve: with the real catalogue rather than 12
synthetic brands, more brands will collide on the consonant skeleton, and the
disambiguation question needs to stay genuinely rare or it becomes an
irritation. That likely means weighting by call volume — ask about the collision
only when both candidates are plausible, rather than whenever the skeleton
matches.

---

## 3. Warm transfer to the Rav on call

Today `escalate_to_rav` returns availability and a callback window, and the
agent tells the caller what happens next. That is correct behaviour and it is
still a promise rather than a connection.

Warm transfer means: the agent stays on, dials the Rav on call, gives him a
one-line summary of the shailah as it was actually asked, and bridges the
caller in. The summary matters — a Rav picking up a cold transfer has to
re-elicit the question, and the caller has already explained it once.

This needs an on-call rota with real availability, which is an operational
problem before it is an engineering one.

---

## 4. Evals gating every deploy

CI runs the suite on every push. It does not yet *block* a deploy.

The right shape is: Vercel's deploy waits on the eval job, and a failing suite
stops the promotion to production. That turns the prompts into code with a
safety net in the way that actually matters — not "we noticed afterwards" but
"it could not ship".

Two things to build alongside it:

- **Per-case cost and latency tracking over time.** A prompt change that fixes a
  case and doubles the turn cost should be visible as a regression, not
  discovered on the bill.
- **A larger suite.** Twelve cases cover the twelve failures we thought of.
  Real call logs would supply the ones we did not — particularly the long tail
  of ambiguous product names, which is where a naive system quietly guesses.

---

## 5. Pesach-season load, which is the real operational problem

Everything above is engineering. This is the thing that would actually break.

Consumer kashrus call volume is not flat. It spikes enormously in the weeks
before Pesach, and the questions change character: the same product asked about
fifty times a day, almost always about its Pesach status specifically, and
almost always by callers who have the package in their hand and need an answer
now.

That has several consequences the current design does not handle:

**Caching becomes the dominant cost lever.** Fifty identical "is *X* kosher for
Pesach" calls are fifty full pipeline runs today. A semantic cache over
(normalised product, intent) — invalidated whenever the underlying record or an
alert changes — would collapse most of that. The invalidation is the hard part
and it must fail toward a fresh lookup, because a stale Pesach answer is exactly
the harm the system exists to prevent.

**Rate limits sized for a demo are wrong for a spike.** The per-IP limits here
exist to stop abuse of a public URL. Real Pesach traffic from one household or
one shul's wifi would look like abuse.

**The Pesach year has to be enforced, not configured.** `_pesachYear` in the
data is currently a field someone must remember to update. In production that
should be derived from the date and the certification record, and a lookup
against a stale Pesach year should refuse to answer rather than answer for last
year. A confidently wrong answer about last Pesach, delivered this Pesach, is
the worst output this system could produce.

**Staffing the overflow.** Every escalation path assumes a human is reachable.
At peak that assumption fails, and the system needs a queue with an honest wait
time rather than a promise of a callback it cannot keep.

---

## Smaller things worth doing

- **Durable counters by default.** The in-memory backend is honest about being
  per-instance, but production wants Redis and the spend cap enforced globally.
- **Structured logging to a real sink.** The telemetry payload is the right
  shape; it currently goes to a browser download rather than anywhere queryable.
- **Barge-in on the phone path.** Implemented for the browser; Media Streams
  needs its own handling, and it is harder there because the audio is already in
  flight.
- **Multi-turn context beyond twelve messages.** Fine for a hotline call, too
  short for a complaint that takes ten minutes to explain.
- **Accessibility pass.** The trace rail is dense and mostly unlabelled for
  screen readers. The conversation itself is fine; the instrumentation is not.
- **A second language.** Yiddish and Hebrew callers are a real segment, and
  neither the STT layer nor the prompts currently contemplate them.
