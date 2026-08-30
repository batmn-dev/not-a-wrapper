import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"
import { vToolInvocationStreamMetadata } from "./lib/messageMetadata"
import { vReasoningEffort } from "./lib/reasoningEffort"
import {
  vLedgerEntryType,
  vPricingSnapshot,
  vSettlementBasis,
  vTitleSettlementBasis,
  vTitleTerminalUsageEvidence,
  vUsageReservationStatus,
} from "./lib/usageValidators"

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
    workosUserId: v.string(),
    email: v.string(),
    displayName: v.optional(v.string()),
    profileImage: v.optional(v.string()),
    profileImageOverride: v.optional(v.string()),
    profileImageStorageId: v.optional(v.id("_storage")),

    anonymous: v.optional(v.boolean()),
    premium: v.optional(v.boolean()),

    messageCount: v.optional(v.number()),
    dailyMessageCount: v.optional(v.number()),
    dailyReset: v.optional(v.number()), // Unix timestamp

    // Production compatibility only; contract after old rows are gone.
    dailyProMessageCount: v.optional(v.number()),
    dailyProReset: v.optional(v.number()), // Unix timestamp

    lastActiveAt: v.optional(v.number()), // Unix timestamp
    lastSyncedFromWorkOSAt: v.optional(v.number()), // Unix timestamp
    workosUpdatedAt: v.optional(v.string()), // ISO timestamp from WorkOS
    deletedAt: v.optional(v.number()), // Unix timestamp
    disabledAt: v.optional(v.number()), // Unix timestamp

    favoriteModels: v.optional(v.array(v.string())),
    systemPrompt: v.optional(v.string()),
  })
    .index("by_workos_user_id", ["workosUserId"])
    .index("by_email", ["email"]),

  chats: defineTable({
    userId: v.id("users"),
    title: v.optional(v.string()),
    // Title generation is compare-and-set: a late model result may replace
    // only the provisional title version it was created for. A manual rename
    // becomes authoritative and is never overwritten by background work.
    titleSource: v.optional(
      v.union(
        v.literal("provisional"),
        v.literal("generated"),
        v.literal("user")
      )
    ),
    titleGeneration: v.optional(v.number()),
    model: v.optional(v.string()),
    systemPrompt: v.optional(v.string()),
    projectId: v.optional(v.id("projects")),
    public: v.boolean(),
    pinned: v.boolean(),
    pinnedAt: v.optional(v.number()), // Unix timestamp
    // Required so recency indexes never sort null keys to the tail, which would
    // hide chats from paginated history/sidebar windows.
    updatedAt: v.number(), // Unix timestamp — last activity (turn start)
    // --- Sidebar status projection (CONTEXT.md "Sidebar status projection")
    // A few run-lifecycle fields mirrored onto the chat doc so each sidebar row
    // derives its indicator from the chat it already subscribes to — no separate
    // query/store/hydrator. All five are OWNER-ONLY: they ride a doc public reads
    // return, so chats.getById/getPublicById strip them for non-owners.
    // Live phase of the current run; cleared at its terminal transition.
    liveRunStatus: v.optional(
      v.union(v.literal("streaming"), v.literal("awaiting"))
    ),
    // Guards the projection so a late terminal event cannot clobber a newer run.
    statusRunId: v.optional(v.id("generationRuns")),
    // Only completed and failed runs signal unread/error to the owner.
    lastRunEndedAt: v.optional(v.number()),
    lastRunStatus: v.optional(
      v.union(v.literal("completed"), v.literal("failed"))
    ),
    lastReadAt: v.optional(v.number()),
    // Freshness ceiling for the live projection, written ONCE (at prepare:
    // startedAt + route budget + slack; at approval pause: the approval's
    // expiresAt) and cleared at terminal transitions — never per heartbeat
    // An expired deadline must never render a spinner.
    liveRunFreshUntil: v.optional(v.number()),
    // Deletion tombstone (logical deletion is immediate; physical cleanup is a
    // scheduled drain — see deletionJobs). A set value makes the chat invisible
    // and write-dead on every surface. Never cleared once set.
    deletingAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_user_pinned", ["userId", "pinned"])
    // Sidebar grouping needs one recency-ordered source that can include both
    // project and non-project chats. Keeping projectId out of this index lets
    // the UI derive either grouping without N+1 project subscriptions.
    .index("by_user_pinned_updated", ["userId", "pinned", "updatedAt"])
    .index("by_user_updated", ["userId", "updatedAt"])
    // The history drawer's browse mode: pinned + non-pinned non-project chats
    // newest-first. Project chats are hidden from browse mode and must not
    // consume pagination slots; title search and project pages reach them
    // through their own reads.
    .index("by_user_project_updated", ["userId", "projectId", "updatedAt"])
    // The sidebar recency window: non-pinned, non-project chats newest-first.
    // Excluding pinned + project at the index level keeps every page full of
    // chats the "Chats" section actually shows, so pinned/project chats never
    // consume window slots (docs/adr/0005-bounded-chat-list-window.md).
    .index("by_user_pinned_project_updated", [
      "userId",
      "pinned",
      "projectId",
      "updatedAt",
    ])
    .index("by_project", ["projectId"])
    // One owner-scoped sidebar query reads the five newest chats for every
    // project. Recency belongs in the index so a project outside the global
    // chat window still receives a complete preview without a client-side
    // subscription per project.
    .index("by_project_updated", ["projectId", "updatedAt"])
    // Title-only full-history search, scoped per user via the userId filter
    // field. Lets history search reach chats outside the bounded sidebar window
    // (docs/adr/0005-bounded-chat-list-window.md).
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
      v.literal("system")
    ),
    content: v.string(),
    parts: v.any(), // AI SDK parts format
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
    errorRecovery: v.optional(
      v.literal("retry_with_shorter_generation_budget")
    ),
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
    // Route-resolution receipt (ADR-0020): which concrete route executed the
    // logical `model`, on whose credentials, and why the resolver chose it.
    // Optional for documents that predate the resolver; never key material.
    routeId: v.optional(v.string()),
    credentialSource: v.optional(
      v.union(v.literal("platform"), v.literal("byok"))
    ),
    routeReason: v.optional(
      v.union(
        v.literal("priority_byok"),
        v.literal("platform"),
        v.literal("fallback_byok"),
        v.literal("legacy_route_hint")
      )
    ),
    // Per-turn effort receipt (ADR-0026): what the user requested and what
    // the runtime applied after route clamping (platform turns record the
    // concrete provider default). Verified by the signed admission proof at
    // prepare; display/audit only.
    reasoningEffort: v.optional(vReasoningEffort),
    appliedReasoningEffort: v.optional(vReasoningEffort),
    // Per-turn generation allowance receipt (ADR-0028). Both values include
    // hidden reasoning output; applied is route/funding clamped.
    requestedGenerationBudget: v.optional(v.number()),
    appliedGenerationBudget: v.optional(v.number()),
    status: generationRunStatus,
    // Compatibility field: no longer written, but production may still contain
    // older run docs. Drop only after preflight proves zero legacy documents.
    chatVersion: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    // Provider-consumption boundary for assistant work timing. Optional for
    // compatibility with runs created before work-duration persistence.
    workStartedAt: v.optional(v.number()),
    // Accumulated active work. While streaming this is the pre-segment base;
    // once terminal it is the frozen total for this run/message lifecycle.
    workDurationMs: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    updatedAt: v.number(),
    error: v.optional(v.string()),
    errorRecovery: v.optional(
      v.literal("retry_with_shorter_generation_budget")
    ),
    finishReason: v.optional(v.string()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    // Compatibility field written by the first cancellation-settlement
    // implementation. Current workers use usageSteps below because a scalar
    // high-water mark loses valid out-of-order writes.
    lastUsageStepNumber: v.optional(v.number()),
    // Order-independent, idempotent per-step usage evidence. Step count is
    // bounded by the runtime's maxSteps; duplicate step numbers are absorbed
    // and totals above are recomputed from this set.
    usageSteps: v.optional(
      v.array(
        v.object({
          stepNumber: v.number(),
          inputTokens: v.optional(v.number()),
          outputTokens: v.optional(v.number()),
        })
      )
    ),
    // Protocol marker for cancellation-settlement audit and historical rows.
    // Current workers always write v1.
    cancellationSettlementVersion: v.optional(v.literal(1)),
    // Durable title attempt/usage evidence, persisted before each call and
    // mirrored to the reservation so worker loss or deletion cannot erase it.
    titleUsageEvidence: v.optional(vTitleTerminalUsageEvidence),
    // Approval continuations reuse the paused assistant message, whose parts
    // were already billed to the PREVIOUS run's settled reservation. This
    // baseline (the partial-output estimate over the reused parts at prepare)
    // is subtracted from every partial-output estimate for THIS run so a
    // stopped continuation never rebills the prior run's output (ADR-0021
    // cancellation amendment).
    resumedOutputTokensBaseline: v.optional(v.number()),
    totalToolCalls: v.optional(v.number()),
    failedToolCalls: v.optional(v.number()),
    activeStreamId: v.optional(v.string()),
    assistantMessageId: v.optional(v.id("messages")),
    // Execution grant (ADR-0011): SHA-256 digest of the run-scoped worker
    // secret minted at prepare. Worker writes authenticate against this digest
    // via the /chat-turn/worker HTTP endpoint instead of the user's request
    // token, so a mid-run token expiry can no longer reject late writes. The
    // raw secret lives only in the Next server process's memory. Absorbing
    // terminal outcomes (aborted/failed) clear both fields (revocation).
    grantDigest: v.optional(v.string()),
    grantExpiresAt: v.optional(v.number()),
    // Durable liveness. Lease fields are
    // written by the worker heartbeat; a document missing them sorts as
    // `undefined` in by_status_lease_expires, so every reaper range MUST
    // exclude undefined (`.gt("leaseExpiresAt", undefined)`) or lease-less
    // rows are falsely reaped.
    heartbeatAt: v.optional(v.number()), // last server-timestamped heartbeat
    leaseExpiresAt: v.optional(v.number()), // stored expiry: reaping + client classification
    lastSnapshotSequence: v.optional(v.number()), // reject stale snapshots pre-insert
    lastProgressAt: v.optional(v.number()), // latest accepted content/tool progress; NOT liveness
    terminalReason: v.optional(
      v.union(
        v.literal("completed"),
        v.literal("user_stop"),
        v.literal("superseded"),
        v.literal("provider_error"),
        v.literal("lease_expired"),
        v.literal("approval_expired"),
        v.literal("continuation_lost"),
        v.literal("request_aborted")
      )
    ),
    stopRequestedAt: v.optional(v.number()),
    stopRequestedBy: v.optional(v.id("users")),
    supersededByRunId: v.optional(v.id("generationRuns")),
    // Approval continuation idempotency: the first continuation
    // records both relation fields; a second attempt sees continuationRunId
    // and returns a typed conflict.
    continuationRunId: v.optional(v.id("generationRuns")),
    continuedFromRunId: v.optional(v.id("generationRuns")),
  })
    .index("by_chat", ["chatId"])
    .index("by_user", ["userId"])
    .index("by_status", ["status"])
    .index("by_chat_updated", ["chatId", "updatedAt"])
    .index("by_status_lease_expires", ["status", "leaseExpiresAt"]),

  // Durable cursors for bounded reconciliation scans. The versioned name is
  // part of the query contract: changing a scan's index/range starts a new
  // checkpoint instead of reusing an opaque cursor from a different query.
  reaperCheckpoints: defineTable({
    name: v.string(),
    cursor: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_name", ["name"]),

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
    // Approval pauses are lease-free with their own expiry.
    expiresAt: v.number(),
  })
    .index("by_user_status", ["userId", "status"])
    .index("by_chat_status", ["chatId", "status"])
    .index("by_run_status", ["runId", "status"])
    .index("by_approval", ["approvalId"])
    .index("by_status_expires", ["status", "expiresAt"]),

  projects: defineTable({
    userId: v.id("users"),
    name: v.string(),
    // Last durable user-visible change to the project or one of its chats.
    updatedAt: v.number(),
    pinned: v.boolean(),
    // Deletion tombstone (logical deletion is immediate; physical cleanup is a
    // scheduled drain — see deletionJobs). A set value makes the project
    // invisible and write-dead on every surface. Never cleared once set.
    deletingAt: v.optional(v.number()),
  }).index("by_user", ["userId"]),

  deletionJobs: defineTable({
    targetKind: v.union(v.literal("chat"), v.literal("project")),
    chatId: v.optional(v.id("chats")), // chat target, or project job's current chat
    projectId: v.optional(v.id("projects")),
    userId: v.id("users"), // owner at initiation; internal consistency only
    state: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("blocked"),
      v.literal("complete")
    ),
    phase: v.string(), // one of DELETION_PHASES / PROJECT_PHASES
    version: v.number(), // job format version, start at 1
    batchesProcessed: v.number(),
    documentsDeleted: v.number(),
    bytesObserved: v.number(), // getConvexSize of deleted rows, content-free
    retryCount: v.number(),
    failureCode: v.optional(v.string()), // stable enum string, never content
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_chat", ["chatId"])
    .index("by_project", ["projectId"])
    .index("by_state_updated", ["state", "updatedAt"]),

  userPreferences: defineTable({
    userId: v.id("users"),
    layout: v.optional(v.string()),
    showToolInvocations: v.optional(v.boolean()),
    showConversationPreviews: v.optional(v.boolean()),
    webSearchEnabled: v.optional(v.boolean()),
    streamingPresentation: v.optional(v.string()),
    hiddenModels: v.optional(v.array(v.string())),
  }).index("by_user", ["userId"]),

  userKeys: defineTable({
    userId: v.id("users"),
    provider: v.string(),
    encryptedKey: v.string(),
    iv: v.string(),
    // Routing-policy preference (ADR-0020): where this key's routes sit in
    // the route resolver's candidate order. Absent = "priority" (the
    // historical BYOK-first behavior). Metadata only — never key material.
    preference: v.optional(
      v.union(v.literal("priority"), v.literal("fallback"))
    ),
  })
    .index("by_user", ["userId"])
    .index("by_user_provider", ["userId", "provider"]),

  feedback: defineTable({
    userId: v.id("users"),
    message: v.string(),
  }).index("by_user", ["userId"]),

  // File attachments tracking
  chatAttachments: defineTable({
    // Files are staged against the authenticated user before a chat exists,
    // then atomically bound to a chat at turn dispatch.
    chatId: v.optional(v.id("chats")),
    userId: v.id("users"),
    storageId: v.optional(v.id("_storage")), // Convex storage reference
    fileUrl: v.string(), // Public URL
    fileName: v.optional(v.string()),
    fileType: v.optional(v.string()),
    fileSize: v.optional(v.number()),
    stagedAt: v.optional(v.number()),
  })
    .index("by_chat", ["chatId"])
    .index("by_user", ["userId"])
    .index("by_storage", ["storageId"]),

  // --- Platform usage allowance (ADR-0021) ---
  // The materialized balance is the fast read model; every change is
  // evidenced by an append-only usageLedgerEntries row. All credit amounts
  // are integers: 1 credit = 1 micro-USD of platform cost.

  // One included-allowance bucket per user per plan period (UTC month),
  // materialized lazily. Invariant (pinned by tests):
  //   availableCredits = grantedCredits - spentCredits - reservedCredits
  // Settlement may drive availableCredits negative (overruns are recorded,
  // never clamped); a negative balance blocks new reservations until the
  // next period's grant. bucketKind is a union of one today so a purchased
  // "overage" bucket can be added later without redesigning reserve/settle.
  usageBuckets: defineTable({
    userId: v.id("users"),
    bucketKind: v.literal("included"),
    periodKey: v.string(), // e.g. "2026-08"
    periodStart: v.number(),
    periodEnd: v.number(),
    planId: v.string(),
    grantedCredits: v.number(),
    availableCredits: v.number(),
    reservedCredits: v.number(),
    spentCredits: v.number(),
    status: v.literal("active"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user_kind_period", ["userId", "bucketKind", "periodKey"])
    .index("by_user", ["userId"]),

  // One durable record per platform-funded generation request. Keyed by the
  // authenticated (userId, requestId) before the run exists; attached to its
  // generationRunId transactionally inside prepareGeneration (the id rides
  // the signed admission proof, so a forged attach is impossible). The
  // pricing snapshot pins reservation-time rates: settlement always prices
  // with the SAME snapshot even if the catalog changed mid-request. Never
  // carries key material or message content.
  usageReservations: defineTable({
    userId: v.id("users"),
    requestId: v.string(),
    bucketId: v.id("usageBuckets"),
    generationRunId: v.optional(v.id("generationRuns")),
    chatId: v.string(),
    modelId: v.string(),
    routeId: v.string(),
    providerId: v.string(),
    status: vUsageReservationStatus,
    estimatedCredits: v.number(),
    estimatedInputTokens: v.optional(v.number()),
    estimatedOutputTokens: v.optional(v.number()),
    reservedCredits: v.number(),
    actualCredits: v.optional(v.number()),
    settlementBasis: v.optional(vSettlementBasis),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    titleCredits: v.optional(v.number()),
    /** Title component of the estimate — the conservative fallback charge
     * when a title call may have run but its usage never arrived. */
    titleEstimatedCredits: v.optional(v.number()),
    /** Input-only title floor pinned at reservation time (ADR-0021
     * cancellation amendment): what a started-but-unfinished title costs.
     * Optional only so historical reservation documents remain readable. */
    titleEstimatedInputTokens: v.optional(v.number()),
    /** How the settled title component was derived (actual / input_floor /
     * not_run), persisted separately from the primary basis. */
    titleSettlementBasis: v.optional(vTitleSettlementBasis),
    // --- Deferred cancellation settlement (ADR-0021 cancellation amendment).
    // A user Stop / supersession keeps status "reserved" (the amount stays in
    // bucket.reservedCredits) and stamps these fields; a worker terminal-usage
    // receipt or the deadline reconciler finalizes. Pending/deadline
    // timestamps are retained after finalization as audit facts; the
    // settlement-grant fields are cleared.
    terminalPendingAt: v.optional(v.number()),
    settlementDeadlineAt: v.optional(v.number()),
    /** Durable partial-output fallback captured when terminality won. */
    terminalEstimatedOutputTokens: v.optional(v.number()),
    /** Digest of the stopped worker's secret, valid ONLY for the
     * settlement-only terminal usage receipt — never for run writes. */
    settlementGrantDigest: v.optional(v.string()),
    settlementGrantExpiresAt: v.optional(v.number()),
    /** Durable fallback discriminator copied from the run before cleanup. */
    providerMayHaveStarted: v.optional(v.boolean()),
    /** Protocol marker copied from the run at attach. */
    cancellationSettlementVersion: v.optional(v.literal(1)),
    /** Per-step evidence mirrored from the run for missing-run recovery. */
    observedInputTokens: v.optional(v.number()),
    observedOutputTokens: v.optional(v.number()),
    /** Durable title evidence for deadline/deletion recovery. */
    titleUsageEvidence: v.optional(vTitleTerminalUsageEvidence),
    pricingSnapshot: vPricingSnapshot,
    payloadFingerprint: v.string(),
    reservedAt: v.number(),
    attachedAt: v.optional(v.number()),
    settledAt: v.optional(v.number()),
    releasedAt: v.optional(v.number()),
    terminalReason: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_user_request", ["userId", "requestId"])
    .index("by_run", ["generationRunId"])
    .index("by_status_reserved_at", ["status", "reservedAt"])
    .index("by_user_reserved_at", ["userId", "reservedAt"])
    // Bounded deadline reconciliation. Missing optional fields index as
    // `undefined`, so scans must exclude them via
    // `.gt("settlementDeadlineAt", undefined)` before the upper bound.
    .index("by_status_settlement_deadline", ["status", "settlementDeadlineAt"]),

  // Append-only accounting evidence. Rows are NEVER updated or deleted in
  // normal operation; corrections are compensating "adjustment" entries.
  // eventKey is the deterministic idempotency identity (grant:{user}:{period},
  // reserve:{reservationId}, ...) enforced by an indexed read inside the
  // inserting mutation.
  usageLedgerEntries: defineTable({
    userId: v.id("users"),
    bucketId: v.id("usageBuckets"),
    reservationId: v.optional(v.id("usageReservations")),
    eventKey: v.string(),
    type: vLedgerEntryType,
    deltaAvailableCredits: v.number(),
    deltaReservedCredits: v.number(),
    deltaSpentCredits: v.number(),
    /** Plan or pricing revision relevant to the event, when applicable. */
    revision: v.optional(v.string()),
    reason: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_event_key", ["eventKey"])
    .index("by_bucket", ["bucketId"])
    .index("by_user_created", ["userId", "createdAt"]),

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

  // Fixed-window per-identity throttle for expensive API routes (e.g. the MCP
  // "test connection" endpoint, which opens an outbound connection per call).
  // Keyed by the authenticated user; see convex/rateLimits.ts.
  apiRateLimits: defineTable({
    actorKey: v.string(), // "user:<users._id>"
    bucket: v.string(), // logical limit name, e.g. "mcp_test"
    windowStartMs: v.number(),
    count: v.number(),
  }).index("by_actor_bucket_window", ["actorKey", "bucket", "windowStartMs"]),

  // MCP (Model Context Protocol) Integration

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
    // "unknown" audits calls that cannot be resolved to a tool layer.
    source: v.union(
      v.literal("builtin"),
      v.literal("third-party"),
      v.literal("mcp"),
      v.literal("platform"),
      v.literal("unknown")
    ),
    serviceName: v.optional(v.string()),

    // One-indexed for chronological ordering within a generation.
    stepNumber: v.optional(v.number()),

    // Step-level usage, not usage attributable to an individual tool.
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),

    // Original size before result truncation.
    resultSizeBytes: v.optional(v.number()),

    // Correlates tool logs with request analytics and diagnostics.
    requestId: v.optional(v.string()),
    // Policy denial enrichment (optional). Present when a wrapper denies a call
    // due to budget controls before execution.
    errorCode: v.optional(v.string()),
    retryAfterSeconds: v.optional(v.number()),
    budgetKeyMode: v.optional(
      v.union(v.literal("platform"), v.literal("byok"))
    ),
    budgetDenied: v.optional(v.boolean()),

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
