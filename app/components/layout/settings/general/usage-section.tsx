"use client"

import { Progress } from "@/components/ui/progress"
import { api } from "@/convex/_generated/api"
import { usePerUserQuery } from "@/lib/convex/use-per-user-query"
import type { FunctionReturnType } from "convex/server"

/**
 * Included platform-usage page (ADR-0021). Reads the live allowance through
 * the per-user subscription seam; percentages only, so internal credit values
 * never surface. Pending reservations reduce the displayed remainder and
 * contribute to the used portion of the meter until they settle or release.
 */

function formatPercent(fraction: number): string {
  if (fraction <= 0) return "0%"
  const percent = fraction * 100
  if (percent < 1) return "<1%"
  return `${Math.min(100, Math.round(percent))}%`
}

type Allowance = FunctionReturnType<
  typeof api.usageAllowance.getCurrentAllowance
>

function getUsageDisplay(allowance: Allowance) {
  const granted = allowance.grantedCredits
  const spent = allowance.spentCredits
  const reserved = allowance.reservedCredits
  const remainingFraction =
    granted > 0
      ? Math.max(0, Math.min(1, (granted - spent - reserved) / granted))
      : 0
  const refillAt = new Date(allowance.periodEnd)
  const refillDate = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(refillAt)
  const refillTime = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(refillAt)

  return {
    meterValue: granted > 0 ? Math.round((1 - remainingFraction) * 100) : 0,
    refillLabel: `${refillDate} ${refillTime}`,
    remainingLabel: `${formatPercent(remainingFraction)} remaining`,
  }
}

export function UsageSection() {
  const { data: allowance, isAuthReady } = usePerUserQuery(
    api.usageAllowance.getCurrentAllowance
  )

  if (!isAuthReady) return null

  const display = allowance === undefined ? null : getUsageDisplay(allowance)

  return (
    <section aria-labelledby="monthly-usage-limit">
      <p className="text-muted-foreground border-border border-b pb-4 text-sm leading-5 text-pretty">
        Usage is shared across models and conversations. It doesn&apos;t include
        messages sent with your own API keys.
      </p>

      <div className="border-border flex min-h-15 items-center border-b py-2 last-of-type:border-none">
        <div className="w-full">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-4">
              <h4
                id="monthly-usage-limit"
                className="text-foreground text-sm font-normal"
              >
                Monthly usage limit
              </h4>
              <span className="text-foreground text-sm tabular-nums">
                {display?.remainingLabel ?? "… remaining"}
              </span>
            </div>
            <Progress
              value={display?.meterValue ?? null}
              aria-label="Included allowance used this period"
              className="bg-info/30 [&>[data-slot=progress-indicator]]:bg-info"
            />
            <p className="text-xs text-[var(--text-tertiary)]">
              Resets {display?.refillLabel ?? "monthly"}
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
