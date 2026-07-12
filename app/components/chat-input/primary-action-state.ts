export type ComposerPrimaryActionMode = "send" | "stop"

export type ComposerPrimaryActionIntent = "send" | "stop"

type ResolveComposerPrimaryActionInput = {
  /** True when the UI should present Stop instead of Send. */
  isStreaming: boolean
  /** True when an active stream can still be aborted. */
  isAbortable: boolean
  /** True when a send action is currently valid. */
  canSend: boolean
}

export type ComposerPrimaryActionState = {
  mode: ComposerPrimaryActionMode
  intent: ComposerPrimaryActionIntent
  disabled: boolean
  ariaLabel: string
  tooltip: string
}

export function resolveComposerPrimaryActionState({
  isStreaming,
  isAbortable,
  canSend,
}: ResolveComposerPrimaryActionInput): ComposerPrimaryActionState {
  if (isStreaming) {
    return {
      mode: "stop",
      intent: "stop",
      disabled: !isAbortable,
      ariaLabel: "Stop",
      tooltip: "Stop",
    }
  }

  return {
    mode: "send",
    intent: "send",
    disabled: !canSend,
    ariaLabel: "Send message",
    tooltip: "Send prompt",
  }
}
