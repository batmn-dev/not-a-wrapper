export type SuggestionIconId =
  "code" | "research" | "analysis" | "creative" | "learning"

// ============================================================================
// Rate Limits & Usage
// ============================================================================

export const NON_AUTH_DAILY_MESSAGE_LIMIT = 5
export const AUTH_DAILY_MESSAGE_LIMIT = 1000
export const REMAINING_QUERY_ALERT_THRESHOLD = 2
export const DAILY_FILE_UPLOAD_LIMIT = 5
export const DAILY_LIMIT_PRO_MODELS = 500

export const NON_AUTH_ALLOWED_MODELS = ["gpt-5-mini"]

export const FREE_MODELS_IDS = [
  "openrouter:openai/gpt-oss-120b:free",
  "openrouter:meta-llama/llama-3.3-70b-instruct:free",
  "pixtral-large-2411",
  "mistral-large-2512",
  "gpt-5-mini",
]

export const MODEL_DEFAULT_ANONYMOUS = "gpt-5-mini"
export const MODEL_DEFAULT_AUTHENTICATED = "gpt-5-mini"

// Legacy alias retained for call sites that still import a single default.
export const MODEL_DEFAULT = MODEL_DEFAULT_AUTHENTICATED

export function getDefaultModelForUser(isAuthenticated: boolean): string {
  return isAuthenticated ? MODEL_DEFAULT_AUTHENTICATED : MODEL_DEFAULT_ANONYMOUS
}

export const APP_NAME = "Not A Wrapper"
export const APP_DOMAIN = "https://not-a-wrapper.com"

export const SUGGESTIONS: Array<{
  label: string
  highlight: string
  prompt: string
  items: string[]
  icon: SuggestionIconId
}> = [
  {
    label: "Code",
    highlight: "Help me",
    prompt: `Help me code`,
    items: [
      "Help me debug this React component that's not rendering",
      "Help me write a Python script to process CSV files",
      "Help me optimize this database query for better performance",
      "Help me implement authentication in my Next.js app",
    ],
    icon: "code",
  },
  {
    label: "Research",
    highlight: "Research",
    prompt: `Research`,
    items: [
      "Research the pros and cons of different state management libraries",
      "Research best practices for API design in 2025",
      "Research how to implement real-time features with WebSockets",
      "Research the latest trends in AI and machine learning",
    ],
    icon: "research",
  },
  {
    label: "Analysis",
    highlight: "Analyze",
    prompt: `Analyze`,
    items: [
      "Analyze this code for potential security vulnerabilities",
      "Analyze the performance bottlenecks in my application",
      "Analyze this dataset and summarize key insights",
      "Analyze the architecture of this system and suggest improvements",
    ],
    icon: "analysis",
  },
  {
    label: "Creative",
    highlight: "Create",
    prompt: `Create`,
    items: [
      "Create a color palette for a modern SaaS dashboard",
      "Create user stories for a new feature I'm building",
      "Create a README template for my GitHub project",
      "Create a presentation outline for my tech talk",
    ],
    icon: "creative",
  },
  {
    label: "Learning",
    highlight: "Explain",
    prompt: `Explain`,
    items: [
      "Explain how React Server Components work",
      "Explain the difference between SQL and NoSQL databases",
      "Explain WebAssembly and when to use it",
      "Explain OAuth 2.0 flow in simple terms",
    ],
    icon: "learning",
  },
]

export const SYSTEM_PROMPT_DEFAULT = `You are a helpful AI assistant powered by Not A Wrapper, an open-source multi-provider chat application. You provide thoughtful, accurate, and helpful responses across a wide range of topics.

You excel at:
- Programming and software development across all languages
- Writing, editing, and content creation
- Research, analysis, and summarization
- Problem-solving and brainstorming
- Explaining complex topics in accessible ways
- Data analysis and interpretation

Your communication style is clear, direct, and tailored to the user's needs. You provide specific, actionable guidance rather than generic advice. When working on code, you explain your reasoning and consider edge cases. When writing, you adapt to the requested tone and format.

You're honest about limitations and uncertainties. When you don't know something, you say so. When a question is ambiguous, you ask for clarification rather than making assumptions.

You respect the user's time by being concise when appropriate and thorough when the situation calls for it.`

export const MESSAGE_MAX_LENGTH = 10000

// ============================================================================
// Context Management (Anthropic Best Practices)
/**
 * Anthropic API beta headers used by the chat route.
 */
export const ANTHROPIC_BETA_HEADERS = {
  /** Token-efficient tool use */
  tokenEfficient: "token-efficient-tools-2025-02-19",
} as const

// ============================================================================
// MCP Integration
// ============================================================================

export const MAX_MCP_SERVERS_PER_USER = 10
export const MAX_TOOL_RESULT_SIZE = 100 * 1024 // 100KB
export const MCP_CONNECTION_TIMEOUT_MS = 5000
export const MCP_CIRCUIT_BREAKER_THRESHOLD = 3
export const MCP_MAX_STEP_COUNT = 20
export const MCP_MAX_TOOLS_PER_REQUEST = 50
/**
 * Comma-separated allowlist for MCP servers whose annotation hints are trusted
 * for retry safety decisions.
 *
 * Values are normalized to lowercase and matched against server id, server
 * name, slugified server name, and server URL host.
 *
 * Example:
 * MCP_TRUSTED_RETRY_SERVER_ALLOWLIST=server_123,github-mcp,mcp.example.com
 */
export const MCP_TRUSTED_RETRY_SERVER_ALLOWLIST = (
  process.env.MCP_TRUSTED_RETRY_SERVER_ALLOWLIST ?? ""
)
  .split(",")
  .map((entry) => entry.trim().toLowerCase())
  .filter((entry) => entry.length > 0)

/** Timeout for MCP tool executions (in milliseconds).
 * MCP tools connect to arbitrary user-configured servers that can hang.
 * Enforced via Promise.race in wrapMcpTools(). On timeout, the AI SDK
 * receives a thrown ToolTimeoutError and gracefully returns a tool-error
 * to the model, which can acknowledge the failure and continue.
 * 30s is conservative — aligns with MCP RFC #1492 direction (60s proposed).
 */
export const MCP_TOOL_EXECUTION_TIMEOUT_MS = 30_000

// ============================================================================
// Tool Infrastructure
// ============================================================================

/** Max steps when no tools are available (currently hardcoded as 10 in route.ts:213) */
export const DEFAULT_MAX_STEP_COUNT = 10

/**
 * Max steps for anonymous (unauthenticated) users with tools.
 * Capped lower than authenticated users (MCP_MAX_STEP_COUNT = 20) to limit
 * tool call cost exposure. With 5 daily messages × 5 steps, worst case is
 * 25 tool calls/day/user — manageable at $0.005/Exa search.
 */
export const ANONYMOUS_MAX_STEP_COUNT = 5

/**
 * Step number after which prepareStep restricts tools to read-only.
 * The model has full tool access for the first N steps; after this
 * threshold, only tools explicitly marked as readOnly: true remain.
 * MCP tools are conservatively included (can't classify read/write yet).
 */
export const PREPARE_STEP_THRESHOLD = 3

/**
 * Timeout for individual third-party tool executions (in milliseconds).
 * Provider tools (Layer 1) are server-side and have their own timeouts.
 * Third-party tools (Layer 2) make outbound HTTP requests that could hang.
 * This timeout is enforced via AbortSignal in custom tool() wrappers.
 *
 * Not yet enforced — reserved for Phase 7 when custom tool() wrappers
 * with AbortSignal support are added for third-party tools.
 */
export const TOOL_EXECUTION_TIMEOUT_MS = 15_000

/**
 * Third-party cache policy (Layer 2 Exa tools).
 * TTL governs in-process reuse lifetime; max entries bounds memory usage.
 */
export const THIRD_PARTY_SEARCH_CACHE_TTL_MS = 15 * 60_000
export const THIRD_PARTY_SEARCH_CACHE_MAX_ENTRIES = 500
export const THIRD_PARTY_EXTRACTION_CACHE_TTL_MS = 15 * 60_000
export const THIRD_PARTY_EXTRACTION_CACHE_MAX_ENTRIES = 500

/**
 * Freshness window passed to Exa content extraction when supported.
 * Keeps extraction results reasonably up-to-date while avoiding unnecessary recrawls.
 */
export const EXA_CONTENT_FRESHNESS_MAX_AGE_HOURS = 24

/**
 * Persistent bucket size for tool limit windows (domain + budget).
 * Smaller buckets improve retry-after precision at the cost of more writes.
 */
export const TOOL_LIMIT_BUCKET_SIZE_MS = 60_000

/**
 * Sliding-window controls for extract_content domain abuse protection.
 * Applies per actor + domain and is enforced only for uncached URL fetches.
 */
export const EXTRACT_CONTENT_DOMAIN_WINDOW_MS = 15 * 60_000
export const EXTRACT_CONTENT_DOMAIN_MAX_REQUESTS = 6

/**
 * Centralized per-tool invocation budgets for server-executed layers.
 * Platform-key budgets are stricter to protect shared infrastructure.
 */
export const TOOL_BUDGET_WINDOW_MS = 15 * 60_000
export const TOOL_BUDGET_LIMITS = {
  platform: {
    default: 25,
    web_search: 25,
    extract_content: 20,
  },
  byok: {
    default: 80,
    web_search: 80,
    extract_content: 60,
  },
} as const

// ============================================================================
// History Replay Compiler
// ============================================================================

export const HISTORY_REPLAY_COMPILER_V1 =
  process.env.HISTORY_REPLAY_COMPILER_V1 === "1" ||
  process.env.HISTORY_REPLAY_COMPILER_V1 === "true"
export const HISTORY_REPLAY_NORMALIZER_VERSION = 1

// ============================================================================
// Sub-Agent Model Configuration
// ============================================================================

export const SUB_AGENT_MODELS = {
  /** Main orchestrator - complex reasoning */
  orchestrator: "claude-opus-4-5-20250929",
  /** Code assistance - fast, cost-effective */
  codeAssistant: "claude-haiku-4-5-20250929",
  /** Writing and editing - balanced */
  writingEditor: "claude-sonnet-4-5-20250929",
  /** Research and analysis - needs reasoning */
  researchAnalyst: "claude-sonnet-4-5-20250929",
  /** Data interpretation - data analysis */
  dataAnalyst: "claude-sonnet-4-5-20250929",
} as const
