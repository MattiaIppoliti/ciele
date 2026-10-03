# Chat architecture deepening

Scope: recent chat, model selection and configuration changes at baseline
`707d1b9dcd5739e98180e27d6bc89ab1a2631d48`. The user requested a deep architecture
analysis and implementation of every justified opportunity. The visual candidate
report lives in the OS temporary directory, outside the repository.

## Accepted work

1. **Complete model capability.** Auto must retain a sole eligible evaluated model.
   Picker suppression remains a presentation decision. Unavailable diagnostics
   must preserve model source pins and the same capability rules.
2. **One Assistant answer resolution.** Engine execution, Conversation spend and
   concurrency admission, and Standing Goal admission must apply the same
   configured default, source pin and reserve precedence. Generic classifier and
   explicit evaluation model resolution stay separate.
3. **Conversation attachment lifecycle.** The attachment module owns synchronous
   capacity reservation, serial reading, removal and reset. Overlapping picks
   cannot exceed the cap; clearing a Conversation prevents late results and queued
   files from reappearing. Attachments remain available for follow-up turns in the
   same Conversation. File policy is client-safe; sealing remains server-side.
4. **Reaction lifecycle.** The reaction module validates receipts, serializes
   mutations and ignores stale reads and detached targets. Verified actor identity
   decides replacement and removal. Existing server authorization is unchanged.
5. **Stored Conversation Turn projection.** One transcript module restores finished
   replies with Flow names, timestamps, feedback, operational trace and iteration
   counters. Reasoning remains explicitly Role-gated and hidden by default. Group
   author attribution remains in the group adapter.

Each module passes the deletion test: removing it would distribute its rules
across callers. Tests cross its interface. Existing console and widget upload
adapters justify the attachment seam; production fetch and deferred test
responses justify the reaction seam. These changes improve locality without
adding a generic transport framework.

## Constraints

Preserve ADR-0001's personal-subscription traffic rule, ADR-0005/0018's runtime
package interface and ADR-0019's domain placement. Do not rewrite the Db facade,
add schema changes, split the runtime speculatively or alter unrelated visuals.
No existing ADR needs reopening.

## Verification

Regression tests cover sole eligible Auto selection, source pins, reserve funding
and precedence, concurrent attachment picks, cleared and removed queued reads,
late reaction reads and writes, mutation exclusion, malformed receipts, transcript
timestamps, completed status and reasoning visibility. Existing model, route,
trace and group transcript suites remain part of validation.

Run workspace typechecking, the full regular suite, security suites, lint and
production build checks. Review the completed diff independently for standards
and conformance to this scope before committing.

## Results

- Workspace regular suite: 501 files, 6,021 tests passed.
- Security suites: 29 files, 294 tests passed.
- Workspace typechecking: all 14 tasks passed.
- Workspace lint: passed; four existing warnings in unrelated web files.
- Production builds: all five tasks passed, including admin bundle and document
  budgets. The public-mirror check passed its path, secret and license checks;
  its separate build step was skipped by the repository's standard command.
- Package boundaries and root deployment/migration-tooling regression checks
  passed. No live deployment or database mutation was performed.
- Independent Standards and Spec reviews: no remaining findings. Their reaction
  refresh-during-save finding was reproduced, fixed and covered by a regression.

The first full run exposed a preflight test adapter still mocking the old generic
model resolver. Updating it to the new Assistant resolution seam restored its
21 behavior tests; the full suite then passed. Unchanged workspace tasks used
the existing Turbo cache; changed agent and web tasks ran locally.
