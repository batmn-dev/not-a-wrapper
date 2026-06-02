---
name: multiple-tool-calling-design-pattern
description: Universal design pattern for implementing multiple tool calling in AI chat applications. Covers the 6-phase tool calling lifecycle, provider-level approaches (OpenAI, Anthropic, Google), Vercel AI SDK multi-step patterns, and NaW's 3-layer hybrid architecture. Use when implementing tool calling, adding new tools, designing tool orchestration, or understanding how multi-step agent loops work.
---

# Multiple Tool Calling Design Pattern

Use this skill when implementing or extending tool calling in the chat pipeline, adding new tool types, or reasoning about tool orchestration architecture.

## Prerequisites

- [ ] Familiar with `app/api/chat/route.ts` (the single tool coordinator)
- [ ] Familiar with `lib/tools/types.ts` and `lib/tools/provider.ts`
- [ ] Review `app/api/chat/route.ts`, `lib/tools/types.ts`, and current AI SDK tool-calling references for the current implementation context

## The Universal Tool Calling Lifecycle

Every production AI system follows this 6-phase loop. The LLM is the *planner*, the orchestrator is the *executor*, and tool definitions are the *contract*.

```
1. CONTEXT PREPARATION
   System prompt + tool definitions (JSON Schema / Zod) + conversation history
                    ↓
2. DECISION PHASE
   LLM decides: call tool(s) or respond directly
   Controlled via: toolChoice ("auto" | "required" | "none" | specific)
                    ↓
3. ARGUMENT CONSTRUCTION
   LLM generates structured JSON arguments
   Middleware validates via Zod / JSON Schema — rejects invalid args
                    ↓
4. EXECUTION
   Orchestrator runs tool(s) with timeout + budget
   Handles: errors, side effects, idempotency
                    ↓
5. OBSERVATION INJECTION
   Results fed back as "tool result" messages into conversation context
                    ↓
6. CONTINUATION
   LLM produces final answer OR plans more tool calls
   Loop back to phase 2 (with step budget: maxSteps / stopWhen)
```

**Key principle**: The decision is *probabilistic* (LLM chooses), but execution is *deterministic* (your code validates, runs, and budgets). Never trust the LLM to self-limit — enforce step budgets, timeouts, and tool restrictions in the orchestrator.

---

## Provider-Level Approaches

### OpenAI: Native Parallel Tool Calls

The model can return *multiple* `tool_calls` in a single response. Client executes them concurrently, sends all results back in one API call.

```
User → Model → [tool_call_1, tool_call_2, tool_call_3]   (single response)
                      ↓              ↓             ↓
              execute(1)     execute(2)    execute(3)     (parallel)
                      ↓              ↓             ↓
                             All results                  (one API call back)
                               ↓
                        Model continues
```

- `parallel_tool_calls: true` (default) — model decides when to parallelize
- Step budget: client-enforced (not API-level)
- Provider tools: `openai.tools.webSearch({})` via AI SDK

### Anthropic: Tool Use + MCP Connector

Same parallel model as OpenAI but with `tool_use` / `tool_result` content blocks instead of separate message roles.

- Token-efficient tool use beta header reduces tool definition token cost
- **MCP Connector** (beta): API-level MCP integration — Anthropic's servers connect directly to your MCP servers, no client-side MCP handling needed
- Provider tools: `anthropic.tools.webSearch_20250305()` via AI SDK

### Google Gemini: Native Grounding + Code Execution

- `googleSearch()`: Built-in model capability (not an external tool)
- `codeExecution()`: Sandboxed Python execution within the model
- Both are *opaque* — the model decides internally when to use them
- Provider tools: `google.tools.googleSearch()` via AI SDK

### xAI (Grok)

- Provider tools: `xai.tools.webSearch()` via AI SDK
- Included in API pricing (no per-search cost)

---

## Vercel AI SDK Approach (NaW's Foundation)

The Vercel AI SDK handles the entire orchestration loop in a single function call. This is the pattern NaW uses.

### Core Pattern: `streamText` with `maxSteps`

```typescript
import { streamText, tool } from "ai"
import { z } from "zod"

const result = streamText({
  model: openai("gpt-4o"),
  messages,
  tools: {
    web_search: tool({
      description: "Search the web for current information",
      parameters: z.object({
        query: z.string().min(1).max(200),
      }),
      execute: async ({ query }) => {
        // Your tool implementation
        return { results: [...] }
      },
    }),
  },
  maxSteps: 5,               // Max orchestration loop iterations
  toolChoice: "auto",         // Let the model decide
  onStepFinish: ({ stepType, toolCalls, toolResults }) => {
    // Per-step logging / tracing
  },
})

return result.toUIMessageStreamResponse({
  sendReasoning: true,
  sendSources: true,
})
```

### Advanced: Multi-Step Agent with Different Models/Tools per Step

```typescript
import { createUIMessageStream, streamText } from "ai"

const stream = createUIMessageStream({
  execute: async ({ writer }) => {
    // Step 1: Extract intent with forced tool call
    const step1 = streamText({
      model: openai("gpt-4o-mini"),
      toolChoice: "required",
      tools: { classifyIntent: tool({...}) },
      messages,
    })
    writer.merge(step1.toUIMessageStream({ sendFinish: false }))

    // Step 2: Execute with full tool set + different model
    const step2 = streamText({
      model: anthropic("claude-sonnet-4-20250514"),
      tools: { webSearch: tool({...}), codeExec: tool({...}) },
      messages: [...messages, ...step1.response.messages],
    })
    writer.merge(step2.toUIMessageStream({ sendStart: false }))
  },
})
```

### Key SDK Features for Tool Control

| Feature | Purpose | When to Use |
|---------|---------|-------------|
| `maxSteps` / `stopWhen` | Limit orchestration loop iterations | Always — prevents runaway loops |
| `toolChoice` | Force, prevent, or auto-select tools | `"required"` for extraction; `"auto"` for chat |
| `activeTools` | Restrict available tools per step | Limit attack surface after step 1 |
| `prepareStep` | Dynamic tool restriction per step | High-risk tools (code execution) |
| `needsApproval` | Human-in-the-loop per tool | Cost-sensitive or irreversible tools |
| `onStepFinish` | Per-step callback for tracing | Audit logging, cost tracking |

### `prepareStep` Example (Dynamic Tool Restriction)

```typescript
streamText({
  tools: { search: tool({...}), codeExec: tool({...}), deleteFile: tool({...}) },
  prepareStep: async ({ stepNumber, previousSteps }) => {
    if (stepNumber > 0) {
      // After first step, restrict to safe tools only
      return { activeTools: ["search"] }
    }
  },
})
```

### `needsApproval` Example (Human-in-the-Loop)

```typescript
tools: {
  deepSearch: tool({
    description: "Deep web search (costs $0.05 per query)",
    parameters: z.object({ query: z.string() }),
    execute: async ({ query }) => exa.searchAndContents(query, { numResults: 25 }),
    needsApproval: true,  // Sends approval request to client
  }),
}
```

---

## NaW's 3-Layer Hybrid Architecture

Route.ts is the single coordinator. `enableSearch` is the master switch.

```
┌─────────────────────────────────────────────────────┐
│                 app/api/chat/route.ts                │
│                                                     │
│  enableSearch (from client) ─────────────┐          │
│                                          ▼          │
│  ┌──────────────────────────────────────────────┐   │
│  │  Provider has native search?                  │   │
│  │    YES → Layer 1: Provider Tool               │   │
│  │          (openai/anthropic/google/xai)        │   │
│  │    NO  → Layer 2: Exa Fallback                │   │
│  │          (mistral/openrouter/perplexity)      │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  Always (if auth + tools !== false):                │
│  ┌──────────────────────────────────────────────┐   │
│  │  Layer 3: MCP Tools (user-configured)         │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  Merge: { ...searchTools, ...mcpTools } → allTools  │
│  streamText({ tools: allTools, maxSteps })          │
└─────────────────────────────────────────────────────┘
```

### Layer Coordination Rules

1. **Layer 1 and Layer 2 are mutually exclusive** — never both for the same request
2. **Layer 3 (MCP) is always independent** — additive to whichever search layer is active
3. **MCP tools win collisions** — user config overrides defaults (spread order in merge)
4. **`enableSearch` is the master switch** — when false, no search tools at any layer
5. **`modelConfig.tools !== false`** — models that can't use tools get none injected

### Tool Definitions: Strict Contract Pattern

Every tool is a strict API contract. Use Zod for validation, structured envelopes for results.

```typescript
// Preferred tool definition pattern
const myTool = tool({
  description: "Be specific: what it does AND when to use it",
  parameters: z.object({
    query: z.string().min(1).max(200).describe("Be specific for better results"),
    limit: z.number().int().min(1).max(25).default(5),
  }),
  execute: async ({ query, limit }) => {
    try {
      const data = await externalApi.call(query, limit)
      return { ok: true, data, error: null }
    } catch (err) {
      return { ok: false, data: null, error: String(err) }
    }
  },
})
```

### Conditional Tool Injection (Dual-Gate Pattern)

Inject tools only when system config enables the feature AND the model supports it:

```typescript
// Phase 7 pattern — config + model capability gate
const shouldInjectSearch = enableSearch && modelConfig.tools !== false
const shouldInjectCodeExec =
  enableCodeExec &&
  (typeof modelConfig.tools === "object"
    ? modelConfig.tools.code !== false
    : modelConfig.tools !== false)
```

---

## Safety Boundaries Checklist

- [ ] **Step budget**: `maxSteps` set (20 authenticated, 5 anonymous in NaW)
- [ ] **Timeout**: Tool execution timeout enforced (`TOOL_EXECUTION_TIMEOUT_MS`)
- [ ] **Result truncation**: Large tool results capped (`MAX_TOOL_RESULT_SIZE`)
- [ ] **Cost protection**: Anonymous users capped; `estimatedCostPer1k` tracked
- [ ] **Audit logging**: Every tool call logged to `toolCallLog` with `source` discriminator
- [ ] **No `exec()`**: Never execute user-provided code in the server process
- [ ] **BYOK key isolation**: Tool calls bill to the correct API key (user or platform)

---

## Internal References

- Route.ts (gold standard): `app/api/chat/route.ts`
- Tool types: `lib/tools/types.ts`
- Provider tools: `lib/tools/provider.ts`
- AI SDK v6 skill: `.agents/skills/ai-sdk-v6/SKILL.md`

## External References

### Vercel AI SDK (Primary)

- Tools & tool calling: https://sdk.vercel.ai/docs/ai-sdk-core/tools-and-tool-calling
- `streamText` reference: https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text
- Multi-step tool cookbook (Node): https://sdk.vercel.ai/cookbook/node/call-tools-multiple-steps
- Multi-step tool cookbook (Next.js): https://sdk.vercel.ai/cookbook/next/call-tools-multiple-steps
- Multi-step agent pattern: https://sdk.vercel.ai/cookbook/next/stream-text-multistep
- Building AI agents guide: https://docs.vercel.com/guides/how-to-build-ai-agents-with-vercel-and-the-ai-sdk
- Automatic multi-step preview: https://ai-sdk-preview-roundtrips.vercel.app/

### Provider Documentation

- OpenAI function calling: https://platform.openai.com/docs/guides/gpt/function-calling
- Anthropic tool use: https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview
- Anthropic MCP overview: https://docs.anthropic.com/en/docs/agents-and-tools/mcp
- Anthropic MCP Connector: https://platform.claude.com/docs/en/agents-and-tools/mcp-connector
- Google Gemini function calling: https://ai.google.dev/gemini-api/docs/function-calling

### Architecture & Best Practices

- Anatomy of Tool Calling in LLMs (deep dive): https://martinuke0.github.io/posts/2026-01-07-the-anatomy-of-tool-calling-in-llms-a-deep-dive/
- AI Agents 2026 — Practical Architecture (tools, memory, evals, guardrails): https://andriifurmanets.com/blogs/ai-agents-2026-practical-architecture-tools-memory-evals-guardrails
- Tool Calling Explained — Core of AI Agents (Composio): https://composio.dev/blog/ai-agent-tool-calling-guide
- OpenAI function calling cookbook: https://cookbook.openai.com/examples/how_to_call_functions_with_chat_models

### Academic Papers

- LLMCompiler — Parallel Function Calling (ICML 2024): https://arxiv.org/abs/2312.04511
- ToolOrchestra — Efficient Model and Tool Orchestration: https://arxiv.org/abs/2511.21689
- Divide-Then-Aggregate — Parallel Tool Invocation: https://aclanthology.org/2025.acl-long.1401/
- Production-Grade Agentic AI Workflows Guide: https://arxiv.org/abs/2512.08769

### Frameworks (Comparison)

- LangGraph overview: https://docs.langchain.com/oss/python/langgraph/overview
- Building LangGraph (design principles): https://blog.langchain.com/building-langgraph/
- Cursor 2.0 Composer (RL-trained tool use): https://cursor.com/blog/composer
