/**
 * Feature flags.
 *
 * `ENABLE_PAGINATED_SIDEBAR` gates the bounded sidebar window
 * (docs/sidebar-chat-list-streaming-plan.md commit 8). Default OFF — with it off
 * the sidebar reads the full chat list via `chats.getForCurrentUser`, exactly as
 * before. With it on the sidebar reads a paginated non-project recency window
 * (`chats.getRecentWindowForCurrentUser`) plus a small live pinned non-project
 * read (`chats.getPinnedForCurrentUser`), so a chat write no longer re-reads the
 * whole collection. Temporary rollout lever — remove after the soak.
 *
 * Read from a NEXT_PUBLIC_ env var so it is available in the client bundle.
 */
export const ENABLE_PAGINATED_SIDEBAR =
  process.env.NEXT_PUBLIC_ENABLE_PAGINATED_SIDEBAR === "true"
