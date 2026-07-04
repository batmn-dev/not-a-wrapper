export type LayoutType = "sidebar" | "fullscreen"

export type UserPreferences = {
  layout: LayoutType
  promptSuggestions: boolean
  showToolInvocations: boolean
  showConversationPreviews: boolean
  webSearchEnabled: boolean
  hiddenModels: string[]
}

// API format uses snake_case
export type UserPreferencesApiFormat = {
  layout?: LayoutType
  prompt_suggestions?: boolean
  show_tool_invocations?: boolean
  show_conversation_previews?: boolean
  web_search_enabled?: boolean
  hidden_models?: string[]
}

export const defaultPreferences: UserPreferences = {
  layout: "sidebar",
  promptSuggestions: true,
  showToolInvocations: true,
  showConversationPreviews: true,
  webSearchEnabled: true,
  hiddenModels: [],
}

// Helper functions to convert between API format (snake_case) and frontend format (camelCase)
export function convertFromApiFormat(
  apiData: UserPreferencesApiFormat
): UserPreferences {
  return {
    layout: apiData.layout || "sidebar",
    promptSuggestions: apiData.prompt_suggestions ?? true,
    showToolInvocations: apiData.show_tool_invocations ?? true,
    showConversationPreviews: apiData.show_conversation_previews ?? true,
    webSearchEnabled: apiData.web_search_enabled ?? true,
    hiddenModels: apiData.hidden_models || [],
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
  if (preferences.hiddenModels !== undefined)
    apiData.hidden_models = preferences.hiddenModels
  return apiData
}
