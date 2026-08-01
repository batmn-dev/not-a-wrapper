// Public chat errors reach useChat's onError as the raw JSON body written by
// createErrorResponse ({ error, code }) — the transport throws the response
// text verbatim as Error.message. Classification keys on the `code` contract;
// substring matching survives only as a fallback for transports that prefix
// or wrap the body. Toasts show the human `error` message, never raw JSON.

export type ChatStreamErrorPresentation =
  | { kind: "swallow"; reason: "approval-continuation-lost-race" }
  | { kind: "toast"; title: string }

const GENERIC_MESSAGES = new Set(["An error occurred", "fetch failed"])
const GENERIC_FALLBACK = "Something went wrong. Please try again."

function parsePublicBody(message: string): { error?: string; code?: string } {
  try {
    const parsed: unknown = JSON.parse(message)
    if (parsed === null || typeof parsed !== "object") return {}
    const record = parsed as { error?: unknown; code?: unknown }
    return {
      ...(typeof record.error === "string" ? { error: record.error } : {}),
      ...(typeof record.code === "string" ? { code: record.code } : {}),
    }
  } catch {
    return {}
  }
}

export function presentChatStreamError(
  error: Error
): ChatStreamErrorPresentation {
  const body = parsePublicBody(error.message)

  // A losing approval-continuation POST (another tab's auto-send won —
  // structured 409, gameplan §10) repaints through the winner's projection,
  // so surfacing it would be a false failure. APPROVAL_UNRESOLVED is
  // deliberately NOT in this set: no winning decision exists to observe, so
  // it falls through to the toast path with its actionable server message.
  if (
    body.code === "APPROVAL_CONTINUATION_CONFLICT" ||
    error.message.includes("APPROVAL_CONTINUATION_CONFLICT") ||
    error.message.includes("Approval continuation already dispatched")
  ) {
    return { kind: "swallow", reason: "approval-continuation-lost-race" }
  }

  const title = body.error ?? error.message
  return {
    kind: "toast",
    title:
      title.length === 0 || GENERIC_MESSAGES.has(title)
        ? GENERIC_FALLBACK
        : title,
  }
}
