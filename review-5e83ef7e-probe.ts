import { anthropic } from "@ai-sdk/anthropic"
import { createGoogle, google } from "@ai-sdk/google"
import { createOpenAI, openai } from "@ai-sdk/openai"
import { xai } from "@ai-sdk/xai"
import {
  convertToModelMessages,
  generateText,
  safeValidateUIMessages,
  validateUIMessages,
  type ToolSet,
  type UIMessage,
} from "ai"
import { adaptHistoryForProvider } from "./app/api/chat/adapters"
import { lowerForeignHostedToolParts } from "./app/api/chat/hosted-tool-lowering"
import { createErrorResponse, hasProviderLinkedResponseIds } from "./app/api/chat/utils"
import { sentryBeforeSend } from "./lib/observability/sentry-scrubbing"

type Provider = "openai" | "anthropic" | "google" | "xai"

const providers: Provider[] = ["openai", "anthropic", "google", "xai"]
const tools: Record<Provider, ToolSet> = {
  openai: { web_search: openai.tools.webSearch({}) } as unknown as ToolSet,
  anthropic: {
    web_search: anthropic.tools.webSearch_20250305(),
  } as unknown as ToolSet,
  google: { web_search: google.tools.googleSearch({}) } as unknown as ToolSet,
  xai: { web_search: xai.tools.webSearch({}) } as unknown as ToolSet,
}

const outputByOrigin: Record<Provider, unknown> = {
  openai: {
    action: { type: "search", queries: ["synthetic query"] },
    sources: [{ type: "url", url: "https://example.invalid/openai" }],
  },
  anthropic: [
    {
      type: "web_search_result",
      url: "https://example.invalid/anthropic",
      title: "Synthetic result",
      pageAge: null,
      encryptedContent: "REDACTED_ENCRYPTED_SENTINEL",
    },
  ],
  google: {},
  xai: {
    query: "synthetic query",
    sources: [
      {
        title: "Synthetic result",
        url: "https://example.invalid/xai",
        snippet: "Synthetic snippet",
      },
    ],
  },
}

const inputByOrigin: Record<Provider, unknown> = {
  openai: {},
  anthropic: { query: "synthetic query" },
  google: {},
  xai: {},
}

const idByOrigin: Record<Provider, string> = {
  openai: "ws_synthetic",
  anthropic: "srvtoolu_synthetic",
  google: "google-search-synthetic",
  xai: "xai-search-synthetic",
}

function metadataByOrigin(origin: Provider): Record<string, unknown> | undefined {
  if (origin === "google") {
    return {
      google: {
        serverToolCallId: "google-search-synthetic",
        serverToolType: "google_search",
      },
    }
  }
  if (origin === "openai") return { openai: { itemId: "ws_synthetic" } }
  return undefined
}

function history(origin: Provider, state = "output-available"): UIMessage[] {
  const part: Record<string, unknown> = {
    type: "tool-web_search",
    state,
    toolCallId: idByOrigin[origin],
    providerExecuted: true,
    input: inputByOrigin[origin],
  }
  if (state === "output-available") part.output = outputByOrigin[origin]
  if (state === "output-error") part.errorText = "synthetic failure"
  if (state === "approval-responded") {
    part.approval = {
      id: "approval_synthetic",
      approved: true,
    }
  }
  const metadata = metadataByOrigin(origin)
  if (metadata) part.callProviderMetadata = metadata
  return [
    {
      id: `assistant-${origin}-${state}`,
      role: "assistant",
      parts: [part, { type: "text", text: "Synthetic answer" }],
    } as unknown as UIMessage,
  ]
}

function openAIHistoryWithReasoning(): UIMessage[] {
  const [message] = history("openai")
  return [
    {
      ...message!,
      parts: [
        { type: "step-start" },
        { type: "reasoning", text: "", state: "done" },
        ...message!.parts,
      ],
    } as UIMessage,
  ]
}

async function originalAndFixedIncident() {
  const canonical = history("anthropic")
  let originalError: Error | undefined
  try {
    await validateUIMessages({ messages: canonical, tools: tools.openai as never })
  } catch (error) {
    originalError = error as Error
  }
  if (!originalError) throw new Error("Expected the parent-flow validation to fail")

  const oldBody = JSON.stringify({ error: originalError.message })
  const fixedResponse = createErrorResponse(originalError)
  const fixedBody = await fixedResponse.text()
  const unbrandedStatusResponse = createErrorResponse({
    message: "UNTRUSTED_PROVIDER_DETAIL_SENTINEL",
    statusCode: 400,
  })
  const unbrandedStatusBody = await unbrandedStatusResponse.text()
  const lowered = await lowerForeignHostedToolParts(canonical, tools.openai)
  const adapted = await adaptHistoryForProvider(
    lowered.messages,
    "openai",
    { targetModelId: "gpt-5.2", hasTools: true },
    { useReplayCompiler: false }
  )
  const boundary2 = await safeValidateUIMessages({
    messages: adapted.messages,
    tools: tools.openai as never,
  })

  console.log("INCIDENT", {
    errorName: originalError.name,
    parentErrorContainsEncryptedPayload: originalError.message.includes(
      "REDACTED_ENCRYPTED_SENTINEL"
    ),
    parentHttpBodyContainsEncryptedPayload: oldBody.includes(
      "REDACTED_ENCRYPTED_SENTINEL"
    ),
    fixedHttpBodyContainsEncryptedPayload: fixedBody.includes(
      "REDACTED_ENCRYPTED_SENTINEL"
    ),
    unbrandedStatusErrorIsEchoed: unbrandedStatusBody.includes(
      "UNTRUSTED_PROVIDER_DETAIL_SENTINEL"
    ),
    loweringCount: lowered.loweredCount,
    loweredContainsToolPart: JSON.stringify(lowered.messages).includes(
      "tool-web_search"
    ),
    loweredContainsEncryptedPayload: JSON.stringify(lowered.messages).includes(
      "REDACTED_ENCRYPTED_SENTINEL"
    ),
    boundary2Success: boundary2.success,
  })
}

async function matrix() {
  const rows: Array<Record<string, unknown>> = []
  for (const origin of providers) {
    for (const target of providers) {
      for (const search of [false, true]) {
        for (const compiler of [false, true]) {
          const registry = search ? tools[target] : ({} as ToolSet)
          const lowered = await lowerForeignHostedToolParts(history(origin), registry)
          const adapted = await adaptHistoryForProvider(
            lowered.messages,
            target,
            { targetModelId: `synthetic-${target}`, hasTools: search },
            { useReplayCompiler: compiler }
          )
          const validation = await safeValidateUIMessages({
            messages: adapted.messages,
            tools: registry as never,
          })
          const serialized = JSON.stringify(adapted.messages)
          rows.push({
            origin,
            target,
            search,
            compiler,
            lowered: lowered.loweredCount,
            toolSurvives: serialized.includes("tool-web_search"),
            originIdSurvives: serialized.includes(idByOrigin[origin]),
            boundary2: validation.success,
          })
        }
      }
    }
  }
  console.log("MATRIX_ACCEPTED_TOOL_SURVIVORS")
  for (const row of rows.filter(row => row.toolSurvives && row.boundary2)) {
    console.log(row)
  }
  console.log("MATRIX_ACCEPTED_BY_LOWERING_BUT_REMOVED_OR_REJECTED")
  for (const row of rows.filter(row => row.search && row.lowered === 0 && (!row.toolSurvives || !row.boundary2))) {
    console.log(row)
  }
}

async function incompleteStates() {
  const states = [
    "input-streaming",
    "input-available",
    "output-error",
    "output-denied",
    "approval-requested",
    "approval-responded",
  ]
  console.log("INCOMPLETE_FOREIGN_SURVIVORS_TO_GOOGLE")
  for (const origin of providers.filter(provider => provider !== "google")) {
    for (const state of states) {
      const lowered = await lowerForeignHostedToolParts(
        history(origin, state),
        tools.google
      )
      const validation = await safeValidateUIMessages({
        messages: lowered.messages,
        tools: tools.google as never,
      })
      if (lowered.loweredCount === 0 && validation.success) {
        console.log({ origin, state })
      }
    }
  }
}

async function prototypeLookup() {
  const message = [
    {
      id: "prototype-key",
      role: "assistant",
      parts: [
        {
          type: "tool-toString",
          state: "output-available",
          toolCallId: "synthetic-prototype-key",
          providerExecuted: true,
          input: {},
          output: { private: "REDACTED" },
        },
      ],
    } as unknown as UIMessage,
  ]
  const lowered = await lowerForeignHostedToolParts(message, tools.openai)
  const laterValidation = await safeValidateUIMessages({
    messages: lowered.messages,
    tools: tools.openai as never,
  })
  console.log("PROTOTYPE_LOOKUP", {
    lowered: lowered.loweredCount,
    toolSurvives: JSON.stringify(lowered.messages).includes("tool-toString"),
    laterValidation: laterValidation.success,
  })
}

async function errorContextProbe() {
  const [message] = history("anthropic", "approval-responded")
  const parts = message!.parts.map(part =>
    part.type === "tool-web_search"
      ? { ...part, toolCallId: "TOOL_ID_PRIVATE_SENTINEL" }
      : part
  )
  const validation = await safeValidateUIMessages({
    messages: [{ ...message!, parts }],
    tools: {} as never,
  })
  if (validation.success) throw new Error("Expected approval-tail validation failure")
  const errorContext = validation.error.message
    .split(": Value:")[0]
    ?.slice(0, 300)
  console.log("ERROR_CONTEXT", {
    containsToolIdPayload: errorContext?.includes("TOOL_ID_PRIVATE_SENTINEL"),
  })
}

async function providerRequestShapes() {
  let openaiBody: any
  const stubOpenAI = createOpenAI({
    apiKey: "REDACTED",
    fetch: async (_url, init) => {
      openaiBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ error: { message: "stubbed" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })
    },
  })
  const loweredOpenAI = await lowerForeignHostedToolParts(
    openAIHistoryWithReasoning(),
    tools.openai
  )
  const adaptedOpenAI = await adaptHistoryForProvider(
    loweredOpenAI.messages,
    "openai",
    { targetModelId: "gpt-5.2", hasTools: true },
    { useReplayCompiler: false }
  )
  const openaiModelMessages = await convertToModelMessages(adaptedOpenAI.messages, {
    tools: tools.openai,
  })
  try {
    await generateText({
      model: stubOpenAI("gpt-5.2"),
      messages: openaiModelMessages,
      tools: { web_search: stubOpenAI.tools.webSearch({}) },
    })
  } catch {}
  const sameProviderOpenAIReferences = (openaiBody?.input ?? [])
    .filter((item: { type?: string }) => item.type === "item_reference")
    .map((item: { id?: string }) => item.id)
  const sameProviderOpenAIDetector = hasProviderLinkedResponseIds(
    openaiModelMessages
  )

  const [googleHistory] = history("google")
  const googleHistoryWithReasoning = [
    {
      ...googleHistory!,
      parts: [
        { type: "step-start" },
        { type: "reasoning", text: "", state: "done" },
        ...googleHistory!.parts,
      ],
    } as UIMessage,
  ]
  const loweredForeignOpenAI = await lowerForeignHostedToolParts(
    googleHistoryWithReasoning,
    tools.openai
  )
  const adaptedForeignOpenAI = await adaptHistoryForProvider(
    loweredForeignOpenAI.messages,
    "openai",
    { targetModelId: "gpt-5.2", hasTools: true },
    { useReplayCompiler: false }
  )
  const foreignOpenAIModelMessages = await convertToModelMessages(
    adaptedForeignOpenAI.messages,
    { tools: tools.openai }
  )
  try {
    await generateText({
      model: stubOpenAI("gpt-5.2"),
      messages: foreignOpenAIModelMessages,
      tools: { web_search: stubOpenAI.tools.webSearch({}) },
    })
  } catch {}
  const foreignOpenAIReferences = (openaiBody?.input ?? [])
    .filter((item: { type?: string }) => item.type === "item_reference")
    .map((item: { id?: string }) => item.id)

  let googleBody: any
  const stubGoogle = createGoogle({
    apiKey: "REDACTED",
    fetch: async (_url, init) => {
      googleBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ error: { message: "stubbed" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })
    },
  })
  const loweredGoogle = await lowerForeignHostedToolParts(
    history("openai"),
    tools.google
  )
  const adaptedGoogle = await adaptHistoryForProvider(
    loweredGoogle.messages,
    "google",
    { targetModelId: "gemini-2.5-flash", hasTools: true },
    { useReplayCompiler: false }
  )
  const googleModelMessages = await convertToModelMessages(adaptedGoogle.messages, {
    tools: tools.google,
  })
  try {
    await generateText({
      model: stubGoogle("gemini-2.5-flash"),
      messages: googleModelMessages,
      tools: { web_search: stubGoogle.tools.googleSearch({}) },
    })
  } catch {}

  const googleParts = googleBody?.contents?.flatMap(
    (content: { parts?: unknown[] }) => content.parts ?? []
  ) ?? []
  console.log("PROVIDER_REQUEST_SHAPES", {
    sameProviderOpenAIReferences,
    sameProviderOpenAIDetector,
    foreignOpenAILoweringCount: loweredForeignOpenAI.loweredCount,
    foreignOpenAIToolSurvivesAdaptation: JSON.stringify(
      adaptedForeignOpenAI.messages
    ).includes("tool-web_search"),
    foreignOpenAIReferences,
    foreignOpenAIDetectorWouldFallback: hasProviderLinkedResponseIds(
      foreignOpenAIModelMessages
    ),
    googleFunctionCalls: googleParts.filter(
      (part: { functionCall?: unknown }) => part.functionCall != null
    ).length,
    googleFunctionResponses: googleParts.filter(
      (part: { functionResponse?: unknown }) => part.functionResponse != null
    ).length,
    googleToolCalls: googleParts.filter(
      (part: { toolCall?: unknown }) => part.toolCall != null
    ).length,
    googleToolResponses: googleParts.filter(
      (part: { toolResponse?: unknown }) => part.toolResponse != null
    ).length,
  })
}

async function googleDynamicReplayShape() {
  const dynamicHistory = [
    {
      id: "assistant-google-dynamic",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolName: "server:google_search",
          state: "output-available",
          toolCallId: "google-dynamic-synthetic",
          providerExecuted: true,
          input: {},
          output: {},
          callProviderMetadata: {
            google: {
              serverToolCallId: "google-dynamic-synthetic",
              serverToolType: "google_search",
            },
          },
          resultProviderMetadata: {
            google: {
              serverToolCallId: "google-dynamic-synthetic",
              serverToolType: "google_search",
            },
          },
        },
        { type: "text", text: "Synthetic answer" },
      ],
    } as unknown as UIMessage,
  ]

  const structural = await safeValidateUIMessages({ messages: dynamicHistory })
  const lowered = await lowerForeignHostedToolParts(dynamicHistory, tools.openai)
  const adapted = await adaptHistoryForProvider(
    lowered.messages,
    "openai",
    { targetModelId: "gpt-5.2", hasTools: true },
    { useReplayCompiler: false }
  )
  const modelBound = await safeValidateUIMessages({
    messages: adapted.messages,
    tools: tools.openai as never,
  })
  const modelMessages = await convertToModelMessages(adapted.messages, {
    tools: tools.openai,
  })

  let body: any
  const stubOpenAI = createOpenAI({
    apiKey: "REDACTED",
    fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ error: { message: "stubbed" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })
    },
  })
  try {
    await generateText({
      model: stubOpenAI("gpt-5.2"),
      messages: modelMessages,
      tools: { web_search: stubOpenAI.tools.webSearch({}) },
    })
  } catch {}

  console.log("GOOGLE_DYNAMIC_REPLAY", {
    structural: structural.success,
    lowered: lowered.loweredCount,
    dynamicSurvivesAdaptation: JSON.stringify(adapted.messages).includes(
      "server:google_search"
    ),
    modelBound: modelBound.success,
    modelMessageToolNames: modelMessages.flatMap(message =>
      Array.isArray(message.content)
        ? message.content
            .filter(part => part.type === "tool-call")
            .map(part => part.toolName)
        : []
    ),
    itemReferences: (body?.input ?? [])
      .filter((item: { type?: string }) => item.type === "item_reference")
      .map((item: { id?: string }) => item.id),
    detectorWouldFallback: hasProviderLinkedResponseIds(modelMessages),
  })
}

async function sentryScrubProbe() {
  const canonical = history("anthropic")
  const validation = await safeValidateUIMessages({
    messages: canonical,
    tools: tools.openai as never,
  })
  if (validation.success) throw new Error("Expected validation failure")
  const event = sentryBeforeSend({
    exception: { values: [{ value: validation.error.message }] },
  })
  console.log("SENTRY_SCRUB", {
    encryptedPayloadSurvives: JSON.stringify(event).includes(
      "REDACTED_ENCRYPTED_SENTINEL"
    ),
  })
}

async function approvalTailWithoutRegistry() {
  const tail = history("anthropic", "approval-responded")
  const validation = await safeValidateUIMessages({
    messages: tail,
    tools: {} as never,
  })
  const modelMessages = await convertToModelMessages(tail, {
    tools: {} as ToolSet,
    ignoreIncompleteToolCalls: true,
  })
  let body: any
  const stubOpenAI = createOpenAI({
    apiKey: "REDACTED",
    fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ error: { message: "stubbed" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })
    },
  })
  try {
    await generateText({
      model: stubOpenAI("gpt-5.2"),
      messages: modelMessages,
      tools: {},
    })
  } catch {}
  console.log("APPROVAL_TAIL_WITHOUT_REGISTRY", {
    validation: validation.success,
    modelParts: modelMessages.flatMap(message =>
      Array.isArray(message.content)
        ? message.content.map(part => part.type)
        : ["text"]
    ),
    requestItemTypes: (body?.input ?? []).map(
      (item: { type?: string }) => item.type
    ),
    requestTools: body?.tools ?? [],
  })
}

async function crossProviderApprovalTail() {
  const tail = history("openai", "approval-responded")
  const validation = await safeValidateUIMessages({
    messages: tail,
    tools: tools.google as never,
  })
  const modelMessages = await convertToModelMessages(tail, {
    tools: tools.google,
    ignoreIncompleteToolCalls: true,
  })
  let body: any
  const stubGoogle = createGoogle({
    apiKey: "REDACTED",
    fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ error: { message: "stubbed" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })
    },
  })
  try {
    await generateText({
      model: stubGoogle("gemini-2.5-flash"),
      messages: modelMessages,
      tools: { web_search: stubGoogle.tools.googleSearch({}) },
    })
  } catch {}
  const requestParts = body?.contents?.flatMap(
    (content: { parts?: unknown[] }) => content.parts ?? []
  ) ?? []
  console.log("CROSS_PROVIDER_APPROVAL_TAIL", {
    validation: validation.success,
    requestFunctionCalls: requestParts.filter(
      (part: { functionCall?: unknown }) => part.functionCall != null
    ).length,
    requestFunctionResponses: requestParts.filter(
      (part: { functionResponse?: unknown }) => part.functionResponse != null
    ).length,
  })
}

await originalAndFixedIncident()
await matrix()
await incompleteStates()
await prototypeLookup()
await errorContextProbe()
await providerRequestShapes()
await googleDynamicReplayShape()
await sentryScrubProbe()
await approvalTailWithoutRegistry()
await crossProviderApprovalTail()
