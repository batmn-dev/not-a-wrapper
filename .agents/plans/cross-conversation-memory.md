# Cross-Conversation Memory Persistence

> **Status**: Draft — Ready for Review  
> **Priority**: P1 (Important)  
> **Last Updated**: February 7, 2026  
> **Related**: Competitive Feature Analysis Card 6, Strategic Recommendation #7

---

## 1. Problem Statement

Users cannot carry context between conversations. Every new chat starts from zero — the AI has no knowledge of the user's preferences, past decisions, technical stack, or personal facts. This forces users to repeat themselves across sessions.

Both ChatGPT and Claude offer cross-conversation memory. ChatGPT stores memories automatically and via explicit commands; users can view, edit, and delete them. Claude Pro has similar persistence. Neither competitor's memory works across models — their memories are locked to their respective providers.

Not A Wrapper's unique opportunity: **memory that works across all 100+ models and 10 providers**. A user's context travels with them regardless of which AI they're talking to. This reinforces the "universal AI interface" positioning and creates meaningful switching cost.

### Current State

- `systemPrompt` field on the `users` table (`convex/schema.ts` line 30) is the closest analog — manual custom instructions the user writes themselves.
- No automatic fact extraction, no explicit memory commands, no memory storage table.
- `app/api/chat/route.ts` injects `effectiveSystemPrompt` at line 110 — this is where memories would be injected.
- Convex supports built-in vector search (RAG) per ADR-001, but no vector indexes are currently defined.
- The `tools` parameter in `streamText()` is empty (`{} as ToolSet` at line 147) — memory tools would be added here.

### Sub-Problems

| Sub-Problem | Question |
|-------------|----------|
| **Creation** | How are memories created and stored? |
| **Retrieval** | How are relevant memories selected and injected into chat context? |
| **Management** | How do users view, edit, and delete their memories? |

---

## 2. Design Constraints

1. **Provider-agnostic**: Memories must work identically regardless of which model the user selects. Memory storage and retrieval happen at the application layer, not the model layer.
2. **Convex-native**: All storage must use Convex tables and indexes. No Postgres, no Redis, no external vector databases.
3. **Serverless-compatible**: The chat API runs on Vercel serverless functions (`maxDuration = 60`). No long-running background processes. All memory operations must complete within the request lifecycle or use Convex scheduled functions.
4. **Privacy-first**: Users must have full control — view, edit, delete any memory. No hidden or irrevocable memory storage. Memories must be scoped to the authenticated user.
5. **BYOK-compatible**: Both platform-key and BYOK users get memory. Memory creation/retrieval uses application-level logic, not provider-specific features.
6. **Authenticated-only**: Memory requires a Convex user record. Anonymous/guest users do not get memory (they lack persistent identity).
7. **Token-budget-aware**: Injected memories consume system prompt tokens. The injection strategy must respect model context window limits, especially for smaller models (e.g., 8K context).

---

## 3. Option A — Simple Full-Injection Memory

### Philosophy

The simplest viable approach. Store memories as plain text records. On each chat request, fetch all of the user's memories and inject them into the system prompt. The AI creates memories via a tool call.

### Storage Schema

```typescript
// Addition to convex/schema.ts
memories: defineTable({
  userId: v.id("users"),
  content: v.string(),        // "User prefers TypeScript over JavaScript"
  source: v.union(
    v.literal("tool"),        // AI called the memoryTool
    v.literal("manual")       // User created via management UI
  ),
  active: v.boolean(),        // Soft-delete / toggle
  createdAt: v.number(),      // Unix timestamp
  updatedAt: v.optional(v.number()),
})
  .index("by_user", ["userId"])
  .index("by_user_active", ["userId", "active"])
```

### Creation Mechanism

**Tool-based extraction only.** Define a `save_memory` tool in the AI SDK tool set. The model decides when a fact is worth remembering and calls the tool.

```typescript
// In app/api/chat/route.ts — added to tools parameter
save_memory: {
  description: "Save an important fact about the user for future conversations. Use when the user shares preferences, personal details, project context, or explicit 'remember this' requests.",
  parameters: z.object({
    content: z.string().describe("The fact to remember, written as a concise third-person statement"),
  }),
  execute: async ({ content }) => {
    await saveMemory({ userId, content, source: "tool" })
    return { saved: true, content }
  },
}
```

The system prompt includes an instruction: "When the user shares important facts about themselves, their preferences, or their projects, use the save_memory tool to store them for future conversations."

### Retrieval Strategy

**Full injection.** Before calling `streamText()`, query all active memories for the user and append them to the system prompt.

```typescript
// In app/api/chat/route.ts
const memories = await fetchUserMemories(convexToken, userId)  // Returns Memory[]
const memoryBlock = memories.length > 0
  ? `\n\n## User Memories\nThe following facts are known about this user from previous conversations:\n${memories.map(m => `- ${m.content}`).join("\n")}`
  : ""
const effectiveSystemPrompt = (systemPrompt || SYSTEM_PROMPT_DEFAULT) + memoryBlock
```

### User Management UI

Add a **"Memory"** tab to the Settings dialog (`app/components/layout/settings/settings-content.tsx`). The tab contains:

- List of all memories with content, source badge (tool/manual), and creation date
- Edit button per memory (inline editing)
- Delete button per memory (with confirmation)
- "Add Memory" button for manual entries
- "Clear All" button with confirmation
- Toggle to enable/disable memory feature globally

### Files to Modify

| File | Change |
|------|--------|
| `convex/schema.ts` | Add `memories` table |
| New `convex/memories.ts` | CRUD mutations + queries |
| `app/api/chat/route.ts` | Add `save_memory` tool, inject memories into system prompt |
| `app/components/layout/settings/settings-content.tsx` | Add Memory tab |
| New `app/components/layout/settings/memory/` | Memory management components |
| `lib/config.ts` | Add `MAX_MEMORIES` and `MEMORY_FEATURE_ENABLED` constants |

### Pros

| Category | Assessment |
|----------|------------|
| **Implementation complexity** | Very low. Estimated 3-5 days. No embeddings, no vector search, no background jobs. |
| **Correctness** | High. All memories are always present — no risk of relevant memories being missed by a ranking algorithm. |
| **Debugging** | Easy. The full memory list is deterministic and inspectable. |
| **User mental model** | Simple. "The AI remembers everything I've told it." |
| **Privacy** | Clear. Users see exactly what's stored. Full CRUD control. |

### Cons

| Category | Assessment |
|----------|------------|
| **Scalability** | Poor. 100+ memories could consume 2,000-5,000 tokens of system prompt, reducing available context for the conversation itself. Models with small context windows (8K) would be severely impacted. |
| **Relevance** | No filtering. Memories about "prefers dark roast coffee" are injected into a coding conversation. This wastes tokens and can confuse models. |
| **Query performance** | O(n) — fetches every memory on every request. Fine for <100 memories; becomes a bottleneck at scale. |
| **Token cost** | Higher per-request cost. Every API call pays for all memories in the system prompt, even irrelevant ones. BYOK users pay this directly. |
| **Intelligence** | The model must decide what to remember. Different models have varying quality of judgment about what constitutes a "memory-worthy" fact, leading to inconsistent behavior across providers. |

### Estimated Timeline

| Phase | Duration | Scope |
|-------|----------|-------|
| Schema + CRUD | 1 day | Convex table, mutations, queries |
| Tool + injection | 1 day | `save_memory` tool, system prompt injection |
| Settings UI | 2 days | Memory tab with list, edit, delete, add |
| Testing + polish | 1 day | Edge cases, token budget, error handling |
| **Total** | **~5 days** | |

---

## 4. Option B — Semantic RAG Memory (Recommended)

### Philosophy

Use Convex's built-in vector search to store memories with embeddings. On each chat request, perform a semantic search against the current conversation to retrieve only the most relevant memories. This scales to thousands of memories while keeping token usage minimal and context relevant.

### Storage Schema

```typescript
// Addition to convex/schema.ts
memories: defineTable({
  userId: v.id("users"),
  content: v.string(),        // "User is building a SaaS with Next.js and Convex"
  embedding: v.array(v.float64()),  // Vector embedding for semantic search
  source: v.union(
    v.literal("tool"),        // AI called the memoryTool
    v.literal("manual")       // User created via management UI
  ),
  category: v.optional(v.string()),  // "preference" | "fact" | "project" | "instruction"
  active: v.boolean(),
  accessCount: v.optional(v.number()),  // Track how often a memory is retrieved
  lastAccessedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
})
  .index("by_user", ["userId"])
  .index("by_user_active", ["userId", "active"])
  .vectorIndex("by_embedding", {
    vectorField: "embedding",
    dimensions: 1536,          // OpenAI text-embedding-3-small dimension
    filterFields: ["userId", "active"],
  })
```

### Creation Mechanism

**Dual approach: tool-based + explicit command.**

1. **Tool-based**: Same `save_memory` tool as Option A, but the Convex mutation also generates an embedding before storing.

```typescript
// convex/memories.ts
export const create = mutation({
  args: {
    content: v.string(),
    source: v.union(v.literal("tool"), v.literal("manual")),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique()
    if (!user) throw new Error("User not found")

    // Check memory limit
    const count = await ctx.db
      .query("memories")
      .withIndex("by_user_active", (q) => q.eq("userId", user._id).eq("active", true))
      .collect()
    if (count.length >= MAX_MEMORIES) {
      throw new Error("Memory limit reached")
    }

    // Generate embedding via Convex action (calls OpenAI embeddings API)
    const embedding = await ctx.scheduler.runAfter(0, internal.memories.generateEmbedding, {
      memoryId, content: args.content,
    })

    return await ctx.db.insert("memories", {
      userId: user._id,
      content: args.content,
      embedding: [],  // Populated by scheduled action
      source: args.source,
      category: args.category,
      active: true,
      accessCount: 0,
      createdAt: Date.now(),
    })
  },
})
```

2. **Explicit command**: The system prompt instructs the model to recognize phrases like "remember this", "keep in mind", or "always do X" as memory triggers. No special syntax needed — the model calls `save_memory` in response.

3. **Deduplication**: Before saving, perform a vector search for similar existing memories. If similarity > 0.92, update the existing memory instead of creating a duplicate.

### Retrieval Strategy

**Semantic search with recency boost.** On each chat request:

1. Extract a search query from the last 2-3 user messages (concatenated).
2. Generate an embedding for the query.
3. Vector search the `memories` table filtered by `userId` and `active: true`, retrieving top-K (K=10) results.
4. Apply a recency score bonus: memories accessed or created recently get a slight boost.
5. Inject the top memories (up to a token budget of ~500 tokens) into the system prompt.

```typescript
// New: lib/memory/retrieve.ts
export async function retrieveRelevantMemories(
  convexToken: string,
  userId: string,
  recentMessages: string,
  maxTokens: number = 500,
): Promise<Memory[]> {
  // 1. Generate embedding for recent messages
  const queryEmbedding = await generateEmbedding(recentMessages)

  // 2. Vector search in Convex
  const results = await convexClient.query(api.memories.searchSimilar, {
    embedding: queryEmbedding,
    limit: 10,
  })

  // 3. Apply token budget
  return truncateToTokenBudget(results, maxTokens)
}
```

```typescript
// In app/api/chat/route.ts (modified)
const recentUserMessages = messages
  .filter(m => m.role === "user")
  .slice(-3)
  .map(m => typeof m.content === "string" ? m.content : "")
  .join(" ")

const memories = isAuthenticated
  ? await retrieveRelevantMemories(convexToken, userId, recentUserMessages)
  : []

const memoryBlock = memories.length > 0
  ? `\n\n## Relevant Context from Previous Conversations\n${memories.map(m => `- ${m.content}`).join("\n")}\n\nUse these memories when relevant. Don't mention that you're reading from stored memories unless the user asks.`
  : ""
```

### Embedding Generation

Embeddings are generated using a Convex action (server-side) that calls an embedding API. This keeps the embedding key server-side and works for all users (BYOK and platform-key alike).

```typescript
// convex/memories.ts
export const generateEmbedding = internalAction({
  args: { memoryId: v.id("memories"), content: v.string() },
  handler: async (ctx, { memoryId, content }) => {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: content,
        model: "text-embedding-3-small",
      }),
    })
    const data = await response.json()
    const embedding = data.data[0].embedding

    await ctx.runMutation(internal.memories.updateEmbedding, {
      memoryId,
      embedding,
    })
  },
})
```

**Important**: Embedding generation uses a **platform-level** OpenAI key (environment variable), not the user's BYOK key. This is a small infrastructure cost borne by the platform. The embedding model (`text-embedding-3-small`) costs ~$0.02 per 1M tokens — negligible.

### User Management UI

Add a **"Memory"** tab to the Settings dialog, similar to Option A but with enhancements:

**Memory List View:**
- Card-based layout showing each memory's content, category badge, source badge, creation date, and access count
- Inline edit (click to edit content, save on blur/Enter)
- Delete with confirmation
- Search/filter bar to find specific memories
- Category filter dropdown (All, Preferences, Facts, Projects, Instructions)
- Sort by: newest, oldest, most accessed

**Memory Creation:**
- "Add Memory" button opens a form with content input and optional category selector
- Embedding is generated automatically on save

**Global Controls:**
- Toggle: "Enable AI Memory" (on/off)
- "Pause Memory" — temporarily stop new memory creation without deleting existing ones
- "Clear All Memories" with confirmation modal
- Memory count / limit indicator (e.g., "47 / 200 memories")

**Inline Chat Indicator** (optional enhancement):
- When memories are injected into a chat request, show a subtle indicator near the model selector: "3 memories active"
- Clicking it opens a popover listing which memories were used for this conversation

### Files to Modify

| File | Change |
|------|--------|
| `convex/schema.ts` | Add `memories` table with vector index |
| New `convex/memories.ts` | CRUD mutations, vector search query, embedding action |
| `app/api/chat/route.ts` | Add `save_memory` tool, retrieve + inject memories |
| New `lib/memory/retrieve.ts` | Embedding generation, retrieval logic, token budgeting |
| `app/components/layout/settings/settings-content.tsx` | Add Memory tab |
| New `app/components/layout/settings/memory/` | Memory management components (list, editor, controls) |
| `lib/config.ts` | Add memory constants (`MAX_MEMORIES`, `MEMORY_TOKEN_BUDGET`, `MEMORY_SIMILARITY_THRESHOLD`) |
| `convex/users.ts` or `convex/userPreferences.ts` | Add `memoryEnabled` preference field |

### Pros

| Category | Assessment |
|----------|------------|
| **Scalability** | Excellent. Vector search is O(log n). Users can store thousands of memories without impacting request latency. Only top-K relevant memories are injected. |
| **Relevance** | High. Semantic search returns memories contextually related to the current conversation. Coding chats get coding memories; personal chats get personal facts. |
| **Token efficiency** | Good. Fixed token budget (~500 tokens) regardless of total memory count. BYOK users don't pay for irrelevant memories. |
| **User experience** | Strong. Categories + search make the management UI scalable. Access count shows which memories are actually useful. |
| **Privacy** | Full CRUD control. Users see all memories, can edit/delete, can disable entirely. |
| **Cross-model** | Native. Memories stored at application layer. Works identically across all 100+ models. The semantic search operates independently of the chat model. |
| **Convex-native** | Uses Convex's built-in vector search — no external vector DB needed. Aligns with ADR-001 rationale. |

### Cons

| Category | Assessment |
|----------|------------|
| **Implementation complexity** | Moderate. Requires embedding generation pipeline, vector index setup, and token budgeting logic. More moving parts than Option A. |
| **Embedding dependency** | Requires an embedding API (OpenAI `text-embedding-3-small`). This is a platform cost (~$0.02/1M tokens, negligible) but introduces a dependency on OpenAI even for users who only use Anthropic or other providers. |
| **Retrieval latency** | Adds ~100-200ms per chat request for embedding generation + vector search. Acceptable but not zero. |
| **Cold start** | New memories have no embedding until the Convex action completes (few hundred ms). Memories saved and immediately queried in the same request may not have embeddings yet. Mitigation: use `ctx.scheduler.runAfter(0, ...)` for near-instant scheduling. |
| **Semantic gaps** | Vector search can miss relevant memories if the query and memory are semantically distant but logically connected. Example: "What's my tech stack?" might not match "User works at Acme Corp" even though both are relevant. |
| **Cost** | Small platform cost for embedding generation. At scale (100K users, 100 memories each, 10 chats/day), embedding costs are ~$6/month for retrieval + $0.20/month for creation. Negligible but nonzero. |

### Estimated Timeline

| Phase | Duration | Scope |
|-------|----------|-------|
| Schema + vector index | 1 day | Convex table, indexes, embedding action |
| Memory CRUD | 1 day | Create, read, update, delete mutations with auth |
| Embedding pipeline | 1 day | Generate embeddings, deduplication logic |
| Retrieval + injection | 1.5 days | Vector search, token budgeting, system prompt injection |
| `save_memory` tool | 0.5 days | Tool definition, system prompt instructions |
| Settings UI — Memory tab | 2 days | List, edit, delete, add, search, filters |
| Settings UI — Global controls | 0.5 days | Enable/disable toggle, clear all, limit indicator |
| Testing + polish | 1.5 days | Cross-model testing, edge cases, token limits, latency measurement |
| **Total** | **~10 days (2 weeks)** | |

---

## 5. Option C — Structured Memory with Tiered Retrieval

### Philosophy

The most feature-rich approach. Memories are strongly typed with categories, importance levels, and expiration. Retrieval uses a tiered strategy: always-inject "core" memories + semantically searched "contextual" memories. Includes automatic memory extraction via post-processing in addition to tool-based creation.

### Storage Schema

```typescript
// Addition to convex/schema.ts
memories: defineTable({
  userId: v.id("users"),
  content: v.string(),
  embedding: v.array(v.float64()),
  source: v.union(
    v.literal("tool"),           // AI called the memoryTool
    v.literal("auto"),           // Automatically extracted via post-processing
    v.literal("manual")          // User created via management UI
  ),
  category: v.union(
    v.literal("identity"),       // Name, role, location
    v.literal("preference"),     // Likes, dislikes, style preferences
    v.literal("project"),        // Current projects, tech stacks
    v.literal("instruction"),    // "Always use TypeScript", "Be concise"
    v.literal("fact"),           // General facts about the user
  ),
  importance: v.union(
    v.literal("core"),           // Always injected (name, role, key preferences)
    v.literal("contextual"),     // Injected when semantically relevant
  ),
  confidence: v.optional(v.number()),  // 0-1, how confident the extraction was
  expiresAt: v.optional(v.number()),   // Optional TTL for time-sensitive facts
  chatId: v.optional(v.id("chats")),   // Which chat this memory came from
  active: v.boolean(),
  accessCount: v.optional(v.number()),
  lastAccessedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
})
  .index("by_user", ["userId"])
  .index("by_user_active", ["userId", "active"])
  .index("by_user_importance", ["userId", "importance"])
  .index("by_user_category", ["userId", "category"])
  .vectorIndex("by_embedding", {
    vectorField: "embedding",
    dimensions: 1536,
    filterFields: ["userId", "active", "importance"],
  })

// Track memory operations for analytics
memoryEvents: defineTable({
  userId: v.id("users"),
  memoryId: v.id("memories"),
  event: v.union(
    v.literal("created"),
    v.literal("accessed"),
    v.literal("edited"),
    v.literal("deleted"),
    v.literal("promoted"),    // contextual → core
    v.literal("demoted"),     // core → contextual
  ),
  chatId: v.optional(v.id("chats")),
  createdAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_memory", ["memoryId"])
```

### Creation Mechanism

**Three pathways:**

1. **Tool-based** (same as Options A/B): Model calls `save_memory` during conversation.

2. **Automatic extraction** (new): After each conversation turn, a Convex scheduled function analyzes the assistant's response to extract potential memories. This runs as a lightweight post-processing step.

```typescript
// convex/memories.ts
export const extractMemories = internalAction({
  args: {
    userId: v.id("users"),
    chatId: v.id("chats"),
    userMessage: v.string(),
    assistantResponse: v.string(),
  },
  handler: async (ctx, args) => {
    // Use a cheap, fast model (e.g., gpt-4.1-nano) to extract facts
    const extraction = await callExtractionModel({
      prompt: `Extract factual statements about the user from this exchange. Only extract clear, explicit facts — not inferences. Return JSON array of {content, category, importance}.`,
      userMessage: args.userMessage,
      assistantResponse: args.assistantResponse,
    })

    for (const memory of extraction) {
      // Deduplicate against existing memories
      // Generate embedding
      // Insert with source: "auto", confidence score
    }
  },
})
```

3. **Manual** (same as Options A/B): User adds via the management UI.

### Retrieval Strategy

**Tiered injection:**

1. **Core memories** (always injected): Query `by_user_importance` index for `importance: "core"`. These are identity facts, key preferences, and standing instructions. Expected to be 5-15 items (~200 tokens).

2. **Contextual memories** (semantically searched): Vector search for `importance: "contextual"` memories, returning top-K relevant to the current conversation. Token budget: ~300 tokens.

3. **Token budget management**: Core memories get priority. Remaining budget goes to contextual memories. If core memories alone exceed the budget, oldest/least-accessed core memories are excluded.

```typescript
// lib/memory/retrieve.ts
export async function retrieveMemories(
  convexToken: string,
  recentMessages: string,
  tokenBudget: number = 500,
): Promise<{ core: Memory[], contextual: Memory[] }> {
  // 1. Always fetch core memories
  const core = await fetchCoreMemories(convexToken)
  const coreTokens = estimateMemoryTokens(core)

  // 2. Semantic search for contextual (with remaining budget)
  const remainingBudget = tokenBudget - coreTokens
  const contextual = remainingBudget > 50
    ? await searchContextualMemories(convexToken, recentMessages, remainingBudget)
    : []

  return { core, contextual }
}
```

### User Management UI

A full-featured memory manager as a **dedicated page** (not just a settings tab):

**Memory Dashboard (`/settings/memory` or modal):**
- Summary stats: total memories, core vs contextual breakdown, category distribution
- Memory timeline showing when memories were created
- Usage analytics: most-accessed memories, memories created per week

**Memory List:**
- Grouped by category with collapsible sections
- Each memory card shows: content, category, importance level (core/contextual), source, confidence (for auto-extracted), access count, creation date
- Inline editing for content and category
- Importance toggle (promote contextual → core, or demote)
- Delete with undo (soft-delete with 30-day recovery)
- Bulk selection for batch delete or category change

**Memory Creation:**
- "Add Memory" form with content, category picker, importance selector
- "Import from Chat" — select a past conversation and extract memories from it retroactively

**Filtering & Search:**
- Full-text search across memory content
- Filter by: category, importance, source, date range
- Sort by: newest, oldest, most accessed, recently accessed

**Global Controls:**
- Master toggle: Enable/disable memory
- Per-category toggles: Enable memory for specific categories only
- Auto-extraction toggle: Enable/disable automatic memory extraction
- Memory limit slider (e.g., 50-500 memories)
- Export memories as JSON
- Import memories from JSON

**In-Chat Indicators:**
- Badge on the chat input showing "N memories active"
- Expandable popover listing which memories were injected
- "Remember this" button on user messages (manual trigger)
- Memory creation toast when the AI saves a new memory

### Files to Modify

| File | Change |
|------|--------|
| `convex/schema.ts` | Add `memories` and `memoryEvents` tables with vector + standard indexes |
| New `convex/memories.ts` | Full CRUD, vector search, embedding generation, auto-extraction action, analytics queries |
| `app/api/chat/route.ts` | Add `save_memory` tool, tiered retrieval, post-turn extraction scheduling |
| New `lib/memory/` | `retrieve.ts`, `extract.ts`, `token-budget.ts`, `types.ts` |
| `app/components/layout/settings/settings-content.tsx` | Add Memory tab |
| New `app/components/layout/settings/memory/` | Dashboard, list, editor, controls, analytics, import/export |
| New `app/components/chat/memory-indicator.tsx` | In-chat memory badge + popover |
| `app/components/chat/chat-input/` | Add "Remember this" affordance |
| `lib/config.ts` | Memory constants (limits, budgets, thresholds) |
| `convex/userPreferences.ts` or `convex/users.ts` | Memory preference fields (enabled, autoExtract, perCategoryToggles) |
| New `app/api/memory/route.ts` | API route for embedding generation (if not done entirely in Convex) |

### Pros

| Category | Assessment |
|----------|------------|
| **Feature completeness** | Best-in-class. Exceeds both ChatGPT and Claude memory capabilities. Category system, importance levels, auto-extraction, and analytics are beyond competitor offerings. |
| **Scalability** | Excellent. Tiered retrieval means core memories are always fast (index lookup) and contextual memories use vector search. Can handle thousands of memories. |
| **Relevance** | Highest. Core memories ensure critical context is never missed. Semantic search handles long-tail context. Category-based filtering adds another relevance dimension. |
| **User control** | Maximum. Per-category toggles, importance management, confidence scores for auto-extracted items, export/import, and detailed analytics give users full agency. |
| **Discoverability** | Strong. In-chat indicators make memory visible and trustworthy. Users can see what the AI "knows" in real time. |
| **Strategic value** | Highest. This level of memory management would be a genuine differentiator. No competitor offers category-based, importance-tiered, cross-model memory with this level of user control. |

### Cons

| Category | Assessment |
|----------|------------|
| **Implementation complexity** | High. Estimated 4-5 weeks. Auto-extraction requires a secondary model call per conversation turn. Tiered retrieval has more edge cases. The UI is substantially more complex than Options A/B. |
| **Cost** | Higher platform cost. Auto-extraction runs a model call after every assistant response (~$0.001/extraction using gpt-4.1-nano, but at scale: 100K users × 10 chats/day × $0.001 = $1,000/day). This must be gated behind a paid plan. |
| **Latency** | Auto-extraction adds post-processing time. The extraction runs asynchronously via Convex scheduled functions, so it doesn't block the response, but there's a delay before new auto-memories are available. |
| **Complexity for users** | The management UI has many concepts (categories, importance, confidence, auto vs manual). Risk of overwhelming users who just want "the AI remembers stuff." |
| **Accuracy risk** | Automatic extraction can produce low-quality or incorrect memories. Even with confidence scores, bad memories injected into future conversations compound errors. Requires careful prompt engineering and user review. |
| **Maintenance burden** | More schema, more code, more edge cases. The extraction model prompt needs ongoing tuning. Category definitions may need to evolve. |
| **BYOK cost impact** | Auto-extraction uses a platform key (not BYOK), but increases platform infrastructure costs. Must be factored into pricing tiers. |

### Estimated Timeline

| Phase | Duration | Scope |
|-------|----------|-------|
| Schema + indexes | 1.5 days | Both tables, vector index, standard indexes |
| Memory CRUD + auth | 1.5 days | Create, read, update, delete, soft-delete with all permission checks |
| Embedding pipeline | 1 day | Generate embeddings, deduplication, similarity check |
| Tiered retrieval | 2 days | Core fetch, contextual search, token budgeting, recency scoring |
| `save_memory` tool | 0.5 days | Tool definition, system prompt instructions |
| Auto-extraction | 3 days | Extraction model prompt, scheduled function, confidence scoring, dedup |
| Settings UI — Memory list | 3 days | Card layout, inline editing, category/importance controls, search, filters |
| Settings UI — Dashboard | 1.5 days | Stats, analytics, timeline |
| Settings UI — Global controls | 1 day | Toggles, import/export, limit management |
| In-chat indicators | 1.5 days | Memory badge, popover, "remember this" button |
| Testing + polish | 3 days | Cross-model testing, extraction quality, edge cases, performance |
| **Total** | **~20 days (4 weeks)** | |

---

## 6. Comparison Matrix

| Dimension | Option A (Simple) | Option B (Semantic RAG) | Option C (Structured) |
|-----------|-------------------|-------------------------|----------------------|
| **Implementation time** | ~5 days | ~10 days | ~20 days |
| **Memory creation** | Tool only | Tool + explicit commands | Tool + auto-extraction + manual |
| **Retrieval strategy** | Full injection (all) | Semantic search (top-K) | Tiered (core always + semantic contextual) |
| **Max effective memories** | ~50-100 before token bloat | ~1,000+ | ~5,000+ |
| **Token efficiency** | Poor (scales with memory count) | Good (fixed budget) | Best (tiered budget) |
| **Relevance** | None (all injected) | High (semantic match) | Highest (core + semantic) |
| **User management** | Basic list | List + search + filters | Full dashboard + analytics |
| **Platform cost** | Near zero | ~$6/month at 100K users | ~$30K/month at 100K users (auto-extraction) |
| **Scalability** | Limited | Excellent | Excellent |
| **UX complexity** | Simple | Moderate | High (risk of overwhelming) |
| **Competitive positioning** | Parity (basic memory) | Differentiated (cross-model semantic) | Best-in-class (exceeds competitors) |
| **Maintenance burden** | Low | Moderate | High |

---

## 7. Recommendation

**Option B (Semantic RAG Memory) is the recommended approach.**

### Rationale

1. **Right complexity-to-value ratio.** Option B delivers the core value proposition — intelligent, cross-model memory with semantic relevance — without the operational complexity and cost of Option C's auto-extraction pipeline. It's a 2-week investment that produces a genuinely differentiated feature.

2. **Scalable from day one.** Unlike Option A, which breaks down at ~100 memories, Option B handles thousands of memories with consistent performance and token usage. Users don't need to manually curate their memory bank to keep it working well.

3. **Leverages Convex's strengths.** Vector search is built into Convex (per ADR-001). This approach exercises a capability that's already part of the platform decision. No external vector database needed.

4. **Upgradeable to Option C.** The schema and retrieval logic from Option B form a subset of Option C. If demand warrants it, auto-extraction, importance tiers, and the analytics dashboard can be added incrementally. The migration path is additive, not rewrite.

5. **Privacy-respectable.** Only the tool-based creation path (the AI decides to save) and manual creation exist. There's no hidden auto-extraction that might store things users didn't intend. This is more trustworthy than Option C's auto-extraction, which requires careful prompt engineering to avoid overreach.

6. **Sustainable cost.** Embedding generation via `text-embedding-3-small` is negligible ($0.02/1M tokens). There's no per-turn model call for extraction like Option C requires. This keeps the feature viable for all plan tiers, including free (with a lower memory limit).

### Recommended Implementation Order

| Sprint | Scope | Duration |
|--------|-------|----------|
| **Sprint 1** | Schema, CRUD, embedding pipeline, basic injection (Option A-level, works without vector search) | 3 days |
| **Sprint 2** | Vector search retrieval, token budgeting, `save_memory` tool | 2.5 days |
| **Sprint 3** | Settings UI — Memory tab with list, edit, delete, search | 2.5 days |
| **Sprint 4** | Polish — deduplication, memory preference toggle, testing across models | 2 days |

### Plan Tier Recommendations

| Tier | Memory Limit | Feature Access |
|------|-------------|----------------|
| Free (authenticated) | 20 memories | Manual creation only, basic management UI |
| Pro | 200 memories | Tool-based + manual creation, full management UI, categories |
| Enterprise (future) | 1,000 memories | All Pro features + export/import, team-shared memories |

### Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Embedding API downtime | Fallback: store memory without embedding, use full-text match as fallback retrieval |
| Model calls `save_memory` too aggressively | Rate-limit tool calls (max 3 per conversation turn), add "memory saved" indicator so user can review |
| Irrelevant memories injected | Token budget cap (500 tokens max), similarity threshold (>0.7), user can disable per-memory |
| User stores sensitive data as memory | Memories are encrypted at rest via Convex. Add a warning in the UI: "Memories are included in your conversations with AI models." |
| BYOK users concerned about memories going to wrong provider | Memories are injected as system prompt text — they go to whichever model the user selects. Document this clearly. |

---

## 8. Appendix

### A. System Prompt Injection Format

```
You are a helpful AI assistant powered by Not A Wrapper...

[existing system prompt content]

## User Context (from Memory)
The following facts are known about this user from previous conversations. Use them when relevant. Do not mention that you are reading from stored memories unless the user asks about your memory.

- User's name is Alex and they work as a senior frontend engineer
- User prefers TypeScript with strict mode enabled
- User is building a SaaS product using Next.js 15 and Convex
- User prefers concise responses with code examples
- User's timezone is PST (UTC-8)

## Memory Tool
When the user shares important facts about themselves, their preferences, their projects, or explicit instructions for future conversations (e.g., "remember this", "always do X"), use the save_memory tool to store them. Write memories as concise, third-person factual statements.
```

### B. Convex Vector Search Example

```typescript
// Based on Convex documentation for vector search
export const searchSimilar = query({
  args: {
    embedding: v.array(v.float64()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { embedding, limit = 10 }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return []

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique()
    if (!user) return []

    const results = await ctx.db
      .query("memories")
      .withVectorIndex("by_embedding", (q) =>
        q.vector(embedding)
          .filter((q) =>
            q.and(
              q.eq("userId", user._id),
              q.eq("active", true)
            )
          )
      )
      .limit(limit)
      .collect()

    // Update access counts (via scheduled mutation to avoid query side-effects)
    // ctx.scheduler.runAfter(0, internal.memories.batchUpdateAccess, { ids: results.map(r => r._id) })

    return results
  },
})
```

### C. Token Budget Estimation

| Memory Count | Avg Tokens/Memory | Total Tokens | % of 8K Context | % of 128K Context |
|-------------|-------------------|--------------|-----------------|-------------------|
| 5 | 25 | 125 | 1.6% | 0.1% |
| 10 | 25 | 250 | 3.1% | 0.2% |
| 20 | 25 | 500 | 6.3% | 0.4% |
| 50 | 25 | 1,250 | 15.6% | 1.0% |
| 100 | 25 | 2,500 | 31.3% | 2.0% |

Option B's fixed budget of ~500 tokens (20 memories) is safe for all models including 8K context windows.

### D. Migration Path: Option B → Option C

If Option B proves successful and users want more, the upgrade path is:

1. Add `importance` field to memories table (schema migration, default all to `"contextual"`)
2. Add `memoryEvents` table for analytics
3. Build auto-extraction as an opt-in Convex scheduled function
4. Enhance Settings UI with dashboard and analytics
5. Add in-chat indicators

No data migration needed — existing memories gain new fields with defaults.

---

*Plan produced February 7, 2026. Based on competitive analysis, codebase review at current commit, and Convex documentation.*
