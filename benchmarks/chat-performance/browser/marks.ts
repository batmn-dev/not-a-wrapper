/**
 * Page-side readers shared by the harness flows: the app's content-free
 * `chat-perf:*` User Timing marks and the CDP heap gauge.
 */
import type { CDPSession, Page } from "playwright"

/** A mark did not appear in time; every other failure propagates. */
export class MarkTimeoutError extends Error {}

export type CollectedMark = {
  name: string
  startTime: number
  detail: Record<string, unknown> | null
}

export async function readMarks(page: Page): Promise<CollectedMark[]> {
  return page.evaluate(() =>
    performance
      .getEntriesByType("mark")
      .filter((entry) => entry.name.startsWith("chat-perf:"))
      .map((entry) => ({
        name: entry.name.slice("chat-perf:".length),
        startTime: entry.startTime,
        detail:
          ((entry as PerformanceMark).detail as Record<
            string,
            unknown
          > | null) ?? null,
      }))
  )
}

export async function waitForMark(
  page: Page,
  name: string,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = await page.evaluate(
      (markName) => performance.getEntriesByName(markName).length > 0,
      `chat-perf:${name}`
    )
    if (found) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const seen = await page
    .evaluate(() =>
      performance
        .getEntriesByType("mark")
        .filter((entry) => entry.name.startsWith("chat-perf:"))
        .map((entry) => entry.name.slice("chat-perf:".length))
    )
    .catch(() => ["<marks unreadable>"])
  throw new MarkTimeoutError(
    `timed out waiting for mark ${name} (${timeoutMs}ms) at ${page.url()}; ` +
      `marks seen: ${[...new Set(seen)].join(", ") || "none"}`
  )
}

/** Waits for the first of several marks; returns the name that appeared. */
export async function waitForAnyMark(
  page: Page,
  names: string[],
  timeoutMs: number
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const name of names) {
      const found = await page.evaluate(
        (markName) => performance.getEntriesByName(markName).length > 0,
        `chat-perf:${name}`
      )
      if (found) return name
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new MarkTimeoutError(
    `timed out waiting for any of [${names.join(", ")}] (${timeoutMs}ms) at ${page.url()}`
  )
}

/**
 * Like waitForMark but resolves false on timeout instead of throwing; a
 * closed page or lost execution context still throws.
 */
export async function tryWaitForMark(
  page: Page,
  name: string,
  timeoutMs: number
): Promise<boolean> {
  try {
    await waitForMark(page, name, timeoutMs)
    return true
  } catch (error) {
    if (error instanceof MarkTimeoutError) return false
    throw error
  }
}

export async function readHeap(cdp: CDPSession): Promise<number | undefined> {
  try {
    const { metrics } = await cdp.send("Performance.getMetrics")
    const metric = metrics.find((entry) => entry.name === "JSHeapUsedSize")
    return metric?.value
  } catch {
    return undefined
  }
}
