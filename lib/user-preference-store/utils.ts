import { resolveModelSelections } from "@/lib/models/catalog"

export type LayoutType = "sidebar" | "fullscreen"

/**
 * Streaming presentation (ADR-0016 amendments, 2026-08-11): "smooth" keeps
 * the paint-only decay overlay; "quick" disables it — new words paint at
 * full foreground color the moment they arrive. CLIENT-ONLY by design: text
 * still streams word by word either way (the evidence-gated server
 * word-chunking transform is delivery behavior, not presentation, and is
 * never gated by this preference), and correctness passes (tail mending)
 * are not part of it either.
 */
export type StreamingPresentation = "smooth" | "quick"

export type UserPreferences = {
  layout: LayoutType
  promptSuggestions: boolean
  showToolInvocations: boolean
  showConversationPreviews: boolean
  webSearchEnabled: boolean
  streamingPresentation: StreamingPresentation
  hiddenModels: string[]
}

// API format uses snake_case
export type UserPreferencesApiFormat = {
  layout?: LayoutType
  prompt_suggestions?: boolean
  show_tool_invocations?: boolean
  show_conversation_previews?: boolean
  web_search_enabled?: boolean
  streaming_presentation?: StreamingPresentation
  hidden_models?: string[]
}

export const defaultPreferences: UserPreferences = {
  layout: "sidebar",
  promptSuggestions: true,
  showToolInvocations: true,
  showConversationPreviews: true,
  webSearchEnabled: true,
  streamingPresentation: "smooth",
  hiddenModels: [],
}

/** Anything not exactly "quick" (unset, legacy, corrupted) means smooth. */
export function normalizeStreamingPresentation(
  value: unknown
): StreamingPresentation {
  return value === "quick" ? "quick" : "smooth"
}

/** Collapse persisted legacy route ids into the logical model identities. */
export function normalizeHiddenModels(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return resolveModelSelections(
    value.filter((modelId): modelId is string => typeof modelId === "string")
  )
}

export function convertFromApiFormat(
  apiData: UserPreferencesApiFormat
): UserPreferences {
  return {
    layout: apiData.layout || "sidebar",
    promptSuggestions: apiData.prompt_suggestions ?? true,
    showToolInvocations: apiData.show_tool_invocations ?? true,
    showConversationPreviews: apiData.show_conversation_previews ?? true,
    webSearchEnabled: apiData.web_search_enabled ?? true,
    streamingPresentation: normalizeStreamingPresentation(
      apiData.streaming_presentation
    ),
    hiddenModels: normalizeHiddenModels(apiData.hidden_models),
  }
}

export function convertToApiFormat(
  preferences: Partial<UserPreferences>
): UserPreferencesApiFormat {
  const apiData: UserPreferencesApiFormat = {}
  if (preferences.layout !== undefined) apiData.layout = preferences.layout
  if (preferences.promptSuggestions !== undefined)
    apiData.prompt_suggestions = preferences.promptSuggestions
  if (preferences.showToolInvocations !== undefined)
    apiData.show_tool_invocations = preferences.showToolInvocations
  if (preferences.showConversationPreviews !== undefined)
    apiData.show_conversation_previews = preferences.showConversationPreviews
  if (preferences.webSearchEnabled !== undefined)
    apiData.web_search_enabled = preferences.webSearchEnabled
  if (preferences.streamingPresentation !== undefined)
    apiData.streaming_presentation = preferences.streamingPresentation
  if (preferences.hiddenModels !== undefined)
    apiData.hidden_models = preferences.hiddenModels
  return apiData
}
