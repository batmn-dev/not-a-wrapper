import { getModelInfo } from "@/lib/models"

const PROMPT_TOKEN_ESTIMATE_CHARACTERS_PER_TOKEN = 4
const PROMPT_INPUT_SAFETY_FACTOR = 0.9
const TEXT_FILE_MODEL_INPUT_BYTES_PER_FILE = 128 * 1024
const TEXT_FILE_MODEL_INPUT_TOTAL_BYTES = 256 * 1024

type PromptPart = {
  type?: string
  text?: unknown
  mediaType?: unknown
}

type PromptMessage = {
  parts?: readonly PromptPart[]
}

type PromptSizeInput = {
  modelId: string
  systemPrompt: string
  messages?: readonly PromptMessage[]
  nextText: string
  submittedFiles?: readonly File[]
}

export type PromptSizeDecision =
  | {
      ok: true
      estimatedTokens: number
      effectiveInputTokens: number | null
    }
  | {
      ok: false
      estimatedTokens: number
      effectiveInputTokens: number
      message: string
    }

function textCharactersInMessages(messages: readonly PromptMessage[]): number {
  let textCharacters = 0
  let textFileBytes = 0

  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (part.type === "text" && typeof part.text === "string") {
        textCharacters += part.text.length
      }
      if (
        part.type === "file" &&
        typeof part.mediaType === "string" &&
        part.mediaType.split(";")[0]?.trim().toLowerCase() === "text/plain"
      ) {
        textFileBytes = Math.min(
          TEXT_FILE_MODEL_INPUT_TOTAL_BYTES,
          textFileBytes + TEXT_FILE_MODEL_INPUT_BYTES_PER_FILE
        )
      }
    }
  }

  return textCharacters + textFileBytes
}

function textBytesInSubmittedFiles(files: readonly File[]): number {
  let total = 0
  for (const file of files) {
    if (
      typeof file.type !== "string" ||
      file.type.split(";")[0]?.trim().toLowerCase() !== "text/plain"
    ) {
      continue
    }
    total = Math.min(
      TEXT_FILE_MODEL_INPUT_TOTAL_BYTES,
      total + Math.min(file.size, TEXT_FILE_MODEL_INPUT_BYTES_PER_FILE)
    )
  }
  return total
}

/**
 * Browser-side admission policy. Provider tokenizers and tool schemas differ,
 * so this deliberately uses a conservative four-characters-per-token estimate
 * and only 90% of the selected model's catalog context window. The provider
 * remains authoritative for exact tokenization.
 */
export function evaluatePromptSize({
  modelId,
  systemPrompt,
  messages = [],
  nextText,
  submittedFiles = [],
}: PromptSizeInput): PromptSizeDecision {
  const estimatedCharacters =
    systemPrompt.length +
    nextText.length +
    textCharactersInMessages(messages) +
    textBytesInSubmittedFiles(submittedFiles)
  const estimatedTokens = Math.ceil(
    estimatedCharacters / PROMPT_TOKEN_ESTIMATE_CHARACTERS_PER_TOKEN
  )
  const model = getModelInfo(modelId)

  if (!model?.contextWindow) {
    return { ok: true, estimatedTokens, effectiveInputTokens: null }
  }

  const effectiveInputTokens = Math.floor(
    model.contextWindow * PROMPT_INPUT_SAFETY_FACTOR
  )
  if (estimatedTokens <= effectiveInputTokens) {
    return { ok: true, estimatedTokens, effectiveInputTokens }
  }

  return {
    ok: false,
    estimatedTokens,
    effectiveInputTokens,
    message: `This prompt is too long for ${model.name}. Shorten the message or remove attachments.`,
  }
}
