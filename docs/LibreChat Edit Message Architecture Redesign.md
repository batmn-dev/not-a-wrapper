# LibreChat Edit Message Architecture Redesign

## Purpose

Carefully inspect LibreChat's edit and resend architecture before redesigning this app's edit/resend chat-turn flow. The goal is not to copy LibreChat directly, but to understand the best-practice model behind its behavior and adapt the right parts to our current stack: Next.js, AI SDK, Convex, and the existing chat-turn modules.

## LibreChat Research Scope

Use the local LibreChat repo if available at:

- `/Users/andresgonzalez/Github/Projects/libreChat`

Inspect these paths first:

- `client/src/components/Chat/Messages/Content/EditMessage.tsx`
- `client/src/components/Chat/Messages/Content/Parts/EditTextPart.tsx`
- `client/src/hooks/Messages/useMessageActions.tsx`
- `client/src/hooks/Chat/useChatFunctions.ts`
- `client/src/hooks/Chat/useChatHelpers.ts`
- `client/src/hooks/useGenerationsByLatest.ts`
- `packages/data-provider/src/messages.ts`
- `packages/data-provider/src/createPayload.ts`
- `client/src/components/Chat/Messages/MultiMessage.tsx`
- `client/src/components/Chat/Messages/Message.tsx`
- `client/src/hooks/SSE/useResumableSSE.ts`
- `client/src/hooks/SSE/useEventHandlers.ts`
- `api/app/clients/BaseClient.js`
- `api/server/controllers/agents/request.js`
- `api/server/controllers/agents/client.js`
- `packages/data-schemas/src/schema/message.ts`
- `packages/data-schemas/src/methods/message.ts`

Useful test references:

- `e2e/specs/mock/message-tree.spec.ts`
- `e2e/specs/mock/chat.spec.ts`
- `api/app/clients/specs/BaseClient.test.js`
- `client/src/hooks/SSE/__tests__/useEventHandlers.spec.ts`

## Behaviors To Verify In LibreChat

- User `Save` mutates the existing message only.
- User `Save & Submit` creates a new user-message sibling under the edited message's original parent.
- Regenerate creates a new assistant sibling rather than overwriting the old assistant row.
- Later dependent turns are not deleted. They are hidden by selected branch/path rendering.
- The generation prefix is reconstructed server-side from DB ancestry, not trusted from the browser's visible message array.
- Optimistic client IDs are placeholders and are reconciled to server message IDs through stream events.
- Edit and regenerate controls are disabled or hidden while a generation is active.
- Abort/cancel preserves coherent persisted state and may keep partial assistant content when meaningful.

## Current App Comparison Points

Inspect our corresponding paths:

- `app/components/chat/message-user.tsx`
- `app/components/chat/use-chat-edit.ts`
- `app/components/chat/use-chat-core.ts`
- `app/components/chat/chat-turn.ts`
- `lib/chat-store/turns/chat-turn-service.ts`
- `lib/chat-store/messages/provider.tsx`
- `lib/chat-messages/ui-message-adapter.ts`
- `app/api/chat/route.ts`
- `convex/chatRuntime.ts`
- `convex/messages.ts`

Pay special attention to:

- Where edit state is created, submitted, cancelled, and cleared.
- Whether leaf UI validates message IDs instead of delegating identity resolution.
- Whether edit/resend sends stale client-visible history to `/api/chat`.
- Whether Convex can resolve both durable IDs and `clientMessageId`.
- Whether the backend can derive the edited generation prefix from persisted state.
- Whether optimistic IDs are reconciled before later edit/regenerate flows depend on them.

## Strategic Direction

Our long-term direction should be branch-compatible chat turns:

- Treat edit/resend as a first-class chat-turn variant.
- Prefer server-owned ancestry and selected paths over destructive client-side truncation.
- Keep client-side truncation only as an optimistic visual affordance, not as the source of truth.
- Let the backend validate canonical message identity and reconstruct the model prefix from persisted state.
- Do not introduce a full LibreChat-style tree renderer unless the product decision requires visible branch navigation.

## Next Step

Determine the best-practice strategic implementation plan for this app's current stack: Next.js, AI SDK, Convex, and the existing chat-turn service. The plan should define the smallest safe fix for edit/resend now, plus the architecture path toward server-owned ancestry and selected branch rendering later.
