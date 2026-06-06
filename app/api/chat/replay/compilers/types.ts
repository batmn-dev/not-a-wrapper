import type { UIMessage } from "ai"
import type { ReplayMessage } from "../types"

export type ReplayCompileContext = {
  targetModelId: string
  hasTools: boolean
  sourceProviderHint?: string
  maxHistoryTokens?: number
}

export type ReplayCompileWarningCode =
  | "tool_non_replayable"
  | "tool_dropped_invalid_role"
  | "invariant_block_dropped"
  | "invariant_reasoning_injected"
  | "message_empty_fallback"
  | "empty_message_fallback"
  | "source_url_dropped"

export type ReplayCompileWarning = {
  code: ReplayCompileWarningCode
  messageIndex: number
  partIndex?: number
  detail: string
}

export type ReplayCompileStats = {
  originalMessageCount: number
  compiledMessageCount: number
  droppedMessages: number
  totalPartsOriginal: number
  totalPartsCompiled: number
  toolExchangesSeen: number
  toolExchangesCompiled: number
  toolExchangesDropped: number
  invariantsRepaired: number
}

export type ReplayCompileResult = {
  messages: UIMessage[]
  warnings: ReplayCompileWarning[]
  stats: ReplayCompileStats
}

export type ReplayCompiler = {
  providerId: string
  compileReplay(
    messages: readonly ReplayMessage[],
    context: ReplayCompileContext
  ): ReplayCompileResult | Promise<ReplayCompileResult>
}
