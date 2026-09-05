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

/** Self-contained for page.evaluate; matches the observer's direct-root wheel scope. */
export function findDirectTranscriptWheelPoint(root: Element): {
  x: number
  y: number
} {
  const bounds = root.getBoundingClientRect()
  const left = Math.max(0, bounds.left)
  const right = Math.min(innerWidth, bounds.right)
  const top = Math.max(0, bounds.top)
  const bottom = Math.min(innerHeight, bounds.bottom)
  if (right - left <= 8 || bottom <= top)
    throw new Error("Scroll root has no visible bounds")
  // Prefer the gutter; the center can hit a nested code scroller.
  for (const x of [left + 4, right - 4, (left + right) / 2]) {
    for (const fraction of [0.5, 0.35, 0.65]) {
      const y = top + (bottom - top) * fraction
      const target = document.elementFromPoint(x, y)
      if (!target || !root.contains(target)) continue
      let nestedScroll = false
      for (
        let node: Element | null = target;
        node && node !== root;
        node = node.parentElement
      ) {
        if (
          node.scrollHeight > node.clientHeight &&
          /^(auto|scroll|overlay)$/.test(getComputedStyle(node).overflowY)
        ) {
          nestedScroll = true
          break
        }
      }
      if (!nestedScroll) return { x, y }
    }
  }
  throw new Error("No unobscured direct transcript wheel target")
}

/** Full durations of observed intervals overlapping the run, regardless of callback delivery time. */
export function durationsOverlappingRun(
  marks: CollectedMark[],
  name: "long_task" | "raf_gap",
  runStart: number,
  runEnd: number
): number[] {
  return marks
    .filter((mark) => mark.name === name)
    .flatMap((mark) => {
      const start = mark.detail?.observedStartMs
      const duration = mark.detail?.durationMs
      if (
        typeof start !== "number" ||
        !Number.isFinite(start) ||
        start < 0 ||
        typeof duration !== "number" ||
        !Number.isFinite(duration) ||
        duration < 0
      )
        throw new Error(`${name} is missing a valid observed interval`)
      return start < runEnd && start + duration > runStart ? [duration] : []
    })
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
