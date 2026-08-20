"use client"

import { api } from "@/convex/_generated/api"
import { Progress } from "@/components/ui/progress"
import { usePerUserQuery } from "@/lib/convex/use-per-user-query"
import {
  SettingsField,
  SettingsFieldContent,
  SettingsFieldDescription,
  SettingsFieldGroup,
  SettingsFieldLabel,
  SettingsFieldSurface,
} from "./settings-row"

/**
 * Included platform-usage meter (ADR-0021). Reads the live allowance through
 * the per-user subscription seam; percentages only — internal credit values
 * never surface. The meter includes pending reservations, so it can rise when
 * a message starts and settle downward when the actual cost lands — that
 * temporary movement is honest, not a bug.
 */

function formatPercent(fraction: number): string {
  if (fraction <= 0) return "0%"
  const percent = fraction * 100
  if (percent < 1) return "<1%"
  return `${Math.min(100, Math.round(percent))}%`
}

export function UsageSection() {
  const { data: allowance, isAuthReady } = usePerUserQuery(
    api.usageAllowance.getCurrentAllowance
  )

  if (!isAuthReady) return null

  const granted = allowance?.grantedCredits ?? 0
  const spent = allowance?.spentCredits ?? 0
  const reserved = allowance?.reservedCredits ?? 0
  const usedFraction = granted > 0 ? spent / granted : 0
  const pendingFraction = granted > 0 ? reserved / granted : 0
  const meterFraction = Math.min(1, usedFraction + pendingFraction)
  const exhausted = granted > 0 && spent + reserved >= granted
  const refillDate =
    allowance === undefined
      ? null
      : new Intl.DateTimeFormat(undefined, {
          month: "short",
          day: "numeric",
        }).format(new Date(allowance.periodEnd))

  return (
    <SettingsFieldGroup aria-label="Included usage">
      <SettingsField>
        <SettingsFieldSurface className="py-3 sm:flex-col sm:items-stretch sm:gap-2">
          <SettingsFieldContent>
            <div className="flex items-baseline justify-between gap-4">
              <SettingsFieldLabel>Included usage</SettingsFieldLabel>
              <span className="text-foreground text-sm leading-6">
                {allowance === undefined
                  ? "…"
                  : `${formatPercent(usedFraction)} used${
                      reserved > 0
                        ? ` · ${formatPercent(pendingFraction)} pending`
                        : ""
                    }`}
              </span>
            </div>
            <Progress
              value={Math.round(meterFraction * 100)}
              aria-label="Included allowance used this period"
            />
            <SettingsFieldDescription>
              {exhausted
                ? `Your included allowance is used up. It refills ${refillDate ?? "next period"}; messages sent with your own API keys keep working.`
                : `Refills ${refillDate ?? "monthly"}. Cost varies by model, context length, attachments, tools, and search, so the meter can move faster on heavier messages.`}
            </SettingsFieldDescription>
            <SettingsFieldDescription>
              Messages sent using your API keys do not use your included
              allowance.
            </SettingsFieldDescription>
          </SettingsFieldContent>
        </SettingsFieldSurface>
      </SettingsField>
    </SettingsFieldGroup>
  )
}
