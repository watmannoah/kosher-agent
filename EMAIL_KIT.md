# Email kit

Everything you need to send this, plus answers to the replies you will get.

> **Before you send it:** open the deployed URL and press **Run all 12 cases
> now** in the evals section. Watch it finish. If any case fails, do not send
> the link until it is fixed — the email below invites the recipient to press
> that same button, and they will.

---

## The email

> **Subject:** The kosher certification hotline, as a working system
>
> I built a live multi-agent voice system for a kosher certification hotline —
> real model calls, real tool lookups, real guardrails, nothing pre-recorded.
>
> **https://YOUR-APP.vercel.app** — passcode `YOUR-PASSCODE`
>
> Type or say *"Is Tzofim Honey Wafers kosher?"* first. It's a product that
> isn't in the database, and what it does with that is the part I'd want you to
> look at.
>
> — Noah

Three sentences, one link, the passcode, one line on what to click.

### Why that first click

It is the behaviour that separates a system that understands kosher
certification from one that doesn't. A naive bot says "no, that's not kosher."
The correct answer is that *we* don't certify it — it may well be certified by
another agency — followed by an offer to identify the symbol on the package.

It is also the fastest way for a sceptical reader to establish that the thing
is real, because the answer is specific, correct, and not what a generic
chatbot would say.

### Subject line variants

1. **The kosher certification hotline, as a working system** — plainest. Best if
   they already know the context.
2. **A voice agent that won't tell you something is certified unless it looked
   it up** — leads with the engineering claim. Best for a technical reader who
   sees a lot of demos.
3. **Kosher certification hotline — live, 30 seconds to try** — lowest friction.
   Best if you think they'll open it on a phone between meetings.

I'd send (2) to an engineer and (1) to anyone else.

---

## Answers to the five replies you'll get

Short enough to paste directly.

### "What's the latency in production?"

Measured, in the strip at the bottom of the live section: **1.6–2.6 seconds** for
a turn that does a lookup. That's honest rather than flattering, and the strip
shows the target next to the measurement rather than quietly moving the goalpost.

The shape is why. A tool-using turn is two sequential model round trips — the
model asks for the lookup, we execute it, then it writes the answer from the
result — plus triage in front and the verifier behind. Four sequential model
calls, none of which can be parallelised because each needs the previous one's
output.

Real telephony is where that improves, and the gain is mostly not from the
models. Browser speech recognition and synthesis are the largest avoidable
costs; Deepgram plus Cartesia over Twilio Media Streams puts **700–900ms** in
range. The roadmap has the detail.

### "How do you stop it hallucinating certification status?"

Three layers, and the point is that none of them is a prompt instruction.

1. **A separate verifier model call.** It receives the drafted reply plus the
   raw tool results and returns pass or block. It's a distinct call, not a
   longer prompt, because a model checking its own draft shares the context that
   produced the error. On a block, the specialist retries once with the specific
   claim named; a second block falls through to a safe deflection.

2. **The interpretation travels with the data.** Every tool result about
   certification status carries a `meaning` field in plain words, including that
   absence from the database is not a statement about kashrus. A prompt rule
   competes with the caller's insistence; a sentence inside the result the model
   just received does not.

3. **Capability removal.** The symbol data has no reliability field and the
   pricing data has no single-figure cost field. There's nothing to leak on
   either question even under pressure.

Press any button in the **Break It** panel to see it working. Blocked drafts are
shown in full, struck through, with the reason — a caught hallucination you can
read is the actual evidence.

### "How do you know it still works after you change a prompt?"

Twelve eval cases in `config/evals.json`, run against the same code path the
browser drives — there's no eval-only mode. You can run them yourself from the
page; the timestamp comes from the server when you click.

Each case is scored by two gates that must both agree. **Deterministic
assertions** read the real event stream: which agent was routed to, which tools
actually ran, whether a status claim was backed by a lookup in the same turn,
which guardrails fired, which phrases are absent. **An LLM judge** grades quality
1–5 against that case's rubric and must return 4 or better. Assertions catch
mechanical failures a judge waves through; the judge catches phrasing that
passes every regex and would still mislead a caller.

GitHub Actions runs the suite on every push. There's also a pull request that
deliberately loosens one guardrail so two evals go red in CI, then tightens it
so they go green — the red-to-green is visible in the PR's checks history. That
PR is the honest answer to this question: the prompts are code, and there's a
net under them.

### "What would real telephony actually take?"

Two stages, and I'd ship the first before building the second.

**The simple version** is a few hours: a Twilio number, `<Gather
input="speech">`, and a webhook into the same pipeline. Twilio does the speech
recognition and posts a transcript. Around 2–3 second turns. Boring, reliable,
and a real phone number.

**The good version** is Twilio Media Streams — a bidirectional WebSocket of raw
audio — with Deepgram for recognition (with a custom kashrus vocabulary, which
is worth more than it sounds), Cartesia for synthesis, and proper VAD
endpointing instead of waiting for a recognition engine to decide the caller
stopped talking. That's the 700–900ms path.

What it needs from you: a Twilio account, a purchased number, and a decision
about who answers when it escalates. The escalation paths all assume a human is
reachable, and at Pesach that assumption is the thing that breaks first.

### "What does this cost at our call volume?"

Under a cent per turn today. Triage and the verifier run on Haiku 4.5; only the
specialist runs on Sonnet 5, and only when a specialist is actually needed.
Per-turn cost is on screen so you don't have to take my word for it.

At **2,000 calls a day averaging three turns**, model cost is roughly
**$30–60/day**. At that scale the models are not the expensive part — telephony
and speech infrastructure are.

The bigger cost question isn't average volume, it's **Pesach**. Consumer kashrus
volume spikes hard in the weeks before, and the questions concentrate: the same
product asked about fifty times a day, almost always about Pesach status
specifically. That's where a semantic cache over (product, intent) pays for
itself, and it's the one place I'd want to be careful, because a stale Pesach
answer is precisely the harm the system exists to prevent. The roadmap covers
it.

---

## What to say if they find something broken

Say what it is. The build has a deliberately honest posture throughout — the
latency strip shows real numbers, the recorded-calls panel says when it has
nothing captured, `/api/usage` admits when the spend counters are per-instance
rather than global. Claiming polish it doesn't have would undercut the parts
that are genuinely solid.

If the microphone doesn't work for them, that is expected on many phones and the
UI says so on arrival — text input is a first-class path, not a fallback.
