/**
 * Feature flags.
 *
 * `ENABLE_PAGINATED_SIDEBAR` gates the bounded sidebar window
 * (docs/adr/0005-bounded-chat-list-window.md). Default ON — the sidebar reads a
 * paginated recency window that retains project membership
 * (`chats.getRecentWindowForCurrentUser`) plus a small live pinned read
 * (`chats.getPinnedForCurrentUser`), so a chat write no longer re-reads the
 * whole collection. Set the flag to the exact string `"false"` for an instant
 * rollback to the legacy full-list subscription. Remove the lever after the
 * default-on soak.
 *
 * Read from a NEXT_PUBLIC_ env var so it is available in the client bundle.
 */
export const ENABLE_PAGINATED_SIDEBAR =
  process.env.NEXT_PUBLIC_ENABLE_PAGINATED_SIDEBAR !== "false"
