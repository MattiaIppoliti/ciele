# The answer improvement workflow

Ciele helps an Organization give customer-site Visitors useful answers from internal knowledge.
The Improvements board should help Members close gaps in those answers. The unit is an
Improvement with evidence, an expected outcome, an owner, a correction, and validation.

## Foundational decisions

Keep Improvements as the answer-quality problem record. Work that fixes one goes on a Task, a
separate entity linked to the Improvement it resolves (ADR-0027). When every linked Task is Done,
an Improvement in Triage or Fix moves to Validate, and a person still closes it. Validation evidence
is orthogonal to Tasks: finished Tasks say the work was done, a validation record says the answer
was checked, and neither one resolves the Improvement. Keep external Help Desk tickets for Visitor
requests, Alerts for operational failures, Review Requests for paused Flow decisions, and Teammate
Routines for recurring execution. Each has a different completion rule. A credential Alert can
prevent an answer, but dismissing it must not resolve an Improvement.

Projects are the container of Tasks and optional coordination context for Improvements. Project
membership is not Assistant ownership, knowledge access, or publication scope. An Improvement can collect evidence
from several Assistants; its current evidence determines which Assistant the correction links open.
Never infer that Assistant from a Project name or silently apply a fix across every Assistant.

The current evidence includes original questions, actual answers, citations, conversation metadata,
and the number of linked messages. Linked-message count measures evidence, not unique Visitors,
severity, or lost revenue. Priority remains an explicit Member decision. Assignment names a Member
accountable for the outcome; it does not grant an AI permission to edit or publish.

## Lifecycle

| Console stage | Stable API status | Member's job | Primary next action |
| --- | --- | --- | --- |
| Triage | `to_do` | Read evidence, state expected answer, choose owner and priority | Start fixing |
| Fix | `in_progress` | Correct a Source, FAQ, Flow, or instruction; review suggested fixes | Ready to validate |
| Validate | `in_review` | Replay original questions, inspect citations, check customer widget | Mark resolved |
| Resolved | `done` | Retain outcome and evidence for future diagnosis | Reopen through status picker |
| Archived | `archived` | Retain a duplicate, obsolete, or declined item outside active work | Restore through status picker |

The primary button follows the sequence. Explicit status selection and drag-and-drop remain
available for correction and reopening. These are workflow decisions, not enforced release gates.
The labels live in `IMPROVEMENT_WORKFLOW` (`packages/core/src/improvements.ts`); the stored and API
statuses do not change. The automatic move of ADR-0027 lands on `in_review`, which the console now
names Validate, so a Task closing hands the item to the person who checks the answer.
Existing resolved items are not relabeled as automatically verified. A recurrence after closure
creates a new Improvement under the existing deduplication rule.

## End-to-end operation

1. Capture a weak answer through Inbox, a Flow, unresolved retrieval, escalation, or Goal evaluation.
   Link repeated evidence to the open Improvement rather than creating a separate task per answer.
2. During triage, write the expected answer and the observable failure in the description. Set an
   owner and priority. Use a Project only when it helps coordinate a larger effort.
3. Open the affected Assistant's knowledge or Flows directly from the evidence. Accept a generated
   FAQ only after reviewing its content and provenance. Acceptance writes knowledge and advances the item to Validate. It does not resolve the item.
4. Move to Validate. Ask the original question in Preview, check Sources and scope, and test relevant
   variations. Configuration changes need publication; knowledge changes are live. Neither a Preview
   success nor a publication alone proves the customer-site widget is correct.
5. Check the widget and record the correction and validation in the description before resolving.
   Preserve the original evidence; unlinking an inconvenient answer is not validation.

The board remains a bounded, paginated queue with list and Kanban layouts. Filters run before
pagination. Search, owner, priority, Project, Assistant scope, counts, and exports use the same
storage predicate, `public.matching_improvements`. Assistant scope follows linked conversation
evidence, including items affecting several Assistants. CLI and MCP list calls expose the same
filters through the public API, whose list answer carries per-stage `counts`.

`improvements.listPage` and `GET /api/v1/improvements` also run in the Rust service
(`services/ciele-api`). Its port reads through the same SQL predicate, an unfiltered request keeps
its one-statement direct path, and a filtered one runs the operation. `rust-parity.test.ts` and the
two web parity suites pin the filters, the counts and the zod wording to the TypeScript body.

## Validation and resolution evidence

Members record the expected behavior, changed resources, observed widget result, validator, time,
and publication. Evidence is append-only. Legacy resolved items have no recorded verification.
A status remains a workflow decision and does not fabricate an observed test result. The status
picker and external integrations remain compatible. We retain manual closure rather than introducing
a mandatory gate that would invalidate existing API clients and legacy records.

A Member can explicitly request a synthetic replay with up to three question/expectation cases.
The console offers one representative question at a time, seeded from the flagged answer's preceding
Visitor turn. Checks require explicit expected text and optionally Source citations. A deterministic
check records what passed or failed. It makes no claim about semantic equivalence beyond those
expectations. Replay never resolves or publishes anything.

The request and background job are inserted in one transaction, by a security-definer trigger, since
the requesting Member has no insert policy on the job ledger. Only one replay per Improvement
can be pending. Each job has one attempt to avoid repeating paid model work after a worker loss.
The generic job ledger records terminal failure and the validation record exposes it. Each case has
a 20-second limit, each job a 60-second limit, and every model turn uses the Organization spend
admission rules and the Publication's PII masking guardrail. Partial failures retain the completed
case results. Synthetic traffic creates no
Visitor Conversations, Inbox messages, or answer-quality KPIs. Evaluation usage is metered under
the existing `goal_eval` usage stage.

Replay uses the latest publication and live knowledge. Publications containing actions outside the
answer-only catalogue are refused before a model call, so replay cannot send mail or invoke an
external action. It has no API catalogue, MCP tools, Teammate operations, or effect executor.
A missing chat model can still exercise a verbatim Flow through the existing deterministic runtime.

The database fingerprints the publication and linked Source/Concept revisions. A change before or
during replay prevents a passing current result. Reading history recalculates fingerprints so a
previously passing check becomes visibly stale after a publication or knowledge edit. A synthetic
pass still requires a Member to check the actual host website, including URL conditions and identity.
Manual widget evidence is distinguished from synthetic replay in the UI.

## Projects and Teammates

Project views show authoritative Improvement counts for every stage and link to the same filtered
queue. Archiving or deleting a Project preserves Improvement evidence and never changes Assistant
knowledge access. Connected Teammates read shared correction decisions through existing Project
memory and propose fixes under their existing grants. They cannot assert a Member's manual widget
verification or request paid replays: recording a check and requesting a replay are in neither
a Teammate's curated catalogue nor Ciele AI's, and they refuse an API key. Ciele AI may read the
recorded checks. Existing publication permissions and
Suggested Fix approval rules continue to apply.

## Deployment and compatibility

The additive migration supplies filtered read functions, version fingerprints, validation storage,
and atomic replay queueing. RLS protects reads, binds records to the acting Editor, checks target
Organization ownership and per-Assistant access, and leaves replay outcome writes to the
service-role worker. The API-key
adapter also checks ownership before creating a validation, even with a service-role client.
During schema lag, filtered views and evidence recording say they are unavailable rather than
returning unfiltered rows or invented passing results. Project metadata remains readable while its
new counts are unavailable. No production migration is applied by this implementation task.

Stored/API status identifiers remain unchanged. No new project ownership rule, automatic publisher,
or model-controlled closure is introduced. Tasks stay the separate, linked entity ADR-0027 defines.
