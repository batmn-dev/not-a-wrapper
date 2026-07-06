import type { ChatTurnMessage } from "./turn-plans"

// Shared test fixtures for the Chat turn controller suites. Not a *.test.ts
// file, so vitest does not run it as a test. `userMessage` takes an optional
// `extraParts` so the controller suite (which attaches file parts) and the
// plan/store suites (which do not) share one builder.
export function userMessage(
  id: string,
  text: string,
  createdAt = new Date("2026-01-01T00:00:00.000Z"),
  extraParts: NonNullable<ChatTurnMessage["parts"]> = []
): ChatTurnMessage {
  return {
    id,
    role: "user",
    createdAt,
    parts: [{ type: "text", text }, ...extraParts],
  }
}

export function assistantMessage(
  id: string,
  text: string,
  createdAt = new Date("2026-01-01T00:00:01.000Z")
): ChatTurnMessage {
  return {
    id,
    role: "assistant",
    createdAt,
    parts: [{ type: "text", text }],
  }
}
