"use client"

import { api } from "@/convex/_generated/api"
import type { Doc } from "@/convex/_generated/dataModel"
import { usePerUserQuery } from "@/lib/convex/use-per-user-query"
import { convexChatToChat, type Chats } from "../types"
import { useChats } from "./provider"

export type UseChatResult = {
  /** The chat, or undefined while a fallback read is loading / not found. */
  chat: Chats | undefined
  /** True only while the out-of-window fallback read is in flight. */
  isLoading: boolean
}

/**
 * Resolve the args for the `chats.getById` fallback read. Returns `"skip"`
 * whenever the chat is already in the live sidebar window (served
 * synchronously) or there is no chat id. Guests never subscribe: the per-user
 * query seam gates on Convex auth, so a local chat id costs no read.
 */
function resolveGetByIdArgs(
  chatId: string | null | undefined,
  inWindow: Chats | undefined
): { chatId: string } | "skip" {
  if (!chatId || inWindow) return "skip"
  return { chatId }
}

/**
 * The chat to surface: the in-window chat takes precedence (synchronous, already
 * subscribed); otherwise the server fallback, mapped to the UI type.
 */
function pickChat(
  inWindow: Chats | undefined,
  serverChat: Doc<"chats"> | null | undefined
): Chats | undefined {
  if (inWindow) return inWindow
  return serverChat ? convexChatToChat(serverChat) : undefined
}

/**
 * Per-chat access that works even when the chat is outside the bounded sidebar
 * window. Returns the in-window chat synchronously from `useChats().getChatById`
 * when present; otherwise falls back to a targeted `chats.getById` read (which
 * also closes a latent deep-link gap for chats not in the live list).
 *
 * See docs/adr/0005-bounded-chat-list-window.md.
 */
export function useChat(chatId: string | null | undefined): UseChatResult {
  const { getChatById } = useChats()
  const inWindow = chatId ? getChatById(chatId) : undefined

  const args = resolveGetByIdArgs(chatId, inWindow)
  const { data, isLoading } = usePerUserQuery(api.chats.getById, args)

  return {
    chat: pickChat(inWindow, data),
    isLoading: args !== "skip" && isLoading,
  }
}
