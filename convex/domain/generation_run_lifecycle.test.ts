import { describe, expect, it } from "vitest"
import {
  isIgnoredSignal,
  isSupersedableGenerationRunStatus,
  isSupersedableMessageStatus,
  resolveGenerationRunTransition,
  resolveTerminalAssistantMessageResolution,
  type AssistantMessageFacts,
  type LifecycleSignal,
  type LifecycleVerdict,
} from "./generation_run_lifecycle"

// A semantic, non-reused message — the "ordinary partial answer" facts. Terminal
// signals stamp it; individual cases override the fields that carry the rule.
const semanticFacts: AssistantMessageFacts = {
  hasSemanticParts: true,
  isReusedForRegeneration: false,
  hasSnapshotForRun: false,
  fallbackSiblingId: null,
}

function resolve(
  runStatus: unknown,
  signal: LifecycleSignal,
  message: AssistantMessageFacts | null = null
): LifecycleVerdict {
  return resolveGenerationRunTransition({ runStatus, message }, signal)
}

describe("resolveGenerationRunTransition", () => {
  describe("race convergence — first terminal outcome wins", () => {
    it("fail overwrites completed (onError vs envelope must converge to failed)", () => {
      // Both orders converge: completed-then-fail lands here (completed → failed),
      // and fail-then-completed no-ops the completion (see complete-from-terminal).
      const verdict = resolve(
        "completed",
        { kind: "fail", error: "boom" },
        semanticFacts
      )
      expect(verdict).toMatchObject({
        kind: "transition",
        run: { status: "failed", error: "boom", settle: true },
      })
    })

    it("fail from aborted is ignored (a user Stop is settled)", () => {
      expect(resolve("aborted", { kind: "fail", error: "late" })).toEqual({
        kind: "ignore",
        reason: "already-terminal",
      })
    })

    it("fail from failed is ignored (idempotent)", () => {
      expect(resolve("failed", { kind: "fail", error: "again" })).toEqual({
        kind: "ignore",
        reason: "already-terminal",
      })
    })

    it("abort from failed is ignored", () => {
      expect(resolve("failed", { kind: "abort", reason: "stop" })).toEqual({
        kind: "ignore",
        reason: "already-terminal",
      })
    })

    it("abort from completed is ignored", () => {
      expect(resolve("completed", { kind: "abort", reason: "stop" })).toEqual({
        kind: "ignore",
        reason: "already-terminal",
      })
    })

    it("complete from aborted is ignored (the envelope finish must not repaint a Stop)", () => {
      expect(
        resolve("aborted", { kind: "complete", hasPendingApprovals: false })
      ).toEqual({ kind: "ignore", reason: "already-terminal" })
    })

    // awaiting_approval is ACTIVE, not terminal — a paused run must still be
    // closable by a failure or a user Stop (the old per-site guards allowed
    // this; these rows pin that the isActive translation preserved it).
    it("fail from awaiting_approval transitions to failed", () => {
      expect(
        resolve("awaiting_approval", { kind: "fail", error: "boom" })
      ).toMatchObject({
        kind: "transition",
        run: { status: "failed", error: "boom", settle: true },
      })
    })

    it("abort from awaiting_approval transitions to aborted", () => {
      expect(
        resolve("awaiting_approval", { kind: "abort", reason: "stop" })
      ).toMatchObject({
        kind: "transition",
        run: { status: "aborted", settle: true },
      })
    })
  })

  describe("pinned bug fixes — late writes on a settled run resolve to ignore", () => {
    it("approval-requested from aborted is ignored (no zombie awaiting_approval)", () => {
      expect(resolve("aborted", { kind: "approval-requested" })).toEqual({
        kind: "ignore",
        reason: "already-terminal",
      })
    })

    it("approvals-resolved from aborted is ignored", () => {
      expect(
        resolve("aborted", { kind: "approvals-resolved", anyDenied: false })
      ).toEqual({ kind: "ignore", reason: "already-terminal" })
    })

    it("approvals-resolved from completed is ignored", () => {
      expect(
        resolve("completed", { kind: "approvals-resolved", anyDenied: true })
      ).toEqual({ kind: "ignore", reason: "already-terminal" })
    })

    it("approvals-resolved from active non-paused runs is ignored", () => {
      for (const status of ["queued", "running", "streaming"]) {
        expect(
          resolve(status, { kind: "approvals-resolved", anyDenied: false })
        ).toEqual({ kind: "ignore", reason: "not-awaiting-approval" })
      }
    })
  })

  describe("approval shape", () => {
    it("complete with pending approvals downgrades to awaiting_approval and does not settle", () => {
      const verdict = resolve("streaming", {
        kind: "complete",
        hasPendingApprovals: true,
      })
      expect(verdict).toEqual({
        kind: "transition",
        run: {
          status: "awaiting_approval",
          clearActiveStream: true,
          settle: false,
        },
        message: { kind: "stamp", status: "awaiting_approval" },
      })
    })

    it("complete with no pending approvals settles completed", () => {
      const verdict = resolve("streaming", {
        kind: "complete",
        hasPendingApprovals: false,
      })
      expect(verdict).toEqual({
        kind: "transition",
        run: {
          status: "completed",
          clearActiveStream: true,
          settle: true,
          terminalReason: "completed",
        },
        message: { kind: "stamp", status: "completed" },
      })
    })

    it("approval-requested pauses without settling or clearing the active stream", () => {
      const verdict = resolve("streaming", { kind: "approval-requested" })
      expect(verdict).toEqual({
        kind: "transition",
        run: {
          status: "awaiting_approval",
          clearActiveStream: false,
          settle: false,
        },
        message: { kind: "stamp", status: "awaiting_approval" },
      })
    })

    it("approvals-resolved with any denied aborts the run", () => {
      const verdict = resolve("awaiting_approval", {
        kind: "approvals-resolved",
        anyDenied: true,
      })
      expect(verdict).toMatchObject({
        kind: "transition",
        run: { status: "aborted", settle: true },
        message: { kind: "none" },
      })
    })

    it("approvals-resolved with all approved completes the run", () => {
      const verdict = resolve("awaiting_approval", {
        kind: "approvals-resolved",
        anyDenied: false,
      })
      expect(verdict).toMatchObject({
        kind: "transition",
        run: { status: "completed", settle: true },
        message: { kind: "none" },
      })
    })
  })

  describe("supersede scope", () => {
    it("supersede from streaming aborts with the reason", () => {
      const verdict = resolve(
        "streaming",
        { kind: "supersede", reason: "superseded" },
        semanticFacts
      )
      expect(verdict).toMatchObject({
        kind: "transition",
        run: { status: "aborted", error: "superseded", settle: true },
      })
    })

    it("supersede from awaiting_approval is not-supersedable (paused runs are deny-pending's job)", () => {
      expect(
        resolve("awaiting_approval", {
          kind: "supersede",
          reason: "superseded",
        })
      ).toEqual({ kind: "ignore", reason: "not-supersedable" })
    })

    it("supersede from completed is not-supersedable", () => {
      expect(
        resolve("completed", { kind: "supersede", reason: "superseded" })
      ).toEqual({ kind: "ignore", reason: "not-supersedable" })
    })
  })

  describe("terminal message half rides the run transition", () => {
    it("abort of a semantic message stamps it, keeping content", () => {
      const verdict = resolve(
        "streaming",
        { kind: "abort", reason: "stop" },
        semanticFacts
      )
      expect(verdict).toMatchObject({
        kind: "transition",
        message: { kind: "stamp", status: "aborted", error: "stop" },
      })
    })

    it("abort of an unresolvable message leaves the message half as none", () => {
      const verdict = resolve(
        "streaming",
        { kind: "abort", reason: "stop" },
        null
      )
      expect(verdict).toMatchObject({
        kind: "transition",
        message: { kind: "none" },
      })
    })
  })
})

describe("resolveTerminalAssistantMessageResolution — first match wins", () => {
  const outcome = { status: "aborted" as const, error: "stop" }

  it("restores a reused regeneration that died pre-snapshot with prior content", () => {
    expect(
      resolveTerminalAssistantMessageResolution(
        {
          hasSemanticParts: true,
          isReusedForRegeneration: true,
          hasSnapshotForRun: false,
          fallbackSiblingId: "sibling_1",
        },
        outcome
      )
    ).toEqual({ kind: "restore-completed" })
  })

  it("does NOT restore once a snapshot exists — it stamps the partial content instead", () => {
    // A reused regeneration that produced a snapshot is a real partial answer:
    // the restore precedence yields to the stamp so the partial survives aborted.
    expect(
      resolveTerminalAssistantMessageResolution(
        {
          hasSemanticParts: true,
          isReusedForRegeneration: true,
          hasSnapshotForRun: true,
          fallbackSiblingId: null,
        },
        outcome
      )
    ).toEqual({ kind: "stamp", status: "aborted", error: "stop" })
  })

  it("deletes an empty placeholder and reselects its semantic sibling", () => {
    expect(
      resolveTerminalAssistantMessageResolution(
        {
          hasSemanticParts: false,
          isReusedForRegeneration: false,
          hasSnapshotForRun: false,
          fallbackSiblingId: "sibling_1",
        },
        outcome
      )
    ).toEqual({ kind: "delete-and-reselect", siblingId: "sibling_1" })
  })

  it("keeps an empty placeholder with no sibling as a Terminal outcome stub", () => {
    expect(
      resolveTerminalAssistantMessageResolution(
        {
          hasSemanticParts: false,
          isReusedForRegeneration: false,
          hasSnapshotForRun: false,
          fallbackSiblingId: null,
        },
        { status: "failed", error: "provider down" }
      )
    ).toEqual({ kind: "keep-stub", status: "failed", error: "provider down" })
  })

  it("delete-and-reselect (empty + sibling) beats the reused-regen restore when the message is empty", () => {
    // The restore branch requires semantic parts; an empty reused message with a
    // sibling falls through to delete-and-reselect, not restore.
    expect(
      resolveTerminalAssistantMessageResolution(
        {
          hasSemanticParts: false,
          isReusedForRegeneration: true,
          hasSnapshotForRun: false,
          fallbackSiblingId: "sibling_1",
        },
        outcome
      )
    ).toEqual({ kind: "delete-and-reselect", siblingId: "sibling_1" })
  })
})

describe("durable control signals (gameplan §10)", () => {
  it("stop reaches every active status — including the approval pause — and stamps user_stop", () => {
    for (const status of [
      "queued",
      "running",
      "streaming",
      "awaiting_approval",
    ]) {
      expect(
        resolve(status, { kind: "stop", reason: "stopped" }, semanticFacts)
      ).toMatchObject({
        kind: "transition",
        run: {
          status: "aborted",
          settle: true,
          terminalReason: "user_stop",
        },
        message: { kind: "stamp", status: "aborted" },
      })
    }
  })

  it("stop on a settled run is ignored (idempotent second Stop, completion race)", () => {
    for (const status of ["completed", "aborted", "failed"]) {
      expect(resolve(status, { kind: "stop" })).toEqual({
        kind: "ignore",
        reason: "already-terminal",
      })
    }
  })

  it("lease-expired fails only worker-executing statuses, preserving partial content", () => {
    for (const status of ["queued", "running", "streaming"]) {
      expect(
        resolve(status, { kind: "lease-expired" }, semanticFacts)
      ).toMatchObject({
        kind: "transition",
        run: {
          status: "failed",
          settle: true,
          terminalReason: "lease_expired",
        },
        message: { kind: "stamp", status: "failed" },
      })
    }
  })

  it("lease-expired never touches the lease-free approval pause or a settled run", () => {
    expect(resolve("awaiting_approval", { kind: "lease-expired" })).toEqual({
      kind: "ignore",
      reason: "not-worker-executing",
    })
    for (const status of ["completed", "aborted", "failed"]) {
      expect(resolve(status, { kind: "lease-expired" })).toEqual({
        kind: "ignore",
        reason: "already-terminal",
      })
    }
  })

  it("approval-expired settles only the approval pause", () => {
    expect(
      resolve("awaiting_approval", { kind: "approval-expired" }, semanticFacts)
    ).toMatchObject({
      kind: "transition",
      run: {
        status: "failed",
        settle: true,
        terminalReason: "approval_expired",
      },
    })
    expect(resolve("streaming", { kind: "approval-expired" })).toEqual({
      kind: "ignore",
      reason: "not-awaiting-approval",
    })
    expect(resolve("aborted", { kind: "approval-expired" })).toEqual({
      kind: "ignore",
      reason: "already-terminal",
    })
  })

  it("continuation-lost settles only the approval pause: denied → aborted, approved → failed, never a resurrection", () => {
    expect(
      resolve(
        "awaiting_approval",
        { kind: "continuation-lost", anyDenied: false },
        semanticFacts
      )
    ).toMatchObject({
      kind: "transition",
      run: {
        status: "failed",
        settle: true,
        terminalReason: "continuation_lost",
      },
    })
    expect(
      resolve(
        "awaiting_approval",
        { kind: "continuation-lost", anyDenied: true },
        semanticFacts
      )
    ).toMatchObject({
      kind: "transition",
      run: {
        status: "aborted",
        settle: true,
        terminalReason: "continuation_lost",
      },
    })
    expect(
      resolve("streaming", { kind: "continuation-lost", anyDenied: false })
    ).toEqual({ kind: "ignore", reason: "not-awaiting-approval" })
    // A Stop-settled (or already-continued) pause is untouchable.
    for (const status of ["completed", "aborted", "failed"]) {
      expect(
        resolve(status, { kind: "continuation-lost", anyDenied: false })
      ).toEqual({ kind: "ignore", reason: "already-terminal" })
    }
  })

  it("reaped runs become failed, never completed — and stay absorbing against late completion", () => {
    const reaped = resolve("streaming", { kind: "lease-expired" })
    expect(reaped).toMatchObject({ kind: "transition", run: { status: "failed" } })
    // A late spurious completion after reaping is ignored (first terminal wins).
    expect(
      resolve("failed", { kind: "complete", hasPendingApprovals: false })
    ).toEqual({ kind: "ignore", reason: "already-terminal" })
  })
})

describe("terminal reasons ride the transitions", () => {
  it("stamps the vocabulary per signal", () => {
    expect(
      resolve("streaming", { kind: "complete", hasPendingApprovals: false })
    ).toMatchObject({ run: { terminalReason: "completed" } })
    expect(resolve("streaming", { kind: "fail", error: "x" })).toMatchObject({
      run: { terminalReason: "provider_error" },
    })
    expect(resolve("streaming", { kind: "abort" })).toMatchObject({
      run: { terminalReason: "request_aborted" },
    })
    expect(
      resolve("streaming", { kind: "supersede", reason: "newer turn" })
    ).toMatchObject({ run: { terminalReason: "superseded" } })
  })

  it("the awaiting_approval downgrade carries no terminal reason (it does not settle)", () => {
    expect(
      resolve("streaming", { kind: "complete", hasPendingApprovals: true })
    ).toMatchObject({
      run: { status: "awaiting_approval", settle: false },
    })
    const verdict = resolve("streaming", {
      kind: "complete",
      hasPendingApprovals: true,
    })
    expect(
      verdict.kind === "transition" ? verdict.run.terminalReason : "unreached"
    ).toBeUndefined()
  })

  it("fail-over-completed rewrites the terminal reason to provider_error", () => {
    expect(
      resolve("completed", { kind: "fail", error: "boom" }, semanticFacts)
    ).toMatchObject({
      run: { status: "failed", terminalReason: "provider_error" },
    })
  })
})

describe("isIgnoredSignal", () => {
  it("agrees with the resolver's ignore column for every status × signal", () => {
    const statuses = [
      "queued",
      "running",
      "streaming",
      "awaiting_approval",
      "completed",
      "aborted",
      "failed",
    ]
    const signals: LifecycleSignal[] = [
      { kind: "complete", hasPendingApprovals: true },
      { kind: "fail", error: "boom" },
      { kind: "abort", reason: "stop" },
      { kind: "supersede", reason: "superseded" },
      { kind: "approval-requested" },
      { kind: "approvals-resolved", anyDenied: true },
      { kind: "stop", reason: "stopped" },
      { kind: "lease-expired" },
      { kind: "approval-expired" },
      { kind: "continuation-lost", anyDenied: false },
    ]
    for (const status of statuses) {
      for (const signal of signals) {
        expect(isIgnoredSignal(status, signal.kind)).toBe(
          resolve(status, signal).kind === "ignore"
        )
      }
    }
  })
})

describe("supersedable predicates", () => {
  it("supersedable run statuses are the pre-terminal, pre-pause states", () => {
    expect(isSupersedableGenerationRunStatus("queued")).toBe(true)
    expect(isSupersedableGenerationRunStatus("running")).toBe(true)
    expect(isSupersedableGenerationRunStatus("streaming")).toBe(true)
    expect(isSupersedableGenerationRunStatus("awaiting_approval")).toBe(false)
    expect(isSupersedableGenerationRunStatus("completed")).toBe(false)
    expect(isSupersedableGenerationRunStatus("aborted")).toBe(false)
    expect(isSupersedableGenerationRunStatus("failed")).toBe(false)
  })

  it("supersedable message statuses are the live-run states only", () => {
    expect(isSupersedableMessageStatus("submitted")).toBe(true)
    expect(isSupersedableMessageStatus("streaming")).toBe(true)
    expect(isSupersedableMessageStatus("awaiting_approval")).toBe(false)
    expect(isSupersedableMessageStatus("completed")).toBe(false)
    expect(isSupersedableMessageStatus("aborted")).toBe(false)
    expect(isSupersedableMessageStatus("failed")).toBe(false)
  })
})
