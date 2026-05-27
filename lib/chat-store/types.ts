import type { Doc, Id } from "@/convex/_generated/dataModel"

// ============================================================================
// Convex Types
// ============================================================================

export type ConvexChat = Doc<"chats">
export type ConvexMessage = Doc<"messages">

// ============================================================================
// Unified Types (used throughout the app)
// These types provide a consistent interface for the rest of the application
// ============================================================================

/**
 * Unified Chat type used throughout the application
 * Uses snake_case for compatibility with existing code
 */
export type Chat = {
  id: string
  user_id: string
  title: string | null
  model: string | null
  system_prompt?: string | null
  project_id: string | null
  public: boolean
  pinned: boolean
  pinned_at: string | null
  created_at: string | null
  updated_at: string | null
}

/**
 * Unified Message type used throughout the application
 */
export type Message = {
  id: string | number
  chat_id: string
  user_id?: string | null
  role: "user" | "assistant" | "system" | "data"
  content: string
  parts: unknown
  created_at?: string | null
}

// Alias for backward compatibility
export type Chats = Chat

// ============================================================================
// Conversion Helpers
// ============================================================================

/**
 * Convert Convex chat to unified Chat type
 */
export function convexChatToChat(convexChat: ConvexChat): Chat {
  return {
    id: convexChat._id,
    user_id: convexChat.userId,
    title: convexChat.title ?? null,
    model: convexChat.model ?? null,
    system_prompt: convexChat.systemPrompt ?? null,
    project_id: convexChat.projectId ?? null,
    public: convexChat.public,
    pinned: convexChat.pinned,
    pinned_at: convexChat.pinnedAt
      ? new Date(convexChat.pinnedAt).toISOString()
      : null,
    created_at: new Date(convexChat._creationTime).toISOString(),
    updated_at: convexChat.updatedAt
      ? new Date(convexChat.updatedAt).toISOString()
      : null,
  }
}

/**
 * Convert Convex message to unified Message type
 */
export function convexMessageToMessage(convexMessage: ConvexMessage): Message {
  return {
    id: convexMessage._id,
    chat_id: convexMessage.chatId,
    user_id: convexMessage.userId ?? null,
    role: convexMessage.role,
    content: convexMessage.content,
    parts: convexMessage.parts,
    created_at: new Date(convexMessage.createdAt).toISOString(),
  };
}

/**
 * Type guard to check if a chat ID is a Convex ID
 */
export function isConvexId(id: string): id is Id<"chats"> {
  // Convex IDs are typically longer strings with specific format
  return id.length > 20 && !id.includes("-")
}
