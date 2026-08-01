import { anthropic } from "@ai-sdk/anthropic"
import { google } from "@ai-sdk/google"
import { openai } from "@ai-sdk/openai"
import { xai } from "@ai-sdk/xai"
import type { ToolSet, UIMessage } from "ai"
import { describe, expect, it } from "vitest"
import { lowerForeignHostedToolParts } from "./hosted-tool-lowering"

type Provider = "openai" | "anthropic" | "google" | "xai"

const registries: Record<Provider, ToolSet> = {
  openai: { web_search: openai.tools.webSearch({}) } as ToolSet,
  anthropic: {
    web_search: anthropic.tools.webSearch_20250305(),
  } as ToolSet,
  google: { web_search: google.tools.googleSearch({}) } as ToolSet,
  xai: { web_search: xai.tools.webSearch({}) } as ToolSet,
}

const ENCRYPTED = "ENCRYPTED_CONTENT_SENTINEL"

function hostedSearchMessage(
  origin: Exclude<Provider, "google">,
  state = "output-available"
): UIMessage {
  const fixtures = {
    openai: {
      id: "ws_authentic_shape",
      input: {},
      output: {
        action: { type: "search", queries: ["query"] },
        sources: [{ type: "url", url: "https://example.com/openai" }],
      },
    },
    anthropic: {
      id: "srvtoolu_authentic_shape",
      input: { query: "query" },
      output: [
        {
          type: "web_search_result",
          url: "https://example.com/anthropic",
          title: "Anthropic result",
          pageAge: null,
          encryptedContent: ENCRYPTED,
        },
      ],
    },
    xai: {
      id: "xai_response_item_shape",
      input: {},
      output: {
        query: "query",
        sources: [
          {
            title: "xAI result",
            url: "https://example.com/xai",
            snippet: "snippet",
          },
        ],
      },
    },
  } as const
  const fixture = fixtures[origin]
  const part: Record<string, unknown> = {
    type: "tool-web_search",
    state,
    toolCallId: fixture.id,
    providerExecuted: true,
    input: fixture.input,
  }
  if (state === "output-available") part.output = fixture.output
  if (state === "output-error") part.errorText = "provider failure"
  if (state === "output-denied") {
    part.approval = { id: "approval_shape", approved: false }
    part.input = fixture.input
  }
  if (state === "approval-requested") {
    part.approval = { id: "approval_shape" }
  }
  if (state === "approval-responded") {
    part.approval = { id: "approval_shape", approved: true }
  }
  return {
    id: `${origin}-${state}`,
    role: "assistant",
    metadata: { provider: origin },
    parts: [part as never, { type: "text", text: "Visible answer" }],
  }
}

function project(
  messages: UIMessage[],
  targetProvider: Provider,
  tools?: ToolSet
) {
  return lowerForeignHostedToolParts(messages, {
    targetProvider,
    tools: tools ?? registries[targetProvider],
  })
}

describe("lowerForeignHostedToolParts", () => {
  it("projects every installed static hosted origin for every target registry", () => {
    const origins = ["openai", "anthropic", "xai"] as const
    const targets = ["openai", "anthropic", "google", "xai"] as const

    for (const origin of origins) {
      for (const target of targets) {
        const result = project([hostedSearchMessage(origin)], target)
        expect(result.loweredCount, `${origin}->${target}`).toBe(1)
        const serialized = JSON.stringify(result.messages)
        expect(serialized, `${origin}->${target}`).not.toContain(
          "tool-web_search"
        )
        expect(serialized, `${origin}->${target}`).not.toContain(
          "authentic_shape"
        )
        expect(serialized, `${origin}->${target}`).not.toContain(ENCRYPTED)
        expect(serialized, `${origin}->${target}`).toContain(
          "Earlier web search"
        )
      }
    }
  })

  it("classifies exact, foreign, absent, same-name foreign, and prototype registry identities", () => {
    expect(
      project([hostedSearchMessage("openai")], "openai").details[0]?.reason
    ).toBe("provider_hosted_history")
    expect(
      project([hostedSearchMessage("openai")], "google").details[0]?.reason
    ).toBe("provider_mismatch")
    expect(
      project([hostedSearchMessage("openai")], "openai", {}).details[0]?.reason
    ).toBe("tool_not_registered")

    const foreignSameName = {
      web_search: google.tools.googleSearch({}),
    } as ToolSet
    expect(
      project([hostedSearchMessage("openai")], "openai", foreignSameName)
        .details[0]?.reason
    ).toBe("tool_identity_mismatch")

    const prototypeKey = {
      id: "prototype-key",
      role: "assistant",
      metadata: { provider: "openai" },
      parts: [
        {
          type: "tool-toString",
          state: "output-available",
          toolCallId: "prototype-id",
          providerExecuted: true,
          input: {},
          output: {},
        },
      ],
    } as unknown as UIMessage
    expect(project([prototypeKey], "openai").details[0]?.reason).toBe(
      "tool_not_registered"
    )
  })

  it("projects every incomplete, error, denied, and approval state without payloads or ids", () => {
    for (const state of [
      "input-streaming",
      "input-available",
      "output-error",
      "output-denied",
      "approval-requested",
      "approval-responded",
    ]) {
      const result = project(
        [hostedSearchMessage("anthropic", state)],
        "anthropic"
      )
      expect(result.loweredCount, state).toBe(1)
      const serialized = JSON.stringify(result.messages)
      expect(serialized, state).not.toContain("tool-web_search")
      expect(serialized, state).not.toContain("srvtoolu_")
      expect(serialized, state).not.toContain(ENCRYPTED)
      expect(result.details[0]?.reason, state).toBe(
        ["output-error", "output-denied"].includes(state)
          ? "provider_hosted_history"
          : "unsafe_state"
      )
    }
  })

  it("projects an installed Google dynamic server-tool event, not an invented static search result", () => {
    const message = {
      id: "google-server-tool",
      role: "assistant",
      metadata: { provider: "google" },
      parts: [
        {
          type: "dynamic-tool",
          toolName: "server:google_search",
          state: "output-available",
          toolCallId: "google-server-call",
          providerExecuted: true,
          input: {},
          output: {},
          callProviderMetadata: {
            google: {
              serverToolCallId: "google-server-call",
              serverToolType: "google_search",
            },
          },
        },
      ],
    } as unknown as UIMessage

    const result = project([message], "google")
    expect(result.details[0]?.reason).toBe("dynamic_provider_tool")
    expect(JSON.stringify(result.messages)).not.toContain("dynamic-tool")
    expect(JSON.stringify(result.messages)).not.toContain("google-server-call")
  })

  it("projects Google grounding sources to citation text", () => {
    const grounding = {
      id: "google-grounding",
      role: "assistant",
      metadata: { provider: "google" },
      parts: [
        {
          type: "source-url",
          sourceId: "grounding-source-id",
          url: "https://example.com/grounding",
          title: "Grounded source",
        },
        { type: "text", text: "Grounded answer" },
      ],
    } as UIMessage

    const result = project([grounding], "openai")
    expect(result.sourceProjectionCount).toBe(1)
    expect(JSON.stringify(result.messages)).toContain(
      "https://example.com/grounding"
    )
    expect(JSON.stringify(result.messages)).not.toContain("source-url")
    expect(JSON.stringify(result.messages)).not.toContain("grounding-source-id")
  })

  it("does not trust missing or malformed provider provenance", () => {
    const missing = hostedSearchMessage("openai")
    delete (missing as { metadata?: unknown }).metadata
    expect(project([missing], "openai").details[0]?.reason).toBe(
      "untrusted_provenance"
    )

    const malformed = hostedSearchMessage("openai")
    malformed.metadata = { provider: { unexpected: true } }
    expect(project([malformed], "openai").details[0]?.reason).toBe(
      "untrusted_provenance"
    )
  })

  it("leaves provider-neutral client-executed static and dynamic tool pairs unchanged", () => {
    const message = {
      id: "client-tools",
      role: "assistant",
      metadata: { provider: "openai" },
      parts: [
        {
          type: "tool-search",
          state: "output-available",
          toolCallId: "client-static",
          input: { query: "q" },
          output: { ok: true },
        },
        {
          type: "dynamic-tool",
          toolName: "mcp_tool",
          state: "output-available",
          toolCallId: "client-dynamic",
          input: {},
          output: { ok: true },
        },
      ],
    } as unknown as UIMessage

    const result = project([message], "openai")
    expect(result.loweredCount).toBe(0)
    expect(result.messages[0]?.parts).toEqual(message.parts)
  })
})
