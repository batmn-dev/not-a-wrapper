import { useCallback, useRef, useState } from "react"

type SelectionInfo = {
  container: HTMLElement
  range: Range
  text: string
  messageId: string
}

export const useAssistantMessageSelection = (enabled: boolean) => {
  const [selectionInfo, setSelectionInfo] = useState<SelectionInfo | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  const messageRef = useCallback(
    (messageContainer: HTMLDivElement | null) => {
      cleanupRef.current?.()
      cleanupRef.current = null

      if (!enabled || !messageContainer) return

      const clearSelectionInfo = () => setSelectionInfo(null)
      const onPointerDown = (event: PointerEvent) => {
        const target = event.target
        if (!(target instanceof Node) || messageContainer.contains(target))
          return

        setSelectionInfo(null)
      }
      const onMouseUp = () => {
        const selection = window.getSelection()
        const selectedText = selection?.toString()

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
          !messageContainer.contains(messageElement)
        ) {
          setSelectionInfo(null)
          return
        }

        if (range) {
          setSelectionInfo({
            container: messageContainer,
            range: range.cloneRange(),
            text: selectedText.trim(),
            messageId,
          })
        } else {
          setSelectionInfo(null)
        }
      }

      messageContainer.addEventListener("selectstart", clearSelectionInfo)
      document.addEventListener("mouseup", onMouseUp)
      document.addEventListener("pointerdown", onPointerDown)
      const cleanup = () => {
        messageContainer.removeEventListener("selectstart", clearSelectionInfo)
        document.removeEventListener("mouseup", onMouseUp)
        document.removeEventListener("pointerdown", onPointerDown)
      }
      cleanupRef.current = cleanup
      return cleanup
    },
    [enabled]
  )

  const clearSelection = useCallback(() => {
    setSelectionInfo(null)
    window.getSelection()?.removeAllRanges()
  }, [])

  return { selectionInfo, clearSelection, messageRef }
}
