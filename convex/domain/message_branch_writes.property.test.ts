/**
 * PR 1 writer-equivalence gate: the restructured branch writer (one context
 * per planned array version, one-pass missing-index assignment) must produce
 * EXACTLY the pre-change writer's observable behavior — the ordered
 * patch/insert log (patch sets and `updatedAt` bumps included), the final
 * table state, the returned message, and thrown errors — for randomized
 * operation sequences over randomized starting trees, with the
 * `CHAT_SINGLE_PASS_BRANCH_CONTEXT` flag both off and on.
 */
import {
  buildRandomBranchTree,
  createSeededRandom,
  hashValue,
  makeBenchMessage,
} from "@/benchmarks/chat-performance/fixtures"
import { afterEach, describe, expect, it } from "vitest"
import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx } from "../_generated/server"
import { createMessageBranchWriter } from "./message_branch_writes"
import { createMessageBranchWriter as createLegacyMessageBranchWriter } from "./message_branch_writes_legacy_fixture"

type ChatMessage = Doc<"messages">

const chatId = "bench_chat" as Id<"chats">
const userId = "bench_user" as Id<"users">
const NOW = 1_000_000

type DbOp =
  | { op: "patch"; id: string; patch: Record<string, unknown> }
  | { op: "insert"; id: string; value: Record<string, unknown> }

function createHarness(initialMessages: ChatMessage[]) {
  const messages = structuredClone(initialMessages)
  const log: DbOp[] = []
  let nextId = 1

  const ctx = {
    db: {
      get: async (id: string) =>
        messages.find((candidate) => candidate._id === id) ?? null,
      query: () => ({
        withIndex: (
          _index: string,
          build: (query: {
            eq: (field: string, value: unknown) => unknown
          }) => unknown
        ) => {
          const query = { eq: () => query }
          build(query)
          return {
            collect: async () =>
              [...messages].sort((a, b) => a.orderId - b.orderId),
          }
        },
      }),
      patch: async (id: string, patch: Partial<ChatMessage>) => {
        const target = messages.find((candidate) => candidate._id === id)
        if (!target) throw new Error(`Missing message ${id}`)
        log.push({ op: "patch", id, patch: structuredClone(patch) })
        Object.assign(target, patch)
      },
      insert: async (
        _table: string,
        value: Omit<ChatMessage, "_id" | "_creationTime">
      ) => {
        const id = `inserted_${nextId++}` as Id<"messages">
        log.push({ op: "insert", id, value: structuredClone(value) })
        messages.push({ _id: id, _creationTime: value.createdAt, ...value })
        return id
      },
    },
  } as unknown as MutationCtx

  return { ctx, messages, log }
}

type WriterOp =
  | { kind: "select"; targetIndex: number }
  | {
      kind: "user"
      clientMessageId: string
      replacesIndex: number | null
      stamped: boolean
    }
  | { kind: "assistant"; replacesIndex: number | null }

/** Seeded op sequence — target indexes resolve against the CURRENT table. */
function buildOpSequence(seed: number, length: number): WriterOp[] {
  const random = createSeededRandom(seed ^ 0x5f3759df)
  const ops: WriterOp[] = []
  for (let i = 0; i < length; i++) {
    const roll = random()
    if (roll < 0.3) {
      ops.push({ kind: "select", targetIndex: Math.floor(random() * 1000) })
    } else if (roll < 0.65) {
      ops.push({
        kind: "user",
        clientMessageId: `client_${seed}_${random() < 0.3 ? Math.floor(random() * 3) : i}`,
        replacesIndex: random() < 0.3 ? Math.floor(random() * 1000) : null,
        stamped: random() < 0.8,
      })
    } else {
      ops.push({
        kind: "assistant",
        replacesIndex: random() < 0.4 ? Math.floor(random() * 1000) : null,
      })
    }
  }
  return ops
}

type Writer = ReturnType<typeof createMessageBranchWriter>

async function runOp(
  writer: Writer,
  op: WriterOp,
  table: ChatMessage[],
  sequence: number
): Promise<{ ok: boolean; result?: string; error?: string }> {
  const pick = (index: number) =>
    table.length > 0 ? table[index % table.length]!._id : ("missing" as Id<"messages">)
  try {
    if (op.kind === "select") {
      const result = await writer.select(pick(op.targetIndex))
      return { ok: true, result: String(result._id) }
    }
    if (op.kind === "user") {
      const base = {
        clientMessageId: op.clientMessageId,
        userId,
        content: `content ${sequence}`,
        parts: [{ type: "text", text: `content ${sequence}` }],
        replaces:
          op.replacesIndex === null ? undefined : pick(op.replacesIndex),
      }
      const result = await writer.writeUserMessage(
        op.stamped
          ? {
              ...base,
              requestId: `request_${sequence}`,
              model: "model_1",
              provider: "provider_1",
            }
          : base
      )
      return { ok: true, result: String(result._id) }
    }
    const result = await writer.writeAssistantPlaceholder({
      generationRunId: `run_${sequence}` as Id<"generationRuns">,
      requestId: `request_${sequence}`,
      model: "model_1",
      provider: "provider_1",
      replaces: op.replacesIndex === null ? undefined : pick(op.replacesIndex),
    })
    return { ok: true, result: String(result._id) }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}

async function runSequence(
  makeWriter: (ctx: MutationCtx) => Writer,
  initial: ChatMessage[],
  ops: WriterOp[]
) {
  const { ctx, messages, log } = createHarness(initial)
  const writer = makeWriter(ctx)
  const outcomes: unknown[] = []
  for (const [sequence, op] of ops.entries()) {
    outcomes.push(await runOp(writer, op, messages, sequence))
  }
  return { outcomes, log, finalState: messages }
}

/**
 * Randomized starting trees for the writer must be structurally sane (the
 * writer legitimately throws on unreachable targets, which both writers must
 * do identically — covered by including SOME anomalies via legacy rows).
 */
function buildStartingTree(seed: number): ChatMessage[] {
  const roll = seed % 3
  if (roll === 0) return []
  if (roll === 1) {
    // Legacy linear rows without branch metadata.
    return Array.from({ length: 6 }, (_, i) =>
      makeBenchMessage(`start_${seed}_${i}`, i, i % 2 === 0 ? "user" : "assistant")
    )
  }
  // Random anomalous tree — writers must fail/succeed identically on it.
  return buildRandomBranchTree(seed, { minRows: 4, maxRows: 24 })
}

afterEach(() => {
  delete process.env.CHAT_SINGLE_PASS_BRANCH_CONTEXT
})

describe("branch writer equivalence vs pre-change writer", () => {
  const seeds = Array.from({ length: 60 }, (_, i) => 90210 + i * 131)

  async function expectSequenceEquivalence(flagValue: "true" | undefined) {
    for (const seed of seeds) {
      const initial = buildStartingTree(seed)
      const ops = buildOpSequence(seed, 8)

      delete process.env.CHAT_SINGLE_PASS_BRANCH_CONTEXT
      const legacyRun = await runSequence(
        (ctx) => createLegacyMessageBranchWriter(ctx, { chatId, now: NOW }),
        initial,
        ops
      )

      if (flagValue === undefined) {
        delete process.env.CHAT_SINGLE_PASS_BRANCH_CONTEXT
      } else {
        process.env.CHAT_SINGLE_PASS_BRANCH_CONTEXT = flagValue
      }
      const candidateRun = await runSequence(
        (ctx) => createMessageBranchWriter(ctx, { chatId, now: NOW }),
        initial,
        ops
      )

      const label = `seed ${seed}, flag=${flagValue ?? "off"}`
      if (hashValue(candidateRun) !== hashValue(legacyRun)) {
        expect(candidateRun.log, `${label}: db op log`).toEqual(legacyRun.log)
        expect(candidateRun.outcomes, `${label}: outcomes`).toEqual(
          legacyRun.outcomes
        )
        expect(candidateRun.finalState, `${label}: final state`).toEqual(
          legacyRun.finalState
        )
      }
    }
  }

  it("matches the exact db op log, outcomes, and final state with the flag off", async () => {
    await expectSequenceEquivalence(undefined)
  })

  it("matches the exact db op log, outcomes, and final state with the flag on", async () => {
    await expectSequenceEquivalence("true")
  })
})
