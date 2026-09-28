# Stage eval v1: the docs.ciele.app Assistant, 28 September 2026

The retrieval bench (`../../rag-eval/`) measures one stage offline. These datasets measure the other
tiers the same way the console does, through **Eval** (`/eval`, #992), against the live "Ciele"
Assistant on ciele.app, whose Knowledge is the 21 crawled pages of docs.ciele.app.

Run on 28 September 2026. Every number below comes from `results-2026-09-28.json`, the raw
per-execution records of the 15 runs.

## Datasets

Upload each file in **Eval → Datasets**, then start a run per stage. A run is capped at 24
executions, so every file holds 8 examples, and three models fit in one run.

| File | Examples | Reference | Stages it grades |
|---|---|---|---|
| `knowledge-{1,2,3}.json` | 24 questions, 5 in Italian, each answered by one docs page | `answer_contains` + `source_url_contains` | Answer, Fallback (text and citation); Reranker (citation only) |
| `routing-{1,2,3}.json` | 24 messages, 4 in Italian: 8 courtesy, 8 about the assistant, 8 content questions | `flow_name` | Classifier, Orchestration, Pre-flight |

The routing set has traps on purpose: "Can you help me set up voice mode?" (a polite request for
content), "Thanks, but how do I delete a source?" (courtesy plus a question), "What can a Goal
check?" and "Does Ciele crawl login-protected websites?" (words that look like the assistant's own
name or capabilities), and "I need to talk to a human" while **Human Help Needed** is disabled.

Grading is `gradeEvaluation` in `packages/core/src/evaluation.ts`: literal, case-insensitive
fragments, not a model judge. Prices are the Eval estimates in EUR, not invoices, and not the
USD list prices of the retrieval slide.

## Results

The Assistant's base model is `google/gemini-3.1-flash-lite`. Only Google, Jev and Voyage are
connected in this Organization.

### Answer: the model that writes the reply

| Model | N | Accuracy | Answered¹ | Autonomy² | € / 1,000 | Median latency | p95 latency |
|---|---:|---:|---:|---:|---:|---:|---:|
| gemini-3.5-flash | 24 | **96%** | 96% | 100% | 3.04 | 8.6 s | 10.3 s |
| gemini-3.5-flash-lite | 24 | 25% | 38% | 100% | 2.12 | 10.1 s | 15.5 s |
| gemini-2.5-flash-lite | 24 | 17% | 21% | 100% | 0.72 | 5.5 s | 7.3 s |

The answering page was among the cited Sources in 24 of 24 turns for both 3.5 models and 16 of 24
for 2.5 Flash Lite, whose leaked tool calls never ran a search. So the Lite models fail after
retrieval, not in it:

- **3.5 Flash Lite** said "I don't have that information in my knowledge base" 13 times with the
  answering page in its own sources, and invented "30 minutes" for a 60-second recording limit.
- **2.5 Flash Lite** was cut off before it summarised 11 times, and 6 times it returned a tool call
  as the answer text (`print(default_api.searchKnowledge(...))`).
- **3.5 Flash** missed one: the Italian question about the licence, where it retrieved
  `/editions` and still said it had no information.

¹ Answered = not a refusal, a cut-off or a leaked tool call. ² Eval's autonomy flag counts only a
reply part of type `fallback` or `refusal`, so a refusal the model writes as ordinary text still
counts as autonomous. On this stage, read **Answered** instead.

### Classifier: Intent Classification alone

| Model | N | Accuracy | Autonomy | € / 1,000 | Median latency | p95 latency |
|---|---:|---:|---:|---:|---:|---:|
| gemini-3.5-flash-lite | 24 | **100%** | n/a | 0.30 | 2.9 s | 5.1 s |
| gemini-3.5-flash | 24 | 96% | n/a | 0.57 | 2.2 s | 3.8 s |
| gemini-2.5-flash-lite | 24 | 92% | n/a | 0.10 | 0.9 s | 1.0 s |

The model that fails as an answer model is the best router. Every miss is the same mistake: a
content question that mentions the product ("Does Ciele crawl login-protected websites?", "What can
a Goal check?") sent to **Assistant Information** instead of Default behavior.

### Orchestration: the classifier inside a full turn

| Model | N | Accuracy | Autonomy | € / 1,000 | Median latency | p95 latency |
|---|---:|---:|---:|---:|---:|---:|
| gemini-3.5-flash-lite | 24 | **100%** | 100% | 1.52 | 9.9 s | 14.5 s |
| gemini-3.5-flash | 24 | 96% | 100% | 1.80 | 9.7 s | 15.1 s |
| gemini-2.5-flash-lite | 24 | 96% | 100% | 1.37 | 9.0 s | 12.9 s |

Cost and latency are for the whole turn, because the base model still writes the reply. The
routing result matches the isolated Classifier stage.

### Pre-flight: one calibrated routing decision before classification

| Model | N | Accuracy | Autonomy³ | Errors | € / 1,000 | Median latency | p95 latency |
|---|---:|---:|---:|---:|---:|---:|---:|
| typesafe-ai/jev | 24 | **83%** | 75% | 4% | 0.07 | **0.6 s** | 1.0 s |
| gemini-3.5-flash | 24 | 38% | 0% | 50% | 0.29 | 1.6 s | 1.7 s |
| gemini-3.5-flash-lite | 24 | 8% | 0% | 92% | 0.05 | 1.6 s | 1.7 s |

³ Autonomy here = the decision cleared its threshold and routed, instead of handing the message
to Intent Classification.

Gemini on this stage mostly measures the budget, not the judgement. The pre-flight has a 1.5 s
timeout (`PREFLIGHT_TIMEOUT_MS`), and 12 of 24 Gemini 3.5 Flash calls and 22 of 24 Flash Lite calls
hit it. Of Jev's four misses, two were declines (below threshold, so classification would still
have routed them), one was the "What can a Goal check?" trap, and one was an aborted call.

### Reranker: which passages the answer model reads

| Model | N | Accuracy | € / 1,000 | Median latency | p95 latency |
|---|---:|---:|---:|---:|---:|
| voyage/rerank-2.5 | 24 | 100% | 0.04 | 1.1 s | 1.3 s |
| voyage/rerank-2.5-lite | 24 | 100% | 0.01 | 1.1 s | 1.3 s |

Both put the answering page among the cited Sources for every question. With 21 pages the
candidate set is too small to separate them. `bench:rag`, with 10 long readings and fact-level
judging, is the test that did (100% against 98% top-1).

### Fallback: not run

The Fallback stage needs a model from a vendor other than the Assistant's own, and this
Organization connects only Google. The console refuses with "At least two models must be
configured for this stage." Connect Anthropic or OpenAI in **Settings → AI Provider**, then run
`knowledge-{1,2,3}.json` on the Fallback stage.

## Summary by tier

| Tier | Best on this data | Accuracy | Autonomy | € / 1,000 | Median latency |
|---|---|---:|---:|---:|---:|
| Answer | gemini-3.5-flash | 96% | 96% answered | 3.04 | 8.6 s |
| Classifier | gemini-3.5-flash-lite | 100% | n/a | 0.30 | 2.9 s |
| Orchestration | gemini-3.5-flash-lite | 100% | 100% | 1.52 | 9.9 s |
| Pre-flight | Jev | 83% | 75% | 0.07 | 0.6 s |
| Reranker | voyage/rerank-2.5-lite (tie) | 100% | n/a | 0.01 | 1.1 s |
| Fallback | not measured | | | | |

## Limits

- 24 examples per stage. One miss moves accuracy by 4 points. Treat a gap under ~10 points as
  noise.
- The question sets were written from the same docs the Assistant crawled, which favours
  retrieval.
- The Knowledge was crawled on 26 September. A docs change since then can turn a correct answer
  into a miss.
- The routing references assume the current Flow list: Basic Interaction and Assistant Information
  enabled, Human Help Needed and Socratic flow disabled.

## Runs

| Stage | Dataset 1/3 | 2/3 | 3/3 |
|---|---|---|---|
| Answer | [5dw5Q4HY-CMu](https://ciele.app/eval/5dw5Q4HY-CMu) | [HFp49EGr-mpv](https://ciele.app/eval/HFp49EGr-mpv) | [dE25G0xg-HZ3](https://ciele.app/eval/dE25G0xg-HZ3) |
| Classifier | [t57VRmWp-4n3](https://ciele.app/eval/t57VRmWp-4n3) | [g4c2cBH5-Y68](https://ciele.app/eval/g4c2cBH5-Y68) | [r8Qo0MvY-Dsn](https://ciele.app/eval/r8Qo0MvY-Dsn) |
| Orchestration | [R3pBDqfe-EYA](https://ciele.app/eval/R3pBDqfe-EYA) | [PlVE2hER-b2E](https://ciele.app/eval/PlVE2hER-b2E) | [hEF5Btly-8km](https://ciele.app/eval/hEF5Btly-8km) |
| Pre-flight | [xH1rFZ0b-gPm](https://ciele.app/eval/xH1rFZ0b-gPm) | [wGSUvyIh-ncc](https://ciele.app/eval/wGSUvyIh-ncc) | [ZCEm3Cfn-2OE](https://ciele.app/eval/ZCEm3Cfn-2OE) |
| Reranker | [BOeIj3Tj-ckz](https://ciele.app/eval/BOeIj3Tj-ckz) | [NmWxcBnD-Fce](https://ciele.app/eval/NmWxcBnD-Fce) | [YElM3sFJ-7GD](https://ciele.app/eval/YElM3sFJ-7GD) |
