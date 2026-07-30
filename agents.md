# agents.md — AI runtime & assistant model

How an **Assistant** behaves at runtime — the conversational engine's design. Read with
[`CLAUDE.md`](CLAUDE.md) (feature surface) and [`context.md`](context.md) (domain language).

> **This document is the target conversational design.** For exactly how *this repo* implements it
> today — the **two-engine runtime**, wire-event contract, and per-action/-condition status — see
> [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §5. Current-state deltas to keep in mind while
> reading below:
> - **Intent Classification is real** in the production/widget runtime (`runAssistantChat`): a cheap
>   **LLM classifier** (`generateObject`) routes to a flow, **falling back to the keyword `matchFlow`**
>   when no model is configured or on error. The keyword engine (`packages/core/src/engine.ts`) is the
>   offline/demo path (ADR-0003).
> - **`search_knowledge` is a real agent loop** (`streamText` + a knowledge tool, ≤5 steps, cited
>   Sources).
> - **Live actions**: `custom_message` (verbatim), `search_knowledge`, `suggest_help_desk`
>   (with AI desk recommendation when enabled), `follow_up_questions`, `show_button`, `iframe`,
>   `api_request` (full config), `send_email` (Resend transport; honest copy when unconfigured),
>   `improvement`, `notification` (verbatim, proactive-only — see §4.2). **[partial]**: `handover`
>   (acknowledges + halts; no target-assistant continuation yet).
> - **AI Tutor is out of scope**: Study Mode / H5P interactives have no SETUP nav entry and no
>   `study_mode`/`h5p` flow actions in this repo (see `context.md` §Scope).
> - **Conditions**: three kinds exist, gated two different ways on purpose.
>   `conversation_context` is **soft context** fed to the classifier (few-shot), not a hard gate;
>   **URL** and **Schedule** are objective, so they are a **hard gate applied before classification**
>   — `flowConditionsAllowRouting` runs inside `messageFlowCandidates` (and inside
>   `proactiveFlowCandidates`), the candidate filters every router shares, and objective kinds are
>   kept out of the classifier prompt entirely. User role, External data and Course remain
>   **[target]** and are **not offered in the picker at all** — an affordance that cannot do anything
>   is worse than its absence.
> - **Triggers**: all four fire. `message` flows route through Intent Classification;
>   `page_load` / `time_on_page` / `chat_open` are reported by the embed (and by Preview) and run
>   through the same Conversation Turn without a model. A proactive flow has **no conditions** and
>   exactly one action, `notification`. Still **[target]** within that: **multiple triggers per
>   flow** ("Add trigger") and the Notification's **auto-delete**.

---

## 1. Mental model

An **Assistant** is a *configured agent*, not free-form. Every turn passes through a deterministic
pipeline:

```
incoming user message
   │
   ▼
[1] Intent Classification  ── cheap LLM call ── picks the best-matching enabled Flow
   │                          (falls back to "Default behavior" when nothing matches)
   ▼
[2] Flow Conditions        ── evaluate Any/All conditions (context, role, url, external, course, schedule)
   │                          if unmet → continue to next candidate flow / Default behavior
   ▼
[3] Flow Response actions  ── execute the ordered action list; only generative actions call the model
   │
   ▼
assistant reply (+ citations, thinking steps, buttons, widgets, escalation)
```

Key invariant: **the router is authoritative**. The LLM chooses *which* flow, but does not override
*what* the flow does. Non-generative actions (Message/Button/Iframe/Follow-ups) emit exactly what was
configured; only **Search knowledge** and the **Default behavior** run the generative agent loop.

---

## 2. Triggers (what starts a flow)

- **User sends a message** — the common path; drives intent classification.
- **On page load** — proactive flow when the host page loads (e.g. greeting/announcement).
- **Time on page** — fire after a dwell threshold; config is a duration (**minutes + seconds**).
- **Chat opens** — fire when the widget is opened.

A flow can have **multiple triggers** ("Add trigger") — **[target]**; this repo stores exactly one.
Non-message triggers do not need intent classification; they fire on the client event and then run
their conditions + response.

**How a proactive trigger reaches the runtime here.** The chat frame cannot see the host page, so the
embed script reports the events it alone can observe — page loaded, its URL, dwell elapsed, chat
opened — and the runtime decides what answers them. The report is a *claim*: which flows run, whether
the dwell was really reached, and whether the nudge has already been delivered are all re-decided
server-side, so a reopen loop or a replayed report changes nothing. An assistant with no proactive
flows arms no listeners at all (the published config says which triggers exist), and a trigger nothing
is configured for writes nothing and streams nothing.

Delivery is bounded by the Notification's **delivery rule** — once per conversation (default), once
per user, or every time. Preview ignores it: an admin pressing Refresh expects to see the nudge again.

**Trigger-dependent editor** (important): the trigger changes what Conditions and Response actions are
available.
- With **User sends a message**: Conditions include **Conversation context** (+ the rest); Response
  offers the **full action catalog** (§4).
- With a **proactive trigger** (On page load / Time on page / Chat opens): **Conversation context** is
  NOT offered as a condition (only User role / URL / External data / Course / Schedule), and the
  Response collapses to a single **Notification** action (§4.2) — a proactive in-widget nudge.
  Here that means a proactive flow has **no conditions at all** (the other condition types are still
  `[target]` for message flows too), and the pairing is enforced on save *and* at dispatch — stored
  data cannot make the runtime run what the editor forbids.

---

## 3. Conditions (must-pass criteria)

Combined with **Any condition matches** (OR) or **All conditions match** (AND). Types:

- **Conversation context** — semantic NL match on the user/assistant turns ("mentions stress,
  anxiety, …"), tuned with few-shot **matching** (positive) and **non-matching** (negative) examples.
  This is the same mechanism as the flow matcher, reusable as a gate.
- **User role** — "Select user role/s" (multi-select of roles from the connected IdP; e.g. student
  vs instructor).
- **URL** — match-operator dropdown (**Matches** / …) + URL value; exact-match semantics including
  scheme and `?query` (e.g. `…/courses` does not match `…/courses/psychology`).
- **External data** — a value from imported User data / an external source (disabled until user
  data is connected).
- **Course** — attribute dropdown (**Name** / …) + operator (**Equals** / …) + "Select courses"
  multi-select.
- **Schedule** — **Start date & time** + **End date & time** window (date picker + time-of-day +
  timezone, e.g. Europe/Rome).

(Note: the **Add condition** menu allows stacking multiple conditions of the same or different types,
combined by the Any/All logic toggle above.)

Implement conditions as small predicate evaluators keyed by type; keep the `matchFlow` seam so the
classifier and conditions share the same semantic-match implementation.

**How this repo does it** (spec #550): the objective kinds are evaluated by pure predicates in
`packages/core/src/flow-conditions.ts` and gated in `messageFlowCandidates` — the single candidate
filter `matchFlow` and `classifyIntent` both call — so the two engines cannot disagree. A satisfied
objective condition is *necessary, not sufficient*: it keeps a flow eligible, it never promotes it,
and under **Any** logic a flow is disqualified only when every condition on it returned a false
verdict. The semantic kind stays with the classifier; URL/Schedule never enter its prompt.

---

## 4. Response actions (the action catalog)

Actions run **in order**; multiple per flow, reorderable.

| Action | Generative? | Behavior |
|--------|:-----------:|----------|
| **Message** | no | Emit configured text **verbatim** (never paraphrased by a model). |
| **Button** | no | Render a clickable button/link (label + target). |
| **Search knowledge** | **yes** | Run the RAG + agent loop over the assistant's knowledge; return an answer **with Source citations** and Thinking Steps. |
| **Follow-ups** | partial | Suggest predictive follow-up questions to click. |
| **Iframe** | no | Embed external content inline in the chat. |
| **API request** | no | Call an external API endpoint (integration / action). |
| **Send email** | no | Send an email (notification / handoff). |
| **Improvement** | no | Flag the last answer for the Improvements tracker. |
| **Handover** [beta] | no | Transfer the conversation to another assistant. |
| **Study Mode** | yes | Enter the self-assessment quiz shell. |
| **Start H5P interactive** | yes | Launch a quiz / flashcards / drag-the-words exercise. |

The **Default behavior** flow is locked and always last; it typically runs **Search knowledge** +
**Follow-ups** so any unmatched message still gets a grounded answer.

### 4.1 Per-action configuration (from the builder)

Every text/URL/field input supports **template variables** — `{{user.name}}`, `{{session.id}}`, and
external-data aliases — so actions personalize from SSO profile + imported User data.

- **Message** ("Custom message"): rich-text body + **"Instruct AI to generate message"** toggle
  (off = emit verbatim; on = the text is a generation instruction) + `{}` variable insert.
- **Button**: External link (URL) · Button name · Button type · Show icon toggle · live Button Preview.
- **Search knowledge**: **"Prompt user to escalate for unresolved queries"** (show the contact-support
  button when the answer is unknown) · **"Create Knowledge Improvement Items for unresolved queries"**
  (auto-file an Improvements item) · **Advanced settings**.
- **Follow-ups**: suggest predictive follow-up questions (count/config).
- **Iframe**: Title · Link (`https://`) · "open in lightbox if possible" · Iframe height (vh, default 30).
- **API request** ("API POST request — perform actions in external systems"): method · Endpoint URL ·
  **Authentication Type** · Headers · Query Parameters · **JSON path mapping** (extract a value from
  the response) · Request JSON body · **Test API** · "Inform user of result" (per-outcome success/
  failure in-chat messages).
- **Send email**: Send to (comma-separated) · Subject · Body (template vars) · **Reply-to** =
  Specific email / Conversation participant.
- **Improvement**: create a task in Improvements ("Improvement task").
- **Handover** [beta]: select the target **Assistant** to continue the conversation in.
- **Study Mode** / **Start H5P interactive**: enter the quiz shell / launch an interactive exercise.

Some actions are single-instance per flow (Search knowledge, Iframe, Handover, Study Mode, H5P grey
out once added); Message/Button/API/Email can repeat.

### 4.2 Notification action (proactive-trigger flows only)

When the flow's trigger is proactive (On page load / Time on page / Chat opens), the only Response
action is **Notification** — a proactive in-widget message:
- **Title** (≤100) · **Notification content** (rich text, ≤5000).
- **Delivery rule** — how often it's delivered to the same user (e.g. *Once per session*).
- **Auto-delete notification** — remove from the inbox after a selected time (e.g. *Never*).
  **[target]** here: it needs a notification-inbox surface this repo does not have.
- **Allow users to reply** (toggle) · **Add button** (attach clickable buttons).

This is the proactive-engagement primitive (nudge/announcement), distinct from the reactive
answer/action flows driven by "User sends a message".

**As implemented here.** The content is emitted **verbatim**, exactly as `custom_message` is — a
proactive turn makes no model call and meters no tokens. It is persisted as an Assistant message on
the Visitor's Conversation, so it appears in the chat window and in the Inbox transcript with its flow
marker like any other reply; nothing is persisted on the Visitor's behalf, because nobody spoke.
Buttons ride the same reply part the Button action emits (link out or send-text-into-chat only — a
help-desk or FAQ button answers a question nobody asked). Turning replies off closes the composer and
says so, and only the newest reply decides that, so an announcement cannot lock a chat the Visitor was
later invited back into. Delivery state lives in the Conversation's session state; nothing is recorded
for a flow that produced no output, so it can still be delivered later.

**How it counts.** A Notification is *not* an AI answer, and a Conversation containing nothing but
Notifications is not a Conversation — so turning proactive flows on cannot move the answer KPIs or the
AI Resolution Rate. What it does move is a KPI of its own, **Notifications Sent**, plus a matching
chart series. The Inbox still shows those Conversations, marked "Notification only" so a queue is not
padded with non-conversations. One reply of any kind makes it a real conversation again, counted
normally from then on. The rules live in `packages/core/src/insights.ts` and are mirrored by the SQL
aggregate, which the parity test holds to the same answers (ADR-0010).

---

## 5. Knowledge & retrieval (the generative core)

Knowledge lives in **Knowledge Collections** stored as **OKF bundles** (ADR-0002): markdown
**Concept** documents (YAML frontmatter + body), cross-linked, with `index.md` for progressive
disclosure. Sources ingested from six input types (Websites crawl, LMS/Courses sync, Applications,
Files, EdTech vendor guides, FAQs) are enriched into Concepts; **pgvector** embeddings index Concept
content and always point back to their Concept → original **Source**.

The **Search knowledge** loop:
1. Retrieve candidate Concepts (vector + lexical fallback), optionally anchored to a Course /
   Collection via a **Context Hint**.
2. Optionally navigate the OKF graph (`index.md` → linked Concepts → Sources) — **Deep Search** gives
   the loop more iterations / multi-hop (knowledge-only, never the open web).
3. Generate the answer with **native tool-use**; attach **Source citations** that resolve to a
   Concept and its Source.
4. Emit **Thinking Steps** (classify → search → generate); **Simplified thinking** rewrites them into
   short, student-friendly progress updates before display.

---

## 6. Providers (how the model is reached)

Per ADR-0001, the runtime is **multi-provider** (Anthropic / OpenAI / Google) behind one abstraction
(Vercel AI SDK). Each Organization configures **Provider Connections** of three types:
- **Platform plan** — bundled models on our keys.
- **Subscription** — a member's personal plan via provider OAuth — **preview-only** (never serves
  published widget traffic; ToS + rate limits).
- **API key** — BYOK, stored encrypted.

Each Assistant selects the provider+model it runs on. When building AI features here, default to the
latest Claude models (see the API reference skill for current model IDs).

> Note: the per-assistant model picker is a deliberate product choice (ADR-0001) — many admin
> platforms keep model/provider selection platform-managed; Ciele exposes it per assistant.

---

## 7. Personalization & identity

- **Authentication (SSO/OIDC, e.g. Entra)** can require sign-in before chat, detect **User role**
  (usable as a Flow condition), and personalize responses from profile data. Drives the widget
  "Connect Your Account" card.
- **User data** import (CSV / LMS / integrations) exposes **dynamic fields** for mail-merge-style
  message personalization.
- **Visitors** are anonymous by default (persistent `visitor_id` in host localStorage) unless
  Authentication requires sign-in.

---

## 8. Escalation & the improvement loop

- When the agent cannot answer (or the user asks for a human), the assistant offers **help desk**
  escalation. The AI can **recommend a desk** by its description + conversation context, or surface an
  always-available "Contact support" button.
- A help-desk **channel** (Email / Phone / Live chat / Create a ticket / External link / Salesforce
  handover / API endpoint) may collect a **form**, attach **conversation data** (summary / full
  history / user data / metadata), respect **availability**, and open a **ticket** in a connected
  system.
- Escalations and 👎 feedback feed **Improvements**: the Flow **Improvement** action and the desk's
  **Auto-generate improvements** create trackable items linked back to the exact flagged message —
  closing the answer-quality loop (edit knowledge/FAQ → re-answer improves).

---

## 9. Widget & analytics surface

- The widget renders welcome message, quick-reply starter buttons, composer, disclaimer, and (if
  configured) the auth card and H5P activity results; theming from **Style**.
- Every conversation is persisted with rich **session metadata** (launch URL, IP, OS, browser,
  resolution, language, location) and **escalation status**, reviewable in the **Inbox** and
  aggregated in **Insights** (resolution rate, ratings, volumes, escalations, languages, CSAT,
  engagement ratios, feedback & grading metrics).

---

## 10. Runtime build checklist

1. `matchFlow(message, flows)` — semantic intent classifier returning the winning enabled flow
   (or Default). Shared with condition evaluation.
2. `evaluateConditions(flow, ctx)` — Any/All over typed predicates (context/role/url/external/course/
   schedule).
3. `runActions(flow.actions, ctx)` — ordered executor; verbatim for non-generative actions; agent
   loop for Search knowledge / Study Mode / H5P.
4. `searchKnowledge(query, collection)` — pgvector + lexical over OKF Concepts, Deep-Search hops,
   Source citations, Thinking Steps.
4b. The **API catalogue triad** — `getApiDetails` / `viewEndpointDetails` / `queryApi` over one
   registered integration per Assistant (base URL + sealed credential + described endpoints), with
   path parameters substituted by the model and every path validated against the catalogue before
   egress. Plus the windowed readers `readApiResponse(handle, from, to)` and
   `readKnowledgeSource(sourceId, from, to)`, which return the window **and the total length** so a
   large payload is walked rather than truncated. A queried endpoint is a citable Source.
5. Provider abstraction with the three Provider-Connection types and the preview-only subscription
   boundary.
6. Escalation runtime: desk selection, channel form → conversation-data attach → ticket/email/API.
7. Telemetry pipeline feeding Inbox + Insights + Improvements.

Keep every generative step **inside** an action; never let the model act above the router.

---

## 11. Observed live-chat behavior (widget, anonymous)

Verified by chatting with a live published assistant (standalone widget, no sign-in required). This is
the target UX to reproduce:

- **Header**: nickname, chat-history icon, new-chat, overflow (…). **Welcome message** + typed
  **starter buttons** (e.g. a "Role-play" button). **Composer** "Ask {nickname}…" + send; footer
  disclaimer.
- **Agentic answer trace**: while generating, a live **"Thinking…"** row streams short progress
  lines; the composer send-button becomes **Stop**. When done it collapses to a summary chip
  **"🔍 ×N  📖 ×M  Thought for Xs"** (N searches, M knowledge reads, elapsed time). Expanding it shows
  the full reasoning interleaved with **🔍 Search** tool-call chips — a visible multi-step loop
  (reason → search → "found some, need more about X" → search again → generate).
- **Answer**: rich markdown (headings, bold, nested bullets, links). Followed by a **Sources** toggle
  that expands to **named citation chips** (each a Source with an external-link icon — never opaque
  chunks), 👍/👎 feedback, and **Suggested questions** (predictive follow-ups generated from the answer).
- **Escalation**: an always-available **Contact support** button. Opening it shows *"How would you
  like to contact {AI-selected help desk}?"* — the desk is chosen by relevance to the conversation
  (an admissions chat → "Admissions Office"). Channels list their **availability** (e.g. Email
  *Available*; Call *Unavailable — Next available: Monday 10:30–19:00 (Europe/Rome)*). Selecting a
  channel opens its configured form.
- **Starter-button flow**: a "Send Text" starter button posts its preset message verbatim as the user
  turn; the assistant then answers under its normal scope guard (a general role-play request is
  politely declined and redirected to in-scope topics — behavior driven by Answering style + knowledge,
  not a hard-coded refusal).

Implementation note: the summary chip's search/read counts and the expandable trace ARE the product's
Thinking-Steps surface — expose `search_knowledge` tool calls and iteration counts to the UI, and
resolve citations to named Concepts/Sources.
