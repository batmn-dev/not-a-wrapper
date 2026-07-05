import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"
import { vToolInvocationStreamMetadata } from "./lib/messageMetadata"

const messageStatus = v.union(
  v.literal("submitted"),
  v.literal("streaming"),
  v.literal("completed"),
  v.literal("aborted"),
  v.literal("failed"),
  v.literal("awaiting_approval")
)

const generationRunStatus = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("streaming"),
  v.literal("awaiting_approval"),
  v.literal("completed"),
  v.literal("aborted"),
  v.literal("failed")
)

const toolSource = v.union(
  v.literal("builtin"),
  v.literal("third-party"),
  v.literal("mcp"),
  v.literal("platform")
)

const toolApprovalStatus = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("denied"),
  v.literal("expired")
)

export default defineSchema({
  users: defineTable({
    // Identity
    workosUserId: v.string(),
    email: v.string(),
    displayName: v.optional(v.string()),
    profileImage: v.optional(v.string()),

    // Status
    anonymous: v.optional(v.boolean()),
    premium: v.optional(v.boolean()),

    // Usage tracking - regular models
    messageCount: v.optional(v.number()),
    dailyMessageCount: v.optional(v.number()),
    dailyReset: v.optional(v.number()), // Unix timestamp

    // Usage tracking - pro models
    dailyProMessageCount: v.optional(v.number()),
    dailyProReset: v.optional(v.number()), // Unix timestamp

    // Activity
    lastActiveAt: v.optional(v.number()), // Unix timestamp
    lastSyncedFromWorkOSAt: v.optional(v.number()), // Unix timestamp
    workosUpdatedAt: v.optional(v.string()), // ISO timestamp from WorkOS
    deletedAt: v.optional(v.number()), // Unix timestamp
    disabledAt: v.optional(v.number()), // Unix timestamp

    // Preferences stored directly on user
    favoriteModels: v.optional(v.array(v.string())),
    systemPrompt: v.optional(v.string()),
  })
    .index("by_workos_user_id", ["workosUserId"])
    .index("by_email", ["email"]),

  chats: defineTable({
    userId: v.id("users"),
    title: v.optional(v.string()),
    model: v.optional(v.string()),
    systemPrompt: v.optional(v.string()),
    projectId: v.optional(v.id("projects")),
    public: v.boolean(),
    pinned: v.boolean(),
    pinnedAt: v.optional(v.number()), // Unix timestamp
    // Required so recency indexes never sort null keys to the tail (which would
    // hide chats from paginated history/sidebar windows). chats.create has
    // always set this; backfill: scripts/backfill-chat-updated-at.mjs.
    updatedAt: v.number(), // Unix timestamp — last activity (turn start)
  })
    .index("by_user", ["userId"])
    .index("by_user_pinned", ["userId", "pinned"])
    .index("by_user_updated", ["userId", "updatedAt"])
    // The history drawer's browse mode: pinned + non-pinned non-project chats
    // newest-first. Project chats are hidden from browse mode and must not
    // consume pagination slots; title search and project pages reach them
    // through their own reads.
    .index("by_user_project_updated", ["userId", "projectId", "updatedAt"])
    // The sidebar recency window: non-pinned, non-project chats newest-first.
    // Excluding pinned + project at the index level keeps every page full of
    // chats the "Chats" section actually shows, so pinned/project chats never
    // consume window slots (docs/sidebar-chat-list-streaming-plan.md commit 8).
    .index("by_user_pinned_project_updated", [
      "userId",
      "pinned",
      "projectId",
      "updatedAt",
    ])
    .index("by_project", ["projectId"])
    // Title-only full-history search, scoped per user via the userId filter
    // field. Lets history search reach chats outside the bounded sidebar window
    // (docs/sidebar-chat-list-streaming-plan.md commit 3).
    .searchIndex("by_title", {
      searchField: "title",
      filterFields: ["userId"],
    }),

  messages: defineTable({
    chatId: v.id("chats"),
    orderId: v.number(), // For ordering within a chat
    clientMessageId: v.optional(v.string()), // AI SDK/browser message id for reconciliation
    userId: v.optional(v.id("users")), // For user messages
    role: v.union(
      v.literal("user"),
      v.literal("assistant"),
      v.literal("system"),
      v.literal("data")
    ),
    content: v.string(),
    parts: v.any(), // AI SDK parts format
    attachments: v.optional(v.array(v.any())), // Deprecated; canonical runtime stores files in `parts`
    parentMessageId: v.optional(v.id("messages")),
    branchIndex: v.optional(v.number()),
    selected: v.optional(v.boolean()),
    // Sibling a regeneration placeholder forked from; the branch to restore
    // when the run dies before its first chunk
    regenerationSourceMessageId: v.optional(v.id("messages")),
    status: messageStatus,
    requestId: v.optional(v.string()),
    generationRunId: v.optional(v.id("generationRuns")),
    model: v.optional(v.string()),
    provider: v.optional(v.string()),
    finishReason: v.optional(v.string()),
    usage: v.optional(
      v.object({
        inputTokens: v.optional(v.number()),
        outputTokens: v.optional(v.number()),
        totalTokens: v.optional(v.number()),
      })
    ),
    error: v.optional(v.string()),
    metadata: v.optional(vToolInvocationStreamMetadata),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_chat", ["chatId"])
    .index("by_chat_role", ["chatId", "role"])
    .index("by_chat_order", ["chatId", "orderId"])
    .index("by_chat_parent", ["chatId", "parentMessageId"])
    .index("by_chat_status", ["chatId", "status"]),

  generationRuns: defineTable({
    chatId: v.id("chats"),
    userId: v.optional(v.id("users")),
    anonymousId: v.optional(v.string()),
    requestId: v.string(),
    model: v.string(),
    provider: v.string(),
    status: generationRunStatus,
    // No longer written (ADR-0008); kept optional so pre-existing run docs
    // validate. Drop after a migration unsets it.
    chatVersion: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    updatedAt: v.number(),
    error: v.optional(v.string()),
    finishReason: v.optional(v.string()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    totalToolCalls: v.optional(v.number()),
    failedToolCalls: v.optional(v.number()),
    activeStreamId: v.optional(v.string()),
    assistantMessageId: v.optional(v.id("messages")),
  })
    .index("by_chat", ["chatId"])
    .index("by_user", ["userId"])
    .index("by_status", ["status"])
    .index("by_chat_updated", ["chatId", "updatedAt"]),

  assistantMessageSnapshots: defineTable({
    runId: v.id("generationRuns"),
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    order: v.number(),
    stepOrder: v.number(),
    sequence: v.number(),
    format: v.union(v.literal("UIMessageChunk"), v.literal("text_snapshot")),
    delta: v.optional(v.string()),
    payload: v.optional(v.any()),
    textSnapshot: v.optional(v.string()),
    partsSnapshot: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_run_sequence", ["runId", "sequence"])
    .index("by_chat_order", ["chatId", "order"]),

  toolInvocations: defineTable({
    runId: v.id("generationRuns"),
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    toolCallId: v.string(),
    toolName: v.string(),
    source: toolSource,
    input: v.optional(v.any()),
    inputPreview: v.optional(v.string()),
    output: v.optional(v.any()),
    outputPreview: v.optional(v.string()),
    error: v.optional(v.string()),
    status: v.union(
      v.literal("called"),
      v.literal("pending_approval"),
      v.literal("approved"),
      v.literal("denied"),
      v.literal("completed"),
      v.literal("failed")
    ),
    approvalId: v.optional(v.id("toolApprovalRequests")),
    approvalRequestId: v.optional(v.string()),
    stepNumber: v.optional(v.number()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_chat", ["chatId"])
    .index("by_tool_call", ["toolCallId"])
    .index("by_run_tool_call", ["runId", "toolCallId"]),

  toolApprovalRequests: defineTable({
    chatId: v.id("chats"),
    runId: v.id("generationRuns"),
    assistantMessageId: v.id("messages"),
    userId: v.id("users"),
    toolCallId: v.string(),
    toolName: v.string(),
    source: toolSource,
    reason: v.optional(v.string()),
    riskClass: v.string(),
    inputPreview: v.optional(v.string()),
    fullInputRef: v.optional(v.string()),
    approvalId: v.string(),
    status: toolApprovalStatus,
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
    resolvedByUserId: v.optional(v.id("users")),
  })
    .index("by_user_status", ["userId", "status"])
    .index("by_chat_status", ["chatId", "status"])
    .index("by_run_status", ["runId", "status"])
    .index("by_approval", ["approvalId"]),

  projects: defineTable({
    userId: v.id("users"),
    name: v.string(),
  }).index("by_user", ["userId"]),

  userPreferences: defineTable({
    userId: v.id("users"),
    layout: v.optional(v.string()),
    promptSuggestions: v.optional(v.boolean()),
    showToolInvocations: v.optional(v.boolean()),
    showConversationPreviews: v.optional(v.boolean()),
    webSearchEnabled: v.optional(v.boolean()),
    hiddenModels: v.optional(v.array(v.string())),
  }).index("by_user", ["userId"]),

  userKeys: defineTable({
    userId: v.id("users"),
    provider: v.string(),
    encryptedKey: v.string(),
    iv: v.string(),
  })
    .index("by_user", ["userId"])
    .index("by_user_provider", ["userId", "provider"]),

  feedback: defineTable({
    userId: v.id("users"),
    message: v.string(),
  }).index("by_user", ["userId"]),

  // File attachments tracking
  chatAttachments: defineTable({
    chatId: v.id("chats"),
    userId: v.id("users"),
    storageId: v.optional(v.id("_storage")), // Convex storage reference
    fileUrl: v.string(), // Public URL
    fileName: v.optional(v.string()),
    fileType: v.optional(v.string()),
    fileSize: v.optional(v.number()),
  })
    .index("by_chat", ["chatId"])
    .index("by_user", ["userId"]),

  // Anonymous usage tracking (for rate limiting unauthenticated users)
  anonymousUsage: defineTable({
    anonymousId: v.string(), // Client-generated persistent ID
    dailyMessageCount: v.number(),
    dailyReset: v.number(), // Unix timestamp (start of day)
  }).index("by_anonymous_id", ["anonymousId"]),

  // Persistent tool limit buckets for sliding-window enforcement.
  // Shared by:
  // - extract_content per-domain abuse control
  // - centralized per-tool budgets (platform/BYOK policies)
  toolLimitBuckets: defineTable({
    actorKey: v.string(), // "user:<workosUserId>" or "guest:<anonymousId>"
    limitType: v.union(v.literal("domain"), v.literal("budget")),
    toolName: v.string(),
    scopeKey: v.string(), // domain for domain limits, "*" for per-tool budgets
    keyMode: v.union(v.literal("platform"), v.literal("byok")),
    bucketStartMs: v.number(),
    count: v.number(),
    updatedAt: v.number(),
  }).index("by_actor_limit_scope_bucket", [
    "actorKey",
    "limitType",
    "toolName",
    "scopeKey",
    "keyMode",
    "bucketStartMs",
  ]),

  // ============================================================================
  // MCP (Model Context Protocol) Integration
  // ============================================================================

  mcpServers: defineTable({
    userId: v.id("users"),
    name: v.string(),
    url: v.string(),
    transport: v.union(v.literal("http"), v.literal("sse")),
    enabled: v.boolean(),
    // Auth fields are optional at the schema level because they depend on authType.
    // Invariant enforced in mcpServers.create/update mutations:
    //   - bearer/header: encryptedAuthValue + authIv required
    //   - header: headerName additionally required
    //   - none: auth fields must be absent
    authType: v.optional(
      v.union(v.literal("none"), v.literal("bearer"), v.literal("header"))
    ),
    encryptedAuthValue: v.optional(v.string()),
    authIv: v.optional(v.string()),
    headerName: v.optional(v.string()),
    createdAt: v.number(),
    lastConnectedAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
  })
    .index("by_user", ["userId"])
    .index("by_user_enabled", ["userId", "enabled"]),

  mcpToolApprovals: defineTable({
    userId: v.id("users"),
    serverId: v.id("mcpServers"),
    toolName: v.string(),
    approved: v.boolean(),
    approvedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_server", ["serverId"])
    .index("by_user_server", ["userId", "serverId"])
    .index("by_user_server_tool", ["userId", "serverId", "toolName"]),

  toolCallLog: defineTable({
    userId: v.id("users"),
    chatId: v.optional(v.id("chats")),
    serverId: v.optional(v.id("mcpServers")), // Optional — only present for MCP tools
    toolName: v.string(),
    toolCallId: v.string(),
    inputPreview: v.optional(v.string()),
    outputPreview: v.optional(v.string()),
    success: v.boolean(),
    durationMs: v.optional(v.number()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    // Tool source discriminator — identifies which layer produced the tool call.
    // REQUIRED (not optional) — clean break, no existing data to migrate.
    // "unknown" covers calls whose tool name no layer's metadata resolves.
    source: v.union(
      v.literal("builtin"),
      v.literal("third-party"),
      v.literal("mcp"),
      v.literal("platform"),
      v.literal("unknown")
    ),
    // Service name for display and filtering (e.g., "OpenAI", "Exa", "my-mcp-server")
    serviceName: v.optional(v.string()),

    // --- Phase C: Observability enrichment (all optional, backward compatible) ---

    // Step number within the streaming response (1-indexed).
    // Enables ordering tool calls chronologically within a single generation.
    stepNumber: v.optional(v.number()),

    // Token usage for the step that produced this tool call.
    // Captured from onStepFinish usage — NOT per-tool, but per-step.
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),

    // Original result size in bytes before truncation.
    // Helps identify tools that consistently return large results.
    resultSizeBytes: v.optional(v.number()),

    // Request-level correlation ID (crypto.randomUUID() from the chat route).
    // Enables joining tool calls, PostHog events, and console logs for a single request.
    requestId: v.optional(v.string()),
    // Policy denial enrichment (optional). Present when a wrapper denies a call
    // due to budget controls before execution.
    errorCode: v.optional(v.string()),
    retryAfterSeconds: v.optional(v.number()),
    budgetKeyMode: v.optional(
      v.union(v.literal("platform"), v.literal("byok"))
    ),
    budgetDenied: v.optional(v.boolean()),

    // Payment guardrail observability (Phase 6)
    intentClass: v.optional(v.string()),
    policyDecision: v.optional(v.string()),
    chatVersion: v.optional(v.number()),
    toolKey: v.optional(v.string()),
    stateMutationKey: v.optional(v.string()),
  })
    .index("by_user", ["userId"])
    .index("by_chat", ["chatId"])
    .index("by_server", ["serverId"])
    .index("by_source", ["source"]),
})
