import { useCallback, useEffect, useRef, useState } from "react"
import useClickOutside from "@/hooks/useClickOutside"

export type UseInlineRenameOptions = {
  /**
   * Fired whenever edit mode ends — on a committed change, a skipped no-op
   * commit, or a cancel. Use it for side effects that must run on every exit
   * (e.g. closing the menu that launched the rename).
   */
  onEditEnd?: () => void
}

/**
 * Owns the inline-rename lifecycle for a single editable label: edit toggling,
 * the draft buffer, focus/select on entry, Enter-to-commit / Escape-to-cancel,
 * click-outside-commits, and resyncing the draft when the persisted value
 * changes externally.
 *
 * The hook is the home for the "should this commit?" rule: a draft is trimmed
 * before comparison and `onSave` is only called when the trimmed value is
 * non-empty AND differs from `currentValue`. Persistence and error handling
 * live entirely in the caller's `onSave`.
 */
export function useInlineRename(
  currentValue: string,
  onSave: (next: string) => void | Promise<void>,
  options?: UseInlineRenameOptions
) {
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(currentValue)
  const [prevValue, setPrevValue] = useState(currentValue)

  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Keep callbacks behind refs so the hook's own handlers stay referentially
  // stable across renders even when callers pass inline `onSave`/`options`.
  const onSaveRef = useRef(onSave)
  const optionsRef = useRef(options)
  useEffect(() => {
    onSaveRef.current = onSave
    optionsRef.current = options
  })

  // React 19 pattern: resync the draft when the persisted value changes
  // externally, but only while not actively editing (don't clobber typing).
  if (!isEditing && currentValue !== prevValue) {
    setPrevValue(currentValue)
    setDraft(currentValue)
  }

  const start = useCallback(() => {
    setIsEditing(true)
    setDraft(currentValue)

    requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.focus()
        inputRef.current.select()
      }
    })
  }, [currentValue])

  const cancel = useCallback(() => {
    setDraft(currentValue)
    setIsEditing(false)
    optionsRef.current?.onEditEnd?.()
  }, [currentValue])

  const save = useCallback(async () => {
    const next = draft.trim()
    setIsEditing(false)
    optionsRef.current?.onEditEnd?.()
    // Skip no-op commits: empty or unchanged values never reach onSave.
    if (next.length === 0 || next === currentValue) return
    await onSaveRef.current(next)
  }, [draft, currentValue])

  const handleClickOutside = useCallback(() => {
    if (isEditing) save()
  }, [isEditing, save])

  useClickOutside(containerRef, handleClickOutside)

  const onContainerClick = useCallback(
    (e: React.MouseEvent) => {
      if (isEditing) e.stopPropagation()
    },
    [isEditing]
  )

  const onSaveClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      save()
    },
    [save]
  )

  const onCancelClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      cancel()
    },
    [cancel]
  )

  const inputProps = {
    value: draft,
    autoFocus: true,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setDraft(e.target.value),
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault()
        save()
      } else if (e.key === "Escape") {
        e.preventDefault()
        cancel()
      }
    },
  }

  return {
    isEditing,
    draft,
    inputRef,
    containerRef,
    start,
    cancel,
    inputProps,
    onContainerClick,
    onSaveClick,
    onCancelClick,
  }
}
