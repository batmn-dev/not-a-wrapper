/**
 * The single decision site for chat-surface chrome (ADR-0017).
 *
 * The chat routes (`/`, `/c/[chatId]`, `/p/[projectId]`) hand their LayoutApp
 * header slot to Chat (`header={null}`) because the visible surface is decided
 * by CLIENT state — chatId and the rendered turn array — which flips inside a
 * shallow first-turn route handoff (and, since the immediate optimistic
 * insert, in the same frame as the send itself). A server-rendered header
 * choice cannot follow that flip: it stranded a header-less thread after a
 * project first send.
 *
 * Chat derives BOTH the surface and its header from this one resolver, so the
 * two can never disagree. Add new surfaces here, not as ad-hoc conditionals in
 * chat.tsx or per-route header slots.
 */
export type ChatSurface = "project-onboarding" | "home-onboarding" | "thread"

export type ChatChrome = {
  surface: ChatSurface
  /**
   * Whether Chat renders the standard app `<Header/>` above the surface.
   * When false the surface owns its chrome — project onboarding renders
   * ProjectDetailSurface's compact mobile header and (by current design)
   * no desktop app header.
   */
  appHeader: boolean
}

export function resolveChatChrome({
  chatId,
  messageCount,
  hasProject,
}: {
  chatId: string | null
  messageCount: number
  hasProject: boolean
}): ChatChrome {
  const onboarding = chatId === null && messageCount === 0
  if (onboarding && hasProject) {
    return { surface: "project-onboarding", appHeader: false }
  }
  if (onboarding) {
    return { surface: "home-onboarding", appHeader: true }
  }
  return { surface: "thread", appHeader: true }
}
