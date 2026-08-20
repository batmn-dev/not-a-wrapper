/**
 * Platform allowance plan policy (ADR-0021) — the ONE typed home for grant
 * sizes, refill semantics, and period identity. Server-owned: nothing here is
 * client-adjustable, and every consumer (reserve, grant, reconciler, the
 * allowance query) derives period identity from the same functions so a
 * bucket can never be minted twice for one period.
 *
 * PROVISIONAL GRANT SIZES: the credit amounts below are engineering
 * placeholders pending product-owner confirmation (see the decision table in
 * docs/adr/0021-platform-usage-allowance.md). Changing a grant is a
 * one-constant edit here; existing buckets keep the grant they were minted
 * with (plan changes take effect at the next period's materialization).
 */

/** 1 credit = 1 micro-USD (10^-6 USD) of platform cost. Integers only. */
export const CREDITS_PER_USD = 1_000_000

export type PlanId = "free-v1" | "premium-v1"

export type PlanPolicy = {
  planId: PlanId
  /** Included allowance granted per plan period, in credits (micro-USD). */
  includedCreditsPerPeriod: number
}

const FREE_PLAN: PlanPolicy = {
  planId: "free-v1",
  includedCreditsPerPeriod: 1 * CREDITS_PER_USD,
}

const PREMIUM_PLAN: PlanPolicy = {
  planId: "premium-v1",
  includedCreditsPerPeriod: 10 * CREDITS_PER_USD,
}

/** The plan a user is on right now. `premium` is the existing users flag. */
export function resolvePlanPolicy(user: { premium?: boolean }): PlanPolicy {
  return user.premium === true ? PREMIUM_PLAN : FREE_PLAN
}

export type PlanPeriod = {
  /** Stable period identity, e.g. "2026-08" (UTC calendar month). */
  periodKey: string
  periodStart: number
  periodEnd: number
}

/**
 * Refill semantics: one bucket per UTC calendar month, materialized lazily on
 * first use. No per-user renewal anchor — the month boundary is the anchor —
 * and no rollover: a new period starts a fresh bucket, which also ends any
 * negative-balance block from the prior period ("until the next grant").
 */
export function currentPlanPeriod(now: number): PlanPeriod {
  const date = new Date(now)
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth()
  const periodKey = `${year}-${String(month + 1).padStart(2, "0")}`
  return {
    periodKey,
    periodStart: Date.UTC(year, month, 1),
    periodEnd: Date.UTC(year, month + 1, 1),
  }
}
