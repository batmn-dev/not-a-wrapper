import { google } from "@ai-sdk/google"
import { openai } from "@ai-sdk/openai"
import { dynamicTool, jsonSchema, tool, type ToolSet, type UIMessage } from "ai"
import { describe, expect, it } from "vitest"
import {
  extractApprovalResponses,
  splitAndValidateApprovalContinuation,
} from "./approval-continuation"

const openaiSearch = {
  web_search: openai.tools.webSearch({}),
} as unknown as ToolSet

const googleSearch = {
  web_search: google.tools.googleSearch({}),
} as unknown as ToolSet

const clientStatic = {
  client_tool: tool({ inputSchema: jsonSchema({ type: "object" }) }),
} as ToolSet

const clientDynamic = {
  mcp_tool: dynamicTool({ inputSchema: jsonSchema({ type: "object" }) }),
} as ToolSet

function tail(
  options: {
    provider?: unknown
    type?: "static" | "dynamic"
    toolName?: string
    providerExecuted?: boolean
    approved?: boolean
  } = {}
): UIMessage {
  const toolName = options.toolName ?? "web_search"
  return {
    id: "approval-tail",
    role: "assistant",
    metadata:
      "provider" in options
        ? { provider: options.provider }
        : { provider: "openai" },
    parts: [
      options.type === "dynamic"
        ? ({
            type: "dynamic-tool",
            toolName,
            state: "approval-responded",
            toolCallId: "provider-linked-call-id",
            providerExecuted: options.providerExecuted,
            input: {},
            approval: {
              id: "provider-linked-approval-id",
              approved: options.approved ?? true,
            },
          } as never)
        : ({
            type: `tool-${toolName}`,
            state: "approval-responded",
            toolCallId: "provider-linked-call-id",
            providerExecuted: options.providerExecuted ?? true,
            input: {},
            approval: {
              id: "provider-linked-approval-id",
              approved: options.approved ?? true,
            },
          } as never),
    ],
  }
}

function split(message: UIMessage, targetProvider: string, tools: ToolSet) {
  return splitAndValidateApprovalContinuation({
    messages: [
      { id: "history", role: "user", parts: [{ type: "text", text: "hi" }] },
      message,
    ],
    targetProvider,
    tools,
  })
}

describe("splitAndValidateApprovalContinuation", () => {
  it.each([true, false])(
    "keeps a same-provider static hosted approval when approved=%s",
    (approved) => {
      const result = split(tail({ approved }), "openai", openaiSearch)
      expect(result.history).toHaveLength(1)
      expect(result.tail).toHaveLength(1)
      expect(result.tail[0]?.parts[0]).toMatchObject({
        state: "approval-responded",
        approval: { approved },
      })
    }
  )

  it("rejects a provider switch even when the target has the same tool name", () => {
    expect(() => split(tail(), "google", googleSearch)).toThrowError(
      expect.objectContaining({
        statusCode: 409,
        code: "APPROVAL_PROVIDER_MISMATCH",
      })
    )
  })

  it("rejects a disabled or absent tool", () => {
    expect(() => split(tail(), "openai", {})).toThrowError(
      expect.objectContaining({
        statusCode: 409,
        code: "APPROVAL_TOOL_UNAVAILABLE",
      })
    )
  })

  it("rejects a same-name provider tool with the wrong provider identity", () => {
    expect(() => split(tail(), "openai", googleSearch)).toThrowError(
      expect.objectContaining({ code: "APPROVAL_TOOL_UNAVAILABLE" })
    )
  })

  it.each([undefined, { malformed: true }])(
    "rejects missing or malformed origin provenance (%s)",
    (provider) => {
      expect(() =>
        split(tail({ provider }), "openai", openaiSearch)
      ).toThrowError(
        expect.objectContaining({ code: "APPROVAL_PROVIDER_MISMATCH" })
      )
    }
  )

  it("accepts same-provider client-executed static and dynamic continuations", () => {
    const staticResult = split(
      tail({
        toolName: "client_tool",
        providerExecuted: false,
      }),
      "openai",
      clientStatic
    )
    expect(staticResult.tail).toHaveLength(1)

    const dynamicResult = split(
      tail({
        type: "dynamic",
        toolName: "mcp_tool",
        providerExecuted: false,
      }),
      "openai",
      clientDynamic
    )
    expect(dynamicResult.tail).toHaveLength(1)
  })

  it("exempts only approval parts and leaves sibling content in history", () => {
    const message = tail()
    message.parts.unshift({ type: "text", text: "Keep this explanation." }, {
      type: "dynamic-tool",
      toolName: "server:code_execution",
      providerExecuted: true,
      state: "output-available",
      toolCallId: "foreign-server-tool-id",
      input: {},
      output: { secret: "opaque-provider-output" },
    } as never)

    const result = split(message, "openai", openaiSearch)
    expect(result.history.at(-1)?.parts).toEqual(message.parts.slice(0, 2))
    expect(result.tail[0]?.parts).toHaveLength(1)
    expect(result.tail[0]?.parts[0]).toMatchObject({
      state: "approval-responded",
    })
  })

  it("rejects static/dynamic and provider/client execution-kind mismatches", () => {
    expect(() =>
      split(
        tail({
          type: "dynamic",
          toolName: "client_tool",
          providerExecuted: false,
        }),
        "openai",
        clientStatic
      )
    ).toThrowError(
      expect.objectContaining({ code: "APPROVAL_TOOL_UNAVAILABLE" })
    )

    expect(() =>
      split(
        tail({
          toolName: "mcp_tool",
          providerExecuted: false,
        }),
        "openai",
        clientDynamic
      )
    ).toThrowError(
      expect.objectContaining({ code: "APPROVAL_TOOL_UNAVAILABLE" })
    )

    expect(() =>
      split(
        tail({
          toolName: "web_search",
          providerExecuted: false,
        }),
        "openai",
        openaiSearch
      )
    ).toThrowError(
      expect.objectContaining({ code: "APPROVAL_TOOL_UNAVAILABLE" })
    )
  })

  it("uses own-property lookup for approval tools", () => {
    expect(() =>
      split(
        tail({ toolName: "toString", providerExecuted: false }),
        "openai",
        {} as ToolSet
      )
    ).toThrowError(
      expect.objectContaining({ code: "APPROVAL_TOOL_UNAVAILABLE" })
    )
  })
})

describe("approval continuation parse", () => {
  it("extracts the trailing assistant's responses for persistence", () => {
    const messages = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          {
            type: "tool-send_email",
            toolCallId: "call-1",
            state: "approval-responded",
            input: { to: "person@example.com" },
            approval: {
              id: "approval-1",
              approved: false,
              reason: "Denied by user",
            },
          },
        ],
      },
    ] as unknown as UIMessage[]

    expect(extractApprovalResponses(messages)).toEqual([
      {
        messageId: "assistant-1",
        approvalId: "approval-1",
        toolCallId: "call-1",
        toolName: "send_email",
        approved: false,
        reason: "Denied by user",
      },
    ])
    // Historical responses are evidence, never a continuation.
    expect(
      extractApprovalResponses([
        ...messages,
        { id: "u2", role: "user", parts: [{ type: "text", text: "next" }] },
      ])
    ).toEqual([])
  })

  it("rejects a responded part without a well-formed approval as a 400, for split and extraction alike", () => {
    const wellFormed = tail()
    const malformed = {
      ...wellFormed,
      parts: [{ ...wellFormed.parts[0], approval: { approved: true } }],
    } as UIMessage
    const invalid = expect.objectContaining({
      statusCode: 400,
      code: "INVALID_REQUEST",
    })

    expect(() => split(malformed, "openai", openaiSearch)).toThrowError(invalid)
    expect(() => extractApprovalResponses([malformed])).toThrowError(invalid)

    // An empty id is as unusable as a missing one.
    const emptyId = {
      ...wellFormed,
      parts: [{ ...wellFormed.parts[0], approval: { id: "", approved: true } }],
    } as UIMessage
    expect(() => extractApprovalResponses([emptyId])).toThrowError(invalid)
  })
})
