# Architecture

Why this shape, and what it costs.

---

## Why supervisor-and-specialists rather than one prompt with ten tools

A single prompt holding every tool has to describe every rule for every
situation simultaneously. The instruction "never comment on another agency's
reliability" has to coexist with "give the process and a broad range for
certification pricing" and "state Pesach separately from year-round" — and each
rule dilutes the others. Attention is finite, and a rule that matters in one
situation out of ten is competing with nine irrelevant ones.

Splitting by queue means the product agent's prompt is about product status and
nothing else. It is shorter, more specific, and can afford to be emphatic about
the three things that actually go wrong in product calls.

The second reason is harder to get any other way: **a specialist physically
cannot call a tool it was not granted.** The sales agent has no `open_complaint`.
The shailah router has `escalate_to_rav` and `get_hours` and nothing else — it
could not look up a product if its prompt told it to. That is enforced in
`toolsForAgent()` in `src/lib/tools/registry.ts`, which reads the per-agent
`tools` array from config and throws at startup if it names a tool that does not
exist. A prompt instruction not to use a tool is a request; an absent tool is a
guarantee.

The cost is one extra model call per turn for triage, and a routing decision
that can be wrong. Triage being wrong is mitigated by the shailah override — the
one misroute that would cause real harm is detected separately from the intent
and takes priority over it.

---

## Why the verifier is a separate model call

The obvious alternative is a longer specialist prompt: "before you reply, check
that every claim is supported." That fails for a specific reason. A model
checking its own draft shares the context that produced it — including the
caller's pressure, the half-remembered brand name, and whatever reasoning led to
the ungrounded claim. It is being asked to find a mistake it does not believe it
made.

The verifier starts clean. It receives three things: the caller's message, the
**raw** tool results, and the drafted reply. It has never seen the conversation,
has no draft to defend, and is given a lettered checklist rather than a
conversation. Its question is narrow enough to be nearly mechanical: does this
claim appear in this JSON?

That narrowness is also why it runs on the cheap tier. Comparing a claim against
a document is not the task that needs the strong model; composing a precisely
phrased answer under pressure is. Running the verifier on Sonnet would roughly
double the cost of the pipeline to do a job Haiku does well.

**It fails closed.** A verifier that cannot reach a verdict blocks rather than
passes. A verifier that errors takes the turn to the safe deflection. On a block
the specialist retries once with the reason injected — naming the specific claim,
because "your draft was rejected" produces another draft with the same problem —
and a second block falls through to the deflection rather than a third attempt.

### When it runs, and why it sometimes doesn't

It runs whenever the turn could carry a certification claim: the product,
establishment and complaint intents always; any turn where a tool returned a
status or an alert; any turn where a guardrail fired; every shailah reply
(checked for leaked halachic content rather than for status). It skips greetings
and hours answers, which saves roughly 250ms on turns that cannot cause harm.

The bias is deliberately toward running it. An unnecessary verifier call costs a
fraction of a cent and a quarter second. A skipped one that should have run is
the exact failure the system exists to prevent.

---

## Guardrails: why regexes and not another model

The guardrails are string checks in code, before and after the model. That looks
lazy next to an LLM judge, and it is the right choice for a specific reason: the
failure modes here are *particular phrasings*.

"It's not kosher." "That's fine." "The cost is $8,000." "They're very reliable."

A regex catches those deterministically, in microseconds, with no variance
between runs. Asking a model "was this reply acceptable?" would be slower,
cost more, and — worse — give a different answer on different days, which makes
a regression impossible to detect.

The two mechanisms cover different things and neither replaces the other. A
regex cannot tell whether a claim is *supported by the tool results*; that
requires reading the results, which is the verifier's job. A model is unreliable
at "does this exact phrase appear"; that is the regex's job.

Exemptions matter more than they look. `"it's not kosher"` appears inside the
sentence the system is *trying* to produce — "that doesn't mean it's not
kosher" — so an exemption clears the whole rule when a disclaiming phrase is
present. Without that, the guardrail would block the correct answer.

Every pattern lives in `config/agent.config.json`. Tightening a guardrail is a
config change with an eval to prove it, which is what the deliberate-regression
commit demonstrates.

---

## The interpretation travels with the data

The most load-bearing design decision is small and easy to miss. Every tool
result that concerns certification status carries a `meaning` field stating the
interpretation **in words**:

```json
{
  "status": "not_in_database",
  "meaning": "We do not certify this. This is NOT a statement that it is not
              kosher — it may well be certified by another agency whose symbol
              is on the package. Say that we do not certify it, never that it
              is not kosher, and offer to identify the symbol."
}
```

A rule in the system prompt competes with the caller's insistence and with
everything else in the prompt. A sentence sitting inside the tool result the
model received two hundred tokens ago does not. It also means the verifier and
the on-screen trace are checking against the same explicit text, rather than
against a rule stated somewhere the reader cannot see.

The same principle runs the other way: `data/symbols.json` has no reliability
field and `data/certification.json` has no single-figure cost field. There is
nothing there to leak on either question even under pressure. Removing the
capability beats instructing a model not to use it.

---

## The latency budget, honestly

| Stage | Target (brief) | What actually happens |
|---|---|---|
| STT finalise | <300ms | Browser-dependent, often worse |
| Normalisation | <20ms | Comfortably inside — sub-millisecond typically |
| Triage | <200ms | Haiku with a 400-token cap; realistically 300–600ms |
| Specialist first token | <500ms | 400–900ms on the first round trip |
| Tool execution | — | Local JSON lookups, single-digit ms |
| Verifier | <250ms | 300–600ms |
| **Total** | **<1500ms** | **Realistically 1.6–2.6s for a tool-using turn** |

The brief's total is not reachable, and it is worth being precise about why
rather than treating it as a stretch goal.

A turn that uses a tool is **two sequential model round trips**. The model
cannot ask for a lookup and answer from it in one call — it emits a `tool_use`
block, we execute, we send the result back, and it generates the reply. Each
round trip has its own network latency and time-to-first-token. Add triage in
front and the verifier behind and there are four sequential model calls on a
product-status turn.

You cannot parallelise them, because each depends on the previous one's output.
You can only make each cheaper, and they are already on the cheapest model that
does the job.

So `latencyBudgetMs` in config carries three numbers per stage: the brief's
`target`, plus `amber` and `red` thresholds calibrated to what the pipeline
actually achieves. The strip shows the measurement against both. Colouring
against the target would leave a healthy system permanently red, which teaches
the reader to ignore the strip.

Where the time actually goes, and what would move it, is in
[ROADMAP.md](./ROADMAP.md) — briefly: browser STT and TTS are the largest
avoidable costs, and replacing them with Deepgram and Cartesia is what makes
sub-900ms plausible.

### The one latency decision with a real trade-off

Streaming audio and a blocking verifier cannot both be had.

The brief asks for TTS to begin at the first sentence boundary — the largest
perceived-latency win available — and for the verifier to block bad drafts
before the caller hears them. Speaking sentence one means a blocked draft has
already been read aloud. An agent that interrupts itself to retract a
certification claim is worse than one that paused, because the caller has
already heard the wrong thing and may act on it.

The resolution is to decide per turn, from triage, **before generating a token**:

- Turns that cannot carry a certification claim (greetings, hours) speak at the
  first sentence boundary. Nothing for the verifier to catch, so nothing to wait
  for.
- Turns that can (product, establishment, complaint, shailah, anything where a
  guardrail fired) stream text to the screen immediately — marked as an
  unverified draft — and hold the **audio** until the verdict.

The turns where correctness is a religious-harm concern pay the latency. The
turns where it isn't get the fast path. The trace rail reports which path ran and
why, so the trade-off is visible rather than asserted.

---

## Cost

| Tier | Model | $/Mtok in | $/Mtok out | Calls per turn |
|---|---|---|---|---|
| Triage | `claude-haiku-4-5` | $1.00 | $5.00 | 1, always |
| Specialist | `claude-sonnet-5` | $3.00 | $15.00 | 1–2 (2 when a tool is used) |
| Verifier | `claude-haiku-4-5` | $1.00 | $5.00 | 0–1 |
| Judge | `claude-sonnet-5` | $3.00 | $15.00 | evals only, never on the hot path |

A product-status turn is triage + two specialist round trips + verifier, and
lands well under a cent. Prompt caching is applied to the system prompts, which
are the stable part of the request and the largest — the cache breakpoint sits
after the shared policy and agent prompt, with the caller's turn and all tool
results after it, where they cannot invalidate the prefix.

At real hotline volume — say 2,000 calls a day averaging three turns — the model
cost is roughly $30–60/day. The dominant cost at that scale is not the models; it
is telephony and speech infrastructure. See ROADMAP.md.

---

## What the request shape has to get right

The two tiers need genuinely different request bodies, and the failures are 400s
rather than degradations:

- **Sonnet 5** rejects `temperature`, `top_p`, `top_k` and `budget_tokens`.
  Thinking is `{type:'adaptive'}` or `{type:'disabled'}`, and
  `output_config.effort` is supported.
- **Haiku 4.5** predates that change and is the mirror image: `temperature` is
  accepted, `output_config.effort` is rejected.

So `tierParams()` in `src/lib/agents/client.ts` derives the shape from
capability flags in config rather than assuming, which means changing a model id
in config cannot silently produce an invalid request.
`npm run check:models` sends the exact body each tier builds, as a two-second
pre-flight.

Specialists run with thinking disabled. This is a voice agent on a latency
budget, and a hotline answer is a lookup plus two sentences, not a reasoning
task. The documented mitigations for thinking-off prompts — permitting a brief
sentence before a tool call, and a generic instruction against emitting internal
tags — are in the shared policy and noted there as load-bearing.
