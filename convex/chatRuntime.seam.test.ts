/** @vitest-environment edge-runtime */
import { convexTest } from "convex-test"
import { afterEach, describe, expect, it, vi } from "vitest"
import { api, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import {
  CANCELLATION_SETTLEMENT_PROTOCOL_VERSION,
  signChatAdmissionProof,
} from "./lib/chatAdmissionProof"
import schema from "./schema"
import { modules } from "./test.setup"

// Seam tests (ADR-0034): call the registrations the client calls, through
// convex-test, so the Authenticated handler builders, the arg validators, and
// the index semantics are on the test surface. What the cores do once
// admitted stays with chatRuntime.test.ts.

const SECRET = "test-chat-admission-secret-with-32-bytes"
const OWNER = "workos_owner"
const STRANGER = "workos_stranger"

const makeT = () => convexTest(schema, modules)
type T = ReturnType<typeof makeT>

async function seedOwner(t: T, subject: string, publicId: string) {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      workosUserId: subject,
      email: `${subject}@example.com`,
    })
    const chatId = await ctx.db.insert("chats", {
      publicId,
      userId,
      public: false,
      pinned: false,
      updatedAt: 1,
    })
    return { userId, chatId }
  })
}

async function seedRun(
  t: T,
  owner: { userId: Id<"users">; chatId: Id<"chats"> },
  run: { status: "running" | "awaiting_approval"; leaseExpiresAt?: number }
) {
  return t.run(async (ctx) => {
    const messageId = await ctx.db.insert("messages", {
      chatId: owner.chatId,
      orderId: 1,
      role: "assistant",
      content: "",
      parts: [],
      status: "streaming",
      createdAt: 1,
      updatedAt: 1,
    })
    const runId = await ctx.db.insert("generationRuns", {
      chatId: owner.chatId,
      userId: owner.userId,
      requestId: `request_${messageId}`,
      model: "gpt-5-mini",
      provider: "openai",
      assistantMessageId: messageId,
      updatedAt: 1,
      ...run,
    })
    return { runId, messageId }
  })
}

async function seedApproval(
  t: T,
  owner: { userId: Id<"users">; chatId: Id<"chats"> },
  approvalId: string
) {
  const { runId, messageId } = await seedRun(t, owner, {
    status: "awaiting_approval",
  })
  await t.run(async (ctx) => {
    await ctx.db.insert("toolApprovalRequests", {
      chatId: owner.chatId,
      runId,
      assistantMessageId: messageId,
      userId: owner.userId,
      toolCallId: "call_1",
      toolName: "send_email",
      source: "mcp",
      riskClass: "destructive",
      approvalId,
      status: "pending",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    })
  })
  return runId
}

describe("prepareGeneration (ownedChatMutation + admission proof)", () => {
  afterEach(() => vi.unstubAllEnvs())

  function admission(publicId: string) {
    const issuedAt = Date.now()
    const payload = {
      chatId: publicId,
      requestId: "request_seam",
      model: "gpt-5-mini",
      provider: "openai",
      cancellationSettlementVersion: CANCELLATION_SETTLEMENT_PROTOCOL_VERSION,
      issuedAt,
    }
    return {
      args: {
        chatId: publicId,
        requestId: payload.requestId,
        model: payload.model,
        provider: payload.provider,
        cancellationSettlementVersion: payload.cancellationSettlementVersion,
        expectedVisibleMessageCount: 0,
        latestUserMessage: {
          id: "user-1",
          role: "user" as const,
          content: "hi",
          parts: [{ type: "text", text: "hi" }],
        },
        admissionIssuedAt: issuedAt,
        admissionProof: signChatAdmissionProof(payload, SECRET),
      },
    }
  }

  it("refuses a guest before touching the chat", async () => {
    const t = makeT()
    await seedOwner(t, OWNER, "chat-owned")
    await expect(
      t.mutation(
        api.chatRuntime.prepareGeneration,
        admission("chat-owned").args
      )
    ).rejects.toThrow("Not authenticated")
  })

  it("refuses another user's chat", async () => {
    const t = makeT()
    await seedOwner(t, OWNER, "chat-owned")
    await seedOwner(t, STRANGER, "chat-stranger")
    await expect(
      t
        .withIdentity({ subject: STRANGER })
        .mutation(
          api.chatRuntime.prepareGeneration,
          admission("chat-owned").args
        )
    ).rejects.toThrow("Not authorized")
  })

  it("refuses a tampered proof for the owner and writes nothing", async () => {
    vi.stubEnv("CHAT_ADMISSION_SECRET", SECRET)
    const t = makeT()
    await seedOwner(t, OWNER, "chat-owned")
    const { args } = admission("chat-owned")
    await expect(
      t
        .withIdentity({ subject: OWNER })
        .mutation(api.chatRuntime.prepareGeneration, {
          ...args,
          model: "gpt-5",
        })
    ).rejects.toMatchObject({ data: { code: "admission_proof_invalid" } })
    const runs = await t.run((ctx) => ctx.db.query("generationRuns").collect())
    expect(runs).toHaveLength(0)
  })

  it("creates the run for the owner with a valid proof", async () => {
    vi.stubEnv("CHAT_ADMISSION_SECRET", SECRET)
    const t = makeT()
    const owner = await seedOwner(t, OWNER, "chat-owned")
    const result = await t
      .withIdentity({ subject: OWNER })
      .mutation(api.chatRuntime.prepareGeneration, admission("chat-owned").args)
    const run = await t.run((ctx) => ctx.db.get(result.runId))
    expect(run).toMatchObject({
      chatId: owner.chatId,
      userId: owner.userId,
      status: "streaming",
    })
  })
})

describe("approveToolCall / denyToolCall (ownedToolApprovalMutation)", () => {
  it("refuses a guest", async () => {
    const t = makeT()
    await expect(
      t.mutation(api.chatRuntime.approveToolCall, { approvalId: "approval_1" })
    ).rejects.toThrow("Not authenticated")
  })

  it("hides another user's approval", async () => {
    const t = makeT()
    const owner = await seedOwner(t, OWNER, "chat-owned")
    await seedOwner(t, STRANGER, "chat-stranger")
    await seedApproval(t, owner, "approval_1")
    await expect(
      t
        .withIdentity({ subject: STRANGER })
        .mutation(api.chatRuntime.denyToolCall, { approvalId: "approval_1" })
    ).rejects.toThrow("Approval not found")
  })

  it("lets the owner decide", async () => {
    const t = makeT()
    const owner = await seedOwner(t, OWNER, "chat-owned")
    await seedApproval(t, owner, "approval_1")
    await expect(
      t
        .withIdentity({ subject: OWNER })
        .mutation(api.chatRuntime.approveToolCall, {
          approvalId: "approval_1",
          reason: "ok",
        })
    ).resolves.toMatchObject({ status: "approved", alreadyResolved: false })
  })
})

describe("stopGenerationRun (ownedGenerationRunMutation)", () => {
  it("hides another user's run", async () => {
    const t = makeT()
    const owner = await seedOwner(t, OWNER, "chat-owned")
    await seedOwner(t, STRANGER, "chat-stranger")
    const { runId } = await seedRun(t, owner, { status: "running" })
    await expect(
      t
        .withIdentity({ subject: STRANGER })
        .mutation(api.chatRuntime.stopGenerationRun, { runId })
    ).rejects.toThrow("Run not found")
  })
})

describe("reapExpiredGenerationRuns (index range semantics)", () => {
  it("never reaps a running run that has no lease yet", async () => {
    const t = makeT()
    const owner = await seedOwner(t, OWNER, "chat-owned")
    const leaseless = await seedRun(t, owner, { status: "running" })
    const expired = await seedRun(t, owner, {
      status: "running",
      leaseExpiresAt: Date.now() - 1,
    })

    await t.mutation(internal.chatRuntime.reapExpiredGenerationRuns, {})

    const [a, b] = await t.run((ctx) =>
      Promise.all([ctx.db.get(leaseless.runId), ctx.db.get(expired.runId)])
    )
    expect(a?.status).toBe("running")
    expect(b?.status).not.toBe("running")
  })
})
