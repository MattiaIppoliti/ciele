# Stage eval: every tier of a turn, through Ciele's Eval

The retrieval bench (`../rag-eval/`) measures one stage offline. These datasets measure the other
tiers of a turn the way a customer would, through **Eval** (`/eval`, #992) on ciele.app.

- [`v1/`](v1/README.md): the first round, 28 September 2026, on the docs.ciele.app Assistant. It
  was too easy: the questions came from the same 21 web pages the Assistant crawled, and every
  answer was a single fact.
- This folder: the second round, a fictional organization in eight files and seven formats, with
  questions written to separate the models.

## Corpus

Kestrel Freight Cooperative does not exist, so no model can answer from memory. `build-corpus.mjs`
writes every file in `corpus/`, and every fact a question depends on is in that one script:

| File | Format | What it holds |
|---|---|---|
| `staff-handbook.pdf` | PDF, 3 pages | leave, sick leave, remote work, expenses, notice, training |
| `travel-policy-tp7.docx` | Word, with two tables | approval thresholds, cabin classes, per diem, hotel caps |
| `policy-change-log.txt` | text | later entries that supersede values in the handbook and the travel policy |
| `warehouses.csv` | CSV | six warehouses: manager, capacity, doors, opening hours, cold storage |
| `q3-2026-operations-review.pptx` | PowerPoint, 5 slides | on-time and damage rates per warehouse, actions, headcount |
| `rate-card-2026.xlsx` | Excel, 3 sheets | base rates by zone and weight, country zones, surcharges |
| `it-security-standard.txt` | text | MFA, passwords, incident reporting, USB storage |
| `procedura-resi.md` | Markdown, Italian | the customer returns procedure |

`verify-corpus.mts` runs each file through the production extractor (`extractSourceText`, the same
triage and parsers an upload goes through) and prints the text a question can rely on. All eight
pass.

```bash
node packages/agent/scripts/stage-eval/build-corpus.mjs
pnpm --filter @agent-hub/agent exec tsx scripts/stage-eval/verify-corpus.mts
```

## Datasets

Six files per set, 8 examples each, so three models fit in one run under the 24-execution cap.

**`knowledge-{1..6}.json`**: 48 questions. `knowledge-kinds.json` labels each one:

| Kind | Count | What it tests |
|---|---:|---|
| single fact | 23 | one value, spread over all seven formats |
| superseded | 3 | the change log overrides the handbook or the travel policy |
| calc | 7 | rate × surcharges, per diem × days, sums across rows |
| multihop | 5 | two files together, e.g. the deck's worst warehouse and the CSV's manager |
| cross-language | 6 | Italian questions over English files, English over the Italian one |
| unanswerable | 4 | nothing in the corpus answers; the right reply says so |

The unanswerable four carry no reference, so Eval grades them `n/a`. Grade them by reading the
answers.

**`routing-{1..6}.json`**: 48 messages, 12 per Flow: Basic Interaction, Assistant Information,
Human Help Needed, Default behavior. The Default behavior messages are traps: a greeting with a
question in it, "What can the security desk do…", "Which person manages…", "is there a human review
of expense claims?".

## Running it

1. Create an Assistant and upload the eight files in **Knowledge**.
   The deck and the workbook need Knowledge to accept `.pptx` and `.xlsx`, which lands in its own
   PR (`claude/knowledge-pptx-xlsx`).
2. Enable **Human Help Needed** in **Flows**, so the routing set has four classes.
3. Upload the twelve datasets in **Eval → Datasets**.
4. Start one run per dataset and stage. Knowledge sets: Answer and Fallback. Routing sets:
   Classifier, Orchestration and Pre-flight.

The Reranker stage cannot be graded on this corpus: it grades `source_url_contains`, and an
uploaded file has no URL.
