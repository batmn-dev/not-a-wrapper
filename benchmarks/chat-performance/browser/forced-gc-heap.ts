import type { CDPSession } from "playwright"

export async function readForcedGcHeap(
  cdp: Pick<CDPSession, "send">
): Promise<number> {
  await cdp.send("HeapProfiler.collectGarbage")
  const { metrics } = await cdp.send("Performance.getMetrics")
  const bytes = metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0)
    throw new Error("Forced-GC JS heap metric is missing or invalid")
  return bytes
}
