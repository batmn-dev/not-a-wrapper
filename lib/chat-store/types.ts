import type { Doc, Id } from "@/convex/_generated/dataModel"

export type ConvexChat = Doc<"chats">
export type ConvexMessage = Doc<"messages">

/** App-facing chat shape; snake_case is retained for existing consumers. */
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
  // Absent on optimistic/local chats, which derive an idle sidebar status.
  live_run_status?: "streaming" | "awaiting" | null
  // Once-written freshness ceiling for the live projection (gameplan §5):
  // prepare stamps startedAt + route budget + slack; an approval pause stamps
  // the approval's own expiry. An expired ceiling must never render a spinner.
  live_run_fresh_until?: number | null
  // Owner-only cursor used to derive unread/error for completed background runs.
  last_run_ended_at?: number | null
  last_run_status?: "completed" | "failed" | null
  last_read_at?: number | null
}

export type Message = {
  id: string | number
  chat_id: string
  user_id?: string | null
  role: "user" | "assistant" | "system" | "data"
  content: string
  parts: unknown
  created_at?: string | null
}

/** Compatibility alias for existing consumers. */
export type Chats = Chat

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
    live_run_status: convexChat.liveRunStatus ?? null,
    live_run_fresh_until: convexChat.liveRunFreshUntil ?? null,
    last_run_ended_at: convexChat.lastRunEndedAt ?? null,
    last_run_status: convexChat.lastRunStatus ?? null,
    last_read_at: convexChat.lastReadAt ?? null,
  }
}

export function convexMessageToMessage(convexMessage: ConvexMessage): Message {
  return {
    id: convexMessage._id,
    chat_id: convexMessage.chatId,
    user_id: convexMessage.userId ?? null,
    role: convexMessage.role,
    content: convexMessage.content,
    parts: convexMessage.parts,
    created_at: new Date(convexMessage.createdAt).toISOString(),
  }
}

export function isConvexId(id: string): id is Id<"chats"> {
  return id.length > 20 && !id.includes("-")
}
