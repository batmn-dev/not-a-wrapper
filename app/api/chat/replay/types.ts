import { z } from "zod"

export const replayProviderOriginSchema = z.enum([
  "openai",
  "anthropic",
  "google",
  "xai",
  "unknown",
])

export type ReplayProviderOrigin = z.infer<typeof replayProviderOriginSchema>

export const replayWebSearchResultSchema = z.object({
  url: z.string().min(1),
  title: z.string().optional(),
  snippet: z.string().optional(),
  pageAge: z.string().nullable().optional(),
  encryptedContent: z.string().optional(),
  resultType: z.literal("web_search_result").optional(),
})

export type ReplayWebSearchResult = z.infer<typeof replayWebSearchResultSchema>

export const replayWebSearchSchema = z.object({
  query: z.string(),
  results: z.array(replayWebSearchResultSchema),
  providerOrigin: replayProviderOriginSchema.optional(),
  rawShape: z
    .enum(["object-action-sources", "array-results", "array-anthropic-native", "unknown"])
    .optional(),
})

export type ReplayWebSearch = z.infer<typeof replayWebSearchSchema>

export const replayPlatformToolContextSchema = z.object({
  toolKey: z.string(),
  jobId: z.string().optional(),
  status: z.string().optional(),
  url: z.string().optional(),
  isTerminal: z.boolean().optional(),
})

export type ReplayPlatformToolContext = z.infer<typeof replayPlatformToolContextSchema>

export const replayToolExchangeSchema = z.object({
  toolName: z.string(),
  toolCallId: z.string().optional(),
  state: z.string().optional(),
  replayable: z.boolean(),
  nonReplayableReason: z.string().optional(),
  webSearch: replayWebSearchSchema.optional(),
  platformToolContext: replayPlatformToolContextSchema.optional(),
})

export type ReplayToolExchange = z.infer<typeof replayToolExchangeSchema>

export const replayTextPartSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
})

export const replayFilePartSchema = z.object({
  type: z.literal("file"),
  mediaType: z.string().optional(),
  filename: z.string().optional(),
  url: z.string().optional(),
})

export const replaySourceUrlPartSchema = z.object({
  type: z.literal("source-url"),
  sourceId: z.string().optional(),
  url: z.string().min(1),
  title: z.string().optional(),
})

export const replayToolExchangePartSchema = z.object({
  type: z.literal("tool-exchange"),
  tool: replayToolExchangeSchema,
})

export const replayPartSchema = z.discriminatedUnion("type", [
  replayTextPartSchema,
  replayFilePartSchema,
  replaySourceUrlPartSchema,
  replayToolExchangePartSchema,
])

export type ReplayPart = z.infer<typeof replayPartSchema>

export const replayMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["system", "user", "assistant", "tool"]),
  parts: z.array(replayPartSchema),
})

export type ReplayMessage = z.infer<typeof replayMessageSchema>
