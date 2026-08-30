/**
 * Shared deterministic fixtures for the chat-performance benchmarks. Fixture
 * hashes are pinned in docs/performance/2026-08-27-system-performance-baseline.md.
 *
 * Everything here is seeded and pure: the same seed always produces the same
 * branch trees, payloads, and stream scripts, so benchmark output hashes are
 * committable and implementations can be compared exactly.
 * No wall-clock time is read anywhere — stream cadence is virtual (`atMs`).
 */
import type { Doc, Id } from "../../convex/_generated/dataModel"
import {
  createBranchContext,
  getBranchInfoForMessage,
  getBranchInfoForMessageFromContext,
  getSelectedPathBranchNormalizationPatches,
  getSelectedPathBranchNormalizationPatchesFromContext,
  getSelectedPathMessages,
  getSelectedPathMessagesFromContext,
  type MessageBranchInfo,
  type MessageBranchPatch,
} from "../../convex/domain/message_branches"

export type BenchMessage = Doc<"messages">

// Seeded randomness and stable hashing

/** mulberry32 — small, fast, fully deterministic PRNG. */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** JSON.stringify with sorted object keys so hashes are order-independent. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, function replacer(_key, val: unknown) {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return Object.fromEntries(
        Object.entries(val as Record<string, unknown>).sort(([a], [b]) =>
          a < b ? -1 : a > b ? 1 : 0
        )
      )
    }
    return val
  })
}

/** FNV-1a (64-bit via two 32-bit lanes) over the stable serialization. */
export function hashValue(value: unknown): string {
  const text = typeof value === "string" ? value : stableStringify(value)
  let h1 = 0x811c9dc5
  let h2 = 0xcbf29ce4
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ ((code >> 8) ^ code), 0x01000193) >>> 0
  }
  return (
    h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")
  )
}

// Branch tree fixtures

const FIXTURE_CHAT_ID = "bench_chat" as Id<"chats">
const FIXTURE_USER_ID = "bench_user" as Id<"users">

export function makeBenchMessage(
  id: string,
  orderId: number,
  role: "user" | "assistant",
  options: Partial<BenchMessage> = {}
): BenchMessage {
  return {
    _id: id as Id<"messages">,
    _creationTime: orderId,
    chatId: FIXTURE_CHAT_ID,
    orderId,
    userId: role === "user" ? FIXTURE_USER_ID : undefined,
    role,
    content: `${role} ${orderId}`,
    parts: [],
    status: "completed",
    createdAt: orderId,
    updatedAt: orderId,
    ...options,
  } as BenchMessage
}

/**
 * Deterministic branched conversation: `turns` turns, each with
 * `userSiblings` user-edit siblings and `assistantSiblings` regeneration
 * siblings. Row count = turns * (userSiblings + assistantSiblings).
 * The selected path always follows the LAST sibling of each group.
 */
export function buildDeterministicBranchTree(rowCount: 575 | 1150) {
  const turns = rowCount === 575 ? 115 : 230
  const userSiblings = 2
  const assistantSiblings = 3

  const messages: BenchMessage[] = []
  let order = 0
  let parentId: Id<"messages"> | undefined

  for (let turn = 0; turn < turns; turn++) {
    let selectedUser: Id<"messages"> | undefined
    for (let s = 0; s < userSiblings; s++) {
      const id = `t${turn}_u${s}` as Id<"messages">
      messages.push(
        makeBenchMessage(id, order++, "user", {
          parentMessageId: parentId,
          branchIndex: s,
          selected: s === userSiblings - 1,
        })
      )
      if (s === userSiblings - 1) selectedUser = id
    }
    let selectedAssistant: Id<"messages"> | undefined
    for (let s = 0; s < assistantSiblings; s++) {
      const id = `t${turn}_a${s}` as Id<"messages">
      messages.push(
        makeBenchMessage(id, order++, "assistant", {
          parentMessageId: selectedUser,
          branchIndex: s,
          selected: s === assistantSiblings - 1,
        })
      )
      if (s === assistantSiblings - 1) selectedAssistant = id
    }
    parentId = selectedAssistant
  }

  return messages
}

function buildDeepSelectedPathFixture(): BenchMessage[] {
  // 40 turns; each level hides two unselected siblings behind the path.
  const messages: BenchMessage[] = []
  let order = 0
  let parentId: Id<"messages"> | undefined
  for (let turn = 0; turn < 40; turn++) {
    const role = turn % 2 === 0 ? ("user" as const) : ("assistant" as const)
    for (let s = 0; s < 3; s++) {
      const id = `deep_${turn}_${s}` as Id<"messages">
      messages.push(
        makeBenchMessage(id, order++, role, {
          parentMessageId: parentId,
          branchIndex: s,
          selected: s === 0,
        })
      )
    }
    parentId = `deep_${turn}_0` as Id<"messages">
  }
  return messages
}

function buildWideSiblingSetFixture(): BenchMessage[] {
  const messages: BenchMessage[] = [
    makeBenchMessage("wide_user", 0, "user", {
      branchIndex: 0,
      selected: true,
    }),
  ]
  // 48 regeneration siblings under one user turn; sparse/missing indexes.
  for (let s = 0; s < 48; s++) {
    messages.push(
      makeBenchMessage(`wide_a${s}`, s + 1, "assistant", {
        parentMessageId: "wide_user" as Id<"messages">,
        branchIndex: s % 5 === 0 ? undefined : s,
        selected: s === 47,
      })
    )
  }
  return messages
}

function buildLegacyLinearFixture(): BenchMessage[] {
  // Pre-branching rows: no parentMessageId / branchIndex / selected at all.
  const messages: BenchMessage[] = []
  for (let i = 0; i < 30; i++) {
    messages.push(
      makeBenchMessage(
        `legacy_${i}`,
        i,
        i % 2 === 0 ? "user" : "assistant"
      )
    )
  }
  return messages
}

function buildMixedLegacyExplicitFixture(): BenchMessage[] {
  const messages = buildLegacyLinearFixture()
  const tail = messages[messages.length - 1]!
  // Explicit branching grafted onto a legacy prefix.
  messages.push(
    makeBenchMessage("mixed_edit_0", 30, "assistant", {
      parentMessageId: tail._id,
      branchIndex: 0,
      selected: false,
    }),
    makeBenchMessage("mixed_edit_1", 31, "assistant", {
      parentMessageId: tail._id,
      branchIndex: 1,
      selected: true,
    }),
    // Explicit root sibling: branch state present, no parent.
    makeBenchMessage("mixed_root_sibling", 32, "user", {
      branchIndex: 1,
      selected: false,
    })
  )
  return messages
}

function buildSelectionAnomalyFixture(): BenchMessage[] {
  // Duplicate selected flags, all-deselected groups, and tied order values.
  return [
    makeBenchMessage("sel_u0", 0, "user", { branchIndex: 0, selected: true }),
    makeBenchMessage("sel_a0", 1, "assistant", {
      parentMessageId: "sel_u0" as Id<"messages">,
      branchIndex: 0,
      selected: true,
    }),
    makeBenchMessage("sel_a1", 1, "assistant", {
      // Tied orderId with sel_a0 (createdAt tie too) — _id breaks the tie.
      parentMessageId: "sel_u0" as Id<"messages">,
      branchIndex: 1,
      selected: true, // duplicate selected inside the sibling group
    }),
    makeBenchMessage("sel_u1", 2, "user", {
      parentMessageId: "sel_a0" as Id<"messages">,
      branchIndex: 0,
      selected: false, // all siblings deselected
    }),
    makeBenchMessage("sel_u2", 3, "user", {
      parentMessageId: "sel_a0" as Id<"messages">,
      branchIndex: 1,
      selected: false,
    }),
    makeBenchMessage("sel_a2", 4, "assistant", {
      parentMessageId: "sel_u1" as Id<"messages">,
      // Missing branchIndex + undefined selected
    }),
  ]
}

function buildMalformedCycleFixture(): BenchMessage[] {
  return [
    makeBenchMessage("cyc_u0", 0, "user", { branchIndex: 0, selected: true }),
    // Two-node parent cycle.
    makeBenchMessage("cyc_a0", 1, "assistant", {
      parentMessageId: "cyc_a1" as Id<"messages">,
      branchIndex: 0,
      selected: true,
    }),
    makeBenchMessage("cyc_a1", 2, "assistant", {
      parentMessageId: "cyc_a0" as Id<"messages">,
      branchIndex: 0,
      selected: true,
    }),
    // Self-parent.
    makeBenchMessage("cyc_self", 3, "user", {
      parentMessageId: "cyc_self" as Id<"messages">,
      branchIndex: 0,
      selected: true,
    }),
    // Orphan parent pointer (target does not exist).
    makeBenchMessage("cyc_orphan", 4, "assistant", {
      parentMessageId: "cyc_missing" as Id<"messages">,
      branchIndex: 0,
      selected: true,
    }),
    // A normal continuation so the fixture still has a selected path.
    makeBenchMessage("cyc_a2", 5, "assistant", {
      parentMessageId: "cyc_u0" as Id<"messages">,
      branchIndex: 0,
      selected: true,
    }),
  ]
}

/**
 * The six named fixture classes preserved from the supplied benchmark
 * baseline: deep path, wide siblings, legacy linear, mixed legacy/explicit,
 * selection anomalies (duplicate/missing flags + tied orders), malformed cycles.
 */
export const NAMED_BRANCH_FIXTURES: Record<string, () => BenchMessage[]> = {
  "deep-selected-path": buildDeepSelectedPathFixture,
  "wide-sibling-set": buildWideSiblingSetFixture,
  "legacy-linear": buildLegacyLinearFixture,
  "mixed-legacy-explicit": buildMixedLegacyExplicitFixture,
  "selection-anomalies": buildSelectionAnomalyFixture,
  "malformed-cycles": buildMalformedCycleFixture,
}

export type RandomBranchTreeOptions = {
  minRows?: number
  maxRows?: number
}

/**
 * Seeded randomized tree generator. Injects, per seed: legacy rows (missing
 * branch fields), duplicate/missing selected flags, tied order values, orphan
 * parent pointers, explicit root siblings, and occasional parent cycles.
 */
export function buildRandomBranchTree(
  seed: number,
  { minRows = 12, maxRows = 90 }: RandomBranchTreeOptions = {}
): BenchMessage[] {
  const random = createSeededRandom(seed)
  const rowCount = minRows + Math.floor(random() * (maxRows - minRows + 1))
  const messages: BenchMessage[] = []
  let order = 0

  const pickExistingId = (): Id<"messages"> | undefined => {
    if (messages.length === 0) return undefined
    return messages[Math.floor(random() * messages.length)]!._id
  }

  for (let i = 0; i < rowCount; i++) {
    const id = `r${seed}_${i}` as Id<"messages">
    const role = random() < 0.5 ? ("user" as const) : ("assistant" as const)
    const legacyRow = random() < 0.2

    // Tied orders ~15% of the time; otherwise monotonic.
    const orderId = random() < 0.15 && order > 0 ? order - 1 : order++

    const options: Partial<BenchMessage> = {}
    if (!legacyRow) {
      const anomaly = random()
      if (anomaly < 0.05) {
        // Orphan parent pointer.
        options.parentMessageId = `r${seed}_missing_${i}` as Id<"messages">
      } else if (anomaly < 0.08) {
        // Forward/self reference — creates cycles once later rows point back.
        options.parentMessageId = id
      } else if (anomaly < 0.2) {
        // Explicit root sibling: branch fields, no parent.
        options.parentMessageId = undefined
      } else {
        options.parentMessageId = pickExistingId()
      }
      if (random() < 0.85) options.branchIndex = Math.floor(random() * 4)
      const selectedRoll = random()
      if (selectedRoll < 0.45) options.selected = true
      else if (selectedRoll < 0.7) options.selected = false
      // else: missing selected flag
    }

    messages.push(makeBenchMessage(id, orderId, role, options))
  }

  // Shuffle input order (Fisher–Yates) so nothing depends on load order.
  for (let i = messages.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const tmp = messages[i]!
    messages[i] = messages[j]!
    messages[j] = tmp
  }

  return messages
}

export function buildRandomBranchTreeSeeds(
  count: number,
  baseSeed = 20260722
): number[] {
  return Array.from({ length: count }, (_, i) => baseSeed + i * 7919)
}

// Branch projection harness

/**
 * The canonical serializable projection compared between implementations:
 * selected path ids, per-message branch descriptors (sibling order included),
 * and normalization patches — the full observable surface of
 * `convex/domain/message_branches.ts`.
 */
export type BranchProjection = {
  selectedPath: Array<{
    id: string
    role: string
    orderId: number
    parentMessageId: string | null
    branchIndex: number | null
    selected: boolean | null
  }>
  branchInfo: Array<MessageBranchInfo | null>
  normalizationPatches: MessageBranchPatch[]
}

export type BranchProjectionImplementation = {
  name: string
  project: (messages: BenchMessage[]) => BranchProjection
}

type BranchProjectionOps = {
  getSelectedPathMessages: (messages: BenchMessage[]) => BenchMessage[]
  getBranchInfoForMessage: (
    messages: BenchMessage[],
    message: BenchMessage
  ) => MessageBranchInfo | undefined
  getSelectedPathBranchNormalizationPatches: (
    messages: BenchMessage[]
  ) => MessageBranchPatch[]
}

/**
 * Builds a projection through array-based ops for comparison benchmarks.
 */
function createArrayOpsImplementation(
  name: string,
  ops: BranchProjectionOps
): BranchProjectionImplementation {
  return {
    name,
    project: (messages) => {
      const selectedPath = ops.getSelectedPathMessages(messages)
      return {
        selectedPath: selectedPath.map((message) => ({
          id: String(message._id),
          role: message.role,
          orderId: message.orderId,
          parentMessageId: message.parentMessageId
            ? String(message.parentMessageId)
            : null,
          branchIndex: message.branchIndex ?? null,
          selected: message.selected ?? null,
        })),
        branchInfo: selectedPath.map(
          (message) => ops.getBranchInfoForMessage(messages, message) ?? null
        ),
        normalizationPatches:
          ops.getSelectedPathBranchNormalizationPatches(messages),
      }
    },
  }
}

/**
 * The per-call adapter pattern. Benchmark-only: production shares one context.
 */
export const arrayAdapterBranchImplementation = createArrayOpsImplementation(
  "per-call-adapters",
  {
    getSelectedPathMessages,
    getBranchInfoForMessage,
    getSelectedPathBranchNormalizationPatches,
  }
)

/**
 * One shared `BranchContext` per array version — the production shape.
 */
export const singlePassBranchImplementation: BranchProjectionImplementation = {
  name: "single-pass-context",
  project: (messages) => {
    const context = createBranchContext(messages)
    return createArrayOpsImplementation("single-pass-context", {
      getSelectedPathMessages: () =>
        getSelectedPathMessagesFromContext(context),
      getBranchInfoForMessage: (_messages, message) =>
        getBranchInfoForMessageFromContext(context, message),
      getSelectedPathBranchNormalizationPatches: () =>
        getSelectedPathBranchNormalizationPatchesFromContext(context),
    }).project(messages)
  },
}

function projectionHash(projection: BranchProjection): string {
  return hashValue(projection)
}

/**
 * Asserts every implementation produces byte-identical projections for the
 * given tree. Returns the shared hash and names mismatches.
 */
export function assertProjectionEquivalence(
  implementations: BranchProjectionImplementation[],
  messages: BenchMessage[],
  label: string
): string {
  if (implementations.length === 0) {
    throw new Error("assertProjectionEquivalence requires an implementation")
  }
  const results = implementations.map((impl) => ({
    name: impl.name,
    hash: projectionHash(impl.project(messages)),
  }))
  const [first, ...rest] = results
  for (const other of rest) {
    if (other.hash !== first!.hash) {
      throw new Error(
        `Branch projection mismatch on ${label}: ${first!.name}=${first!.hash} ${other.name}=${other.hash}`
      )
    }
  }
  return first!.hash
}

// Deterministic Markdown / code payloads

/**
 * Fixed mixed-Markdown payload (headings, lists, table, math, links, inline
 * code, one fence). Size is asserted to sit in the benchmark's 8–15 KB window.
 */
export function buildMarkdownPayload(): string {
  return buildSectionedMarkdownPayload(24)
}

/**
 * Shared section generator behind the mixed payloads: `sectionCount` controls
 * total size (24 sections ≈ 12 KB) without changing the per-section shape, so
 * the 12 KB and ~100 KB fixtures differ only in completed-block count.
 */
export function buildSectionedMarkdownPayload(sectionCount: number): string {
  const sections: string[] = ["# Deterministic mixed Markdown payload\n"]
  for (let section = 0; section < sectionCount; section++) {
    sections.push(
      `## Section ${section}: streaming behavior\n`,
      `Paragraph ${section} exercises **bold**, _italic_, \`inline code\`, and a ` +
        `[link ${section}](https://example.com/section-${section}) inside a ` +
        `sentence long enough to be split across many deltas without landing on ` +
        `a block boundary every time.\n`,
      `- item one for section ${section}\n- item two for section ${section}\n- item three with \`code\` for section ${section}\n`,
      `> Blockquote ${section} keeps the parser honest about container nodes.\n`
    )
    if (section % 3 === 0) {
      sections.push(
        `| column A | column B | column C |\n| --- | --- | --- |\n` +
          `| a${section} | b${section} | c${section} |\n| d${section} | e${section} | f${section} |\n`
      )
    }
    if (section % 4 === 0) {
      sections.push(`$$\\sum_{i=0}^{${section}} i^2 = \\frac{n(n+1)(2n+1)}{6}$$\n`)
    }
  }
  sections.push(
    "```ts\n" +
      Array.from(
        { length: 18 },
        (_, i) => `export const embedded${i} = ${i} * ${i}`
      ).join("\n") +
      "\n```\n",
    "Final paragraph after the fence so the payload does not end inside code.\n"
  )
  return sections.join("\n")
}

/**
 * Short prose payload (~500 characters) for the ADR-0016 renderer corpus:
 * plain sentences, no Markdown constructs beyond emphasis, single paragraph.
 */
export function buildShortProsePayload(): string {
  return (
    "Streaming answers should appear the moment the provider emits them, " +
    "stay smooth while the response grows, and settle into exactly the " +
    "canonical text. This short prose fixture exists so the fastest path — " +
    "one growing paragraph with *light* emphasis and no code — is measured " +
    "on its own, without amortizing any cost against heavier Markdown. It " +
    "is deterministic, content-safe, and sized near five hundred characters " +
    "so first-token and per-delta costs dominate the numbers."
  )
}

/**
 * Long mixed payload (~100 KB): the same section shape as
 * the 12 KB fixture repeated until ~100 KB of COMPLETED blocks, ending in a
 * short growing terminal paragraph. Per-update projection cost on this
 * payload must track the terminal region, not the accumulated size.
 */
export function buildLongMarkdownPayload(): string {
  return (
    buildSectionedMarkdownPayload(210) +
    "\nShort growing terminal paragraph under construction"
  )
}

/**
 * Many short completed blocks with a small mutable tail:
 * block COUNT is the stressor (memo/reconciliation overhead per block),
 * where the ~100 KB payload stresses accumulated BYTES.
 */
export function buildManyShortBlocksPayload(): string {
  const blocks: string[] = []
  for (let i = 0; i < 400; i++) {
    blocks.push(`Short completed paragraph number ${i}.`)
  }
  blocks.push("Growing tail paragraph")
  return blocks.join("\n\n")
}

/**
 * Code stress payload: a single fenced block large enough
 * to reproduce the historical full-rehighlight tab pressure (the section-6
 * freeze class) without crashing CI. 1600 lines ≈ 4× the 400-line fixture.
 */
export function buildCodeStressPayload(): string {
  return buildCodePayload(1600)
}

/** Deterministic TypeScript payload with `lineCount` lines (250–500 window). */
export function buildCodePayload(lineCount = 400): string {
  const lines: string[] = []
  for (let i = 0; i < lineCount; i++) {
    switch (i % 5) {
      case 0:
        lines.push(`export function generated${i}(input: number): number {`)
        break
      case 1:
        lines.push(`  const scaled = input * ${i} + ${(i * 31) % 97}`)
        break
      case 2:
        lines.push(`  if (scaled % 2 === 0) return scaled / 2`)
        break
      case 3:
        lines.push(`  return scaled + ${i}`)
        break
      default:
        lines.push(`}`)
    }
  }
  return lines.join("\n")
}

// Deterministic stream fixture

export type StreamChunkRate = 10 | 30 | 100

export type StreamScenario =
  | "text-only"
  | "mixed-markdown"
  | "code-block"
  | "interleaved"
  | "partial-error"
  | "stop-during-text"

export type StreamChunkEvent =
  | { sequence: number; atMs: number; type: "start" }
  | { sequence: number; atMs: number; type: "reasoning-delta"; delta: string }
  | { sequence: number; atMs: number; type: "text-delta"; delta: string }
  | {
      sequence: number
      atMs: number
      type: "source"
      sourceId: string
      url: string
    }
  | {
      sequence: number
      atMs: number
      type: "tool-input"
      toolCallId: string
      toolName: string
      dynamic: boolean
    }
  | {
      sequence: number
      atMs: number
      type: "tool-output"
      toolCallId: string
      toolName: string
    }
  | {
      sequence: number
      atMs: number
      type: "approval-request"
      toolCallId: string
      approvalId: string
    }
  | {
      sequence: number
      atMs: number
      type: "approval-continuation"
      approvalId: string
    }
  | { sequence: number; atMs: number; type: "error"; message: string }
  | { sequence: number; atMs: number; type: "abort" }
  | { sequence: number; atMs: number; type: "finish" }

export type StreamScriptOptions = {
  scenario: StreamScenario
  chunksPerSecond: StreamChunkRate
  /** Characters of payload text carried per text/reasoning delta. */
  deltaSize?: number
}

function chunkString(payload: string, deltaSize: number): string[] {
  const chunks: string[] = []
  for (let offset = 0; offset < payload.length; offset += deltaSize) {
    chunks.push(payload.slice(offset, offset + deltaSize))
  }
  return chunks
}

/**
 * Builds the deterministic chunk script for a scenario. Timing is virtual:
 * chunk `i` is stamped at exactly `round(i * 1000 / chunksPerSecond)` ms.
 * Sequences are dense (0..n-1) so any missing, duplicated, or reordered
 * update fails loudly in `foldStreamScript`.
 */
export function buildStreamScript({
  scenario,
  chunksPerSecond,
  deltaSize = 40,
}: StreamScriptOptions): StreamChunkEvent[] {
  const bodies: Array<
    | { type: "reasoning-delta"; delta: string }
    | { type: "text-delta"; delta: string }
    | { type: "source"; sourceId: string; url: string }
    | {
        type: "tool-input"
        toolCallId: string
        toolName: string
        dynamic: boolean
      }
    | { type: "tool-output"; toolCallId: string; toolName: string }
    | { type: "approval-request"; toolCallId: string; approvalId: string }
    | { type: "approval-continuation"; approvalId: string }
    | { type: "error"; message: string }
    | { type: "abort" }
    | { type: "finish" }
  > = []

  const pushText = (payload: string) => {
    for (const delta of chunkString(payload, deltaSize)) {
      bodies.push({ type: "text-delta", delta })
    }
  }
  const pushReasoning = (payload: string) => {
    for (const delta of chunkString(payload, deltaSize)) {
      bodies.push({ type: "reasoning-delta", delta })
    }
  }

  const markdown = buildMarkdownPayload()
  const code = buildCodePayload()

  switch (scenario) {
    case "text-only": {
      pushText(markdown)
      bodies.push({ type: "finish" })
      break
    }
    case "mixed-markdown": {
      pushReasoning("Considering structure before answering. ".repeat(6))
      pushText(markdown)
      bodies.push({ type: "finish" })
      break
    }
    case "code-block": {
      pushText("Here is the generated module:\n\n```ts\n")
      pushText(code)
      pushText("\n```\n\nDone.\n")
      bodies.push({ type: "finish" })
      break
    }
    case "interleaved": {
      pushReasoning("Planning the answer in two tool steps. ".repeat(4))
      pushText(markdown.slice(0, markdown.length / 2))
      bodies.push(
        { type: "source", sourceId: "src_1", url: "https://example.com/one" },
        { type: "source", sourceId: "src_2", url: "https://example.com/two" },
        {
          type: "tool-input",
          toolCallId: "call_static",
          toolName: "search",
          dynamic: false,
        },
        { type: "tool-output", toolCallId: "call_static", toolName: "search" },
        {
          type: "tool-input",
          toolCallId: "call_dynamic",
          toolName: "mcp_write",
          dynamic: true,
        },
        {
          type: "approval-request",
          toolCallId: "call_dynamic",
          approvalId: "approval_1",
        },
        { type: "approval-continuation", approvalId: "approval_1" },
        {
          type: "tool-output",
          toolCallId: "call_dynamic",
          toolName: "mcp_write",
        }
      )
      pushText(markdown.slice(markdown.length / 2))
      bodies.push({ type: "finish" })
      break
    }
    case "partial-error": {
      pushText(markdown.slice(0, Math.floor(markdown.length / 3)))
      bodies.push({ type: "error", message: "provider_stream_interrupted" })
      break
    }
    case "stop-during-text": {
      pushText(markdown.slice(0, Math.floor(markdown.length / 2)))
      bodies.push({ type: "abort" })
      break
    }
  }

  const events: StreamChunkEvent[] = [{ sequence: 0, atMs: 0, type: "start" }]
  bodies.forEach((body, index) => {
    const sequence = index + 1
    events.push({
      sequence,
      atMs: Math.round((sequence * 1000) / chunksPerSecond),
      ...body,
    })
  })
  return events
}

export type FoldedStream = {
  reasoningText: string
  text: string
  sources: Array<{ sourceId: string; url: string }>
  tools: Array<{
    toolCallId: string
    toolName: string
    dynamic: boolean
    state: "input-available" | "output-available"
  }>
  approvals: Array<{
    approvalId: string
    toolCallId: string
    state: "pending" | "continued"
  }>
  terminal: "finish" | "error" | "abort"
  errorMessage?: string
  /** Ordered part list — the final UIMessage-shaped output for equality gates. */
  parts: Array<Record<string, unknown>>
}

/**
 * Folds a script into its final message state while enforcing the loud-failure
 * contract: dense monotonic sequences, non-decreasing virtual time, exactly
 * one terminal event, and nothing after the terminal.
 */
export function foldStreamScript(events: StreamChunkEvent[]): FoldedStream {
  let reasoningText = ""
  let text = ""
  const sources: FoldedStream["sources"] = []
  const tools = new Map<
    string,
    { toolCallId: string; toolName: string; dynamic: boolean; state: "input-available" | "output-available" }
  >()
  const approvals = new Map<
    string,
    { approvalId: string; toolCallId: string; state: "pending" | "continued" }
  >()
  const parts: FoldedStream["parts"] = []
  let terminal: FoldedStream["terminal"] | undefined
  let errorMessage: string | undefined
  let lastAtMs = -1

  events.forEach((event, index) => {
    if (event.sequence !== index) {
      throw new Error(
        `Stream sequence violation at index ${index}: got sequence ${event.sequence} (missing, duplicated, or reordered chunk)`
      )
    }
    if (event.atMs < lastAtMs) {
      throw new Error(
        `Stream timing violation at sequence ${event.sequence}: atMs ${event.atMs} < ${lastAtMs}`
      )
    }
    lastAtMs = event.atMs
    if (terminal !== undefined) {
      throw new Error(
        `Stream received ${event.type} after terminal ${terminal} at sequence ${event.sequence}`
      )
    }

    switch (event.type) {
      case "start":
        if (index !== 0) throw new Error("start must be the first chunk")
        break
      case "reasoning-delta":
        reasoningText += event.delta
        break
      case "text-delta":
        text += event.delta
        break
      case "source":
        sources.push({ sourceId: event.sourceId, url: event.url })
        parts.push({ type: "source-url", sourceId: event.sourceId, url: event.url })
        break
      case "tool-input":
        tools.set(event.toolCallId, {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          dynamic: event.dynamic,
          state: "input-available",
        })
        break
      case "tool-output": {
        const tool = tools.get(event.toolCallId)
        if (!tool) {
          throw new Error(
            `tool-output for unknown toolCallId ${event.toolCallId}`
          )
        }
        tool.state = "output-available"
        break
      }
      case "approval-request": {
        if (!tools.has(event.toolCallId)) {
          throw new Error(
            `approval-request for unknown toolCallId ${event.toolCallId}`
          )
        }
        approvals.set(event.approvalId, {
          approvalId: event.approvalId,
          toolCallId: event.toolCallId,
          state: "pending",
        })
        break
      }
      case "approval-continuation": {
        const approval = approvals.get(event.approvalId)
        if (!approval) {
          throw new Error(
            `approval-continuation for unknown approvalId ${event.approvalId}`
          )
        }
        if (approval.state !== "pending") {
          throw new Error(
            `approval ${event.approvalId} continued twice (one-shot continuation violated)`
          )
        }
        approval.state = "continued"
        break
      }
      case "error":
        terminal = "error"
        errorMessage = event.message
        break
      case "abort":
        terminal = "abort"
        break
      case "finish":
        terminal = "finish"
        break
    }
  })

  if (terminal === undefined) {
    throw new Error("Stream script ended without a terminal chunk")
  }

  if (reasoningText) parts.unshift({ type: "reasoning", text: reasoningText })
  for (const tool of tools.values()) {
    parts.push({
      type: tool.dynamic ? "dynamic-tool" : `tool-${tool.toolName}`,
      toolCallId: tool.toolCallId,
      state: tool.state,
    })
  }
  if (text) parts.push({ type: "text", text })

  return {
    reasoningText,
    text,
    sources,
    tools: [...tools.values()],
    approvals: [...approvals.values()],
    terminal,
    errorMessage,
    parts,
  }
}

// Measurement helpers and environment recording

export type MeasureResult = {
  warmupIterations: number
  samples: number[]
  medianMs: number
  p95Ms: number
}

/** Simple warmed sampler used by the release-gate tests (median/p95). */
export function measure(
  fn: () => void,
  { warmupIterations = 5, sampleCount = 30 } = {}
): MeasureResult {
  for (let i = 0; i < warmupIterations; i++) fn()
  const samples: number[] = []
  for (let i = 0; i < sampleCount; i++) {
    const start = performance.now()
    fn()
    samples.push(performance.now() - start)
  }
  const sorted = [...samples].sort((a, b) => a - b)
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] ?? 0
  return {
    warmupIterations,
    samples,
    medianMs: at(0.5),
    p95Ms: at(0.95),
  }
}

export type BenchEnvironment = {
  platform: string
  release: string
  arch: string
  cpuModel: string
  cpuCount: number
  nodeVersion: string
  bunVersion: string | null
}

/** Runtime/OS/CPU metadata recorded next to every benchmark result. */
export async function describeBenchEnvironment(): Promise<BenchEnvironment> {
  const os = await import("os")
  return {
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    cpuCount: os.cpus().length,
    nodeVersion: process.version,
    bunVersion: process.versions.bun ?? null,
  }
}
