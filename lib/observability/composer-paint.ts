import {
  isChatPerfClientEnabled,
  markChatPerf,
  type ChatPerfEventName,
} from "./chat-performance"

const NEXT_PAINT_EVENT = "composer.keystroke_to_next_paint"
const SETTLED_PAINT_EVENT = "composer.keystroke_to_settled_paint"

export type ComposerPaintController = {
  onEditorUpdate: () => void
  onComposerUpdate: () => void
  dispose: () => void
}

const NOOP_COMPOSER_PAINT_CONTROLLER: ComposerPaintController = {
  onEditorUpdate: () => {},
  onComposerUpdate: () => {},
  dispose: () => {},
}

function eventTime(event: Event) {
  return event.timeStamp > performance.timeOrigin
    ? event.timeStamp - performance.timeOrigin
    : event.timeStamp
}

function isMeasuredKey(event: KeyboardEvent) {
  if (event.metaKey || event.ctrlKey || event.altKey) return false
  return (
    event.key.length === 1 ||
    event.key === "Backspace" ||
    event.key === "Delete"
  )
}

const MEASURED_INPUT_TYPES = new Set([
  "insertText",
  "insertCompositionText",
  "insertFromComposition",
  "insertReplacementText",
  "insertLineBreak",
  "insertParagraph",
  "deleteContentBackward",
  "deleteContentForward",
])

/**
 * Measures the browser-sensitive editor → React Composer paint handoff without
 * recording draft content. The controller uses keydown/beforeinput
 * classification, a one-frame editor mark, and a two-frame settled mark.
 */
export function createComposerPaintController(
  editor: HTMLElement
): ComposerPaintController {
  if (!isChatPerfClientEnabled()) return NOOP_COMPOSER_PAINT_CONTROLLER

  let pendingInputStartedAt: number | undefined
  let pendingComposerStartedAt: number | undefined
  let carryInputToNextComposer = false
  let skipNextComposerMeasure = false
  const frames = new Set<number>()

  const measureAfterFrames = (
    event: ChatPerfEventName,
    startedAt: number,
    remainingFrames: number
  ) => {
    const frame = requestAnimationFrame((paintedAt) => {
      frames.delete(frame)
      if (remainingFrames > 1) {
        measureAfterFrames(event, startedAt, remainingFrames - 1)
        return
      }
      markChatPerf(event, {
        durationMs: Math.max(0, paintedAt - startedAt),
      })
    })
    frames.add(frame)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (isMeasuredKey(event)) pendingInputStartedAt = eventTime(event)
  }

  const onBeforeInput = (event: InputEvent) => {
    if (MEASURED_INPUT_TYPES.has(event.inputType)) {
      const startedAt = eventTime(event)
      pendingInputStartedAt =
        pendingInputStartedAt === undefined
          ? startedAt
          : Math.min(pendingInputStartedAt, startedAt)
      return
    }

    pendingInputStartedAt = undefined
    pendingComposerStartedAt = undefined
    skipNextComposerMeasure = true
  }

  editor.addEventListener("keydown", onKeyDown, true)
  editor.addEventListener("beforeinput", onBeforeInput, true)

  return {
    onEditorUpdate() {
      if (pendingInputStartedAt === undefined) return
      const startedAt = pendingInputStartedAt
      pendingInputStartedAt = undefined

      if (carryInputToNextComposer) {
        carryInputToNextComposer = false
      } else {
        pendingComposerStartedAt =
          pendingComposerStartedAt === undefined
            ? startedAt
            : Math.min(pendingComposerStartedAt, startedAt)
      }
      measureAfterFrames(NEXT_PAINT_EVENT, startedAt, 1)
    },
    onComposerUpdate() {
      if (skipNextComposerMeasure) {
        skipNextComposerMeasure = false
        pendingComposerStartedAt = undefined
        carryInputToNextComposer = pendingInputStartedAt !== undefined
        return
      }

      const startedAt = pendingComposerStartedAt ?? pendingInputStartedAt
      if (startedAt === undefined) return

      carryInputToNextComposer = pendingComposerStartedAt === undefined
      pendingComposerStartedAt = undefined
      measureAfterFrames(SETTLED_PAINT_EVENT, startedAt, 2)
    },
    dispose() {
      editor.removeEventListener("keydown", onKeyDown, true)
      editor.removeEventListener("beforeinput", onBeforeInput, true)
      for (const frame of frames) cancelAnimationFrame(frame)
      frames.clear()
    },
  }
}
