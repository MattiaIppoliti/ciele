# ADR-0020: Subject type decides which tool variants exist in a turn

Status: accepted · Spec: ciele-org#661 · Tickets: ciele-org#667, ciele-org#668, ciele-org#669

## Context

The runtime now generates tools whose *reach* depends on who is asking:

- **Shared Entities** (#665) answer catalog-like questions for anyone.
- **User-scoped Entities** (#667) hold per-end-user Records; an SSO-signed
  end-user may only ever see their own rows, while an org Member analyzing
  the business needs all rows ("every delayed order, with totals", #668).
- **Identity-enriched custom HTTP tools** (#669) inject the verified SSO
  identity into calls to the Organization's own API, meaningless (and
  dangerous to fake) on turns without one.

The same question: *which variant of a tool should this turn get, if any?*,
could be answered in three places: the model (via prompt instructions),
the tool's execute (checking at call time), or the registration policy
(deciding which tools exist at all). Prompt instructions are advisory and
prompt-injectable; call-time checks still advertise the tool's existence and
shape to the model.

## Decision

**The subject type, never the model, decides which tool variants exist in
a turn.** `buildToolset` receives a server-resolved `toolSubject`
(`{ type: member | visitor | sso, subjectId, claimValue }`, derived from the
session or the sealed SSO gate cookie, never from request bodies or model
output) and applies one registration policy:

| Tool | visitor | sso (verified claim) | member |
|---|---|---|---|
| Shared-Entity tools | ✓ | ✓ | ✓ |
| User-scoped-Entity tools | | identity-bound (filter forced server-side) | cross-record (identity attribute is an ordinary filter) |
| Custom tools with identity placeholders | | ✓ (placeholders resolved server-side) | |
| `searchMemories` / memory recall | | ✓ (org toggle on) | |

Two enforcement layers back the policy for identity-bound variants:
the bound attribute/parameter is **removed from the model-facing schema**,
and its value is **force-set server-side after model input is applied**, a
smuggled value always loses. Where a variant cannot be satisfied (no claim
configured, anonymous turn), the tool is *absent*, not present-but-erroring:
fail safe, never fail open.

## Consequences

- The Widget and the org-staff data assistant share one pipeline and one
  registry; their differing reach is entirely a function of the subject the
  route resolves. New surfaces pick a subject type, not a tool list.
- Prompt injection cannot widen access: the model can neither call a tool
  that wasn't registered nor override a server-bound value.
- Adding a role-graded policy later (e.g. Data Viewer tiers) means extending
  `toolSubject`, not auditing every tool.
