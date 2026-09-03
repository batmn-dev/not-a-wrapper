import { SYSTEM_PROMPT_DEFAULT } from "@/lib/config"
import { getAllModels } from "@/lib/models"
import { shapeRequest } from "@/lib/openproviders/request-shaping"
import { getProviderTools } from "@/lib/tools/provider"
import { createOpenAI } from "@ai-sdk/openai"
import { streamText, type ToolSet } from "ai"
import { describe, expect, it } from "vitest"

// Benchmark finding 2 (docs/performance/2026-09-02-ttft-tps-vs-t3-chat.md):
// the 4,480 input tokens on every OpenAI turn were the hosted web_search
// tool's hidden prompt, declared because the web-search preference defaulted
// on. A plain turn (search off, no attachments, no connectors) measured 44
// input tokens live. This pins the wire request for that plain turn so a tool
// or preamble can never ride along again, and keeps the search-on request
// declaring the hosted tool.

const P1 =
  "List the 8 planets in order from the Sun. One line each: name, then one distinctive fact. No intro, no outro."

// ~4 bytes per token over the wire body; the live figure was 44 tokens, so a
// budget of 128 leaves room for SDK envelope changes but not for a tool
// schema (extract_content alone is ~1.1 KB) or a formatting preamble.
const PLAIN_TURN_TOKEN_BUDGET = 128
const estimateTokens = (body: string) => Math.ceil(body.length / 4)

async function captureOpenAIRequest(
  tools: ToolSet,
  searchToolsActive: boolean
) {
  let body = ""
  const provider = createOpenAI({
    apiKey: "offline",
    fetch: async (_url, init) => {
      body = String(init?.body)
      return new Response(JSON.stringify({ error: { message: "offline" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })
    },
  })
  const modelConfig = (await getAllModels()).find((m) => m.id === "gpt-5-mini")
  if (!modelConfig) throw new Error("gpt-5-mini missing from the catalog")
  const { providerOptions } = shapeRequest(modelConfig, {
    searchToolsActive,
    hasTools: Object.keys(tools).length > 0,
  })
  const result = streamText({
    model: provider(modelConfig.id),
    instructions: SYSTEM_PROMPT_DEFAULT,
    messages: [{ role: "user", content: P1 }],
    tools,
    providerOptions,
    onError: () => {},
  })
  for await (const _part of result.fullStream) void _part
  return { body, json: JSON.parse(body) as Record<string, unknown> }
}

describe("OpenAI plain-turn request budget", () => {
  it("sends only the default prompt and the user text, under budget", async () => {
    const { body, json } = await captureOpenAIRequest({} as ToolSet, false)

    expect(json.tools).toBeUndefined()
    expect(json.include).toBeUndefined()
    const texts = (json.input as Array<{ content: unknown }>).flatMap((item) =>
      typeof item.content === "string"
        ? [item.content]
        : (item.content as Array<{ text?: string }>).map((c) => c.text)
    )
    expect(texts).toEqual([SYSTEM_PROMPT_DEFAULT, P1])
    expect(estimateTokens(body)).toBeLessThanOrEqual(PLAIN_TURN_TOKEN_BUDGET)
  })

  it("still declares the hosted web_search tool when search is on", async () => {
    const { tools } = await getProviderTools("openai", "offline")
    const { json } = await captureOpenAIRequest(tools, true)

    expect(json.tools).toEqual([
      expect.objectContaining({ type: "web_search" }),
    ])
  })
})
