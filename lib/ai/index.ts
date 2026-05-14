/**
 * AI Module
 *
 * Central export point for AI-related utilities:
 * - Context management (compaction, token estimation)
 * - Sub-agent architecture (orchestration, specialized agents)
 *
 * @see lib/ai/CLAUDE.md for implementation details
 */

// Context Management
export {
  // Token utilities
  estimateTokens,
  estimateMessageTokens,
  // Compaction
  shouldCompact,
  compactContext,
  DEFAULT_COMPACTION_THRESHOLD,
  DEFAULT_PRESERVE_RECENT,
  // Structured notes
  formatNote,
  extractNotesFromConversation,
  // API headers
  CONTEXT_MANAGEMENT_API,
  createContextManagementHeaders,
  // Types
  type ContextManagementConfig,
  type CompactionResult,
  type TokenEstimate,
  type StructuredNote,
} from "./context-management"

// Sub-Agents
export {
  // Orchestrator
  createOrchestrator,
  classifyTask,
  Orchestrator,
  DEFAULT_SUB_AGENT_CONFIGS,
  // Placeholder agents
  CodeAssistant,
  WritingEditor,
  ResearchAnalyst,
  DataAnalyst,
  // Types
  type SubAgentType,
  type SubAgentConfig,
  type ClaudeModel,
  type TaskClassification,
  type SubAgentTaskInput,
  type SubAgentResponse,
  type OrchestratorConfig,
  type OrchestratorResult,
} from "./sub-agents"
