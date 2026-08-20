import type { ModelConfig } from "../types"
import { claudeModels } from "./claude"
import { deepseekModels } from "./deepseek"
import { geminiModels } from "./gemini"
import { grokModels } from "./grok"
import { mistralModels } from "./mistral"
import { openaiModels } from "./openai"
import { perplexityModels } from "./perplexity"

/**
 * Every hand-authored direct-provider route record, in curated declaration
 * order. The one list the routable catalog (lib/models/index.ts), the logical
 * catalog compiler (lib/models/catalog.ts), and the OpenRouter generator's
 * `logicalModelId` validation all share — so a mapping can never target an id
 * one consumer knows and another doesn't.
 */
export const directModels: ModelConfig[] = [
  ...openaiModels,
  ...mistralModels,
  ...deepseekModels,
  ...claudeModels,
  ...grokModels,
  ...perplexityModels,
  ...geminiModels,
]
