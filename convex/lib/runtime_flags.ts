/**
 * Server-side runtime flags for Convex execution, read from deployment
 * environment variables at call time (so tests can toggle them and a
 * deployment env change takes effect on the next function execution).
 *
 * `CHAT_SINGLE_PASS_BRANCH_CONTEXT` (chat-responsiveness plan, PR 1): when
 * "true", branch consumers build ONE `BranchContext` per immutable
 * message-array version and reuse it (query decoration shares one context;
 * the branch writer caches per planned array version). When off — the
 * default — every helper call rebuilds its context, exactly the pre-PR-1
 * work pattern. The flag never selects a second algorithm: both settings run
 * the same canonical context implementation and produce identical results;
 * it exists as the staged-rollout/rollback lever for the shared-context
 * consumption pattern (plan §9.2). Flipping it requires no data migration.
 */
export function isSinglePassBranchContextEnabled(): boolean {
  return process.env.CHAT_SINGLE_PASS_BRANCH_CONTEXT === "true"
}
