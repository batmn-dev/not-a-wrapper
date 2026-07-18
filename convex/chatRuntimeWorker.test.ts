import { describe, expect, it } from "vitest"
import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx } from "./_generated/server"
import { requireGrantAuthorizedRun } from "./chatRuntimeWorker"
import { sha256Hex, timingSafeEqualHex } from "./lib/sha256"

// The execution-grant verifier (ADR-0011) — the only NEW authorization logic
// on the worker path. The dispatched `...ForChat` handlers behind it are
// covered by chatRuntime.test.ts; here we prove the grant gate itself.

const SECRET = "a".repeat(64)
const DIGEST = sha256Hex(SECRET)

function makeCtx(documents: Record<string, Record<string, unknown>>) {
  return {
    db: {
      get: async (id: string) => documents[id] ?? null,
    },
  } as unknown as MutationCtx
}

function makeGrantWorld(
  overrides: {
    run?: Partial<Doc<"generationRuns">>
    chat?: Partial<Doc<"chats">>
  } = {}
) {
  return makeCtx({
    run_1: {
      _id: "run_1",
      chatId: "chat_1",
      userId: "user_1",
      status: "streaming",
      grantDigest: DIGEST,
      grantExpiresAt: Date.now() + 60_000,
      ...overrides.run,
    },
    chat_1: { _id: "chat_1", userId: "user_1", ...overrides.chat },
    user_1: { _id: "user_1", workosUserId: "workos_user_1" },
  })
}

const runId = "run_1" as Id<"generationRuns">

describe("sha256Hex", () => {
  it("matches FIPS 180-4 test vectors", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    )
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    )
    // Multi-block input (> 64 bytes) exercises the chunk loop.
    expect(
      sha256Hex(
        "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"
      )
    ).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1")
  })

  it("compares hex digests without length leaks", () => {
    expect(timingSafeEqualHex(DIGEST, DIGEST)).toBe(true)
    expect(timingSafeEqualHex(DIGEST, sha256Hex("other"))).toBe(false)
    expect(timingSafeEqualHex(DIGEST, DIGEST.slice(1))).toBe(false)
  })
})

describe("requireGrantAuthorizedRun", () => {
  it("resolves the run owner for a valid, unexpired grant", async () => {
    const owner = await requireGrantAuthorizedRun(makeGrantWorld(), {
      runId,
      grantDigest: DIGEST,
    })
    expect(owner.run._id).toBe("run_1")
    expect(owner.chat._id).toBe("chat_1")
    expect(owner.user._id).toBe("user_1")
  })

  it("rejects a wrong digest without distinguishing it from a missing run", async () => {
    await expect(
      requireGrantAuthorizedRun(makeGrantWorld(), {
        runId,
        grantDigest: sha256Hex("wrong-secret"),
      })
    ).rejects.toThrow("Execution grant not authorized")
    await expect(
      requireGrantAuthorizedRun(makeCtx({}), { runId, grantDigest: DIGEST })
    ).rejects.toThrow("Execution grant not authorized")
  })

  it("rejects a run that never minted a grant", async () => {
    await expect(
      requireGrantAuthorizedRun(
        makeGrantWorld({
          run: { grantDigest: undefined, grantExpiresAt: undefined },
        }),
        { runId, grantDigest: DIGEST }
      )
    ).rejects.toThrow("Execution grant not authorized")
  })

  it("rejects an expired grant distinctly (legit workers need the telemetry)", async () => {
    await expect(
      requireGrantAuthorizedRun(
        makeGrantWorld({ run: { grantExpiresAt: Date.now() - 1 } }),
        { runId, grantDigest: DIGEST }
      )
    ).rejects.toThrow("Execution grant expired")
  })

  it("rejects when the run's chat is not owned by the run's user", async () => {
    await expect(
      requireGrantAuthorizedRun(
        makeGrantWorld({ chat: { userId: "user_2" as Id<"users"> } }),
        { runId, grantDigest: DIGEST }
      )
    ).rejects.toThrow("Execution grant not authorized")
  })
})
