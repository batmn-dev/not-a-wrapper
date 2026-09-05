import type { ChatUiWindow } from "./chat-ui-observer"

/** Called only from the message publisher's rendering callback. */
export function noteChatPublicationFrame(): void {
  if (typeof window !== "undefined")
    (window as ChatUiWindow).__chatUiPerf?.publicationFrame()
}

/** Unsampled pages do not import or install the observer. */
export function noteChatProgrammaticScroll(root: HTMLElement): void {
  if (typeof window !== "undefined")
    (window as ChatUiWindow).__chatUiPerf?.programmaticScroll(root)
}
