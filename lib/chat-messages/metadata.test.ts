import type { PersistedMessageMetadata } from "@/convex/lib/messageMetadata"
import type { ToolInvocationStreamMetadata } from "@/lib/tools/ui-metadata"
import { describe, expect, it } from "vitest"
import type { MessageBranchInfo } from "./branch"
import {
  adoptServerOwned,
  getBranch,
  getServerMessageId,
  getToolDisplayMetadataRecords,
  SERVER_OWNED_METADATA_KEYS,
  stampServerFields,
  type DurableMetadataSource,
} from "./metadata"

// Drift guard across the persistence boundary: the Convex persisted-metadata
// validator and the client stream-metadata type must stay structurally
// identical. The key-set assertion catches optional-key drift, while the
// assignments catch value-type drift. (Lives here, not in convex/, because
// Convex's own tsc lacks the "@/" alias.)
type Assert<T extends true> = T
type MetadataKeyDrift =
  | Exclude<keyof PersistedMessageMetadata, keyof ToolInvocationStreamMetadata>
  | Exclude<keyof ToolInvocationStreamMetadata, keyof PersistedMessageMetadata>

const _metadataKeysMatch: Assert<
  [MetadataKeyDrift] extends [never] ? true : false
> = true
const _toPersisted: PersistedMessageMetadata =
  {} as ToolInvocationStreamMetadata
const _toClient: ToolInvocationStreamMetadata = {} as PersistedMessageMetadata
void _metadataKeysMatch
void _toPersisted
void _toClient

const branch: MessageBranchInfo = {
  messageId: "m1",
  currentIndex: 1,
  total: 2,
  siblings: [{ messageId: "m0" }, { messageId: "m1" }],
}

/** A stored message with every server-owned field populated. */
const fullSource: DurableMetadataSource = {
  _id: "server_1",
  status: "complete",
  error: { message: "boom" },
  generationRunId: "run_1",
  requestId: "req_1",
  model: "claude",
  provider: "anthropic",
  finishReason: "stop",
  usage: { totalTokens: 10 },
}

describe("stampServerFields", () => {
  it("projects every server-owned key in extended mode, plus the id", () => {
    const result = stampServerFields({}, fullSource, "extended")
    expect(new Set(Object.keys(result))).toEqual(
      new Set(["serverMessageId", ...SERVER_OWNED_METADATA_KEYS])
    )
    expect(result.serverMessageId).toBe("server_1")
    // status → durableStatus, error → durableError renames.
    expect(result.durableStatus).toBe("complete")
    expect(result.durableError).toEqual({ message: "boom" })
    expect(result.model).toBe("claude")
    expect(result.usage).toEqual({ totalTokens: 10 })
  })

  it("projects only id, status, and error in runtime mode", () => {
    const result = stampServerFields({}, fullSource, "runtime")
    expect(new Set(Object.keys(result))).toEqual(
      new Set(["serverMessageId", "durableStatus", "durableError"])
    )
  })

  it("omits undefined source fields rather than writing them", () => {
    const result = stampServerFields(
      {},
      { _id: "s", status: "pending" },
      "extended"
    )
    expect(result).toEqual({ serverMessageId: "s", durableStatus: "pending" })
    expect("model" in result).toBe(false)
  })

  it("clears stale server-owned keys before applying the selected projection", () => {
    const base = {
      durableStatus: "complete",
      generationRunId: "old_run",
      model: "old_model",
      provider: "old_provider",
      reasoningDurationMs: 1234,
    }

    expect(stampServerFields(base, { _id: "s" }, "extended")).toEqual({
      serverMessageId: "s",
      reasoningDurationMs: 1234,
    })

    expect(
      stampServerFields(base, { _id: "s", status: "pending" }, "runtime")
    ).toEqual({
      serverMessageId: "s",
      durableStatus: "pending",
      reasoningDurationMs: 1234,
    })
  })

  it("normalizes a valid branch descriptor and drops an invalid one", () => {
    expect(
      getBranch({
        metadata: stampServerFields({ branch }, { _id: "s" }, "extended"),
      })
    ).toEqual(branch)
    const dropped = stampServerFields(
      { branch: { bogus: true } },
      { _id: "s" },
      "extended"
    )
    expect("branch" in dropped).toBe(false)
  })

  it("preserves client-owned transient keys it does not own", () => {
    const result = stampServerFields(
      { reasoningDurationMs: 1234 },
      { _id: "s" },
      "extended"
    )
    expect(result.reasoningDurationMs).toBe(1234)
  })
})

describe("adoptServerOwned", () => {
  const serverMetadata = stampServerFields({ branch }, fullSource, "extended")

  it("adopts the server's id, branch, and every owned key", () => {
    const result = adoptServerOwned({ model: "stale" }, serverMetadata)
    expect(getServerMessageId(result)).toBe("server_1")
    expect(getBranch({ metadata: result })).toEqual(branch)
    for (const key of SERVER_OWNED_METADATA_KEYS) {
      expect((result as Record<string, unknown>)[key]).toEqual(
        (serverMetadata as Record<string, unknown>)[key]
      )
    }
  })

  it("clears an owned key the server no longer has", () => {
    const local = { model: "old", durableStatus: "complete" }
    const server = { serverMessageId: "s", model: "new" }
    const result = adoptServerOwned(local, server) as Record<string, unknown>
    expect(result.model).toBe("new")
    expect("durableStatus" in result).toBe(false)
  })

  it("clears a stale branch when the server message has none", () => {
    const local = stampServerFields({ branch }, fullSource, "extended")
    const result = adoptServerOwned(local, { serverMessageId: "server_1" })
    expect(getBranch({ metadata: result })).toBeUndefined()
  })

  it("preserves client-owned transient keys", () => {
    const result = adoptServerOwned(
      { reasoningDurationMs: 99 },
      serverMetadata
    ) as Record<string, unknown>
    expect(result.reasoningDurationMs).toBe(99)
  })

  it("returns the original reference on a no-op (idempotent)", () => {
    const already = stampServerFields({ branch }, fullSource, "extended")
    // Adopting the same server metadata onto an equivalent local must not
    // allocate a new object — the projection relies on referential stability.
    const result = adoptServerOwned(already, serverMetadata)
    expect(result).toBe(already)
  })

  it("keeps fresh but structurally equal owned metadata idempotent", () => {
    const local = stampServerFields(
      {
        branch,
        durableError: { message: "boom" },
        usage: { totalTokens: 10 },
      },
      {
        ...fullSource,
        error: { message: "boom" },
        usage: { totalTokens: 10 },
      },
      "extended"
    )
    const server = stampServerFields(
      { branch },
      {
        ...fullSource,
        error: { message: "boom" },
        usage: { totalTokens: 10 },
      },
      "extended"
    )

    expect(adoptServerOwned(local, server)).toBe(local)
  })
})

describe("server-owned key-set drift guard", () => {
  it("stampServerFields and adoptServerOwned agree on the owned key-set", () => {
    // The keys stampServerFields writes (minus the id + branch) must be exactly
    // the set adoptServerOwned governs. Both derive from one source, so this
    // fails the moment a key is added to one writer and not the other.
    const written = new Set(
      Object.keys(stampServerFields({}, fullSource, "extended"))
    )
    written.delete("serverMessageId")

    const local: Record<string, unknown> = {}
    for (const key of SERVER_OWNED_METADATA_KEYS) local[key] = "x"
    const adopted = adoptServerOwned(local, { serverMessageId: "s" }) as Record<
      string,
      unknown
    >
    // adoptServerOwned cleared every owned key the empty server lacked.
    const governed = SERVER_OWNED_METADATA_KEYS.filter((k) => !(k in adopted))

    expect(written).toEqual(new Set(SERVER_OWNED_METADATA_KEYS))
    expect(new Set(governed)).toEqual(new Set(SERVER_OWNED_METADATA_KEYS))
  })
})

describe("getToolDisplayMetadataRecords", () => {
  it("does not expose a mutable shared empty fallback", () => {
    const records = getToolDisplayMetadataRecords(undefined)
    expect(Object.isFrozen(records)).toBe(true)
    expect(Object.isFrozen(records.byName)).toBe(true)
    expect(Object.isFrozen(records.byCallId)).toBe(true)

    try {
      ;(records.byName as Record<string, unknown>).leaked = true
      ;(records.byCallId as Record<string, unknown>).leaked = true
    } catch {
      // Strict-mode runtimes throw on frozen-object writes; loose runtimes
      // silently ignore them. Either behavior must leave the fallback empty.
    }

    const nextRecords = getToolDisplayMetadataRecords(null)
    expect(nextRecords.byName).not.toHaveProperty("leaked")
    expect(nextRecords.byCallId).not.toHaveProperty("leaked")
  })
})
