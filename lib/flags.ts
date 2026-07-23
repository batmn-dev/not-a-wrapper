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
 * (`ENABLE_PAGINATED_SIDEBAR` was removed in the 2026-07-23 flag collapse
 * after its default-on soak: the bounded sidebar window — ADR-0005 — is now
 * the only sidebar read path.)
 *
 * Read from a NEXT_PUBLIC_ env var so it is available in the client bundle.
 *
 * Seam contract (docs/chat-performance-rollout-seam.md): NEXT_PUBLIC_ flags
 * are build-time-inlined — changing one is a redeploy, never a live toggle —
 * and provide no percentage cohorts by themselves. Performance-flag accessors
 * live next to their consumers (`lib/observability/chat-performance.ts`
 * client/server); this module stays the home of product feature flags.
 */
export const ENABLE_DURABLE_RUN_PRESENTATION =
  process.env.NEXT_PUBLIC_ENABLE_DURABLE_RUN_PRESENTATION === "true"
