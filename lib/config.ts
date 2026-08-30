export const NON_AUTH_DAILY_MESSAGE_LIMIT = 5
export const AUTH_DAILY_MESSAGE_LIMIT = 1000
export const REMAINING_QUERY_ALERT_THRESHOLD = 2

export const NON_AUTH_ALLOWED_MODELS = ["gpt-5-mini"]

export const FREE_MODELS_IDS = [
  "openrouter:google/gemma-4-26b-a4b-it:free",
  "openrouter:nvidia/nemotron-3-ultra-550b-a55b:free",
  "pixtral-large-2411",
  "mistral-large-2512",
  "gpt-5-mini",
]

export const MODEL_DEFAULT_ANONYMOUS = "gpt-5-mini"
export const MODEL_DEFAULT_AUTHENTICATED = "gpt-5-mini"

export function getDefaultModelForUser(isAuthenticated: boolean): string {
  return isAuthenticated ? MODEL_DEFAULT_AUTHENTICATED : MODEL_DEFAULT_ANONYMOUS
}

export const APP_NAME = "Not A Wrapper"
export const APP_DOMAIN = "https://not-a-wrapper.com"

export const SYSTEM_PROMPT_DEFAULT = `You are a helpful AI assistant`

export const ANTHROPIC_BETA_HEADERS = {
  tokenEfficient: "token-efficient-tools-2025-02-19",
} as const

export const MAX_TOOL_RESULT_SIZE = 100 * 1024 // 100KB
export const MCP_CONNECTION_TIMEOUT_MS = 5000

export const MCP_CIRCUIT_BREAKER_THRESHOLD = 3
export const MCP_MAX_STEP_COUNT = 20
export const MCP_MAX_TOOLS_PER_REQUEST = 50
/** Lowercased server ids, names, slugs, or hosts whose retry hints are trusted. */
export const MCP_TRUSTED_RETRY_SERVER_ALLOWLIST = (
  process.env.MCP_TRUSTED_RETRY_SERVER_ALLOWLIST ?? ""
)
  .split(",")
  .map((entry) => entry.trim().toLowerCase())
  .filter((entry) => entry.length > 0)

/** Bounds calls to arbitrary user-configured MCP servers. */
export const MCP_TOOL_EXECUTION_TIMEOUT_MS = 30_000

export const DEFAULT_MAX_STEP_COUNT = 10

/** Anonymous tool turns are capped below authenticated turns to limit spend. */
export const ANONYMOUS_MAX_STEP_COUNT = 5

/**
 * After this step, only explicitly read-only tools remain; unclassified MCP
 * tools stay available.
 */
export const PREPARE_STEP_THRESHOLD = 3

/** Timeout for third-party HTTP tools; provider-native tools set their own. */
export const TOOL_EXECUTION_TIMEOUT_MS = 15_000

export const THIRD_PARTY_SEARCH_CACHE_TTL_MS = 15 * 60_000
export const THIRD_PARTY_SEARCH_CACHE_MAX_ENTRIES = 500
export const THIRD_PARTY_EXTRACTION_CACHE_TTL_MS = 15 * 60_000
export const THIRD_PARTY_EXTRACTION_CACHE_MAX_ENTRIES = 500

/** Exa extraction freshness window when the provider supports it. */
export const EXA_CONTENT_FRESHNESS_MAX_AGE_HOURS = 24

/** Smaller buckets improve retry-after precision at the cost of more writes. */
export const TOOL_LIMIT_BUCKET_SIZE_MS = 60_000

/** Per-actor/domain limits for uncached extraction requests. */
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
