# ADR-0018: SSO identity threading and the opt-in identity claim

Status: accepted · Spec: ciele-org#660 · Ticket: ciele-org#662

## Context

Widget SSO (spec #370) was deliberately a **yes/no gate**: the adapter returned only the
verified OIDC `sub`, the chat route checked the sealed gate cookie against the assistant's
Organization, and then discarded the subject. Conversations were keyed to a client-generated
`visitorId` even for signed-in users, and nothing downstream could tell who was speaking.

Per-user capabilities (long-term memory, user-scoped record retrieval, spec #660) need a
verified identity at turn time. The client-supplied `visitorId` can never be that identity:
anyone can send anyone's id in a request body.

## Decision

1. **The gate's subject becomes the Conversation's subject.** A widget request carrying a
   valid gate for the assistant's Organization speaks as subject type `"sso"` with
   `subject_id` = the verified OIDC `sub`. The resolution lives in one helper
   (`widgetSubject`) used by every widget surface (chat, history, conversation feedback,
   escalation); ownership checks compare subject **type and id**, so an anonymous visitor
   can never claim an SSO conversation. Anonymous traffic is byte-for-byte unchanged.
2. **The subject is org-scoped by construction.** `sub` is meaningful only within the
   Organization whose connection minted the gate; every downstream consumer must key on
   (organization, subject), never the subject alone.
3. **Opt-in identity claim.** The SSO connection config gains `identityClaim` (a JWT claim
   name, e.g. `email`). When set, the adapter requests the wider `openid profile email`
   scope, verifies the claim inside the signed ID token, and the claim value rides the
   sealed gate cookie into the turn (`ConversationTurnInput.verifiedIdentity`) and the
   Conversation's session metadata. **This consciously relaxes the personalization-free
   stance of spec #370**, but only per Organization, only by explicit admin opt-in, and
   the default remains subject-only. A configured-but-missing claim fails soft: sign-in
   succeeds, per-user features needing the claim stay off for that user.
4. **The claim is never client- or model-supplied.** It exists only inside the
   AES-sealed gate cookie and the server-side turn input; request-body values cannot
   override it.

## Rejected

- *Trusting an org-passed page identity (HMAC user id)*, moves the trust boundary to the
  embedding page; ruled out in the scope decision (ciele-org#655).
- *Capturing full profiles at sign-in*, more than any current feature needs; one named
  claim is the smallest step past `sub`.
- *A separate identity table*, the gate cookie already is the session store; persist
  identity only where it matters (the Conversation row and future per-user tables).

## Consequences

Downstream tickets can key per-user data on `(organization, sso subject)` and match org
records via the verified claim. The widget history panel follows the signed-in subject, so
pre-sign-in anonymous history no longer appears once a user signs in (a different subject).
