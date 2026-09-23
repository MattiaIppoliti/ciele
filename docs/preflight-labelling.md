# Pre-flight thresholds: the labelled sets and the labelling protocol

Ticket #953 sets the pre-flight's
routing thresholds from human-labelled traffic and blocks #954 (FAQ direct hit) and #955
(escalation from the pre-flight). The blocker is not code. A threshold is a claim about how often
the model is right when it says it is sure, and until that claim rests on labels someone actually
wrote, routing a Visitor on it means routing them on an invented number.

This page records what exists to make the claim checkable, how the labels are to be produced, and
what the first replays over the synthetic set say. Every number here comes from a `--json` run of
the replay script; the raw observation files are kept out of the repository (they carry the
provisional thresholds and 1,186 rows per run) and are kept outside the repository instead.

## 1. Two labelled sets

| Set | Cases | Languages | Labels | Where |
|---|---|---|---|---|
| hand-labelled (#951) | 43 | 21 it · 21 en · 1 fr | one labeller, with expected model distributions written in | `packages/core/src/testing/preflight-fixtures.ts` |
| **synthetic** (this work) | **150** | **112 it · 35 en · 3 mixed** | one labeller, **gold only**, no model numbers | `packages/core/src/testing/preflight-synthetic-cases.ts` |

The #951 set carries hand-written confidences beside each label. They exist so the pure
derivations and the SDK mock can be tested without a model, and they were never a measurement.
The synthetic set has none: the model's answers and confidences come from a replay, and the
fixture holds only what a human decided.

### Where the synthetic set comes from

The source is the Bitext customer-support corpus on Hugging Face
(`bitext/Bitext-customer-support-llm-chatbot-training-dataset`, 26,872 English rows, 27 intents,
CDLA-Sharing-1.0). It was chosen over intent corpora with native Italian (MASSIVE and its Italian
derivatives) because its intents are help-desk situations, and two of them, `contact_human_agent`
and `contact_customer_service`, are direct positives for the `wants_human` question that no
virtual-assistant corpus has.

`packages/agent/scripts/sample-preflight-source.mts` draws the 150 rows: seeded, stratified over
all 27 intents with quotas weighted toward the intents the questions turn on (14 asking for a
person, 10 complaints, 18 password and registration rows), and with the corpus's offensive-language
and typo rows oversampled (16 and 65 of the 150). Every case names its source row, intent and
flags, and `preflight-synthetic.test.ts` pins that the 150 rows are distinct and cover the 27
intents.

From there, by hand: 112 rows translated into Italian keeping the register (a typo where the
source had one, keywords where it was keywords), 35 kept in English with the source's own typos,
3 rewritten as a real Italian/English mix. Corpus placeholders became order numbers, amounts and
account tiers. Eleven cases are **augmented** beyond translation and say how in `source.augmented`:

- five got a topic clause ("about my refund", "il pagamento non va") so the `desk` question has
  positive cases; the corpus never names a topic beside a request for a person;
- five were rewritten as judgment questions ("mi conviene annullarlo e rifarlo o modificarlo?");
  the corpus has none, and a `reasoning` threshold measured on two of three levels measures little;
- one got an elapsed-time clause and one a repetition clause, for the clearly-frustrated level
  the sample under-represented.

The catalogue is one online-retail Organization: five Flows (account access, order changes,
refunds, payment problems, complaints), nine FAQs, three desks. Retail because the corpus is, and
industry-neutral because the map has to serve every vertical the product does.

### What the set cannot show

- **No "other" that is not also a request for a person.** The corpus has no greetings, thanks or
  off-topic rows, so every `other` case escalates and the `fallback` outcome has zero cases. The
  43-case set covers it; real traffic will.
- **The FAQ paraphrases are close.** Bitext varies wording around one intent, so a message labelled
  `faq_password` is rarely far from the curated question. Live FAQ hits will be harder, and the FAQ
  precision below should be read as an upper bound.
- **35 English cases** is enough to notice a language gap and not enough to set a per-language cut.
- **One labeller.** The labels are provisional until the campaign in §3 confirms or overturns them.

## 2. The seven questions and the tie-breaks

The allowed values per column, as the blind sheet lists them:

| Column | Values |
|---|---|
| `flow` | a Flow id from the catalogue · `default` (a question the knowledge base answers) · `other` |
| `faq` | an FAQ id · `none` |
| `wants_human` | `true` · `false` |
| `desk` | a desk id · `none`; **only read when `wants_human` is true** |
| `reasoning` | `lookup` · `explanation` · `judgment` |
| `frustration` | `0` calm · `1` mildly annoyed · `2` clearly frustrated · `3` angry |
| `language` | `it` `en` `es` `fr` `de` `nl` `pt` · `mixed` · `other` |

The criteria are the map's own, in `packages/core/src/preflight.ts`; a labeller reads those, not
this page. The decisions below are the tie-breaks the synthetic labels followed where the criteria
left room, so the campaign can adopt or reject each one explicitly:

1. **Asking the support hours is not asking for a person.** "A che ora posso chiamare il servizio
   clienti" is `wants_human: false` and `faq_contact_hours`; the curated answer is what they want.
   "Come si fa a parlare con il servizio clienti?" is `true`.
2. **An FAQ needs the question, not the topic.** "Come recupero la password?" is `faq_password`;
   "non riesco a recuperare la password" is `none` with `flow: account_access`, because the Visitor
   already tried what the FAQ would say. Same rule for the tracking pair: "quando arriva il mio
   pacco" is `faq_track_order`, "quanto ci mette la spedizione" is `faq_delivery_time`.
3. **A formal complaint is level 2 by default.** Deciding to lodge a complaint is exasperation even
   when the sentence is calm; a polite request for help filing one ("potete aiutarmi a presentare
   un reclamo?") is level 1; profanity in the same sentence makes it 3.
4. **Profanity is graded.** "maledetto", "cavolo", "damn", "bloody", "goddamn" are level 2; "cazzo",
   "fucking" and a hostile clause ("non mi stai aiutando per niente") are level 3.
5. **A stated problem is level 1.** "non riesco a", "c'è un problema", "problema con" without more
   is 1, not 0; repetition or elapsed time ("è passato un mese", "ho già provato tre volte") is 2.
6. **A desk is a label only on a message that wanted a person**, and only when the message names
   the topic. A bare "voglio parlare con qualcuno" is `desk: none`.
7. **Reasoning is about the answer, not the message.** "How do I switch an item of my order" is
   `explanation` (a procedure); "in quali casi posso chiedere un rimborso" is `explanation`
   (several facts); "dove vedo lo stato dell'ordine" is `lookup`; anything with "mi conviene" or
   "should I" that depends on the Visitor's situation is `judgment`.

Frustration was the hardest column to fill and is where the two native speakers are expected to
disagree most. That is a finding to record, not a problem to hide: a question two humans cannot
agree on is not one to route on.

## 3. The campaign

```bash
# 1. the blind sheet: 150 messages in a seeded shuffle, empty label columns, nothing else
pnpm --filter @agent-hub/agent labelling:preflight sheet /tmp/preflight-blind.csv
```

Give each labeller their own copy. They fill the seven columns from the map's criteria and the
tie-breaks above, without seeing each other's sheet, this repository's labels, or the source
intents (the sheet has none of them). An empty cell is a skipped item, not a disagreement.

```bash
# 2. agreement per question, then every disagreement with both answers
pnpm --filter @agent-hub/agent labelling:preflight agreement labeller-a.csv labeller-b.csv --gold
```

The report prints, per question, the items both answered, observed agreement and Cohen's kappa,
which is the figure #953 asks to be recorded per question (`cohenKappa` in
`packages/core/src/preflight-calibration.ts`; the textbook worked example is in its test).
`--gold` also compares each labeller against the synthetic labels, which says whether the set's
own labeller was the outlier. Then the two adjudicate the listed disagreements together, the
adjudicated labels replace the synthetic ones in the fixture with `provenance: "campaign"`, and
the kappa figures go on the ticket.

A rough reading of kappa: above 0.8 the column is ground truth; 0.6 to 0.8 is usable with the
disagreements adjudicated; below 0.6 the question's criteria need rewriting before any threshold on
it means anything.

Reduce the human work if 150 rows is too much: `desk` and `language` are at 100% in every replay
so far and `faq` above 90%, so labelling only `reasoning`, `frustration`, `flow` and `wants_human`
covers where the model actually errs and cuts the work roughly in half.

## 4. The replay and the threshold sweep

```bash
AI_GATEWAY_API_KEY=… pnpm --filter @agent-hub/agent replay:preflight --set all --json /tmp/preflight-<date>-runN.json
```

Both sets run against the real model, each with its own catalogue: about 200 calls, under a cent.
For every question the script prints accuracy overall and per language, then the **sweep**: at
each candidate cut from 0.50 to 0.95, the share of messages that clear it and how often the
cleared answer matched the label, and the lowest cut that reaches 95% precision on at least 20
cases (`suggestThreshold`). The per-language columns exist because #938 sets a per-language
threshold only when the two differ by more than 0.05.

`wants_human` is a Boolean and has no confidence apart from P(true), so its sweep reads "escalate
at P(true) ≥ t" and a separate line prints the recall over the messages that did want a person.

### Two runs, 21 September 2026, 193 messages each

Model `typesafe-ai/jev` through the Gateway (the response echoes the id; the map is written
against `jev-1.13.0`). Run 1: latency median 334 ms, p90 497 ms. Run 2, minutes later: 309 ms and
423 ms. Routing agreement with the gold destination at today's thresholds: 79% and 79% (run 1),
77% and 81% (run 2, hand-labelled and synthetic).

Accuracy per question, run 2, all sets then Italian and English (run 1 within two points on
every row):

| Question | all | it | en |
|---|---|---|---|
| flow | 88% | 89% | 86% |
| faq | 92% | 93% | 91% |
| wants_human (Boolean at 0.85) | 98% | 99% | 96% |
| desk (when a person was wanted) | 100% | 100% | 100% |
| reasoning | **45%** | 41% | 54% |
| frustration | 74% | 75% | 73% |
| language | 100% | 100% | 100% |

Coverage → precision at each cut, run 2, all sets:

| Question | today | 0.50 | 0.60 | 0.70 | 0.75 | 0.80 | 0.85 | 0.90 | 0.95 |
|---|---|---|---|---|---|---|---|---|---|
| flow | 0.80 | 96%→90% | 90%→93% | 85%→93% | 83%→94% | 80%→95% | 77%→96% | 72%→97% | 67%→98% |
| faq | 0.90 | 98%→94% | 95%→96% | 91%→97% | 89%→98% | 85%→99% | 83%→99% | 78%→99% | 69%→99% |
| wants_human (escalate at P(true) ≥ t) | 0.85 | 15%→100% | 15%→100% | 15%→100% | 14%→100% | 14%→100% | 12%→100% | 11%→100% | 10%→100% |
| reasoning | (none) | 70%→50% | 60%→52% | 53%→55% | 44%→61% | 39%→67% | 31%→73% | 20%→92% | 13%→96% |
| frustration | (none) | 93%→75% | 86%→78% | 82%→80% | 75%→81% | 70%→82% | 67%→83% | 63%→82% | 57%→85% |
| language | 0.70 | 100%→100% | 99%→100% | 98%→100% | 98%→100% | 98%→100% | 97%→100% | 96%→100% | 93%→100% |

`wants_human` recall over the 28 messages that did want a person, run 2: 100% up to 0.70, 96% at
0.75 and 0.80, **86% at today's 0.85**, 75% at 0.90. Run 1 gave the same curve. The four misses at
0.85 sit between 0.73 and 0.84 and there was no false positive at any cut in either run.

Lowest cut reaching 95% precision on at least 20 cases, run 2 (run 1 in brackets where different):

| Question | today | all | it | en | per-language? |
|---|---|---|---|---|---|
| flow | 0.80 | 0.80 (0.75) | 0.80 (0.75) | 0.90 | gap > 0.05, on 56 English cases |
| faq | 0.90 | 0.60 (0.55) | 0.60 (0.55) | 0.55 (0.50) | no |
| wants_human | 0.85 | 0.50 | (fewer than 20 clear any cut per language) | | no |
| language | 0.70 | 0.50 | 0.50 | 0.50 | no |

### What the misses are

The JSON makes the disagreements countable, and most of them are one boundary each:

- **`reasoning`: 104 of the 106 misses are gold `lookup`, model `explanation`.** The model reads
  "help me cancel order 48213" as a procedure to walk through; the labeller read it as one fact.
  Accuracy on this question is a labelling decision, not model noise: if the campaign adopts the
  model's reading of §2 rule 7, the question jumps to the high eighties without touching the map.
  Either way the calibration holds: 92% right at ≥0.90 on a fifth of turns.
- **`frustration`: 35 of the 50 misses are gold 1, model 0.** That is §2 rule 5, "a stated problem
  is level 1", which the model does not share. The next two boundaries (2→1, 0→1) are five and
  four cases. The column does not separate by confidence, and this is why.
- **`faq`: 8 of the 15 misses are the "voglio un rimborso" rows, model `faq_refund_policy`, gold
  `none`**, and 4 are "non riesco a recuperare la password", model `faq_password`, gold `none`.
  Both are §2 rule 2, question versus topic. The model is more generous with a curated answer than
  the labeller was; whether that is wrong is what the two native speakers decide.
- **`flow`: 17 of the 23 misses are gold `default`.** Informational rows about accounts, plans,
  newsletters and reviews, which the model places in `other` or, under threshold, in a Flow.
  Nearly all fall back to today's path rather than misroute, which is the fallback doing its job.
- **`faq_delivery_countries`** never matched in either run ("posso ordinare da Lugano?" against
  "In quali paesi consegnate?"): the model reads it as knowledge search. On the adjudication list.

### What the runs say about the thresholds

- **`flow` at 0.80 holds**: 95% precision at 80% coverage on 193 messages, both runs. English
  wants 0.90 on 56 cases, worth more English before it becomes a per-language cut.
- **`faq` at 0.90 leaves traffic on the table.** 85% of messages clear it at 99% precision; 0.60
  would clear 95% at 96%. With §1's caveat that these paraphrases are close, the FAQ direct hit
  (#954) can start at 0.85 and let the drift replay argue it lower.
- **`wants_human` at 0.85 is too strict for its own recall.** Zero false positives at any cut and
  100% recall at 0.70; 0.75 keeps precision at 100% and recall at 96% on 28 positives. A move to
  0.75 is what the data supports, on a positive set small enough that the campaign has to confirm
  it before #955 relies on it.
- **`reasoning` and `frustration` route nothing**, and the runs say they should stay that way
  until the labelling protocol settles their boundaries.
- **`desk` and `language`** are at 100% in both runs and need no campaign labels.

## 5. What shipped on it (#953)

The thresholds in `packages/core/src/preflight.ts` are now the values above, **marked
provisional** in the map's own comment: `flow` 0.80, `faq` 0.85, `wants_human` 0.75, `desk` 0.80,
`language` 0.70, map version 2. Two of the #951 borderline fixtures moved with the FAQ cut so they
still straddle it.

Routing is behind its own flag, `PREFLIGHT_ROUTING=1`, separate from `PREFLIGHT_SHADOW=1` on
purpose: observing must never become acting because a variable was already set. With routing on,
a decision that clears its threshold takes the Flow (or the Default behavior Flow for a confident
`default`) without the classification call, and the Thinking panel opens with the fixed line for
the outcome in the message's language, the browser locale as the fallback. Below threshold, or on
the adapter, the turn is today's turn event for event; the tests in
`packages/agent/src/preflight-engine.test.ts` assert that as an equality of the two event streams.
The stored record carries `acted: true` when the pre-flight routed, and the Inbox panel says
"routed" instead of "shadow".

The nightly drift replay is `/api/cron/replay-preflight` at 03:30 UTC on both deployments. It
re-routes the **baseline**, `packages/core/src/testing/preflight-drift-baseline.ts`: the 158 of
193 labelled messages the model routed to the gold destination at the current thresholds (run 3,
22 September 2026). A baseline case that lands elsewhere raises a `system` Alert on the
Organizations the platform owners belong to, cleared by the next clean run; a decision that threw
is counted as a failure and never as drift. Regenerate the baseline with
`replay:preflight --baseline packages/core/src/testing/preflight-drift-baseline.ts` whenever a
threshold or a criterion changes. Cases near a cut can flip between runs, so an Alert naming one
or two cases is worth a look at their confidences before it is worth a threshold change.

Still open on the ticket: the blind two-labeller campaign (§3) and its kappa figures. The two
columns to settle first are `frustration` (rule 5) and `reasoning` (rule 7); `desk` and
`language` can be skipped.

## 6. The FAQ direct hit (#954)

With routing on, an FAQ answer that clears 0.85 is the turn: the stored FAQ body verbatim as a
`custom_message` text part, a `sources` part naming the FAQ Concept, no Flow action dispatched,
so no retrieval and no generation, and "FAQ" as the Flow marker on the transcript and in the
export's `AgenticTrace`, the same marker the quick-reply FAQ button has always left. The
Thinking line is the table's `faq` sentence. An FAQ deleted or excluded since the catalogue read
returns null from the host's read and the turn takes today's path.

A catalogue past the 255-option cap is shortlisted by similarity: the same search the Default
behavior runs, read for its Concept ids, puts the FAQs it found first and fills the rest of the
254 slots from the catalogue in order. The record's `faqCatalogue` says `ranked: true` when that
happened, so a shadow row from before the shortlist (a bare prefix) and a routed row after it are
never averaged together. The pure rule is `prefilterFaqs`, tested on its own.

## 7. Escalation from the pre-flight (#955)

With routing on, a "wants a human" answer that clears 0.75 is the turn: one `help_desk` reply part
opening the escalation chip, on the desk the decision chose among the Assistant's selected desks
when that choice cleared 0.80, and on the generic menu when the desk answer was `none` or under
its cut. Nothing is classified, retrieved or generated, and the separate help-desk recommendation
model call is not made, because this is that recommendation. The Thinking line is the table's
`escalation` sentence; the Flow marker is "Escalation". Below threshold, or on the adapter, the
turn is today's turn event for event, recommendation call included.

The Conversation remembers the desk the latest turn's chip was opened on
(`preflight.recommendedHelpDeskId`, cleared by any turn that did not recommend), and when the
Visitor escalates, the escalation records the
recommended desk by name and whether the desk they took was it. The Inbox rail shows the pair.
Both fields are absent when no recommendation was on screen, so "not followed" is never inferred
from a turn that recommended nothing. The pre-flight picks no channel: the channel is the one the
Visitor takes in the desk's menu, recorded as it always was.
