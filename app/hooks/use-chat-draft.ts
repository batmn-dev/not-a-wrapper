import { useCallback, useMemo, useSyncExternalStore } from "react"

const subscribeToStorage = (callback: () => void) => {
  window.addEventListener("storage", callback)
  return () => window.removeEventListener("storage", callback)
}

export function useChatDraft(chatId: string | null) {
  const storageKey = chatId ? `chat-draft-${chatId}` : "chat-draft-new"

  const getSnapshot = useMemo(
    () => () => localStorage.getItem(storageKey) ?? "",
    [storageKey]
  )

  const getServerSnapshot = useCallback(() => "", [])

  const storedValue = useSyncExternalStore(
    subscribeToStorage,
    getSnapshot,
    getServerSnapshot
  )

  const setDraftValue = useCallback(
    (value: string) => {
      if (value) {
        localStorage.setItem(storageKey, value)
      } else {
        localStorage.removeItem(storageKey)
      }
      window.dispatchEvent(new StorageEvent("storage", { key: storageKey }))
    },
    [storageKey]
  )

  const clearDraft = useCallback(() => {
    localStorage.removeItem(storageKey)
    window.dispatchEvent(new StorageEvent("storage", { key: storageKey }))
  }, [storageKey])

  return {
    draftValue: storedValue,
    setDraftValue,
    clearDraft,
  }
}
