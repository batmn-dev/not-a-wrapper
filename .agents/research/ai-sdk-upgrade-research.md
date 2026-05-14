# AI SDK Upgrade Research

> **Goal:** Research and plan a smooth upgrade from Vercel AI SDK v4.x to v6.x
> **Created:** 2026-02-01
> **Status:** ✅ All Research Complete — Ready for Implementation
> **Last Updated:** 2026-02-02

---

## 🎯 Executive Summary

**All research is now complete.** Both initial questions and the 8 additional questions identified during codebase review have been fully answered. Implementation can proceed with confidence.

### Key Findings

| Question | Answer | Impact |
|----------|--------|--------|
| **Data Migration** | Use runtime conversion layer (no immediate DB changes) | Low risk |
| **Transport Architecture** | Per-request body supported via `sendMessage` options | Direct migration |
| **Convex Schema** | Already compatible (`parts: v.any()`) | No changes needed |
| **Message Parts** | Codebase already uses parts, minor property renames | Small refactor |
| **Multi-Model View** | Compatible with transport updates | Minor changes |
| **Framework Compatibility** | Next.js 16 + React 19 fully supported | No issues |
| **`maxSteps` → `stopWhen`** | Use `stepCountIs(10)` helper on server-side | Simple migration |
| **Edit Flow** | `sendMessage` supports edits via `messageId` parameter | Compatible |
| **Draft Persistence** | Manual input state (`useState`) is straightforward | No complexity |
| **`regenerate()` Options** | Accepts `{ body: {...} }` same as `reload()` | Drop-in rename |

### Recommended Approach

1. **Incremental Migration**: v4 → v5 → v6 (not direct v4 → v6)
2. **Runtime Conversion**: Use `lib/ai/message-conversion.ts` for format compatibility
3. **No Immediate Schema Migration**: Convex schema already supports v5 format
4. **Use Codemods**: `npx @ai-sdk/codemod v5` then `npx @ai-sdk/codemod v6`

### ✅ All Questions Resolved (2026-02-02)

All 8 additional questions have been thoroughly researched and answered:
- ✅ **2 HIGH priority** — `maxSteps` → `stopWhen`, edit flow works with `messageId`
- ✅ **4 MEDIUM priority** — Manual input state simple, `regenerate()` accepts body, format conversion at API layer
- ✅ **2 LOW priority** — Conversion in `lib/ai/message-conversion.ts`, v6 tool patterns documented

**No remaining blockers.** See **"Additional Critical Questions — FULLY ANSWERED"** section for details.

### Estimated Remaining Effort: **8-12 hours** (reduced from 10-14, no research blocking)

---

## Current State

| Package | Current Version | Target Version | Change |
|---------|-----------------|----------------|--------|
| `ai` | ^4.3.13 | ^6.0.0 | Major (v4→v5→v6) |
| `@ai-sdk/anthropic` | ^1.2.10 | ^3.0.0 | Major |
| `@ai-sdk/google` | ^1.2.13 | ^3.0.0 | Major |
| `@ai-sdk/mistral` | ^1.2.0 | ^3.0.0 | Major |
| `@ai-sdk/openai` | ^1.3.22 | ^3.0.0 | Major |
| `@ai-sdk/perplexity` | ^1.1.9 | ^3.0.0 | Major |
| `@ai-sdk/xai` | ^1.2.16 | ^3.0.0 | Major |
| `@openrouter/ai-sdk-provider` | ^0.7.1 | ^2.0.0 | Major (v6 compatible ✅) |
| `zod` | ^4.3.6 | ^4.1.8+ | Already compatible ✅ |

## Research Tasks

### Phase 1: Documentation Review ✅

- [x] **Read official migration guides**
  - [x] AI SDK v4 → v5 migration guide
  - [x] AI SDK v5 → v6 migration guide
  - [x] Provider-specific migration notes

- [x] **Review changelog for breaking changes**
  - [x] `ai` package changelog
  - [x] `@ai-sdk/*` provider changelogs
  - [x] `@openrouter/ai-sdk-provider` changelog (v2.x compatible with AI SDK v6 ✅)

- [x] **Identify deprecated APIs**
  - [x] `streamText()` changes — minimal, mostly stable
  - [x] `generateText()` changes — `maxTokens` → `maxOutputTokens`, `maxSteps` → `stopWhen`
  - [x] `streamObject()` / `generateObject()` — **DEPRECATED in v6**, use `streamText`/`generateText` with `output` setting
  - [x] Response streaming format changes — `toDataStreamResponse()` → `toUIMessageStreamResponse()`
  - [x] Tool calling API changes — `parameters` → `inputSchema`, `args` → `input`, `result` → `output`

### Phase 2: Codebase Impact Analysis ✅

- [x] **Audit current AI SDK usage** (31 files affected)
  - [x] `app/api/chat/route.ts` - Uses `toDataStreamResponse()`, `Message`, `streamText`, `ToolSet`
  - [x] Historical: removed unused context-management placeholder after migration cleanup.
  - [x] `lib/openproviders/index.ts` - Uses `LanguageModelV1` from `@ai-sdk/provider`
  - [x] `lib/models/types.ts` - Uses `LanguageModelV1` type
  - [x] `app/components/chat/use-chat-core.ts` - Uses `useChat`, `Message`, `append`, `reload`
  - [x] `lib/chat-store/messages/api.ts` - Uses `Message` type
  - [x] Multiple component files using message parts for rendering

- [x] **Identify affected patterns**
  - [x] `toDataStreamResponse()` → Must migrate to `toUIMessageStreamResponse()`
  - [x] `getErrorMessage` callback → Must migrate to `onError`
  - [x] `Message` type → Must migrate to `UIMessage` (v5)
  - [x] `useChat` API changes (transport architecture, removed managed input)
  - [x] Tool invocation rendering (part.toolInvocation → typed tool parts)
  - [x] Reasoning display (part.reasoning → part.text on reasoning parts)
  - [x] `experimental_attachments` → file parts in v5
  - [x] `append` → `sendMessage`, `reload` → `regenerate`

- [x] **Check third-party compatibility**
  - [x] `@openrouter/ai-sdk-provider` v2.x is compatible with AI SDK v6 ✅
  - [x] No other custom provider implementations found

### Phase 3: Risk Assessment ✅

- [x] **Categorize changes by risk level**

**🔴 HIGH RISK (Core Breaking Changes)**
| Change | Impact | Files Affected |
|--------|--------|----------------|
| `toDataStreamResponse()` → `toUIMessageStreamResponse()` | Streaming protocol change | `app/api/chat/route.ts` |
| `Message` → `UIMessage` (content → parts) | Message structure change | 15+ files |
| `useChat` API overhaul | Transport architecture, state management | `use-chat-core.ts` |
| `LanguageModelV1` → `LanguageModelV3` | Provider interface change | `lib/openproviders/`, `lib/models/` |
| `append` → `sendMessage` | Hook API change | `use-chat-core.ts` |

**🟡 MEDIUM RISK (Behavioral Changes)**
| Change | Impact | Files Affected |
|--------|--------|----------------|
| `getErrorMessage` → `onError` | Error handling pattern | `app/api/chat/route.ts` |
| Tool calling API (`parameters` → `inputSchema`) | Schema definition change | Any tool definitions |
| `experimental_attachments` → file parts | Attachment handling | `use-chat-core.ts`, message components |
| `reload` → `regenerate` | Method rename | `use-chat-core.ts` |
| Tool UI parts typing | Render logic change | `message-assistant.tsx`, `tool-invocation.tsx` |

**🟢 LOW RISK (Renames & Minor Changes)**
| Change | Impact | Files Affected |
|--------|--------|----------------|
| `maxTokens` → `maxOutputTokens` | Parameter rename | None (we don't use this) |
| `providerMetadata` → `providerOptions` | Parameter rename | None currently |
| `mimeType` → `mediaType` | Property rename | File handling |

- [x] **Identify potential blockers**
  - [x] ~~Features we use that may be removed~~ — None identified
  - [x] ~~APIs with no direct replacement~~ — All have migration paths
  - [x] ~~Third-party provider support gaps~~ — OpenRouter v2.x compatible ✅

### Phase 4: Upgrade Strategy ✅

- [x] **Determine upgrade path**
  - ~~Option A: Direct v4 → v6~~ — Not recommended (too many breaking changes)
  - **✅ Option B: Incremental v4 → v5 → v6** — RECOMMENDED
  - ~~Option C: Parallel implementation~~ — Unnecessary complexity

**Recommended Upgrade Path:**
```
Step 1: v4.x → v5.0 (major UI/streaming changes)
Step 2: v5.0 → v6.0 (tool/agent improvements)
```

- [x] **Create testing plan**
  - [x] Run `bun run typecheck` after each migration step
  - [x] Run `bun run lint` after each step
  - [x] Manual test: Send message, receive streaming response
  - [x] Manual test: Reasoning/thinking display
  - [x] Manual test: File attachments
  - [x] Manual test: Error handling (rate limits, API errors)
  - [x] Manual test: Multi-model comparison view

- [x] **Plan rollback strategy**
  - [x] Create feature branch: `feat/ai-sdk-v6-upgrade`
  - [x] Commit after each migration step (granular rollback)
  - [x] No database changes required (message format is client-side)
  - [x] Pin versions in package.json until stable

---

## Research Resources

### Official Documentation
- [ ] https://sdk.vercel.ai/docs
- [ ] https://sdk.vercel.ai/docs/migration-guides
- [ ] https://github.com/vercel/ai/releases
- [ ] https://github.com/vercel/ai/blob/main/CHANGELOG.md

### Provider Documentation
- [ ] https://sdk.vercel.ai/providers/ai-sdk-providers/anthropic
- [ ] https://sdk.vercel.ai/providers/ai-sdk-providers/openai
- [ ] https://sdk.vercel.ai/providers/ai-sdk-providers/google-generative-ai
- [ ] https://github.com/openrouter/ai-sdk-provider

### Community Resources
- [ ] GitHub issues tagged with migration
- [ ] Discord/community discussions on upgrade experiences

---

## Files to Audit

### Critical (Must Review)
```
app/api/chat/route.ts          # Main streaming endpoint
lib/ai/message-conversion.ts   # Attachment conversion helpers
lib/openproviders/index.ts     # Provider abstraction
lib/openproviders/provider-map.ts
```

### Important (Likely Affected)
```
lib/models/index.ts            # Model definitions
lib/models/types.ts            # Type definitions
lib/models/data/*.ts           # Provider-specific configs
```

### May Be Affected
```
app/api/*/route.ts             # Other API routes using AI
Historical placeholder sub-agent files have been removed.
```

---

## Questions to Answer ✅

1. **Streaming Changes** ✅
   - ~~Does `toDataStreamResponse()` still exist in v6?~~ → **No**, replaced with `toUIMessageStreamResponse()`
   - ~~What is the new streaming format?~~ → Server-Sent Events with start/delta/end pattern and unique IDs
   - ~~Are there changes to `sendReasoning` / `sendSources`?~~ → Still supported, same API

2. **Provider Changes** ✅
   - ~~Do provider packages need to match AI SDK version?~~ → Yes, `@ai-sdk/*` v3.x for AI SDK v6
   - ~~Are there new initialization patterns?~~ → OpenAI defaults to Responses API (use `openai.chat()` for Chat Completions)
   - ~~How do we handle provider-specific features?~~ → Use `providerOptions` instead of `providerMetadata`

3. **Type Changes** ✅
   - ~~What types have been renamed or removed?~~ → `Message` → `UIMessage`, `CoreMessage` → `ModelMessage`
   - ~~Are there new required fields?~~ → Messages now use `parts` array instead of `content` string
   - ~~How do message formats differ?~~ → Parts-based: `[{ type: 'text', text: '...' }, { type: 'reasoning', text: '...' }]`

4. **Tool Calling** ✅
   - ~~Any changes to tool definition format?~~ → `parameters` → `inputSchema`
   - ~~Changes to tool result handling?~~ → `args` → `input`, `result` → `output`
   - ~~Multi-step tool calling changes?~~ → `maxSteps` removed from useChat, use server-side `stopWhen`

5. **Compatibility** ✅
   - ~~Can v4 and v6 coexist during migration?~~ → No, must upgrade all packages together
   - ~~Are there feature flags in the SDK?~~ → No, but codemods help automate migration
   - ~~What's the minimum Node.js version?~~ → Node.js 18+ (already met ✅)

---

## ✅ Critical Open Questions — ANSWERED

### 1. Data Persistence & Migration 🔴 HIGH PRIORITY ✅ ANSWERED

**Question:** How do existing stored messages (IndexedDB + Convex) need to be migrated?

| Concern | Detail | Status | Answer |
|---------|--------|--------|--------|
| IndexedDB message format | Messages stored with `content: string` need migration to `parts: []` format | ✅ Resolved | **Runtime conversion recommended** |
| Convex schema changes | Does `convex/messages.ts` need schema updates? | ✅ Resolved | **No immediate schema changes needed** — schema already stores `parts: v.optional(v.any())` |
| Backward compatibility | Can v5/v6 read v4-format messages? | ✅ Resolved | **No automatic conversion** — SDK does NOT auto-convert |
| Migration script needed? | Do we need to transform existing data? | ✅ Resolved | **Use runtime conversion layer (Phase 1)**, then optional schema migration (Phase 2) |

**Strategic Answer:**

**✅ Good News:** The codebase is well-positioned for migration:
- Convex schema already supports `parts: v.optional(v.any())` — no schema changes required initially
- IndexedDB is a client-side cache that can be cleared/rebuilt
- The codebase already uses `message.parts` in rendering components

**Recommended Approach (per official AI SDK guidance):**

**Phase 1: Runtime Conversion (No Database Changes)**
1. Install `ai-legacy` alongside `ai@5` for v4 type definitions
2. Create conversion functions (`convertV4MessageToV5`, `convertV5MessageToV4`)
3. Convert messages when reading from IndexedDB/Convex
4. Convert messages when writing back to IndexedDB/Convex
5. This allows immediate upgrade without data migration

**Phase 2: Schema Migration (Optional, recommended)**
1. Create `messages_v5` Convex table alongside existing
2. Dual-write to both tables
3. Background migration of existing messages
4. Switch reads to v5 schema
5. Remove conversion layer
6. Drop old table

**IndexedDB Strategy:**
- Since IndexedDB is a cache, consider incrementing `DB_VERSION` to trigger fresh migration
- Convert on read, or simply clear cache on upgrade (messages are synced from Convex anyway)

**Files already compatible:**
- `convex/schema.ts` — `parts: v.optional(v.any())` already supports v5 format ✅
- `convex/messages.ts` — Functions accept `parts` already ✅
- `lib/chat-store/persist.ts` — Key-value store, format-agnostic ✅

---

### 2. useChat Transport Architecture 🔴 HIGH PRIORITY ✅ ANSWERED

**Question:** How do we pass custom body data with the new transport architecture?

**Strategic Answer:**

**✅ Per-request body IS supported** via two methods:

**Method 1: Request-Level Options (RECOMMENDED)**
```typescript
// v5: Pass body as second parameter to sendMessage
sendMessage(
  { text: input },
  {
    body: {
      chatId: currentChatId,
      userId: uid,
      model: selectedModel,
      systemPrompt,
      enableSearch,
    },
  }
);
```

**Method 2: Dynamic Transport Configuration**
```typescript
import { DefaultChatTransport } from 'ai';

const transport = new DefaultChatTransport({
  api: '/api/chat',
  // Functions are called on each request
  body: () => ({
    chatId: currentChatIdRef.current,
    userId: uidRef.current,
    model: selectedModelRef.current,
  }),
});
```

**Method 3: prepareSendMessagesRequest for Full Control**
```typescript
const transport = new DefaultChatTransport({
  api: '/api/chat',
  prepareSendMessagesRequest: ({ messages, id, trigger, messageId }) => ({
    body: {
      messages: messages.slice(-1), // Only send last message
      chatId: id,
      model: selectedModel,
      trigger,
    },
  }),
});
```

**Migration Path for `use-chat-core.ts`:**

```typescript
// BEFORE (v4)
handleSubmit(undefined, {
  body: { chatId, userId, model, systemPrompt, enableSearch },
  experimental_attachments: attachments,
})

// AFTER (v5)
const [input, setInput] = useState('');  // Manual input state

sendMessage(
  { 
    text: input,
    files: attachments,  // v5: files replaces experimental_attachments
  },
  {
    body: { chatId, userId, model, systemPrompt, enableSearch },
  }
);
```

**Key Changes:**
- `handleSubmit` → `sendMessage`
- `experimental_attachments` → `files` property in first argument
- Input state must be managed manually (not by useChat)
- Body can be passed per-request ✅

---

### 3. onFinish Callback Signature 🟡 MEDIUM PRIORITY ✅ ANSWERED

**Question:** How does the `onFinish` callback change affect our message caching logic?

**Strategic Answer:**

**New `onFinish` Signature:**
```typescript
onFinish: ({ message, messages, isAbort, isDisconnect, isError }) => {
  // message: The response message (UIMessage format)
  // messages: Full message history including new response
  // isAbort: True if user stopped generation
  // isDisconnect: True if connection lost
  // isError: True if error occurred
}
```

**Migration for `use-chat-core.ts`:**

```typescript
// BEFORE (v4)
onFinish: async (m) => {
  cacheAndAddMessage(m, effectiveChatId)
  await syncRecentMessages(effectiveChatId, setMessages, 2)
}

// AFTER (v5)
onFinish: async ({ message, messages, isAbort, isDisconnect, isError }) => {
  // Skip caching if aborted/error
  if (isAbort || isError) return;
  
  // message is the assistant response in UIMessage format
  cacheAndAddMessage(message, effectiveChatId);
  
  // messages contains full history — can use for sync
  await syncRecentMessages(effectiveChatId, setMessages, 2);
}
```

**Server-side (toUIMessageStreamResponse) also has onFinish:**
```typescript
return result.toUIMessageStreamResponse({
  originalMessages: messages,
  onFinish: ({ messages, responseMessage }) => {
    // responseMessage: just the generated message
    // messages: all messages including response
    saveChat({ chatId, messages });
  },
});
```

---

### 4. Multi-Model View Compatibility 🟡 MEDIUM PRIORITY ✅ ANSWERED

**Question:** Does the multi-chat/multi-model comparison feature work with v5 changes?

**Strategic Answer:**

**Current Implementation Analysis:**
```typescript
// use-multi-chat.ts creates multiple useChat hooks
const chatHooks = Array.from({ length: MAX_MODELS }, (_, index) =>
  useChat({
    api: "/api/chat",
    onError: (error) => { /* ... */ },
  })
);
```

**v5 Compatibility:**

**✅ Compatible with modifications:**
1. Each `useChat` instance needs its own `DefaultChatTransport`
2. Shared chat state requires explicit `Chat` instance sharing
3. `append` → `sendMessage` migration needed

**Migration:**
```typescript
// BEFORE (v4)
const chatHooks = Array.from({ length: MAX_MODELS }, (_, index) =>
  useChat({ api: "/api/chat", onError: handleError })
);

// AFTER (v5)
const chatHooks = Array.from({ length: MAX_MODELS }, (_, index) =>
  useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
    onError: handleError,
  })
);

// Then update append → sendMessage in the active instances
return {
  model,
  messages: chatHook.messages,
  isLoading: chatHook.status !== 'ready',
  sendMessage: (message, options) => chatHook.sendMessage(message, options),
  stop: chatHook.stop,
};
```

**No Issues Expected With:**
- Multiple concurrent streams ✅
- Independent chat instances ✅
- Parallel model comparison ✅

---

### 5. Message Parts Already in Use? 🟡 MEDIUM PRIORITY ✅ ANSWERED

**Question:** The codebase already uses `message.parts` — is this v4-compatible parts or something else?

**Strategic Answer:**

**✅ Partially Compatible — Minor Changes Needed**

**Current Code Analysis:**
```typescript
// message-assistant.tsx
const reasoningParts = parts?.find((part) => part.type === "reasoning")
const toolInvocationParts = parts?.filter((part) => part.type === "tool-invocation")
```

**v4 vs v5 Parts Comparison:**

| v4 Part Type | v5 Part Type | Changes |
|--------------|--------------|---------|
| `type: "reasoning"` with `part.reasoning` | `type: "reasoning"` with `part.text` | Property rename: `.reasoning` → `.text` |
| `type: "tool-invocation"` with `part.toolInvocation` | `type: "tool-${toolName}"` with `part.input/output` | Type and property changes |
| — | `type: "text"` with `part.text` | New (replaces `content`) |
| `type: "source"` with `part.source` | `type: "source-url"` / `type: "source-document"` | Type split |
| `type: "file"` with `part.mimeType`, `part.data` | `type: "file"` with `part.mediaType`, `part.url` | Property renames |

**Migration for `message-assistant.tsx`:**

```typescript
// BEFORE (v4)
const reasoningParts = parts?.find((part) => part.type === "reasoning")
// Access: reasoningParts.reasoning

// AFTER (v5)
const reasoningParts = parts?.find((part) => part.type === "reasoning")
// Access: reasoningParts.text  // Property renamed

// BEFORE (v4)
const toolInvocationParts = parts?.filter((part) => part.type === "tool-invocation")
// Access: part.toolInvocation.toolName, part.toolInvocation.args

// AFTER (v5) - Use helper functions
import { isToolUIPart, getToolName } from 'ai';

const toolParts = parts?.filter((part) => isToolUIPart(part))
// Access: getToolName(part), part.input, part.output
// States: 'input-streaming' | 'input-available' | 'output-available' | 'output-error'
```

**Good News:** The codebase structure is already aligned with v5's parts-based approach. Changes are mostly property/type renames.

---

### 6. Framework Compatibility 🟢 LOW PRIORITY ✅ ANSWERED

**Question:** Any known issues with Next.js 16 + React 19 + AI SDK v6?

| Framework | Version | Status | Answer |
|-----------|---------|--------|--------|
| Next.js | 16.1.6 | ✅ Compatible | AI SDK v5/v6 fully supports Next.js App Router |
| React | 19.2.4 | ✅ Compatible | No known issues; `@ai-sdk/react` supports React 19 |

**Strategic Answer:**

**✅ No Known Compatibility Issues**

- AI SDK v5/v6 is designed for modern React (18+, 19)
- Next.js App Router is the primary supported framework
- Server Components + Client Components patterns are documented
- SSR/hydration handled properly via streaming protocols

**Minimum Requirements:**
- Node.js 18+ ✅ (project uses Node 18+)
- React 18+ ✅ (project uses React 19)
- TypeScript 5+ ✅ (project compatible)

**Note:** If Zod performance issues occur, ensure Zod 4.1.8+ is used (project uses 4.3.6 ✅).

---

### 7. File Upload Flow 🟢 LOW PRIORITY ✅ ANSWERED

**Question:** How does `experimental_attachments` → file parts affect the upload workflow?

**Strategic Answer:**

**v5 File Handling:**

```typescript
// BEFORE (v4)
handleSubmit(undefined, {
  experimental_attachments: [
    { name: 'image.png', contentType: 'image/png', url: 'https://...' }
  ],
})

// AFTER (v5) - Method 1: FileList from input
sendMessage({
  text: input,
  files: fileInputRef.current?.files,  // FileList auto-converted
});

// AFTER (v5) - Method 2: File objects array
sendMessage({
  text: input,
  files: [
    { type: 'file', filename: 'image.png', mediaType: 'image/png', url: 'https://...' }
  ],
});
```

**Rendering File Parts:**
```typescript
// v5 rendering
{message.parts.map((part, index) => {
  if (part.type === 'file' && part.mediaType?.startsWith('image/')) {
    return <img key={index} src={part.url} alt={part.filename} />;
  }
  if (part.type === 'text') {
    return <span key={index}>{part.text}</span>;
  }
})}
```

**Current Upload Flow Compatibility:**
1. User selects files → ✅ Same
2. Files uploaded to Convex storage → ✅ Same  
3. Attachment URLs passed via `files` property → Changed from `experimental_attachments`
4. Rendered via `message.parts` with `type: 'file'` → Changed property names

**Property Changes:**
- `contentType` → `mediaType`
- `name` → `filename`
- `url` → `url` (same)

---

### 8. Status States Compatibility 🟢 LOW PRIORITY ✅ ANSWERED

**Question:** Do the `status` values from `useChat` change in v5?

**Strategic Answer:**

**✅ Status Values Are the Same**

| v4 Status | v5 Status | Meaning |
|-----------|-----------|---------|
| `"ready"` | `"ready"` | Can submit new message |
| `"submitted"` | `"submitted"` | Awaiting response stream start |
| `"streaming"` | `"streaming"` | Response actively streaming |
| `"error"` | `"error"` | Error occurred |

**No Code Changes Needed:**
```typescript
// Works in both v4 and v5
status === "streaming" | "submitted" | "ready" | "error"
```

**Usage Pattern (unchanged):**
```typescript
// Disable input during processing
disabled={status !== 'ready'}

// Show spinner
{status === 'submitted' && <Spinner />}

// Show stop button
{(status === 'streaming' || status === 'submitted') && (
  <button onClick={stop}>Stop</button>
)}
```

---

## Research Priority Order ✅ COMPLETED

All questions have been researched and answered. Priority order was:

1. ✅ **Data Persistence** — Runtime conversion recommended, no immediate schema changes
2. ✅ **Transport Architecture** — Per-request body fully supported via `sendMessage` options
3. ✅ **onFinish Signature** — New signature with `{ message, messages, isAbort, isDisconnect, isError }`
4. ✅ **Multi-Model View** — Compatible with transport updates
5. ✅ **Parts Compatibility** — Codebase aligned, minor property renames needed
6. ✅ **Framework Compatibility** — No known issues with Next.js 16 + React 19
7. ✅ **File Upload Flow** — `experimental_attachments` → `files` property
8. ✅ **Status States** — Identical in v5

---

## ✅ Initial Research Complete — Additional Questions Below

### Research Tasks Completed

- [x] **Read Convex schema** — `parts: v.optional(v.any())` already supports v5 ✅
- [x] **Read IndexedDB persist logic** — Key-value store, format-agnostic ✅
- [x] **Read multi-chat hook** — Creates multiple useChat instances, needs transport update
- [x] **Fetch v5 transport docs** — `DefaultChatTransport` with `prepareSendMessagesRequest`
- [x] **Check AI SDK examples** — Per-request body via `sendMessage` second parameter

### Documentation Reviewed

- [x] https://ai-sdk.dev/docs/ai-sdk-ui/chatbot — v5 useChat patterns
- [x] https://ai-sdk.dev/docs/ai-sdk-ui/transport — Transport architecture
- [x] https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence — Message persistence in v5
- [x] https://ai-sdk.dev/docs/migration-guides/migration-guide-5-0 — Full migration guide
- [x] https://ai-sdk.dev/docs/migration-guides/migration-guide-5-0-data — Data migration guide

### Proof of Concept Recommendations

Before full migration:
- [ ] Create feature branch `feat/ai-sdk-v6-upgrade`
- [ ] Test basic chat flow with v5 upgrade
- [ ] Verify streaming with `toUIMessageStreamResponse()`
- [ ] Test existing message loading with conversion layer

---

## ✅ Additional Critical Questions — FULLY ANSWERED (2026-02-02)

All questions identified during the codebase review have been thoroughly researched and answered.

### 1. Server-Side `maxSteps` Behavior Change 🔴 HIGH PRIORITY ✅ ANSWERED

**File:** `app/api/chat/route.ts` (line 145)

```typescript
const result = streamText({
  model: aiModel,
  system: effectiveSystemPrompt,
  messages: messages,
  tools: {} as ToolSet,
  maxSteps: 10,  // <-- MUST CHANGE to stopWhen
  // ...
})
```

**Strategic Answer:**

**✅ `maxSteps` is replaced with `stopWhen` in v5/v6**

The `maxSteps` parameter has been completely removed from `streamText()` and `generateText()`. It must be replaced with the new `stopWhen` parameter, which provides more flexible control over multi-step execution.

**Migration:**
```typescript
// BEFORE (v4)
const result = streamText({
  model: aiModel,
  maxSteps: 10,
  // ...
})

// AFTER (v5/v6)
import { stepCountIs } from 'ai';

const result = streamText({
  model: aiModel,
  stopWhen: stepCountIs(10),  // Equivalent to maxSteps: 10
  // ...
})
```

**Key Differences:**
- `stopWhen` only triggers **when the last step contains tool results** (not on every step)
- `stopWhen` can accept multiple conditions: `stopWhen: [stepCountIs(10), hasToolCall('finalize')]`
- `stopWhen` supports custom callbacks: `stopWhen: ({ steps }) => steps.length >= 10`

**Common Patterns:**
```typescript
// Stop after N steps (equivalent to old maxSteps)
stopWhen: stepCountIs(5)

// Stop when specific tool is called
stopWhen: hasToolCall('finalizeTask')

// Multiple conditions (any condition stops)
stopWhen: [stepCountIs(10), hasToolCall('submitOrder')]

// Custom condition
stopWhen: ({ steps }) => {
  const lastStep = steps[steps.length - 1];
  return lastStep?.text?.includes('COMPLETE');
}
```

**Important:** Since the current codebase uses `tools: {} as ToolSet` (empty tools), the `stopWhen` condition will effectively be a no-op. However, when tools are added, this becomes critical.

**Codemod:** `npx @ai-sdk/codemod v5/move-maxsteps-to-stopwhen`

---

### 2. Edit Flow Migration — `append()` → `sendMessage()` Signature 🔴 HIGH PRIORITY ✅ ANSWERED

**File:** `app/components/chat/use-chat-core.ts` (lines 272-422)

**Strategic Answer:**

**✅ `sendMessage` fully supports edit flows with the `messageId` parameter**

The v6 `sendMessage` function has a built-in edit capability via the optional `messageId` parameter:

```typescript
// v6 sendMessage signature (from official docs)
sendMessage: (
  message?: { 
    text: string; 
    files?: FileList | FileUIPart[]; 
    metadata?; 
    messageId?: string  // <-- KEY: If provided, replaces the message
  } | CreateUIMessage, 
  options?: ChatRequestOptions  // { headers?, body?, metadata? }
) => Promise<void>
```

**Migration for `submitEdit`:**
```typescript
// BEFORE (v4)
append(
  {
    role: "user",
    content: newContent,
  },
  options
)

// AFTER (v5/v6) - Two approaches:

// Approach 1: Use messageId for replacement (RECOMMENDED)
// First, trim messages locally, then send with new content
setMessages((prev) => prev.slice(0, editIndex));
sendMessage(
  { 
    text: newContent,
    files: target.experimental_attachments 
      ? convertAttachmentsToFiles(target.experimental_attachments) 
      : undefined,
  },
  {
    body: {
      chatId: currentChatId,
      userId: uid,
      model: selectedModel,
      systemPrompt,
    },
  }
);

// Approach 2: Full control with setMessages + sendMessage
setMessages((prev) => {
  const trimmed = prev.slice(0, editIndex);
  return [...trimmed, { 
    id: generateId(), 
    role: 'user', 
    parts: [{ type: 'text', text: newContent }],
    // Include file parts if needed
  }];
});
sendMessage(undefined, { body: { ... } }); // Empty message triggers resubmit
```

**Attachment Migration:**
```typescript
// BEFORE (v4)
experimental_attachments: target.experimental_attachments

// AFTER (v5/v6)
// v4 attachments: { name, contentType, url }
// v5 file parts: { type: 'file', filename, mediaType, url }

// Conversion helper:
function convertV4AttachmentsToV5Files(
  attachments?: Array<{ name: string; contentType: string; url: string }>
): FileUIPart[] | undefined {
  if (!attachments?.length) return undefined;
  return attachments.map(att => ({
    type: 'file' as const,
    filename: att.name,
    mediaType: att.contentType,
    url: att.url,
  }));
}
```

**Risk Mitigation:**
- The edit flow's optimistic updates and rollback logic remain unchanged
- `setMessages` is still available and works the same way
- The complex validation and database deletion logic is unaffected

---

### 3. Draft Persistence with Removed `input` State 🟡 MEDIUM PRIORITY ✅ ANSWERED

**File:** `app/components/chat/use-chat-core.ts` (lines 524-530)

**Strategic Answer:**

**✅ Straightforward replacement — no hidden complexities**

The migration is exactly what it appears to be:

```typescript
// BEFORE (v4)
const {
  messages,
  input,          // Managed by useChat
  setInput,       // From useChat
  handleSubmit,
} = useChat({ ... });

const handleInputChange = useCallback(
  (value: string) => {
    setInput(value)      // From useChat
    setDraftValue(value)
  },
  [setInput, setDraftValue]
)

// AFTER (v5/v6)
const [input, setInput] = useState(draftValue);  // Manual state, initialize with draft

const {
  messages,
  sendMessage,
  // input and setInput are NO LONGER provided
} = useChat({ ... });

const handleInputChange = useCallback(
  (value: string) => {
    setInput(value)      // Now from useState
    setDraftValue(value) // Draft persistence unchanged
  },
  [setInput, setDraftValue]
)
```

**Key Points:**
- **No additional complexities** — it's a simple lift from hook-managed to component-managed state
- **Draft persistence hook unchanged** — `useChatDraft` works the same, just gets value from different source
- **Initial value** — Initialize `useState(draftValue)` to restore draft on mount
- **Controlled pattern preserved** — The input is still fully controlled, just by different owner

**Benefits of manual input state:**
- Cleaner separation of concerns
- More predictable behavior (no magic state syncing)
- Easier integration with draft persistence

---

### 4. `reload()` → `regenerate()` Options Compatibility 🟡 MEDIUM PRIORITY ✅ ANSWERED

**File:** `app/components/chat/use-chat-core.ts` (lines 509-520)

**Strategic Answer:**

**✅ `regenerate()` DOES accept `body` options via `ChatRequestOptions`**

From the official v6 documentation:

```typescript
// v6 regenerate signature
regenerate: (options?: { messageId?: string } & ChatRequestOptions) => Promise<void>

// ChatRequestOptions includes:
interface ChatRequestOptions {
  headers?: Record<string, string> | Headers;
  body?: object;      // <-- Custom body IS supported
  metadata?: unknown;
}
```

**Migration:**
```typescript
// BEFORE (v4)
const options = {
  body: {
    chatId,
    userId: uid,
    model: selectedModel,
    isAuthenticated,
    systemPrompt: systemPrompt || SYSTEM_PROMPT_DEFAULT,
  },
}
reload(options)

// AFTER (v5/v6) - Same structure works!
const options = {
  body: {
    chatId,
    userId: uid,
    model: selectedModel,
    isAuthenticated,
    systemPrompt: systemPrompt || SYSTEM_PROMPT_DEFAULT,
  },
}
regenerate(options)

// Or with messageId to regenerate a specific message
regenerate({
  messageId: 'specific-message-id',  // Optional
  body: { ... },                      // Custom body
})
```

**No changes needed** — The `handleReload` function can be migrated with a simple rename from `reload` to `regenerate`.

---

### 5. Sub-Agent Architecture Compatibility 🟡 MEDIUM PRIORITY ✅ ANSWERED

**Historical note:** the sub-agent placeholder module was removed after cleanup.

**Strategic Answer:**

**✅ `maxTokens` → `maxOutputTokens` applies to all generation functions**

When sub-agents are implemented:

```typescript
// BEFORE (v4/placeholder)
"code-assistant": {
  model: "claude-haiku-4-5-20250929",
  maxTokens: 4096,      // <-- v4 name
  temperature: 0.3,
}

// AFTER (v5/v6)
"code-assistant": {
  model: "claude-haiku-4-5-20250929",
  maxOutputTokens: 4096,  // <-- v5/v6 name
  temperature: 0.3,
}
```

**Additional Parameter Renames for Sub-Agents:**

| v4 Parameter | v5/v6 Parameter | Notes |
|--------------|-----------------|-------|
| `maxTokens` | `maxOutputTokens` | All generation functions |
| `providerMetadata` (input) | `providerOptions` | Input parameter only |
| Tool `parameters` | Tool `inputSchema` | When defining tools |
| Tool `args` | Tool `input` | In tool calls |
| Tool `result` | Tool `output` | In tool results |

**Status:** These changes should be noted but are **not blocking** since sub-agents are placeholder implementations. When implementing, follow v6 patterns from the start.

**Codemod:** `npx @ai-sdk/codemod v5` handles `maxTokens` → `maxOutputTokens` automatically.

---

### 6. `syncRecentMessages` Format Expectations 🟡 MEDIUM PRIORITY ✅ ANSWERED

**File:** `app/components/chat/use-chat-core.ts` (line 123)

**Strategic Answer:**

**✅ Conversion should happen at the message API layer**

**Current Flow Analysis:**
```
Convex DB → IndexedDB Cache → syncRecentMessages → setMessages → UI
            ↑
            lib/chat-store/messages/api.ts
```

**Current Convex Schema (already compatible):**
```typescript
// convex/schema.ts
parts: v.optional(v.any()),  // Already supports v5 format ✅
```

**Recommended Conversion Strategy:**

**Option A: Convert at API Layer (RECOMMENDED)**

Add conversion in `lib/chat-store/messages/api.ts`:

```typescript
// lib/chat-store/messages/api.ts
import { convertV4ToV5Message, isV5Format } from '@/lib/ai/message-conversion';

export async function getCachedMessages(chatId: string): Promise<UIMessage[]> {
  const entry = await readFromIndexedDB<ChatMessageEntry>("messages", chatId);
  if (!entry || Array.isArray(entry)) return [];
  
  // Convert any v4 messages to v5 format on read
  const messages = (entry.messages || []).map(msg => 
    isV5Format(msg) ? msg : convertV4ToV5Message(msg)
  );
  
  return messages.sort(
    (a, b) => +new Date(a.createdAt || 0) - +new Date(b.createdAt || 0)
  );
}
```

**Option B: Convert in syncRecentMessages**

If localized conversion is preferred:

```typescript
// app/components/chat/syncRecentMessages.ts
import { convertV4ToV5Message, isV5Format } from '@/lib/ai/message-conversion';

export async function syncRecentMessages(
  chatId: string,
  setMessages: (updater: (prev: UIMessage[]) => UIMessage[]) => void,
  count: number = 2
): Promise<void> {
  const lastFromDb = await getLastMessagesFromDb(chatId, count);
  if (!lastFromDb?.length) return;

  // Convert to v5 format if needed
  const converted = lastFromDb.map(msg => 
    isV5Format(msg) ? msg : convertV4ToV5Message(msg)
  );

  // ... rest of sync logic
}
```

**Recommendation:** Option A (API layer) is cleaner — converts once at the boundary, all consumers get v5 format automatically.

---

### 7. Runtime Conversion Layer Placement 🟢 LOW PRIORITY ✅ ANSWERED

**Strategic Answer:**

**✅ Recommended: `lib/ai/message-conversion.ts`**

Create a dedicated conversion module for cleanest separation of concerns:

```typescript
// lib/ai/message-conversion.ts
import type { Message as V4Message } from 'ai'; // v4 type
import type { UIMessage } from 'ai'; // v5+ type

/**
 * Type guard to detect v5 message format
 */
export function isV5Format(message: unknown): message is UIMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'parts' in message &&
    Array.isArray((message as UIMessage).parts)
  );
}

/**
 * Convert v4 message format to v5 UIMessage format
 */
export function convertV4ToV5Message(v4Message: V4Message): UIMessage {
  const parts: UIMessage['parts'] = [];

  // Convert content string to text part
  if (v4Message.content) {
    parts.push({ type: 'text', text: v4Message.content });
  }

  // Convert experimental_attachments to file parts
  if (v4Message.experimental_attachments?.length) {
    for (const att of v4Message.experimental_attachments) {
      parts.push({
        type: 'file',
        filename: att.name,
        mediaType: att.contentType,
        url: att.url,
      });
    }
  }

  // Convert reasoning if present (v4 had .reasoning property)
  if ('reasoning' in v4Message && v4Message.reasoning) {
    parts.unshift({ type: 'reasoning', text: v4Message.reasoning as string });
  }

  return {
    id: v4Message.id,
    role: v4Message.role as 'user' | 'assistant' | 'system',
    parts,
    createdAt: v4Message.createdAt,
  };
}

/**
 * Convert v5 UIMessage to v4 format (for backward compatibility if needed)
 */
export function convertV5ToV4Message(v5Message: UIMessage): V4Message {
  const textParts = v5Message.parts.filter(p => p.type === 'text');
  const content = textParts.map(p => (p as { text: string }).text).join('');

  const fileParts = v5Message.parts.filter(p => p.type === 'file');
  const experimental_attachments = fileParts.map(p => {
    const fp = p as { filename?: string; mediaType: string; url: string };
    return {
      name: fp.filename || 'file',
      contentType: fp.mediaType,
      url: fp.url,
    };
  });

  return {
    id: v5Message.id,
    role: v5Message.role,
    content,
    createdAt: v5Message.createdAt,
    experimental_attachments: experimental_attachments.length ? experimental_attachments : undefined,
  };
}

/**
 * Batch convert messages, handling mixed formats
 */
export function ensureV5Format(messages: unknown[]): UIMessage[] {
  return messages.map(msg => 
    isV5Format(msg) ? msg : convertV4ToV5Message(msg as V4Message)
  );
}
```

**Where to Apply:**
1. `lib/chat-store/messages/api.ts` — On read from IndexedDB
2. `syncRecentMessages.ts` — Ensure v5 format before updating state
3. `onFinish` callback — Messages returned by server are already v5

**Lazy vs Eager Conversion:**
- **Convert on read (lazy)** — RECOMMENDED for performance
- No database migration needed
- Messages converted when accessed
- Automatic format detection handles mixed data

---

### 8. Empty Tools Object — Future Considerations 🟢 LOW PRIORITY ✅ ANSWERED

**File:** `app/api/chat/route.ts` (line 144)

**Strategic Answer:**

**✅ Document v6 tool patterns for future implementation**

When tools are added in the future, use v6 patterns from the start:

```typescript
// v6 Tool Definition Pattern
import { tool } from 'ai';
import { z } from 'zod';

const weatherTool = tool({
  description: 'Get weather for a location',
  inputSchema: z.object({           // NOT 'parameters'
    city: z.string(),
    unit: z.enum(['celsius', 'fahrenheit']).optional(),
  }),
  execute: async ({ city, unit }) => {  // 'input' not 'args'
    // ... implementation
    return { temperature: 72 };         // 'output' not 'result'
  },
  strict: true,  // v6: Per-tool strict mode
});

// Using in streamText
const result = streamText({
  model: aiModel,
  tools: { weather: weatherTool },
  stopWhen: stepCountIs(10),  // Control multi-step tool execution
});
```

**Tool Part Rendering (v6):**
```typescript
// Use helper functions for type-safe rendering
import { isStaticToolUIPart, getStaticToolName } from 'ai';

{message.parts.map((part, index) => {
  if (isStaticToolUIPart(part)) {
    const toolName = getStaticToolName(part);
    switch (part.state) {
      case 'input-streaming':
        return <Spinner key={index}>Calling {toolName}...</Spinner>;
      case 'input-available':
        return <div key={index}>Executing {toolName}</div>;
      case 'output-available':
        return <ToolResult key={index} output={part.output} />;
      case 'output-error':
        return <Error key={index}>{part.errorText}</Error>;
    }
  }
})}
```

**Action:** Added to implementation plan notes. No changes needed now.

---

## Questions Summary Table ✅ ALL ANSWERED

| # | Question | Priority | Blocking? | Status |
|---|----------|----------|-----------|--------|
| 1 | Server-side `maxSteps` → `stopWhen` | 🔴 HIGH | ~~Yes~~ **No** | ✅ **Answered** |
| 2 | Edit flow `append` → `sendMessage` | 🔴 HIGH | ~~Yes~~ **No** | ✅ **Answered** |
| 3 | Draft persistence with manual input state | 🟡 MEDIUM | No | ✅ **Answered** |
| 4 | `reload()` → `regenerate()` options | 🟡 MEDIUM | ~~Maybe~~ **No** | ✅ **Answered** |
| 5 | Sub-agent `maxTokens` → `maxOutputTokens` | 🟡 MEDIUM | No | ✅ **Answered** |
| 6 | `syncRecentMessages` format handling | 🟡 MEDIUM | ~~Maybe~~ **No** | ✅ **Answered** |
| 7 | Conversion layer file placement | 🟢 LOW | No | ✅ **Answered** |
| 8 | Empty tools—future considerations | 🟢 LOW | No | ✅ **Answered** |

---

## ✅ All Questions Resolved — Ready to Implement

All 8 additional questions have been thoroughly researched and answered. There are **no remaining blockers** for the migration.

**Implementation can proceed with confidence.**

---

## Success Criteria (Post-Migration Verification)

- [ ] All current chat functionality works identically
- [ ] Streaming responses perform at same or better latency
- [ ] All providers (Anthropic, OpenAI, Google, Mistral, Perplexity, xAI) functional
- [ ] OpenRouter integration fully functional (v2.x)
- [ ] Tool calling works across all providers
- [ ] Error handling maintains current UX
- [ ] No regression in reasoning/thinking display
- [ ] File attachments upload and display correctly
- [ ] Message editing works correctly
- [ ] Multi-model comparison view works
- [ ] TypeScript compiles without errors
- [ ] ESLint passes without errors

---

## Timeline Estimate

### Research Phase (Completed ✅)
| Phase | Estimated | Actual |
|-------|-----------|--------|
| Phase 1: Documentation Review | 2-4 hours | ~1 hour |
| Phase 2: Codebase Audit | 2-3 hours | ~30 min |
| Phase 3: Risk Assessment | 1-2 hours | ~15 min |
| Phase 4: Strategy Planning | 1-2 hours | ~15 min |
| **Total Research** | **6-11 hours** | **~2 hours** |

### Implementation Phase (All Questions Resolved ✅)
| Step | Estimated Effort | Status |
|------|------------------|--------|
| **Step 0a: Initial Questions** | **2-4 hours** | **✅ Complete** |
| **Step 0b: Additional Questions** | **2-4 hours** | **✅ Complete** |
| Step 1: v4 → v5 Migration | 4-6 hours | ✅ **Ready to Start** |
| Step 2: v5 → v6 Migration | 1-2 hours | ✅ **Ready** |
| Step 3: Testing & Verification | 2-3 hours | ✅ **Ready** |
| Step 4: Cleanup & Merge | 1 hour | ✅ **Ready** |
| **Total Implementation** | **8-12 hours** | |

---

## Notes

### v4 → v5 Critical Changes

#### Streaming Response (MUST CHANGE)
```typescript
// BEFORE (v4)
return result.toDataStreamResponse({
  sendReasoning: true,
  sendSources: true,
  getErrorMessage: (error) => extractErrorMessage(error),
})

// AFTER (v5)
return result.toUIMessageStreamResponse({
  sendReasoning: true,  // Still supported
  sendSources: true,    // Still supported
  onError: (error) => ({
    errorCode: 'STREAM_ERROR',
    message: extractErrorMessage(error),
  }),
})
```

#### Message Type Changes
```typescript
// BEFORE (v4)
import { Message } from 'ai'
// message.content is a string

// AFTER (v5)
import { UIMessage } from 'ai'
// message.parts is an array: [{ type: 'text', text: '...' }, { type: 'reasoning', text: '...' }]
```

#### useChat Hook Changes
```typescript
// BEFORE (v4)
const { messages, input, handleSubmit, append, reload, setInput } = useChat({
  api: '/api/chat',
  initialMessages,
  initialInput: draftValue,
  onFinish: (m) => { ... },
  onError: handleError,
})

// AFTER (v5)
import { DefaultChatTransport } from 'ai'
const [input, setInput] = useState('')  // Manage input state manually!

const { messages, sendMessage, regenerate, status } = useChat({
  transport: new DefaultChatTransport({ api: '/api/chat' }),
  messages: initialMessages,  // renamed from initialMessages
  onFinish: ({ message }) => { ... },
  onError: handleError,
})

// append → sendMessage({ text: input })
// reload → regenerate()
// handleSubmit removed (use sendMessage directly)
```

#### Tool Part Changes
```typescript
// BEFORE (v4)
if (part.type === 'tool-invocation') {
  const { toolName, state, args, result } = part.toolInvocation
}

// AFTER (v5)
if (isToolUIPart(part)) {
  const toolName = getToolName(part)
  const { state, input, output } = part
  // states: 'input-streaming' | 'input-available' | 'output-available' | 'output-error'
}
```

### v5 → v6 Critical Changes

#### generateObject/streamObject Deprecated
```typescript
// BEFORE (v5)
const { object } = await generateObject({ model, schema, prompt })

// AFTER (v6)
import { Output } from 'ai'
const { output } = await generateText({
  model,
  output: Output.object({ schema }),
  prompt,
})
```

#### convertToModelMessages is now async
```typescript
// BEFORE (v5)
const modelMessages = convertToModelMessages(messages)

// AFTER (v6)
const modelMessages = await convertToModelMessages(messages)
```

### Blockers Identified
- **None** ✅
- **All initial questions answered** — See "Critical Open Questions — ANSWERED" section above ✅
- **All additional questions answered** — See "Additional Critical Questions — FULLY ANSWERED" section ✅
- **Data migration approach confirmed** — Runtime conversion layer via `lib/ai/message-conversion.ts` ✅
- **Edit flow compatible** — `sendMessage` with `messageId` supports edits ✅
- **Regenerate options compatible** — Same `{ body: {...} }` structure works ✅

### Decisions Made
- ✅ Use incremental migration (v4 → v5 → v6)
- ✅ Use official codemods for automatic transformations
- ✅ Create feature branch for isolated testing
- ✅ Upgrade OpenRouter provider to v2.x alongside AI SDK v6

---

## Implementation Plan

### ✅ Step 0: Open Questions Resolved

All critical unknowns have been researched and answered:

**Answers:**
- [x] ❌ — SDK does NOT auto-convert v4 message format to v5 parts → **Use runtime conversion layer**
- [x] ✅ — Convex schema can remain unchanged (already stores `parts: v.any()`)
- [x] ✅ — `DefaultChatTransport` supports per-request body via `sendMessage` options
- [x] ✅ — Multi-chat hook compatible with transport architecture (needs update)

**Implementation Approach:**
1. Use runtime conversion layer for immediate compatibility (no data migration blocking)
2. Convex schema unchanged initially; optional v5 schema migration later
3. Per-request body via `sendMessage({ text }, { body: {...} })`
4. Multi-chat hook needs transport instances per useChat

---

### Pre-Migration Checklist
- [x] **All open questions resolved** (Step 0 complete ✅)
- [ ] Create feature branch: `git checkout -b feat/ai-sdk-v6-upgrade`
- [ ] Create `lib/ai/message-conversion.ts` (format conversion utilities)
- [ ] Commit current state
- [ ] Review this plan with team (if applicable)

### Step 1: Upgrade to AI SDK v5 (Major)

```bash
# 1. Install v5 packages
bun add ai@5 @ai-sdk/react@2 @ai-sdk/anthropic@2 @ai-sdk/google@2 \
  @ai-sdk/mistral@2 @ai-sdk/openai@2 @ai-sdk/perplexity@2 @ai-sdk/xai@2 \
  @ai-sdk/provider@2 @ai-sdk/provider-utils@3

# 2. Run v5 codemods
npx @ai-sdk/codemod v5

# 3. Verify and fix remaining issues
bun run typecheck
bun run lint
```

**Manual Changes Required for v5:**

1. **`app/api/chat/route.ts`**
   - Change `toDataStreamResponse()` → `toUIMessageStreamResponse()`
   - Change `getErrorMessage` → `onError`
   - Change `maxSteps: 10` → `stopWhen: stepCountIs(10)` (import from 'ai')

2. **`app/components/chat/use-chat-core.ts`**
   - Add manual input state: `const [input, setInput] = useState(draftValue)`
   - Use `DefaultChatTransport` for API configuration
   - Replace `append` calls with `sendMessage` (edit flow uses `messageId` parameter)
   - Replace `reload` calls with `regenerate` (same options structure)
   - Replace `handleSubmit` with `sendMessage({ text: input }, options)`
   - Update `initialMessages` → `messages` prop
   - Update `onFinish: (m)` → `onFinish: ({ message, isAbort, isError })`

3. **Create `lib/ai/message-conversion.ts`**
   - Add `isV5Format()` type guard
   - Add `convertV4ToV5Message()` conversion function
   - Add `ensureV5Format()` batch conversion

4. **`lib/chat-store/messages/api.ts`**
   - Update `Message` → `UIMessage` type
   - Import and apply `ensureV5Format()` on read operations

5. **Message rendering components**
   - Update `part.reasoning` → `part.text` for reasoning parts
   - Use `isStaticToolUIPart()` helper for tool parts (v6)
   - Update file part properties: `contentType` → `mediaType`, `name` → `filename`

6. **`lib/openproviders/index.ts`**
   - Update `LanguageModelV1` → `LanguageModelV2` imports

**Commit:** `chore: upgrade to AI SDK v5`

### Step 2: Upgrade to AI SDK v6 (Minor)

```bash
# 1. Install v6 packages
bun add ai@6 @ai-sdk/react@latest @ai-sdk/anthropic@3 @ai-sdk/google@3 \
  @ai-sdk/mistral@3 @ai-sdk/openai@3 @ai-sdk/perplexity@3 @ai-sdk/xai@3 \
  @ai-sdk/provider@3 @ai-sdk/provider-utils@4 @openrouter/ai-sdk-provider@2

# 2. Run v6 codemods
npx @ai-sdk/codemod v6

# 3. Verify and fix remaining issues
bun run typecheck
bun run lint
```

**Manual Changes Required for v6:**

1. **`lib/openproviders/index.ts`**
   - Update `LanguageModelV2` → `LanguageModelV3` imports

2. **Any `convertToModelMessages` calls**
   - Add `await` (now async)

3. **Tool helper function renames**
   - `isToolUIPart` → `isStaticToolUIPart`
   - `getToolName` → `getStaticToolName`

**Commit:** `chore: upgrade to AI SDK v6`

### Step 3: Testing & Verification

- [ ] `bun run dev` — App starts without errors
- [ ] Send a chat message — Streaming works
- [ ] Check reasoning display — Shows correctly
- [ ] Test file attachments — Upload and display work
- [ ] Test error scenarios — Rate limit, API errors show correctly
- [ ] Test multi-model view — All providers work
- [ ] Test regenerate — Works correctly
- [ ] Test edit message — Works correctly

### Step 4: Cleanup & Merge

- [ ] Remove any deprecated code paths
- [ ] Update CLAUDE.md if patterns changed
- [ ] Create PR with summary of changes
- [ ] Merge to main after review

---

## Estimated Effort

| Phase | Effort | Risk | Status |
|-------|--------|------|--------|
| **Step 0a: Initial Questions** | **2-4 hours** | **None** | ✅ Complete |
| **Step 0b: Additional Questions** | **2-4 hours** | **None** | ✅ **Complete** |
| Step 1: v4 → v5 | 4-6 hours | Medium (major API changes) | ✅ **Ready** |
| Step 2: v5 → v6 | 1-2 hours | Low (minor changes) | ✅ **Ready** |
| Step 3: Testing | 2-3 hours | Low (clear test cases) | ✅ **Ready** |
| **Total Remaining** | **8-12 hours** | | |

---

## References

- [AI SDK v4 → v5 Migration Guide](https://ai-sdk.dev/docs/migration-guides/migration-guide-5-0)
- [AI SDK v5 → v6 Migration Guide](https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0)
- [AI SDK Codemods](https://github.com/vercel/ai/tree/main/packages/codemod)
- [@openrouter/ai-sdk-provider](https://github.com/OpenRouterTeam/ai-sdk-provider)
