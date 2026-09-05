import type { ChatUiWindow } from "./chat-ui-observer"

/** Committed admission state only; retained for an observer installed after hydration. */
export function noteChatAccountReadiness(ready: boolean | undefined): void {
  if (typeof window === "undefined") return
  const page = window as ChatUiWindow
  if (ready === undefined) delete page.__chatAccountReady
  else page.__chatAccountReady = ready
  page.__chatUiPerf?.accountReadinessChanged()
}

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
