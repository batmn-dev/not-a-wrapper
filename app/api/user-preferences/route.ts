import { getWorkosSession } from "@/lib/auth/workos"
import { NextResponse } from "next/server"

/**
 * DEPRECATED: User preferences are now managed via Convex client-side hooks.
 * 
 * This endpoint is kept for backward compatibility but clients should use:
 * - useQuery(api.userPreferences.get) for reading
 * - useMutation(api.userPreferences.update) for writing
 * 
 * See: lib/user-preference-store/provider.tsx
 */

const defaultPreferences = {
  layout: "fullscreen",
  promptSuggestions: true,
  showToolInvocations: true,
  showConversationPreviews: true,
  webSearchEnabled: true,
  hiddenModels: [],
}

export async function GET() {
  try {
    const { user } = await getWorkosSession()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Return default preferences
    // Actual preferences are fetched via Convex client-side hooks
    return NextResponse.json({
      layout: defaultPreferences.layout,
      prompt_suggestions: defaultPreferences.promptSuggestions,
      show_tool_invocations: defaultPreferences.showToolInvocations,
      show_conversation_previews: defaultPreferences.showConversationPreviews,
      web_search_enabled: defaultPreferences.webSearchEnabled,
      hidden_models: defaultPreferences.hiddenModels,
    })
  } catch (error) {
    console.error("Error in user-preferences GET API:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request) {
  try {
    const { user } = await getWorkosSession()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // DEPRECATED: This endpoint no longer persists data.
    // Preferences should be updated via Convex useMutation hook client-side.
    // See: lib/user-preference-store/provider.tsx
    console.warn(
      `[DEPRECATED] PUT /api/user-preferences called by user ${user.id}. ` +
      "This endpoint no longer persists data. Use Convex mutations instead."
    )

    // Parse the request body to echo it back (for backward compatibility)
    let submittedPreferences = {}
    try {
      submittedPreferences = await request.json()
    } catch {
      // Empty body is fine, use defaults
    }

    // Return 200 with deprecation flag for backward compatibility
    // Echo back submitted preferences merged with defaults so clients don't break
    return NextResponse.json({
      ...defaultPreferences,
      ...submittedPreferences,
      _deprecated: true,
      _message: "This endpoint is deprecated. Use Convex mutations client-side.",
    })
  } catch (error) {
    console.error("Error in user-preferences PUT API:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
