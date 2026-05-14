import type { ReplayToolExchange } from "../types"

export function synthesizePlatformToolFallback(tool: ReplayToolExchange): string | null {
  const ctx = tool.platformToolContext
  if (!ctx) return null

  if (ctx.toolKey === "pay_purchase") {
    const jobPart = ctx.jobId ? ` (job: ${ctx.jobId})` : ""
    const urlPart = ctx.url ? ` for ${ctx.url}` : ""
    return `Replay context: A purchase was initiated${urlPart}${jobPart}.`
  }

  if (ctx.toolKey === "pay_status") {
    const jobPart = ctx.jobId ? ` for job ${ctx.jobId}` : ""
    const statusPart = ctx.status ? `: ${ctx.status}` : ""
    const terminalPart =
      ctx.isTerminal === true
        ? " (completed)"
        : ctx.isTerminal === false
          ? " (in progress)"
          : ""
    return `Replay context: Purchase status check${jobPart}${statusPart}${terminalPart}.`
  }

  return null
}
