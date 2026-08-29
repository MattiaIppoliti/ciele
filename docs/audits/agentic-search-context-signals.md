# Audit: runtime context signals available to Agentic Search

Companion to [`CLAUDE.md`](../../CLAUDE.md), [`agents.md`](../../agents.md) and
[`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) §5/§7/§12. Written for GitHub issue #53 (map: #52).
**Read-only audit, no product code changed.**

Scope: what context actually reaches the generative core, `search_knowledge`
(`searchKnowledgeHandler`, `apps/web/src/lib/runtime/actions.ts:215-438`), at runtime today, versus
what is stored in the schema/types but never consulted there. Traced end-to-end from the two chat
entrypoints down to `match_chunks`.

Call graph (both entrypoints funnel into one seam):

```
POST /api/widget/[assistantId]/chat/route.ts   (visitor, Publication snapshot)
POST /api/preview/chat/route.ts                (member, live config)
  └─ streamConversationTurn()   turn.ts:141
       └─ runAssistantChat()    engine.ts:144   (classifyIntent → ACTION_HANDLERS)
            └─ searchKnowledgeHandler   actions.ts:215
                 └─ streamText({ tools: buildToolset(...) })   actions.ts:294-314
                      └─ searchKnowledge tool   tools.ts:162-193
                           └─ db.searchChunks(assistantId, collectionId, query)   turn.ts:173-180
                                └─ match_chunks(p_assistant_id, p_collection_id, ...)  supabase.ts:1555-1596
```

---

## 1. Course / Knowledge Collection identity

**Live, but manual only, never automatic, never LTI.**

- The widget POST body accepts an optional `collectionId`
  (`apps/web/src/app/api/widget/[assistantId]/chat/route.ts:29-31,60`; same shape in
  `apps/web/src/app/api/preview/chat/route.ts:27,55`).
- `streamConversationTurn` resolves the anchor once per conversation: `input.collectionId ??
  conversation.collectionId ?? null` (`apps/web/src/lib/runtime/turn.ts:172`), sets it on
  `createConversation` only when a **new** conversation is started
  (`apps/web/src/lib/runtime/turn.ts:161-170`), and closes over it for every turn's
  `searchKnowledge` call (`turn.ts:173-180`), so once a conversation exists, its anchor is fixed for
  its lifetime regardless of what a later POST body sends.
- That `collectionId` is passed straight through to `db.searchChunks(assistantId, collectionId,
  query)` → `match_chunks(p_assistant_id, p_collection_id, p_query_embedding, p_match_count)`
  (`packages/db/src/supabase.ts:1555-1596`). The SQL function itself: `where cc.assistant_id =
  p_assistant_id and (p_collection_id is null or cc.collection_id = p_collection_id)`
  (`supabase/migrations/0005_knowledge.sql:97-119`), **`null` searches every collection the
  assistant owns**, not one course.
- **Where the value comes from, client-side** (`apps/web/src/components/widget/widget-chat.tsx`):
  - A `?c=<collectionId>` query-string "Context Hint" on the widget's own URL, resolved client-side
    against the Publication's collection list (`widget-chat.tsx:122-130`). Nothing in this repo
    generates or documents that `?c=` link, no embed-snippet code
    (`(admin)/assistants/.../publish`) appends it, and there is no LMS/LTI launch path at all
    (`CLAUDE.md` §11: Courses/LMS live sync ⬜, Publish → LTI ⬜, both not built).
  - Failing that, an in-widget "+ Add tag" `<select>` the **visitor manually picks from**
    (`widget-chat.tsx:557-587`), populated from every Collection in the Publication
    (`apps/web/src/app/api/widget/[assistantId]/config/route.ts:11-22`), or removable via an "×" once
    anchored (`widget-chat.tsx:559-568`).
  - The admin Preview panel has the identical manual anchor mechanism
    (`apps/web/src/components/assistant/preview-panel.tsx:250,360,935-937`).
- **Conclusion**: course/collection identity is a real, live signal at the retrieval layer, but
  nothing in the runtime *derives* it from who the visitor is, what course launched them, or what
  page embeds the widget. It is either a hand-built URL parameter or a manual per-conversation
  visitor/admin choice. There is no LTI, SSO-course, or Flow **Course** condition path that sets it
  (see §3), confirms `agents.md`'s "Course" condition and `CLAUDE.md`'s Courses/LMS/Publish→LTI rows
  are unbuilt, not merely disconnected from this one signal.

---

## 2. Session / prior turns

**Two independent mechanisms; both live, but neither is cross-session.**

### 2a. Turn history (the transcript)

- `streamConversationTurn` loads the **last 12 stored messages**
  (`RECENT_HISTORY_LIMIT = 12`, `apps/web/src/lib/runtime/turn.ts:75,182-185`) for the resolved
  Conversation and maps them to `{role, text}` (`turn.ts:193-202`, text-only, non-text reply parts
  like sources/buttons are dropped).
- That `history` array is threaded through `runAssistantChat` (`engine.ts:144-183` → `ActionContext`,
  `types.ts:99`) into `searchKnowledgeHandler`, which prepends it to the `streamText` `messages` array
  ahead of the current user turn (`apps/web/src/lib/runtime/actions.ts:300-303`). **Live**: the model
  sees prior turns of *this Conversation* verbatim, but nothing older (13th message back is
  invisible) and nothing from a *different* Conversation the same visitor may have had.
- A Conversation is only reused across POSTs when the caller supplies its id **and** it still belongs
  to the same `subjectId` + `assistantId` (`turn.ts:151-160`); otherwise a fresh Conversation (and
  fresh history) starts silently. Client-side, the widget's `conversationId` React state initializes
  to `null` on every page load (`widget-chat.tsx:119`) and is **not** persisted to
  `localStorage`/`sessionStorage`, only the visitor identity (`ciele-visitor` key,
  `widget-chat.tsx:71-77`) survives a reload. So a page refresh starts a brand-new Conversation (and
  therefore empty history/session memory, §2b) unless the visitor explicitly reopens a past thread via
  the History panel (`widget-chat.tsx:207-244`, fetches by `conversationId` from
  `GET /api/widget/{id}/conversations`).

### 2b. `session_state` / `remember` memory (tau-style session)

- `conversations.session_state` (jsonb, `Conversation.sessionState`, `packages/db/src/types.ts:699`)
  is loaded into a `TurnSession` at the start of each turn:
  `createTurnSession(conversation.id, turnIndex, conversation.sessionState)`
  (`apps/web/src/lib/runtime/turn.ts:188-192`; implementation `apps/web/src/lib/runtime/session.ts`).
- Tools read/write it through `get`/`set`/`remember` (`session.ts:24-31,49-70`); the built-in
  `remember` tool (`apps/web/src/lib/runtime/tools.ts:264-277`) appends a fact (deduped, capped at 20
  entries / 500 chars each, `session.ts:15-16,62-69`).
- `buildSystemPrompt` injects `session.memory()` as a "Session memory" layer, below the
  Assistant/Skills layers and above the Flow layer (`apps/web/src/lib/runtime/actions.ts:41-82`,
  specifically `context?.memory` at line 49 and the rendered block at lines 66-71). **Live**: a fact
  remembered on turn 2 of a conversation is visible to the model on turn 3+ of the *same*
  conversation.
- Persistence is **write-back, not read-time-only**: after the turn, `turn.ts:302-313` calls
  `db.updateConversationSessionState(conversationId, session.snapshot())`: but only if
  `session.dirty` is true, and only for that one Conversation row.
- **Not cross-session**: `session_state` lives on the `conversations` row, keyed by Conversation, not
  by visitor/subject. There is no lookup anywhere in `apps/web/src/lib/runtime/` or
  `packages/db/src/` that reads a *different* Conversation's `session_state` to seed a new one for the
  same `subjectId`. Combined with §2a's finding that a page reload starts a fresh Conversation, the
  practical effect is that `remember`ed facts do not survive a visitor closing and reopening the
  widget in a new page load, only continuing the *same* open conversation, or explicitly reopening
  the same past conversation from History, keeps them.

---

## 3. Identity signals: role / URL / auth

**Confirmed inert**, matching `docs/ARCHITECTURE.md` §5.2 exactly. None of the three reaches
`ActionContext` (`apps/web/src/lib/runtime/types.ts:90-129`) or `classifyIntent`
(`apps/web/src/lib/runtime/engine.ts:86-135`), both take only `message`/`flows`/`history`/model
handles, no identity fields.

| Signal | What exists | Where it's captured | Why it's inert |
|---|---|---|---|
| **User role** | `FlowCondition.kind` is a closed union of exactly `"conversation_context"` (`packages/db/src/types.ts:27-32`); there is **no `role` condition kind in the type system at all**, so it isn't merely unread, it isn't modeled. The only `userRole` field anywhere is `ConversationMetadata.userRole` (`packages/db/src/types.ts:669`). | Set **only** on the admin Preview entrypoint, from the signed-in Member's own RBAC role: `userRole: session.role ?? undefined` (`apps/web/src/app/api/preview/chat/route.ts:60`). The public widget entrypoint never sets it (no IdP/SSO integration exists, `CLAUDE.md` §11 Authentication row ⬜). | `ConversationMetadata` is read only by Inbox/Improvements/Insights UI for filtering and display (`apps/web/src/components/inbox/inbox-client.tsx:274,303,310,398,718`, `apps/web/src/components/improvements/improvement-detail.tsx:413`, `apps/web/src/lib/insights/{report,kpi}.ts`), never by `engine.ts`, `actions.ts`, or `tools.ts`. It cannot gate a Flow condition (no such condition kind exists) and is never interpolated into the system prompt. |
| **URL** | `FlowCondition.kind` has no `url` variant either (same union, `types.ts:27-32`); `agents.md`'s "URL" condition (match-operator + value) is UI copy / target design, not a stored shape. The only URL-shaped field is `ConversationMetadata.launchUrl`. | Captured once, at Conversation-creation time, from the request's `Referer`/`Origin` header: `launchUrl = headers.get("referer") ?? headers.get("origin")` (`apps/web/src/lib/runtime/session-meta.ts:39`, returned by `sessionMetadata()` and passed as `metadata` only when `streamConversationTurn` creates a **new** Conversation, `turn.ts:59,168`). It is host-origin level, not the per-page-path granularity `agents.md` describes for a URL condition, and it is never refreshed on later turns of the same conversation (host page navigation mid-chat isn't observed). | Read only by the Inbox "Session" detail panel (`ConversationMetadata.launchUrl` display), never by the classifier, any Flow condition evaluator (none exists for URL), or the system prompt. |
| **Auth (SSO/OIDC)** | No implementation. `Assistant`/`Flow` types have no auth/IdP config fields; `CLAUDE.md` §11 lists Authentication (SSO/OIDC + User data dynamic fields) as ⬜ not built. | N/A | The widget's persistent visitor identity is an anonymous `crypto.randomUUID()` cached in `localStorage` (`ciele-visitor` key, `apps/web/src/components/widget/widget-chat.tsx:71-77`); there is no authenticated end-user identity to carry at all on the widget surface. The only "identity" reaching a turn is the admin Member's own session on Preview (`subjectType: "member"`, `subjectId: session.userId`, `preview/chat/route.ts:52-53`), which is an operator testing the assistant, not an end-user role signal. |

---

## 4. Summary table

| Signal | Live / Inert | Reaches `search_knowledge`? | Key seam |
|---|:---:|:---:|---|
| Collection/course anchor (`collectionId`) | **Live** (manual/URL-param only) | Yes: scopes `match_chunks` | `turn.ts:172-180` → `supabase.ts:1555` → `0005_knowledge.sql:97-119` |
| Recent transcript (≤12 messages, this Conversation only) | **Live** | Yes: prepended to `streamText` messages | `turn.ts:75,182-202` → `actions.ts:300-303` |
| Session memory (`remember`, this Conversation only) | **Live** | Yes: injected as a system-prompt layer | `session.ts` → `actions.ts:41-82,296-299` |
| Cross-conversation / cross-session memory for the same visitor | **Inert** (not implemented) | No | no seam exists, `session_state` is keyed by `conversations.id`, no lookup by `subjectId` |
| User role | **Inert** | No | `FlowCondition` has no `role` kind (`types.ts:27-32`); `ConversationMetadata.userRole` reaches only Inbox/Insights UI |
| URL | **Inert** | No | `FlowCondition` has no `url` kind; `ConversationMetadata.launchUrl` reaches only the Inbox detail panel |
| Auth / SSO identity | **Inert** (not implemented) | No | no fields, no IdP integration anywhere in the repo |

---

## 5. What would be needed to make the inert signals live

Stated as bare mechanical requirements, no design decisions taken here (that's map #52's job):

- **Role / URL / External data / Course / Schedule conditions**: extend `FlowCondition["kind"]`
  (`packages/db/src/types.ts:27-32`) beyond `"conversation_context"`, add a predicate evaluator per
  kind, and call it from `runAssistantChat`/`classifyIntent` (`engine.ts`) as a hard gate rather than
  routing-context-only, today only `conversation_context` is rendered into the classifier prompt
  (`flowCatalogEntry`, `engine.ts:62-84`).
- **Role/URL reaching the model or a gate at all**: thread `ConversationMetadata` (or a per-turn
  equivalent) into `ActionContext` (`types.ts:90-129`) and `classifyIntent`'s inputs; currently
  neither function receives it.
- **Automatic course identity for published traffic**: something upstream of `collectionId` would
  need to derive it, an LTI launch parameter, an SSO course claim, or an embed snippet that appends
  `?c=`, none of which exist in this repo (`CLAUDE.md` §11: Courses/LMS ⬜, Publish → LTI ⬜).
- **Cross-session memory for a visitor**: a lookup keyed by `subjectId` (not `conversation.id`) would
  need to exist before `createTurnSession` is called (`turn.ts:188-192`), plus a decision on how a
  fresh Conversation seeds from a prior one's `session_state`.
- **Auth-derived identity**: the whole Authentication surface (`CLAUDE.md` §4.8, §11) is unbuilt;
  nothing to extend yet.
