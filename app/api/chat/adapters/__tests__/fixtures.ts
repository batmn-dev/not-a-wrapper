import type { UIMessage } from "ai"

export const textOnlyAssistant = {
  id: "msg-assistant-1",
  role: "assistant",
  parts: [{ type: "text", text: "Hello! How can I help?" }],
} as UIMessage

export const reasoningPlusText = {
  id: "msg-assistant-2",
  role: "assistant",
  parts: [
    {
      type: "reasoning",
      reasoning: "Let me think about this...",
      state: "done",
    },
    { type: "text", text: "Here's my answer" },
  ],
} as UIMessage

export const singleSdkToolComplete = {
  id: "msg-assistant-3",
  role: "assistant",
  parts: [
    { type: "step-start" },
    {
      type: "reasoning",
      reasoning: "I'll run Exa search for this.",
      state: "done",
    },
    {
      type: "tool-exa_search",
      state: "output-available",
      toolCallId: "tc_sdk_1",
      toolName: "exa_search",
      providerExecuted: false,
      input: { query: "Batman products Amazon" },
      output: {
        ok: true,
        data: [
          { title: "Batman Figure", url: "https://example.com/batman-figure" },
        ],
      },
    },
    { type: "text", text: "Here are the top search results." },
  ],
} as UIMessage

export const singleProviderExecutedTool = {
  id: "msg-assistant-4",
  role: "assistant",
  parts: [
    { type: "step-start" },
    {
      type: "reasoning",
      reasoning: "I'll use web search to verify live listings.",
      state: "done",
    },
    {
      type: "tool-web_search",
      state: "output-available",
      toolCallId: "tc_prov_1",
      toolName: "web_search",
      providerExecuted: true,
      input: { query: "Batman collectibles Amazon" },
      output: {
        content: [
          { type: "text", text: "Found multiple Amazon Batman listings." },
        ],
      },
      callProviderMetadata: {
        openai: {
          responseId: "msg_abc123",
          reasoningId: "rs_def456",
        },
      },
    },
    { type: "text", text: "I found current product listings from web search." },
  ],
} as UIMessage

export const parallelToolCalls = {
  id: "msg-assistant-5",
  role: "assistant",
  parts: [
    { type: "step-start" },
    {
      type: "reasoning",
      reasoning: "I'll run two searches in parallel.",
      state: "done",
    },
    {
      type: "tool-web_search",
      state: "output-available",
      toolCallId: "tc_parallel_1",
      toolName: "web_search",
      providerExecuted: true,
      input: { query: "Batman action figures Amazon" },
      output: { content: [{ type: "text", text: "Action figure results." }] },
    },
    {
      type: "tool-exa_search",
      state: "output-available",
      toolCallId: "tc_parallel_2",
      toolName: "exa_search",
      providerExecuted: false,
      input: { query: "Batman comics Amazon", numResults: 5 },
      output: {
        ok: true,
        data: [{ title: "Batman Comic #1", url: "https://example.com/comic" }],
      },
    },
    { type: "text", text: "I combined results from both tools." },
  ],
} as UIMessage

export const multiStepToolChain = {
  id: "msg-assistant-6",
  role: "assistant",
  parts: [
    { type: "step-start" },
    {
      type: "reasoning",
      reasoning: "First, I'll gather initial inventory.",
      state: "done",
    },
    {
      type: "tool-web_search",
      state: "output-available",
      toolCallId: "tc_chain_1",
      toolName: "web_search",
      providerExecuted: true,
      input: { query: "Batman products Amazon best sellers" },
      output: { content: [{ type: "text", text: "Top sellers data." }] },
    },
    { type: "text", text: "I found a first pass of best sellers." },
    { type: "step-start" },
    {
      type: "reasoning",
      reasoning: "Now I'll refine by price and reviews.",
      state: "done",
    },
    {
      type: "tool-exa_search",
      state: "output-available",
      toolCallId: "tc_chain_2",
      toolName: "exa_search",
      providerExecuted: false,
      input: {
        query: "Batman products Amazon under 50 dollars high rating",
        numResults: 8,
      },
      output: {
        ok: true,
        data: [{ title: "Budget Batman Figure", rating: 4.8 }],
      },
    },
    { type: "text", text: "Refined list ready with budget-friendly options." },
  ],
} as UIMessage

export const failedToolCall = {
  id: "msg-assistant-7",
  role: "assistant",
  parts: [
    { type: "step-start" },
    { type: "reasoning", reasoning: "Attempting search...", state: "done" },
    {
      type: "tool-exa_search",
      state: "output-error",
      toolCallId: "tc_error_1",
      toolName: "exa_search",
      providerExecuted: false,
      input: { query: "Batman statues Amazon" },
      output: { error: "Connection timeout" },
    },
    { type: "text", text: "The search tool timed out; I can retry." },
  ],
} as UIMessage

export const incompleteAbortedTool = {
  id: "msg-assistant-8",
  role: "assistant",
  parts: [
    { type: "step-start" },
    {
      type: "reasoning",
      reasoning: "Starting search request...",
      state: "done",
    },
    {
      type: "tool-exa_search",
      state: "input-streaming",
      toolCallId: "tc_abort_1",
      toolName: "exa_search",
      providerExecuted: false,
      input: { query: "Batman Lego Amazon" },
    },
    { type: "text", text: "Search was interrupted before completion." },
  ],
} as UIMessage

export const crossProviderMetadata = {
  id: "msg-assistant-9",
  role: "assistant",
  parts: [
    { type: "step-start" },
    {
      type: "reasoning",
      reasoning: "Replaying prior provider output.",
      state: "done",
    },
    {
      type: "tool-web_search",
      state: "output-available",
      toolCallId: "tc_cross_1",
      toolName: "web_search",
      providerExecuted: true,
      input: { query: "Batman cowl Amazon" },
      output: { content: [{ type: "text", text: "Cowl listings." }] },
      callProviderMetadata: {
        openai: { responseId: "msg_xyz789" },
      },
    },
    { type: "text", text: "Cross-provider metadata is attached above." },
  ],
} as UIMessage

export const mixedProviderAndSdkTools = {
  id: "msg-assistant-10",
  role: "assistant",
  parts: [
    { type: "step-start" },
    {
      type: "reasoning",
      reasoning: "I'll use both provider and SDK tools.",
      state: "done",
    },
    {
      type: "tool-web_search",
      state: "output-available",
      toolCallId: "tc_mixed_1",
      toolName: "web_search",
      providerExecuted: true,
      input: { query: "Batman posters Amazon" },
      output: { content: [{ type: "text", text: "Poster listings found." }] },
      callProviderMetadata: {
        openai: { responseId: "msg_mix_001", reasoningId: "rs_mix_001" },
      },
    },
    {
      type: "tool-exa_search",
      state: "output-available",
      toolCallId: "tc_mixed_2",
      toolName: "exa_search",
      providerExecuted: false,
      input: { query: "Batman poster quality reviews", numResults: 3 },
      output: { ok: true, data: [{ title: "Review summary", score: 0.92 }] },
    },
    { type: "text", text: "Combined provider and SDK tool outputs." },
  ],
} as UIMessage

export function userMessage(id: string, text: string): UIMessage {
  return {
    id,
    role: "user",
    parts: [{ type: "text", text }],
  } as UIMessage
}

const assistantWithWebSearchChain = {
  id: "msg-assistant-batman-chain",
  role: "assistant",
  parts: [
    { type: "step-start" },
    {
      type: "reasoning",
      reasoning: "Let me search Amazon for Batman products.",
      state: "done",
    },
    {
      type: "tool-web_search",
      state: "output-available",
      toolCallId: "ws_batman_1",
      toolName: "web_search",
      providerExecuted: true,
      input: { query: "Batman products on Amazon" },
      output: { content: [{ type: "text", text: "Initial product results." }] },
      callProviderMetadata: {
        openai: { responseId: "msg_batman_1", reasoningId: "rs_batman_1" },
      },
    },
    { type: "text", text: "I found an initial set of Batman items." },
    { type: "step-start" },
    {
      type: "reasoning",
      reasoning: "Now I will refine for official Amazon product pages.",
      state: "done",
    },
    {
      type: "tool-web_search",
      state: "output-available",
      toolCallId: "ws_batman_2",
      toolName: "web_search",
      providerExecuted: true,
      input: { query: "Batman action figures Amazon official listings" },
      output: { content: [{ type: "text", text: "Refined product pages." }] },
      callProviderMetadata: {
        openai: { responseId: "msg_batman_2", reasoningId: "rs_batman_2" },
      },
    },
    { type: "text", text: "I narrowed the results to likely official pages." },
    { type: "step-start" },
    {
      type: "reasoning",
      reasoning: "Final pass to add links and pricing context.",
      state: "done",
    },
    {
      type: "tool-web_search",
      state: "output-available",
      toolCallId: "ws_batman_3",
      toolName: "web_search",
      providerExecuted: true,
      input: { query: "Batman collectibles Amazon links and prices" },
      output: {
        content: [{ type: "text", text: "Pricing snippets and links." }],
      },
      callProviderMetadata: {
        openai: { responseId: "msg_batman_3", reasoningId: "rs_batman_3" },
      },
    },
    {
      type: "text",
      text: "Here are Batman options and the best links I found.",
    },
  ],
} as UIMessage

export const batmanProductionBug: UIMessage[] = [
  userMessage("msg-user-1", "Find Batman products on Amazon"),
  assistantWithWebSearchChain,
  userMessage("msg-user-2", "Why weren't links from Amazon?"),
]

const anthropicAssistant = {
  id: "msg-assistant-anthropic-1",
  role: "assistant",
  parts: [
    { type: "step-start" },
    {
      type: "reasoning",
      reasoning: "I'll inspect options from a neutral search index.",
      state: "done",
    },
    {
      type: "tool-exa_search",
      state: "output-available",
      toolCallId: "tc_anthropic_1",
      toolName: "exa_search",
      providerExecuted: false,
      input: { query: "Batman products with reviews" },
      output: {
        ok: true,
        data: [{ title: "Anthropic-style result", score: 0.88 }],
      },
    },
    { type: "text", text: "I found reviewed Batman products." },
  ],
} as UIMessage

const openaiAssistant = {
  id: "msg-assistant-openai-1",
  role: "assistant",
  parts: [
    { type: "step-start" },
    {
      type: "reasoning",
      reasoning: "I'll enrich with live web data.",
      state: "done",
    },
    {
      type: "tool-web_search",
      state: "output-available",
      toolCallId: "tc_openai_1",
      toolName: "web_search",
      providerExecuted: true,
      input: { query: "Batman product availability today" },
      output: { content: [{ type: "text", text: "In-stock updates." }] },
      callProviderMetadata: {
        openai: { responseId: "msg_openai_111", reasoningId: "rs_openai_222" },
      },
    },
    { type: "text", text: "Here is the latest availability snapshot." },
  ],
} as UIMessage

export const crossProviderConversation: UIMessage[] = [
  userMessage("msg-user-3", "What Batman products are currently trending?"),
  anthropicAssistant,
  userMessage("msg-user-4", "Can you verify with live search?"),
  openaiAssistant,
]

export const heavyToolUseConversation: UIMessage[] = [
  userMessage("msg-user-5", "Find Batman toys"),
  {
    id: "msg-assistant-heavy-1",
    role: "assistant",
    parts: [
      { type: "step-start" },
      { type: "reasoning", reasoning: "Search pass one.", state: "done" },
      {
        type: "tool-web_search",
        state: "output-available",
        toolCallId: "tc_h_1",
        toolName: "web_search",
        providerExecuted: true,
        input: { query: "Batman toys Amazon" },
        output: { content: [{ type: "text", text: "Toys found." }] },
      },
      { type: "text", text: "Initial toy list ready." },
    ],
  } as UIMessage,
  userMessage("msg-user-6", "Filter to under $30"),
  {
    id: "msg-assistant-heavy-2",
    role: "assistant",
    parts: [
      { type: "step-start" },
      {
        type: "tool-exa_search",
        state: "output-available",
        toolCallId: "tc_h_2",
        toolName: "exa_search",
        providerExecuted: false,
        input: { query: "Batman toys under 30 dollars" },
        output: { ok: true, data: [{ title: "Budget toy", price: 24.99 }] },
      },
      { type: "text", text: "Budget-filtered list prepared." },
    ],
  } as UIMessage,
  userMessage("msg-user-7", "Prioritize highly rated items"),
  {
    id: "msg-assistant-heavy-3",
    role: "assistant",
    parts: [
      { type: "step-start" },
      { type: "reasoning", reasoning: "Ranking by rating now.", state: "done" },
      {
        type: "tool-web_search",
        state: "output-available",
        toolCallId: "tc_h_3",
        toolName: "web_search",
        providerExecuted: true,
        input: { query: "best rated Batman toys Amazon" },
        output: { content: [{ type: "text", text: "Top rated products." }] },
      },
      { type: "text", text: "Sorted by ratings." },
    ],
  } as UIMessage,
  userMessage("msg-user-8", "Add comic bundle options"),
  {
    id: "msg-assistant-heavy-4",
    role: "assistant",
    parts: [
      { type: "step-start" },
      {
        type: "tool-exa_search",
        state: "output-available",
        toolCallId: "tc_h_4",
        toolName: "exa_search",
        providerExecuted: false,
        input: { query: "Batman comic bundle Amazon" },
        output: {
          ok: true,
          data: [{ title: "Comic bundle pack", bundleSize: 6 }],
        },
      },
      { type: "text", text: "Added comic bundle suggestions." },
    ],
  } as UIMessage,
  userMessage("msg-user-9", "Compare shipping speeds"),
  {
    id: "msg-assistant-heavy-5",
    role: "assistant",
    parts: [
      { type: "step-start" },
      {
        type: "reasoning",
        reasoning: "Checking shipping information.",
        state: "done",
      },
      {
        type: "tool-web_search",
        state: "output-available",
        toolCallId: "tc_h_5",
        toolName: "web_search",
        providerExecuted: true,
        input: { query: "Batman products Prime shipping speed" },
        output: {
          content: [{ type: "text", text: "Shipping estimates collected." }],
        },
      },
      { type: "text", text: "Shipping speed comparison complete." },
    ],
  } as UIMessage,
  userMessage("msg-user-10", "Summarize everything in a shortlist"),
  {
    id: "msg-assistant-heavy-6",
    role: "assistant",
    parts: [
      { type: "step-start" },
      {
        type: "tool-exa_search",
        state: "output-available",
        toolCallId: "tc_h_6",
        toolName: "exa_search",
        providerExecuted: false,
        input: { query: "Batman shortlist top picks from previous criteria" },
        output: { ok: true, data: [{ title: "Final shortlist", count: 5 }] },
      },
      { type: "text", text: "Here is the final shortlist." },
    ],
  } as UIMessage,
]

export const textOnlyConversation: UIMessage[] = [
  userMessage("msg-user-11", "Hi"),
  {
    id: "msg-assistant-11",
    role: "assistant",
    parts: [{ type: "text", text: "Hello!" }],
  } as UIMessage,
  userMessage("msg-user-12", "Can you help me pick Batman comics?"),
  {
    id: "msg-assistant-12",
    role: "assistant",
    parts: [
      {
        type: "text",
        text: "Absolutely, tell me your budget and format preference.",
      },
    ],
  } as UIMessage,
]

export const abortedToolConversation: UIMessage[] = [
  userMessage("msg-user-13", "Find Batman masks"),
  {
    id: "msg-assistant-13",
    role: "assistant",
    parts: [
      { type: "step-start" },
      { type: "reasoning", reasoning: "Starting lookup...", state: "done" },
      {
        type: "tool-web_search",
        state: "output-available",
        toolCallId: "tc_abort_conv_1",
        toolName: "web_search",
        providerExecuted: true,
        input: { query: "Batman masks Amazon" },
        output: { content: [{ type: "text", text: "Mask results." }] },
      },
      { type: "text", text: "I found several options." },
    ],
  } as UIMessage,
  userMessage("msg-user-14", "Now find cosplay versions"),
  {
    id: "msg-assistant-14",
    role: "assistant",
    parts: [
      { type: "step-start" },
      {
        type: "reasoning",
        reasoning: "Launching another search.",
        state: "done",
      },
      {
        type: "tool-exa_search",
        state: "input-streaming",
        toolCallId: "tc_abort_conv_2",
        toolName: "exa_search",
        providerExecuted: false,
        input: { query: "Batman cosplay mask Amazon" },
      },
      { type: "text", text: "Search was interrupted." },
    ],
  } as UIMessage,
]
