import {
  shareTarget,
  type ShareTargetOutcome,
} from "@/lib/browser/share-target"
import { APP_DOMAIN } from "@/lib/config"

const PUBLIC_CHAT_SHARE_TITLE =
  "Check out this conversation I shared with Not A Wrapper!"

export function getPublicChatShareDetails(chatId: string) {
  const publicLink = `${APP_DOMAIN}/share/${chatId}`
  const postText = `${PUBLIC_CHAT_SHARE_TITLE} ${publicLink}`
  return {
    postText,
    publicLink,
    shareTarget: { title: postText, url: publicLink } satisfies ShareData,
    xIntentUrl: `https://x.com/intent/tweet?text=${encodeURIComponent(postText)}`,
  }
}

type SharePublishedChatOptions = {
  chatId: string
  publish: () => Promise<unknown>
  openFallback: () => void
}

/**
 * Publishes first, then follows ChatGPT's share capability order: native share
 * when supported, otherwise the existing custom surface. Dismissal is a user
 * decision, while a capability or operational failure opens the fallback.
 */
export async function sharePublishedChat({
  chatId,
  publish,
  openFallback,
}: SharePublishedChatOptions): Promise<ShareTargetOutcome> {
  await publish()
  const outcome = await shareTarget(
    getPublicChatShareDetails(chatId).shareTarget
  )
  if (outcome === "unsupported" || outcome === "failed") openFallback()
  return outcome
}
