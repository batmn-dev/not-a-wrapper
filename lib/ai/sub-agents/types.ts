/**
 * Sub-Agent Architecture Types
 *
 * Defines the type system for the multi-agent architecture
 * used to delegate specialized tasks to purpose-built agents.
 *
 * @see lib/ai/CLAUDE.md - Current module status
 */

// ============================================================================
// Agent Types
// ============================================================================

/**
 * Available sub-agent types for task specialization
 */
export type SubAgentType =
  | "code-assistant"
  | "writing-editor"
  | "research-analyst"
  | "data-analyst"

/**
 * Claude model identifiers for different agent tiers
 */
export type ClaudeModel =
  | "claude-opus-4-5-20250929" // Complex orchestration
  | "claude-sonnet-4-5-20250929" // Balanced tasks
  | "claude-haiku-4-5-20250929" // Fast, simple tasks

/**
 * Base configuration for all sub-agents
 */
export type SubAgentConfig = {
  /** Unique identifier for the agent type */
  type: SubAgentType

  /** Display name for the agent */
  name: string

  /** Claude model to use for this agent */
  model: ClaudeModel

  /** System prompt defining the agent's role and capabilities */
  systemPrompt: string

  /** Maximum tokens for agent output */
  maxOutputTokens: number

  /** Temperature setting (0-1) */
  temperature: number

  /** Tools available to this agent */
  tools: string[]
}

// ============================================================================
// Task Types
// ============================================================================

/**
 * Task classification result from the orchestrator
 */
export type TaskClassification = {
  /** Primary task type */
  type: SubAgentType | "general"

  /** Confidence score (0-1) */
  confidence: number

  /** Extracted parameters for the task */
  parameters: Record<string, unknown>
}

/**
 * Base interface for sub-agent task input
 */
export type SubAgentTaskInput = {
  /** The user's original request */
  userRequest: string

  /** Additional context from the conversation */
  conversationContext?: string

  /** Any attached files or data */
  attachments?: SubAgentAttachment[]
}

/**
 * Attachment types supported by sub-agents
 */
export type SubAgentAttachment = {
  type: "code" | "document" | "data" | "image" | "text"
  content: string
  mimeType?: string
  metadata?: Record<string, unknown>
}

// ============================================================================
// Task-Specific Input Types
// ============================================================================

/**
 * Input for code assistance tasks
 */
export type CodeAssistanceInput = {
  code?: string
  language?: string
  context?: {
    fileName?: string
    projectType?: string
    framework?: string
  }
} & SubAgentTaskInput

/**
 * Input for writing/editing tasks
 */
export type WritingEditInput = {
  content?: string
  style?: "formal" | "casual" | "technical" | "creative"
  purpose?: "blog" | "documentation" | "email" | "social" | "other"
  targetAudience?: string
} & SubAgentTaskInput

/**
 * Input for research tasks
 */
export type ResearchInput = {
  topic: string
  depth?: "overview" | "detailed" | "comprehensive"
  sources?: string[]
  constraints?: string[]
} & SubAgentTaskInput

/**
 * Input for data analysis tasks
 */
export type DataAnalysisInput = {
  data?: string
  dataType?: "csv" | "json" | "table" | "text"
  analysisType?: "summary" | "trends" | "comparison" | "prediction"
  metrics?: string[]
} & SubAgentTaskInput

// ============================================================================
// Response Types
// ============================================================================

/**
 * Base interface for sub-agent responses
 */
export type SubAgentResponse<T = unknown> = {
  /** Whether the task completed successfully */
  success: boolean

  /** The agent that processed the task */
  agent: SubAgentType

  /** Processing time in milliseconds */
  processingTime: number

  /** Token usage for the task */
  tokenUsage: {
    input: number
    output: number
    total: number
  }

  /** The response data */
  data: T

  /** Error message if success is false */
  error?: string
}

/**
 * Code assistance response
 */
export type CodeAssistanceResponse = {
  code?: string
  explanation: string
  suggestions?: string[]
  issues?: {
    severity: "error" | "warning" | "info"
    message: string
    line?: number
  }[]
  documentation?: string
}

/**
 * Writing/editing response
 */
export type WritingEditResponse = {
  content: string
  changes?: {
    original: string
    revised: string
    reason: string
  }[]
  suggestions?: string[]
  readabilityScore?: number
}

/**
 * Research response
 */
export type ResearchResponse = {
  summary: string
  keyFindings: string[]
  sources?: {
    title: string
    url?: string
    relevance: string
  }[]
  recommendations?: string[]
  limitations?: string[]
}

/**
 * Data analysis response
 */
export type DataAnalysisResponse = {
  summary: string
  insights: string[]
  trends?: {
    metric: string
    direction: "up" | "down" | "stable"
    change?: number
    significance: string
  }[]
  recommendations?: string[]
  visualizationSuggestions?: string[]
}

// ============================================================================
// Orchestrator Types
// ============================================================================

/**
 * Configuration for the main orchestrator agent
 */
export type OrchestratorConfig = {
  /** Primary model for orchestration (typically Opus) */
  model: ClaudeModel

  /** Sub-agents available for delegation */
  subAgents: Map<SubAgentType, SubAgentConfig>

  /** Whether to use parallel processing for independent tasks */
  enableParallelProcessing: boolean

  /** Maximum concurrent sub-agent tasks */
  maxConcurrentTasks: number

  /** Context compaction settings */
  contextManagement: {
    compactionThreshold: number
    preserveRecentMessages: number
  }
}

/**
 * Result from the orchestrator including all sub-agent results
 */
export type OrchestratorResult = {
  /** Primary response for the user */
  response: string

  /** Sub-agent tasks that were executed */
  subAgentResults: SubAgentResponse[]

  /** Total processing time */
  totalTime: number

  /** Total token usage across all agents */
  totalTokens: {
    input: number
    output: number
    total: number
  }
}
