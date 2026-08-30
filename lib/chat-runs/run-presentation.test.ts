import type { SelectedRunProjection } from "@/convex/messages"
import { describe, expect, it } from "vitest"
import {
  ORPHAN_STREAM_CUT_GRACE_MS,
  resolveGenerationPresentation,
  type RunPresentationInputs,
} from "./run-presentation"

// Table tests over the precedence ladder and lease/skew boundaries — the one
// place clock classification lives. Injected `now` throughout; no timers.

const NOW = 1_000_000
const GRACE = 5_000

// Loose override typing: test literals use plain strings where the wire type
// carries branded Convex ids.
function makeRun(
  overrides: Record<string, unknown> = {}
): SelectedRunProjection {
  return {
    runId: "run_1",
    assistantMessageId: "msg_1",
    status: "streaming",
    terminalReason: undefined,
    leaseExpiresAt: NOW + 30_000,
    pendingApproval: null,
    ...overrides,
  } as unknown as SelectedRunProjection
}

function resolve(overrides: Partial<RunPresentationInputs> = {}) {
  return resolveGenerationPresentation({
    localStatus: "ready",
    isSubmitting: false,
    localAssistantMessageId: null,
    selectedRun: null,
    pendingStopRunId: null,
    isConnected: true,
    now: NOW,
    skewGraceMs: GRACE,
    ...overrides,
  })
}

describe("guest / local-only reduction (selectedRun always null)", () => {
  it("reduces to current local behavior", () => {
    expect(resolve().state).toBe("settled")
    expect(resolve({ localStatus: "submitted" }).state).toBe("local-submitted")
    expect(resolve({ localStatus: "streaming" })).toMatchObject({
      state: "local-streaming",
      source: "local",
      active: true,
      stoppable: true,
      caretEligible: true,
    })
    expect(resolve({ isSubmitting: true }).state).toBe("local-submitted")
  })
})

describe("precedence ladder", () => {
  it("durable terminal beats a still-streaming matching local transport and cuts it", () => {
    const presentation = resolve({
      localStatus: "streaming",
      localAssistantMessageId: "msg_1",
      selectedRun: makeRun({
        status: "aborted",
        terminalReason: "user_stop",
        leaseExpiresAt: undefined,
      }),
    })
    expect(presentation).toMatchObject({
      state: "stopped",
      active: false,
      shouldStopLocalStream: true,
      terminalReason: "user_stop",
    })
  })

  it("a PREVIOUS turn's terminal is masked behind a new local stream (projection gap)", () => {
    // Local submission renders immediately. The prior turn's completed run
    // must neither present nor cut the new stream.
    const presentation = resolve({
      localStatus: "streaming",
      localAssistantMessageId: "msg_other",
      selectedRun: makeRun({
        status: "completed",
        terminalReason: "completed",
      }),
    })
    expect(presentation.state).toBe("local-streaming")
    expect(presentation.stoppable).toBe(true)
    expect(presentation.shouldStopLocalStream).toBe(false)
  })

  it("the submitted phase of a history chat presents local-submitted with Stop, not the prior terminal", () => {
    const presentation = resolve({
      localStatus: "submitted",
      localAssistantMessageId: null,
      selectedRun: makeRun({ status: "aborted", terminalReason: "user_stop" }),
    })
    expect(presentation.state).toBe("local-submitted")
    expect(presentation.stoppable).toBe(true)
    // No run id is known yet — Stop goes through the deferred intent.
    expect(presentation.stopTargetRunId).toBeNull()
  })

  it("hydrating a settled chat (no local activity) still presents the terminal", () => {
    const presentation = resolve({
      localStatus: "ready",
      selectedRun: makeRun({
        status: "completed",
        terminalReason: "completed",
      }),
    })
    expect(presentation.state).toBe("completed")
  })

  it("a terminal for the attached local stream cuts it (remote-Stop convergence)", () => {
    const attachedTerminal = resolve({
      localStatus: "streaming",
      localAssistantMessageId: "msg_1",
      selectedRun: makeRun({ status: "aborted", terminalReason: "user_stop" }),
    })
    expect(attachedTerminal).toMatchObject({
      state: "stopped",
      shouldStopLocalStream: true,
    })
  })

  it("terminal states map: completed / failed / stopped / superseded", () => {
    expect(
      resolve({ selectedRun: makeRun({ status: "completed" }) }).state
    ).toBe("completed")
    expect(
      resolve({
        selectedRun: makeRun({
          status: "failed",
          terminalReason: "lease_expired",
        }),
      })
    ).toMatchObject({ state: "failed", terminalReason: "lease_expired" })
    expect(
      resolve({
        selectedRun: makeRun({
          status: "aborted",
          terminalReason: "user_stop",
        }),
      }).state
    ).toBe("stopped")
    expect(
      resolve({
        selectedRun: makeRun({
          status: "aborted",
          terminalReason: "superseded",
        }),
      }).state
    ).toBe("superseded")
  })

  it("pending unexpired approval beats local streaming and background", () => {
    const presentation = resolve({
      localStatus: "streaming",
      localAssistantMessageId: "msg_1",
      selectedRun: makeRun({
        status: "awaiting_approval",
        leaseExpiresAt: undefined,
        pendingApproval: {
          approvalId: "approval_1",
          toolCallId: "call_1",
          toolName: "send_email",
          source: "mcp",
          riskClass: "destructive",
          assistantMessageId: "msg_1",
          createdAt: NOW - 1000,
          expiresAt: NOW + 60_000,
        },
      }),
    })
    expect(presentation).toMatchObject({
      state: "awaiting-approval",
      active: true,
      stoppable: true,
      stopTargetRunId: "run_1",
      caretEligible: false,
      actionsSuppressed: true,
    })
  })

  it("presents a projection-gap deferred Stop as non-repeatable stopping", () => {
    const presentation = resolve({
      localStatus: "streaming",
      deferredStopPending: true,
    })

    expect(presentation).toMatchObject({
      state: "stopping",
      active: true,
      stoppable: false,
      stopTargetRunId: null,
      shouldStopLocalStream: false,
    })
  })

  it("an EXPIRED approval pause is possibly-stale, not actionable-approval", () => {
    const presentation = resolve({
      selectedRun: makeRun({
        status: "awaiting_approval",
        leaseExpiresAt: undefined,
        pendingApproval: {
          approvalId: "approval_1",
          toolCallId: "call_1",
          toolName: "send_email",
          source: "mcp",
          riskClass: "destructive",
          assistantMessageId: "msg_1",
          createdAt: NOW - 100_000,
          expiresAt: NOW - GRACE - 1,
        },
      }),
    })
    expect(presentation.state).toBe("possibly-stale")
    expect(presentation.active).toBe(false)
  })

  it("a pending durable Stop renders stopping and cuts a live local transport", () => {
    const presentation = resolve({
      localStatus: "streaming",
      localAssistantMessageId: "msg_1",
      pendingStopRunId: "run_1",
      selectedRun: makeRun(),
    })
    expect(presentation).toMatchObject({
      state: "stopping",
      active: true,
      stoppable: false,
      shouldStopLocalStream: true,
    })
  })

  it("a Stop pending against an OLD run yields nothing once a newer run owns the chat", () => {
    const presentation = resolve({
      pendingStopRunId: "run_old",
      selectedRun: makeRun({ runId: "run_new" }),
    })
    // The newer run's own state wins; the stale Stop intent must not paint it.
    expect(presentation.state).toBe("background-streaming")
  })

  it("matching local stream wins over background classification", () => {
    const presentation = resolve({
      localStatus: "streaming",
      localAssistantMessageId: "msg_1",
      selectedRun: makeRun(),
    })
    expect(presentation).toMatchObject({
      state: "local-streaming",
      source: "local",
      stopTargetRunId: "run_1",
      caretEligible: true,
    })
  })

  it("local submitted renders immediately before the run projection exists", () => {
    expect(resolve({ localStatus: "submitted" })).toMatchObject({
      state: "local-submitted",
      active: true,
    })
  })
})

describe("lease classification (client-owned, skew-graced)", () => {
  const runAt = (leaseExpiresAt: number | undefined) =>
    resolve({ selectedRun: makeRun({ leaseExpiresAt }) })

  it("fresh strictly inside expiry + grace; stale at and beyond", () => {
    expect(runAt(NOW + 1).state).toBe("background-streaming")
    expect(runAt(NOW).state).toBe("background-streaming") // within grace
    expect(runAt(NOW - GRACE + 1).state).toBe("background-streaming")
    expect(runAt(NOW - GRACE).state).toBe("possibly-stale")
    expect(runAt(NOW - GRACE - 1).state).toBe("possibly-stale")
  })

  it("a lease-less active-looking run is unverifiable → possibly-stale", () => {
    expect(runAt(undefined)).toMatchObject({
      state: "possibly-stale",
      active: false,
      stoppable: true,
      stopTargetRunId: "run_1",
      actionsSuppressed: true,
    })
  })

  it("disconnected clients cannot claim background freshness and lose stale Stop", () => {
    expect(
      resolve({ selectedRun: makeRun(), isConnected: false })
    ).toMatchObject({ state: "possibly-stale", stoppable: false })
  })
})

describe("supersession orphan cut", () => {
  it("cuts a KNOWN-identity local stream that lost the chat slot to a newer run", () => {
    const presentation = resolve({
      localStatus: "streaming",
      localAssistantMessageId: "msg_old",
      localStreamStartedAtMs: NOW - ORPHAN_STREAM_CUT_GRACE_MS,
      selectedRun: makeRun({ runId: "run_new", assistantMessageId: "msg_new" }),
    })
    expect(presentation.state).toBe("background-streaming")
    expect(presentation.shouldStopLocalStream).toBe(true)
  })

  it("does NOT cut during the submitted phase before the local identity is known", () => {
    const presentation = resolve({
      localStatus: "submitted",
      localAssistantMessageId: null,
      selectedRun: makeRun(),
    })
    expect(presentation.shouldStopLocalStream).toBe(false)
  })

  it("does NOT cut a young mismatched stream (regeneration identity gap)", () => {
    // Right after a regeneration dispatch the projection can still show the
    // PREVIOUS run — the healthy new local stream must survive the gap.
    const presentation = resolve({
      localStatus: "streaming",
      localAssistantMessageId: "msg_regen",
      localStreamStartedAtMs: NOW - ORPHAN_STREAM_CUT_GRACE_MS + 1,
      selectedRun: makeRun({ runId: "run_old", assistantMessageId: "msg_old" }),
    })
    expect(presentation.state).toBe("background-streaming")
    expect(presentation.shouldStopLocalStream).toBe(false)
  })

  it("never cuts when the caller cannot vouch for the stream's age", () => {
    const presentation = resolve({
      localStatus: "streaming",
      localAssistantMessageId: "msg_old",
      localStreamStartedAtMs: null,
      selectedRun: makeRun({ runId: "run_new", assistantMessageId: "msg_new" }),
    })
    expect(presentation.shouldStopLocalStream).toBe(false)
  })
})
