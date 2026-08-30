export type ComposerPrimaryActionMode = "send" | "stop"

export type ComposerPrimaryActionIntent = "send" | "stop"

type ResolveComposerPrimaryActionInput = {
  isStreaming: boolean
  isAbortable: boolean
  canSend: boolean
  isMessageEmpty: boolean
}

export type ComposerPrimaryActionState = {
  mode: ComposerPrimaryActionMode
  intent: ComposerPrimaryActionIntent
  buttonType: "button" | "submit"
  disabled: boolean
  ariaLabel: string
  tooltip: string
}

export function resolveComposerPrimaryActionState({
  isStreaming,
  isAbortable,
  canSend,
  isMessageEmpty,
}: ResolveComposerPrimaryActionInput): ComposerPrimaryActionState {
  if (isStreaming) {
    return {
      mode: "stop",
      intent: "stop",
      buttonType: "button",
      disabled: !isAbortable,
      ariaLabel: "Stop",
      tooltip: "Stop",
    }
  }

  return {
    mode: "send",
    intent: "send",
    buttonType: "submit",
    disabled: !canSend,
    ariaLabel: "Send prompt",
    tooltip: isMessageEmpty ? "Message is empty" : "Send prompt",
  }
}
