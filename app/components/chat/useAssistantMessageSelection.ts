import { RefObject, useCallback, useEffect, useState } from "react"

type SelectionInfo = {
  text: string
  position: { x: number; y: number }
  messageId: string
}

export const constrainSelectionPosition = (
  rect: DOMRect,
  mousePosition: { x: number; y: number }
) => {
  return {
    x: Math.max(rect.left, Math.min(mousePosition.x, rect.right)),
    y: Math.max(rect.top, Math.min(mousePosition.y, rect.bottom)),
  }
}

export const useAssistantMessageSelection = (
  ref: RefObject<HTMLElement | null>,
  enabled: boolean
) => {
  const [selectionInfo, setSelectionInfo] = useState<SelectionInfo | null>(null)

  const onSelectStart = useCallback(() => {
    setSelectionInfo(null)
  }, [])

  const onMouseUp = useCallback(
    (event: MouseEvent) => {
      const selection = window.getSelection()
      const selectedText = selection?.toString()

      // Find the closest ancestor with data-message-id attribute for the current selection
      let messageElement: HTMLElement | null = null
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null
      if (range) {
        const commonAncestor = range.commonAncestorContainer
        if (commonAncestor instanceof HTMLElement) {
          messageElement = commonAncestor.closest("[data-message-id]")
        } else if (commonAncestor.parentNode instanceof HTMLElement) {
          messageElement =
            commonAncestor.parentNode.closest("[data-message-id]")
        }
      }

      const messageId = messageElement?.dataset.messageId

      if (
        !selectedText?.trim() ||
        selectedText.trim().length < 3 ||
        !selection ||
        !messageId ||
        !ref.current?.contains(messageElement)
      ) {
        setSelectionInfo(null)
        return
      }

      if (range) {
        const rect = range.getBoundingClientRect()

        setSelectionInfo({
          text: selectedText.trim(),
          position: constrainSelectionPosition(rect, {
            x: event.clientX,
            y: event.clientY,
          }),
          messageId,
        })
      } else {
        setSelectionInfo(null)
      }
    },
    [ref]
  )

  useEffect(() => {
    if (!enabled) return

    const currentRef = ref.current
    if (currentRef) {
      currentRef.addEventListener("selectstart", onSelectStart)
      document.addEventListener("mouseup", onMouseUp)
      return () => {
        currentRef.removeEventListener("selectstart", onSelectStart)
        document.removeEventListener("mouseup", onMouseUp)
      }
    }
  }, [ref, onSelectStart, onMouseUp, enabled])

  const clearSelection = useCallback(() => {
    setSelectionInfo(null)
    window.getSelection()?.removeAllRanges()
  }, [])

  return { selectionInfo, clearSelection }
}
