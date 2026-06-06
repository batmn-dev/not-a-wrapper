import type { ReplayMessage } from "../types"
import { anthropicReplayCompiler } from "./anthropic"
import { openaiReplayCompiler } from "./openai"
import type {
  ReplayCompileContext,
  ReplayCompiler,
  ReplayCompileResult,
} from "./types"

export type {
  ReplayCompileContext,
  ReplayCompileResult,
  ReplayCompileStats,
  ReplayCompiler,
  ReplayCompileWarning,
  ReplayCompileWarningCode,
} from "./types"

const compilerRegistry = new Map<string, ReplayCompiler>()
compilerRegistry.set("openai", openaiReplayCompiler)
compilerRegistry.set("anthropic", anthropicReplayCompiler)

export function registerReplayCompiler(compiler: ReplayCompiler): void {
  compilerRegistry.set(compiler.providerId, compiler)
}

export function getReplayCompiler(
  providerId: string
): ReplayCompiler | undefined {
  return compilerRegistry.get(providerId)
}

export async function compileReplay(
  messages: readonly ReplayMessage[],
  providerId: string,
  context: ReplayCompileContext
): Promise<ReplayCompileResult> {
  const compiler = compilerRegistry.get(providerId)
  if (!compiler) {
    throw new Error(
      `No replay compiler registered for provider "${providerId}".`
    )
  }

  return compiler.compileReplay(messages, context)
}
