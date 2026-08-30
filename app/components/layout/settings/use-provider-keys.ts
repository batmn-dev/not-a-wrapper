"use client"

import { toast } from "@/components/ui/toast"
import { fetchClient } from "@/lib/fetch"
import { useMutation } from "@tanstack/react-query"
import { useCallback, useState } from "react"

export type ProviderKeyConfig = {
  id: string
  name: string
  placeholder: string
  getKeyUrl: string
  /** Shown in the password field when a key is stored; falls back to generic dots. */
  maskHint?: string
}

type SaveResult = { isNewKey?: boolean }

const GENERIC_MASK = "••••••••••••"

/**
 * The provider-key management module: selection, the draft buffer + masking,
 * and the save/delete mutations against `/api/user-keys` with their toasts and
 * the "don't save the mask / empty" guard. Provider-domain-free — key presence
 * arrives as `keyStatus` and side-effects (catalog refresh, favorites) as the
 * `onSaved`/`onDeleted` ports — so it is the single home the BYOK and tool-key
 * panels both run through instead of two ~390-line copies.
 */
export function useProviderKeys({
  providers,
  defaultProvider,
  keyStatus,
  noun,
  onSaved,
  onDeleted,
}: {
  providers: ProviderKeyConfig[]
  defaultProvider: string
  keyStatus: Record<string, boolean>
  /** Toast noun, e.g. "API key" / "Tool key". */
  noun: string
  onSaved?: (providerId: string, result: SaveResult) => void | Promise<void>
  onDeleted?: (providerId: string) => void | Promise<void>
}) {
  const [selectedProvider, setSelectedProvider] = useState(defaultProvider)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [providerToDelete, setProviderToDelete] = useState<string>("")

  const nameOf = useCallback(
    (id: string) => providers.find((p) => p.id === id)?.name ?? id,
    [providers]
  )
  const selectedConfig = providers.find((p) => p.id === selectedProvider)
  const hasKey = useCallback(
    (id: string) => Boolean(keyStatus[id]),
    [keyStatus]
  )
  const maskFor = (config?: ProviderKeyConfig) =>
    config?.maskHint ?? GENERIC_MASK

  // Display value: the live draft if the field has been touched, otherwise the
  // mask (when a key is stored) or empty.
  const draft = drafts[selectedProvider]
  const inputValue =
    draft !== undefined
      ? draft
      : hasKey(selectedProvider)
        ? maskFor(selectedConfig)
        : ""

  const setInputValue = (value: string) =>
    setDrafts((prev) => ({ ...prev, [selectedProvider]: value }))

  // Clear the mask on focus so the user types over a stored key instead of
  // editing the dots.
  const onInputFocus = () => {
    if (hasKey(selectedProvider) && drafts[selectedProvider] === undefined) {
      setDrafts((prev) => ({ ...prev, [selectedProvider]: "" }))
    }
  }

  const clearDraft = (id: string) =>
    setDrafts((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })

  const runSideEffect = (sideEffect: () => void | Promise<void>) => {
    try {
      void Promise.resolve(sideEffect()).catch(() => {
        // Caller-owned refresh failures should not leave local secret/UI state dirty.
      })
    } catch {
      // Caller-owned refresh failures should not leave local secret/UI state dirty.
    }
  }

  const saveMutation = useMutation({
    mutationFn: async ({
      provider,
      apiKey,
    }: {
      provider: string
      apiKey: string
    }) => {
      const res = await fetchClient("/api/user-keys", {
        method: "POST",
        body: JSON.stringify({ provider, apiKey }),
      })
      if (!res.ok) throw new Error("Failed to save key")
      return (await res.json()) as SaveResult
    },
    onSuccess: async (result, { provider }) => {
      toast({
        title: `${noun} saved`,
        description: result?.isNewKey
          ? `Your ${nameOf(provider)} ${noun} has been saved.`
          : `Your ${nameOf(provider)} ${noun} has been updated.`,
      })
      runSideEffect(() => onSaved?.(provider, result))
      clearDraft(provider) // reset the field back to its masked state
    },
    onError: (
      _error: Error,
      { provider }: { provider: string; apiKey: string }
    ) => {
      toast({
        title: `Failed to save ${noun}`,
        description: `Failed to save ${nameOf(provider)} ${noun}. Please try again.`,
      })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (provider: string) => {
      const res = await fetchClient("/api/user-keys", {
        method: "DELETE",
        body: JSON.stringify({ provider }),
      })
      if (!res.ok) throw new Error("Failed to delete key")
      return res
    },
    onSuccess: async (_res, provider) => {
      toast({
        title: `${noun} deleted`,
        description: `Your ${nameOf(provider)} ${noun} has been deleted.`,
      })
      runSideEffect(() => onDeleted?.(provider))
      clearDraft(provider)
      setDeleteDialogOpen(false)
      setProviderToDelete("")
    },
    onError: (_error: Error, provider: string) => {
      toast({
        title: `Failed to delete ${noun}`,
        description: `Failed to delete ${nameOf(provider)} ${noun}. Please try again.`,
      })
      setDeleteDialogOpen(false)
      setProviderToDelete("")
    },
  })

  const save = () => {
    const value = drafts[selectedProvider]
    // Never persist an untouched mask or an empty field (this also fixes the
    // old BYOK path, which would POST the placeholder dots on an untouched Save).
    if (!value || value === maskFor(selectedConfig)) {
      toast({
        title: "No key entered",
        description: "Please enter an API key before saving.",
      })
      return
    }
    saveMutation.mutate({ provider: selectedProvider, apiKey: value })
  }

  const requestDelete = (id: string) => {
    setProviderToDelete(id)
    setDeleteDialogOpen(true)
  }

  const confirmDelete = () => {
    if (providerToDelete) deleteMutation.mutate(providerToDelete)
  }

  return {
    selectedProvider,
    selectedConfig,
    select: setSelectedProvider,
    hasKey,
    nameOf,
    inputValue,
    setInputValue,
    onInputFocus,
    save,
    saving: saveMutation.isPending,
    deleting: deleteMutation.isPending,
    deleteDialogOpen,
    setDeleteDialogOpen,
    providerToDelete,
    requestDelete,
    confirmDelete,
  }
}
