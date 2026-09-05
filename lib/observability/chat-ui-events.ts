import type { ChatUiWindow } from "./chat-ui-observer"

/** Unsampled pages do not import or install the observer. */
export function noteChatProgrammaticScroll(root: HTMLElement): void {
  if (typeof window !== "undefined")
    (window as ChatUiWindow).__chatUiPerf?.programmaticScroll(root)
}
