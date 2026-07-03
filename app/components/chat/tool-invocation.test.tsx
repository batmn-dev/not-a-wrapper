import type { ToolUIPart } from "ai"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ToolInvocation } from "./tool-invocation"

describe("ToolInvocation", () => {
  it("shows a running state instead of completed after an approval response while a tool is still active", () => {
    const toolCallId = "call_search_001"
    const approvalRespondedTool = {
      type: "tool-web_search",
      toolCallId,
      state: "approval-responded",
      input: { query: "durable tool approval" },
      approval: { id: "approval_001", approved: true },
    } as unknown as ToolUIPart
    const runningTool = {
      type: "tool-web_search",
      toolCallId,
      state: "input-available",
      input: { query: "durable tool approval" },
    } as unknown as ToolUIPart

    const markup = renderToStaticMarkup(
      <ToolInvocation
        toolInvocations={[approvalRespondedTool, runningTool]}
      />
    )

    expect(markup).toContain("Running")
    expect(markup).not.toContain("Completed")
  })

  it("keeps output-available as the terminal display state", () => {
    const toolCallId = "call_search_002"
    const runningTool = {
      type: "tool-web_search",
      toolCallId,
      state: "input-available",
      input: { query: "durable tool approval" },
    } as unknown as ToolUIPart
    const completedTool = {
      type: "tool-web_search",
      toolCallId,
      state: "output-available",
      input: { query: "durable tool approval" },
      output: [{ title: "Result", url: "https://example.com" }],
    } as unknown as ToolUIPart

    const markup = renderToStaticMarkup(
      <ToolInvocation toolInvocations={[runningTool, completedTool]} />
    )

    expect(markup).toContain("Completed")
    expect(markup).not.toContain("Running")
  })

  it("presents an in-flight part as Stopped once the turn settles", () => {
    const runningTool = {
      type: "tool-web_search",
      toolCallId: "call_search_004",
      state: "input-available",
      input: { query: "stopped mid-call" },
    } as unknown as ToolUIPart

    const markup = renderToStaticMarkup(
      <ToolInvocation toolInvocations={[runningTool]} turnActive={false} />
    )

    expect(markup).toContain("Stopped")
    expect(markup).not.toContain("Running")
  })

  it("keeps a denied approval response as the terminal display state", () => {
    const toolCallId = "call_search_003"
    const deniedTool = {
      type: "tool-web_search",
      toolCallId,
      state: "approval-responded",
      input: { query: "durable tool approval" },
      approval: { id: "approval_003", approved: false },
    } as unknown as ToolUIPart
    const runningTool = {
      type: "tool-web_search",
      toolCallId,
      state: "input-available",
      input: { query: "durable tool approval" },
    } as unknown as ToolUIPart

    const markup = renderToStaticMarkup(
      <ToolInvocation toolInvocations={[runningTool, deniedTool]} />
    )

    expect(markup).toContain("Denied")
    expect(markup).not.toContain("Running")
    expect(markup).not.toContain("Completed")
  })
})
