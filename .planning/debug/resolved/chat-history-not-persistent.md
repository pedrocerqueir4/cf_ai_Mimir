---
status: fixed
trigger: "Chat at /chat does not persist conversation history across page reloads. User expects the last N messages (≈50) to reload when returning to the page, with scroll-up to fetch older. Currently the page starts empty every time."
created: 2026-04-23
updated: 2026-04-23
phase: 02-ai-content-pipeline
---

## Symptoms

expected: |
  On loading /chat, the frontend should fetch the most recent ~50 messages for the current user/conversation from the server and render them in order. Scrolling up should lazy-load older messages (pagination). Persistence survives page reload, sign-out/sign-in, and new tabs.

actual: |
  /chat loads with an empty message list every time. Messages sent during the current page-view render fine, but are discarded on reload. No history visible.

reproduction: |
  1. Sign in
  2. Open /chat, send a few messages (some plain Q&A, maybe a roadmap prompt)
  3. Refresh the browser → messages gone
  4. (Bonus) Open /chat in another tab while signed in → also empty

scope_clarification: user confirmed they want "last N messages (e.g. 50)" pattern with scroll-up for more. NOT grouped-by-session.

## Current Focus

hypothesis: confirmed — mixed state; see Evidence.

test: see Evidence.

next_action: fix applied (working tree); user to review diff and confirm live behavior.

## Evidence

- timestamp: 2026-04-23T00:00:00Z
  finding: "Backend D1 schema for `chat_messages` EXISTS and is migrated."
  file: worker/src/db/schema.ts:5-12
  extra: |
    Columns: id (PK text), userId (FK users, cascade), conversationId (text), role (user|assistant), content (text), createdAt (timestamp).
    No composite index on (user_id, conversation_id, created_at) — fixed by new migration 0007.
    Migration present: worker/src/db/migrations/0001_flashy_white_tiger.sql.

- timestamp: 2026-04-23T00:00:00Z
  finding: "Backend POST /api/chat/message persists user messages and roadmap-acknowledgment assistant messages, but NEVER persists the plain-Q&A streamed assistant reply."
  file: worker/src/routes/chat.ts:19-123 (pre-fix)
  extra: |
    - Line 45-52: user message inserted BEFORE branching.
    - Line 67-78: on roadmap intent, an assistant `generation_started` stub IS persisted.
    - Line 111-122: on plain Q&A, `env.AI.run(..., stream:true)` is piped straight back to the client. The stream is never tee'd, so the final assembled reply is never inserted into chat_messages. Once the client disconnects, the AI response is gone from the server's perspective.

- timestamp: 2026-04-23T00:00:00Z
  finding: "Backend GET endpoints `/api/chat/conversations` and `/api/chat/conversations/:conversationId/messages` exist and are IDOR-scoped to the current user."
  file: worker/src/routes/chat.ts:126-197 (pre-fix)
  extra: |
    - /conversations returns one row per conversationId with the latest message's timestamp + 100-char preview.
    - /conversations/:id/messages returned ALL messages for that conversation in chronological order (no pagination parameters — no ?before / ?limit). Fixed — now cursor-paginated.
    - IDOR check validates ownership before returning.

- timestamp: 2026-04-23T00:00:00Z
  finding: "Frontend /chat page generated a FRESH conversationId on every mount and had NO history-loading logic."
  file: apps/web/app/routes/_app.chat.tsx:249 (pre-fix)
  extra: |
    - Pre-fix: `const conversationId = useRef<string>(randomId());` — new UUID every mount.
    - No React Router `loader` export.
    - No useEffect calling a history fetch; the only useEffects were autoscroll, textarea resize, and syncing conversationId into Zustand.
    - `messages` state started [] and was only mutated by `handleSend`. On reload, state was lost.
    - Fixed — now reads/writes conversationId from localStorage and fetches the first history page on mount.

- timestamp: 2026-04-23T00:00:00Z
  finding: "api-client exported `fetchConversationMessages` but nothing in the frontend called it."
  file: apps/web/app/lib/api-client.ts:160-175 (pre-fix)
  extra: |
    Defined and typed correctly but orphaned. Fixed — signature updated to accept cursor/limit and return a paginated page shape; now called by the chat route's mount effect + load-older handler.

- timestamp: 2026-04-23T00:00:00Z
  finding: "Zustand `useChatStore` has no persist middleware; conversationId is only in-memory."
  file: apps/web/app/stores/chat-store.ts:23-56
  extra: |
    Not changed by this fix. Persistence across reloads is handled by the
    route component reading/writing localStorage directly (simpler than
    middleware; the store is only used for transient streaming/status state).

- timestamp: 2026-04-23T00:00:00Z
  finding: "Phase 2 SUMMARY files did not mention a frontend history loader for /chat; feature was not implemented."
  file: .planning/phases/02-ai-content-pipeline/02-00-SUMMARY.md,02-01-SUMMARY.md
  extra: |
    Grep for "history|load history|initial load|useQuery|fetchConversation" in both SUMMARY files returned zero hits. The backend table and GET endpoints were built, but the UI wiring and the last-mile write (persisting streamed assistant replies) were never completed.

- timestamp: 2026-04-23T00:00:00Z
  finding: "Typecheck passes for both web app and worker after applying the fix."
  file: apps/web (tsconfig.json), worker (tsconfig.json)
  extra: |
    `npx tsc --noEmit -p tsconfig.json` exits 0 in both `apps/web` and `worker`.

## Eliminated

- "Messages are persisted but /chat doesn't fetch them" — partially true (roadmap ack is, plain reply isn't).
- "No D1 persistence at all" — false; table + migration + user-message insert exist.

## Resolution

root_cause: |
  Three-pronged gap, all in Phase 2 chat persistence:
  1. **Frontend never fetches history.** /chat route had no loader and no useEffect that called the existing `/api/chat/conversations/:id/messages` endpoint. It minted a fresh conversationId on every mount, so even if history were fetched there would be no cursor to fetch it against.
  2. **Plain-Q&A assistant replies are never persisted.** POST /api/chat/message piped the Workers AI SSE stream directly back to the client; the assembled final response was never written to D1. Only user messages and roadmap-generation acknowledgments hit the chat_messages table.
  3. **History endpoint lacked pagination.** GET /api/chat/conversations/:id/messages returned ALL messages unbounded — it couldn't support the user-requested "last 50, scroll up for older" UX pattern.

  Net effect: even with the UI wired up, the user would only see their own past messages + "generation_started" JSON blobs, never the actual conversational replies.

fix: |
  Applied to working tree (not committed).

  **A. Persist the streamed assistant reply — worker/src/routes/chat.ts (plain-Q&A branch):**
    - `aiStream.tee()` splits the AI output into a client branch (returned as the SSE Response) and a persist branch consumed in `c.executionCtx.waitUntil(...)`.
    - The persist branch reads the SSE frames with the same parsing logic as the client reader, assembles the full reply, then inserts a single `assistant` row with `createdAt = now + 2ms` (sorts strictly after the user message and any +1ms roadmap ack).
    - Empty/failed streams skip the insert — never persist a partial reply that isn't what the user saw.

  **B. Cursor-paginated history endpoint — worker/src/routes/chat.ts:**
    - `GET /api/chat/conversations/:conversationId/messages?before=<iso>&limit=<n>` (default 50, max 100).
    - Query fetches `limit + 1` rows newest-first to detect `hasMore` without a second query, returns chronological order (oldest first in the page) for easy client prepend.
    - Response shape: `{ messages: ChatMessage[], hasMore: boolean, nextCursor: string | null }`.
    - IDOR ownership check preserved.

  **C. New pagination index — worker/src/db/migrations/0007_chat_messages_pagination_index.sql:**
    - `CREATE INDEX idx_chat_messages_user_conv_created ON chat_messages (user_id, conversation_id, created_at DESC);`
    - Journal updated: `worker/src/db/migrations/meta/_journal.json` entry idx=7.

  **D. api-client upgrade — apps/web/app/lib/api-client.ts:**
    - `fetchConversationMessages(conversationId, { before?, limit? })` now accepts cursor/limit and returns `ChatHistoryPage`.
    - New `ChatHistoryPage` type exported.

  **E. Chat route rehydration + scroll-up pagination — apps/web/app/routes/_app.chat.tsx:**
    - `conversationId` now reads/writes `localStorage["mimir.chat.conversationId"]` so reloads resume the same conversation.
    - On mount, fetches the first 50 messages and hydrates `messages`; tracks `hasMore` + `nextCursor`.
    - Assistant rows whose content is a JSON `{type:"generation_started", workflowRunId}` are rehydrated as `isGenerationProgress` bubbles → `GenerationProgressBubble` polls status on mount, shows the step indicator (live) or the "View roadmap" / failure state immediately (terminal).
    - IntersectionObserver on a top sentinel fires `loadOlder()` which fetches the next page and PREPENDS it. Scroll position is preserved by capturing scrollHeight before/after and adjusting scrollTop in the next animation frame.
    - Auto-scroll-to-bottom logic now only triggers on tail-appends (not on prepends from pagination).

  **Files changed:**
    - worker/src/routes/chat.ts (fix A + B)
    - worker/src/db/migrations/0007_chat_messages_pagination_index.sql (new, fix C)
    - worker/src/db/migrations/meta/_journal.json (register migration 7)
    - apps/web/app/lib/api-client.ts (fix D)
    - apps/web/app/routes/_app.chat.tsx (fix E)

  **Verification:**
    - `npx tsc --noEmit -p tsconfig.json` → exit 0 in apps/web
    - `npx tsc --noEmit -p tsconfig.json` → exit 0 in worker

  **User action required:**
    - Run `drizzle-kit` apply / `wrangler d1 migrations apply` to push migration 0007.
    - Smoke test: sign in → /chat → send plain Q&A + roadmap prompt → reload → confirm both persist. Scroll up after >50 messages to confirm pagination.
    - Review diff and commit.

specialist_hint: react

## Specialist Review

(skipped — executed directly; specialist dispatch not available in this runtime. The implementation follows the suggested plan from the Fix section and typechecks cleanly against both TS projects.)
