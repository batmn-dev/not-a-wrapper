/**
 * Create Guest User API
 * 
 * This endpoint is kept for backward compatibility but returns a mock
 * guest user. Actual guest functionality is local and unauthenticated.
 */
export async function POST(request: Request) {
  try {
    const { userId } = await request.json()

    if (!userId) {
      return new Response(JSON.stringify({ error: "Missing userId" }), {
        status: 400,
      })
    }

    // Input validation: ensure userId is a string with safe characters
    if (typeof userId !== "string") {
      return new Response(JSON.stringify({ error: "Invalid userId" }), {
        status: 400,
      })
    }

    const trimmedUserId = userId.trim()
    const userIdPattern = /^[a-zA-Z0-9_\-:@.]{1,128}$/

    if (!trimmedUserId || !userIdPattern.test(trimmedUserId)) {
      return new Response(JSON.stringify({ error: "Invalid userId format" }), {
        status: 400,
      })
    }

    // Return a mock user for backward compatibility
    console.log("Guest user creation handled via local storage")
    
    return new Response(
      JSON.stringify({ 
        user: { 
          id: trimmedUserId, 
          anonymous: true,
          message_count: 0,
          daily_message_count: 0,
        } 
      }),
      { status: 200 }
    )
  } catch (err: unknown) {
    console.error("Error in create-guest endpoint:", err)

    return new Response(
      JSON.stringify({ error: (err as Error).message || "Internal server error" }),
      { status: 500 }
    )
  }
}
