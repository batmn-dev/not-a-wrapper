/**
 * Feature flags.
 *
 * `ENABLE_DURABLE_RUN_PRESENTATION` gates only the user-visible
 * background/stale/returning-client run presentation from the durable-turn
 * gameplan. Backend leases, reapers, snapshots, approval expiry, exact-run
 * Stop, and atomic projection stay active while it is off. Enable only after
 * the gameplan's 15-flow manual checklist passes; unset/default is OFF so the
 * rollback path is real before rollout.
 *
 * `ENABLE_PAGINATED_SIDEBAR` independently gates the bounded sidebar window
 * (docs/adr/0005-bounded-chat-list-window.md). Default ON — the sidebar reads a
 * paginated recency window that retains project membership
 * (`chats.getRecentWindowForCurrentUser`) plus a small live pinned read
 * (`chats.getPinnedForCurrentUser`), so a chat write no longer re-reads the
 * whole collection. Set the flag to the exact string `"false"` for an instant
 * rollback to the legacy full-list subscription. Remove the lever after the
 * default-on soak.
 *
 * Read from a NEXT_PUBLIC_ env var so it is available in the client bundle.
 *
 * Seam contract (docs/chat-performance-rollout-seam.md): NEXT_PUBLIC_ flags
 * are build-time-inlined — changing one is a redeploy, never a live toggle —
 * and provide no percentage cohorts by themselves. Performance-flag
 * accessors live next to their consumers (`lib/observability/
 * chat-performance.ts` client/server, `convex/lib/runtime_flags.ts` for
 * Convex execution); this module stays the home of product feature flags.
 */
export const ENABLE_DURABLE_RUN_PRESENTATION =
  process.env.NEXT_PUBLIC_ENABLE_DURABLE_RUN_PRESENTATION === "true"

export const ENABLE_PAGINATED_SIDEBAR =
  process.env.NEXT_PUBLIC_ENABLE_PAGINATED_SIDEBAR !== "false"
