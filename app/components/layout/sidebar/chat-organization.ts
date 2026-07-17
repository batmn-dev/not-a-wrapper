"use client"

import { useCallback, useSyncExternalStore } from "react"

export type ChatOrganization = "by-project" | "one-list"

export const CHAT_ORGANIZATION_STORAGE_KEY = "sidebar-chat-organization"
export const DEFAULT_CHAT_ORGANIZATION: ChatOrganization = "by-project"

export function parseChatOrganization(value: string | null): ChatOrganization {
  return value === "one-list" ? "one-list" : DEFAULT_CHAT_ORGANIZATION
}

function subscribeToChatOrganization(onStoreChange: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === CHAT_ORGANIZATION_STORAGE_KEY) onStoreChange()
  }
  window.addEventListener("storage", handleStorage)
  return () => window.removeEventListener("storage", handleStorage)
}

function getChatOrganizationSnapshot(): ChatOrganization {
  return parseChatOrganization(
    localStorage.getItem(CHAT_ORGANIZATION_STORAGE_KEY)
  )
}

function getServerChatOrganizationSnapshot(): ChatOrganization {
  return DEFAULT_CHAT_ORGANIZATION
}

function subscribeToHydration() {
  return () => undefined
}

export function setStoredChatOrganization(next: ChatOrganization) {
  localStorage.setItem(CHAT_ORGANIZATION_STORAGE_KEY, next)
  window.dispatchEvent(
    new StorageEvent("storage", { key: CHAT_ORGANIZATION_STORAGE_KEY })
  )
}

/**
 * Sidebar-owned grouping preference. `useSyncExternalStore` keeps desktop,
 * mobile, and same-browser tabs synchronized without effect-mirrored state.
 */
export function useChatOrganization() {
  const organization = useSyncExternalStore(
    subscribeToChatOrganization,
    getChatOrganizationSnapshot,
    getServerChatOrganizationSnapshot
  )
  const isHydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false
  )
  const setOrganization = useCallback(
    (next: ChatOrganization) => setStoredChatOrganization(next),
    []
  )

  return [organization, setOrganization, isHydrated] as const
}
