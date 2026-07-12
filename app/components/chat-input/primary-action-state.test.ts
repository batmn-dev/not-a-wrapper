import { describe, expect, it } from "vitest"
import { resolveComposerPrimaryActionState } from "./primary-action-state"

describe("resolveComposerPrimaryActionState", () => {
  it("returns send when no stream is active", () => {
    const action = resolveComposerPrimaryActionState({
      isStreaming: false,
      isAbortable: false,
      canSend: true,
    })

    expect(action).toMatchObject({
      mode: "send",
      intent: "send",
      disabled: false,
      tooltip: "Send prompt",
    })
  })

  it("returns stop while streaming even when send preconditions fail", () => {
    const action = resolveComposerPrimaryActionState({
      isStreaming: true,
      isAbortable: true,
      canSend: false,
    })

    expect(action).toMatchObject({
      mode: "stop",
      intent: "stop",
      disabled: false,
    })
  })
})
