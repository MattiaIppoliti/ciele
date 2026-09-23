# Jev against a chat model: what it actually saves

Spec #948. This document exists so nobody has to take the decision-model idea on faith. It
separates three things that get mixed together in vendor material:

1. **Measured.** Numbers taken from real calls, with the date and the route.
2. **Arithmetic.** Cost computed from this repo's own price table
   (`packages/core/src/pricing.ts`), which is list prices in EUR, not invoices.
3. **Projected.** Anything that depends on a baseline we have not measured yet.

Where a number is projected, it says so. The point of the shadow pre-flight
(#952) is precisely to replace the projections here with measurements.

---

## 1. What was measured

Five `experimental_evaluate` calls against `typesafe-ai/jev` through the AI
Gateway, from Italy, edge Frankfurt, 21 September 2026 (#940):

| | ms |
|---|---|
| Cold first call | 1266 |
| Warm | 299 · 354 · 299 · 393 |

The #951 keyed replay, 43 hand-labelled messages through the same route, run
**twice on different days** so the numbers below are a repeat rather than a
single sample:

| | First run | Second run |
|---|---|---|
| Median | 309 ms | 335 ms |
| p90 | 351 ms | 485 ms |
| Routing agreement with the labels | 72% | 72% |

Per question, second run: language and desk 100%, wants_human 98%, faq 93%,
flow 86%, frustration 74%, **reasoning 58%**. The first run gave the same
picture (faq 91%, reasoning 60%), so the weak two are weak repeatably.

Tokens on one boolean decision over an Italian message (#950): **296 input, 23
output**. The seven-question pre-flight map runs around **500 input** tokens.

Two facts worth carrying: the Gateway **relays Jev's calibrated confidence**,
and it **hides the resolved model version** (the response echoes the id it was
sent). The second is why the map records the version it was written against
rather than pretending to pin one.

### The finding that matters is the confidence curve, not the accuracy

Headline accuracy is the wrong number to set a threshold from. Split each
question by the confidence the provider returned:

| Question | at or above 0.8 | below 0.8 | share of turns kept at 0.8 |
|---|---|---|---|
| reasoning | **90%** (18/20) | **30%** (7/23) | 47% |
| frustration | **87%** (27/31) | 42% (5/12) | 72% |
| flow | 89% (31/35) | 75% (6/8) | 81% |
| faq | **100%** (34/34) | 67% (6/9) | 79% |
| desk | 100% (38/38) | 100% (5/5) | 88% |
| language | 100% (43/43) | — | 100% |

`reasoning` is not a question the model answers badly. It is a question it
answers **badly when it says so**: above 0.8 it is right nine times in ten, and
below 0.8 it is right three times in ten, which is worse than a coin. The same
shape holds for `frustration`. So the conclusion is the opposite of dropping
them: **gate them hard and keep them**, at the cost of asking about half the
turns instead of all of them. That is what a calibrated model is *for*, and it
is the clearest evidence in this document that the calibration is real.

`faq` is the other one worth reading twice: 34 of 34 above 0.8. If that holds
on live traffic, the FAQ direct hit (#954) is the cheapest correct answer in
the whole spec.

**One caveat on the table above.** `wants_human` is a Boolean, and its column
is P(true), not a confidence: `clearsThreshold` judges a Boolean on its own
probability by design (#951). Its row therefore does not read like the others
and is left out rather than made to look comparable.

### The 150-message synthetic set, two runs

The 43 cases above were the whole labelled set until #953's synthetic set landed: 150 messages
drawn from a public customer-support corpus, 112 of them Italian, with gold labels and **no
hand-written confidences**. Two replays over all 193 messages on 21 September 2026 (median 334
and 309 ms, p90 497 and 423 ms) repeat the picture: `flow` 95% precise at 0.80 on 80% of turns,
`faq` 99% at 0.85, `wants_human` with no false positive at any cut and 86% recall at today's
0.85 (100% at 0.70), `reasoning` 92% at ≥0.90 on a fifth of turns and a coin below. The sweep
tables, the per-language columns and what the misses turn out to be are in
[`preflight-labelling.md`](preflight-labelling.md).

### What else is worth measuring, and is not measured here

- **The same replay through the adapter**, uncalibrated, which is what a
  self-host with no Jev key gets. Nobody has run it, so the sentence "a
  self-host behaves as today" is an argument from the code rather than a
  measurement.
- **Latency from the serving region**, not from a laptop in Italy. The numbers
  above include a home connection to the Frankfurt edge.
- **Cost per turn from the ledger**, once the shadow has run: §2 is arithmetic
  over a token count, and the ledger will have the real one.
- **The classification this replaces**, in tokens and milliseconds. Still the
  one gap that turns §3 from an argument into a comparison.

---

## 2. Cost, as arithmetic

Jev is priced at **€0.04 per million input tokens, output free**. Every other
row is this repo's price table. The comparison is deliberately like-for-like:
**the same 500 input and 25 output tokens on each model.** It answers "what
does one decision cost", not "what does the whole feature cost", which is §3.

| Model | €/M in | €/M out | One decision | Against Jev |
|---|---|---|---|---|
| **Jev** | 0.04 | 0 | **€0.000020** | 1× |
| gemini-3.5-flash | 0.30 | 1.20 | €0.000180 | 9× |
| Haiku 4.5 | 0.75 | 3.70 | €0.000468 | 23× |
| gpt-5.1-mini | 0.90 | 3.60 | €0.000540 | 27× |
| **Sonnet 5** | 2.80 | 14.00 | €0.001750 | **88×** |
| Opus 4.8 | 14.00 | 70.00 | €0.008750 | 438× |

At 100,000 Visitor messages a month, one decision each:

| Model | Per month |
|---|---|
| Jev | €2 |
| gemini-3.5-flash | €18 |
| Haiku 4.5 | €47 |
| gpt-5.1-mini | €54 |
| Sonnet 5 | €175 |
| Opus 4.8 | €875 |

**The honest reading of this table.** Nobody routes intents on Opus, and the
row is there only to bound the range. The real comparison for a classification
is against a small model, where the ratio is 9× to 27×, not 88×. €2 against
€18 a month is not why you would do this. **The reasons are latency and
structure**, which is the next section.

---

## 3. Per use case

### 3.1 Pre-flight (#951, #952, #953)

*Today:* one streamed `streamObject` call picks a Flow, and nothing else is
asked. Language comes from the browser locale, escalation intent is not
detected, frustration is not measured.

*With Jev:* **one call answers seven independent questions** (Flow, FAQ, wants
a human, which desk, reasoning needed, frustration, language) in about 300 ms.

The saving is not one call made cheaper. It is **six answers that do not exist
today arriving for free**, plus the routing answer. Getting the same seven from
a chat model means either seven calls or one call with a schema large enough
that it costs more and is slower than the classification it replaces. That is
the structural argument, and it does not depend on the price table at all.

*Measured:* 309 ms median, €0.00002 per message.
*Projected:* the latency the classification actually costs today. **Not
measured.** The shadow (#952) records both per turn, which is what makes this
comparison real rather than argued.

*Known weakness, measured:* of the seven questions, `reasoning` was right 60%
of the time and `frustration` 74%. At 0.7 confidence `reasoning` was right once
in seven. Those two either take a much higher threshold or stop steering
anything and stay Insights signals. The other five ranged 86% to 100%.

### 3.2 FAQ direct hit (#954)

*Today:* a question whose answer the Organization already wrote goes through
retrieval and generation anyway, and comes back paraphrased.

*With Jev:* the pre-flight's FAQ answer clears its threshold and the stored
text is returned verbatim, with the FAQ as its Source.

This is the largest saving in the spec and it is **not a cheaper call, it is no
call**: no embedding, no retrieval, no generation. It is also the only one that
makes the answer *better* rather than cheaper, because the Organization's own
words beat a paraphrase of them.

*Projected:* the share of traffic this catches. Unknown until the shadow runs.
The FAQ question scored 91% in the keyed replay, with every miss at 0.7
confidence or below, which is what a threshold is for.

### 3.3 Verifier, tier one (#957)

*Today:* verification is a chat-model call with a written reason, expensive
enough that it runs **under a spend budget on a sample** rather than on every
answer.

*With Jev:* a boolean per cited claim on every answer; the chat model runs only
on fails and unsure answers, where its reason is what the Improvement needs.

The saving is coverage, not euros: sampling becomes universal at roughly the
cost of the sample. Claims carrying a date, an amount or a count skip tier one
by rule, because that is the one thing the vendor documents Jev as misjudging.

### 3.4 Approval gate (#958, in this branch)

*Today:* nothing. A granted Teammate action runs or it does not; there is no
judgement about whether a human should see it first.

*With Jev:* two questions, about 300 ms, before the action executes. Budget one
second, and every failure path answers "ask a human".

There is no baseline to save against here. The cost is €0.00002 per gated
action and the return is that an irreversible action is not taken unattended.
Doing this with a chat model would add a second or more to every action, which
is the difference between a gate somebody keeps switched on and one they turn
off.

### 3.5 Improvements dedup and priority (#959, in this branch)

*Today:* dedup is a title comparison at 0.85 similarity. It catches "Password
reset link expired" against "Password reset link has expired" and misses "I
can't get back into my account". Priority is not derived at all.

*With Jev:* one fan-out of booleans over up to 40 open items plus three
priority scores, once per piece of evidence, on a nightly routine.

Volume here is tiny, so cost is not the argument. **Correctness is**: one
broken answer that ten Visitors hit files one item with ten occurrences instead
of ten items, and the board counts problems rather than reports.

---

## 4. What this does not say

- **It does not say Jev is more accurate than Sonnet 5.** It is not. It picks
  among options code supplied and returns a calibrated probability; it writes
  nothing. Every use case here is one where a closed choice is the whole
  answer. Anything generative stays on a chat model, by design.
- **It does not claim a measured end-to-end latency win.** The classification
  it would replace has not been timed on our traffic. The shadow is the
  instrument, not this document.
- **It does not assume the vendor's throughput figures.** The 70–500 ms and
  1,200 requests a minute in the vendor material are first-party and from the
  US West. Our own European measurement is §1, and it is the one to quote.
- **It does not price a self-host.** With no Jev key the same question maps run
  on the Organization's own classifier model through the SDK adapter, priced at
  that model's rate with `calibrated: false`. The feature is a speed-up
  somebody can add, never a dependency they must buy.

## 5. What would change these numbers

The shadow (#952) records, per turn, the seven answers with their confidences,
the backend, the model id and the latency, beside the routing decision actually
taken. After a few weeks of real traffic it answers the three things this
document has to project: what a classification costs today in tokens and
milliseconds, how often the pre-flight would have agreed with it, and what
share of questions an FAQ already answers.

Until then, treat §2 as arithmetic and §3 as an argument.
