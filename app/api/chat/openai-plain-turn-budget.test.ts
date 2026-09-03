import { SYSTEM_PROMPT_DEFAULT } from "@/lib/config"
import { getAllModels } from "@/lib/models"
import { resolveModelSearchMode } from "@/lib/models/catalog"
import { shapeRequest } from "@/lib/openproviders/request-shaping"
import { prepareToolRuntime } from "@/lib/tools/runtime"
import { resolveWebSearchEnabled } from "@/lib/user-preference-store/web-search"
import { createOpenAI } from "@ai-sdk/openai"
import { streamText } from "ai"
import { describe, expect, it, vi } from "vitest"

// Benchmark finding 2 (docs/performance/2026-09-02-ttft-tps-vs-t3-chat.md):
// the 4,480 input tokens on every OpenAI turn were the hosted web_search
// tool's hidden prompt, declared because the web-search preference defaulted
// on. A plain turn (search off, no attachments, no connectors) measured 44
// input tokens live. This drives the same chain the route runs — stored
// preference (none) → resolveWebSearchEnabled → prepareToolRuntime's search
// gate → shapeRequest → the SDK's wire body — so neither a flipped default
// nor a gate regression can put the hosted tool back on a plain turn.

// Content extraction (extract_content) is Exa-keyed and independent of the
// search toggle; it is out of scope here, so the key seam resolves to nothing
// instead of reading whatever the shell env holds.
vi.mock("@/lib/user-keys", () => ({
  getEffectiveToolKeyWithMode: async () => ({}),
}))

const P1 =
  "List the 8 planets in order from the Sun. One line each: name, then one distinctive fact. No intro, no outro."

// ~4 bytes per token over the wire body; the live figure was 44 tokens, so a
// budget of 128 leaves room for SDK envelope changes but not for a tool
// schema (extract_content alone is ~1.1 KB) or a formatting preamble.
const PLAIN_TURN_TOKEN_BUDGET = 128
const estimateTokens = (body: string) => Math.ceil(body.length / 4)

async function captureOpenAIRequest(enableSearch: boolean) {
  const modelConfig = (await getAllModels()).find((m) => m.id === "gpt-5-mini")
  if (!modelConfig) throw new Error("gpt-5-mini missing from the catalog")

  // Guest tier, platform key: the plain-turn shape the benchmark measured.
  const runtime = await prepareToolRuntime({
    isAuthenticated: false,
    convexToken: undefined,
    anonymousId: "guest",
    provider: "openai",
    apiKey: "offline",
    providerToolKeyMode: "platform",
    modelTools: modelConfig.tools,
    modelSearchMode: resolveModelSearchMode(modelConfig),
    enableSearch,
    logContext: {
      requestId: "req",
      chatId: "chat",
      userId: "guest",
      model: modelConfig.id,
    },
  })
  const { providerOptions } = shapeRequest(modelConfig, {
    searchToolsActive: runtime.policySummary.searchInjected,
    hasTools: runtime.hasTools,
  })

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
  const result = streamText({
    model: provider(modelConfig.id),
    instructions: SYSTEM_PROMPT_DEFAULT,
    messages: [{ role: "user", content: P1 }],
    tools: runtime.tools,
    providerOptions,
    prepareStep: runtime.prepareStep,
    onError: () => {},
  })
  for await (const _part of result.fullStream) void _part
  await runtime.dispose()
  return { runtime, body, json: JSON.parse(body) as Record<string, unknown> }
}

describe("OpenAI plain-turn request budget", () => {
  it("sends only the default prompt and the user text, under budget", async () => {
    // No stored preference: the default the fix flipped.
    const { runtime, body, json } = await captureOpenAIRequest(
      resolveWebSearchEnabled(undefined)
    )

    expect(runtime.policySummary.searchInjected).toBe(false)
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
    const { runtime, json } = await captureOpenAIRequest(true)

    expect(runtime.policySummary.searchInjected).toBe(true)
    expect(json.tools).toEqual([
      expect.objectContaining({ type: "web_search" }),
    ])
  })
})
