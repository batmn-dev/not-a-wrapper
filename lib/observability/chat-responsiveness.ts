"use client"

/**
 * Main-thread long tasks and animation-frame gaps, emitted as content-free User Timing
 * marks through the same allow-listed gate as every other chat-perf event.
 * Everything is a no-op unless `NEXT_PUBLIC_CHAT_PERF_INSTRUMENTATION` is on,
 * so normal production builds mount neither observer.
 */
import { useEffect } from "react"
import { isChatPerfClientEnabled, markChatPerf } from "./chat-performance"

/**
 * A frame-to-frame interval beyond this reads as a missed frame budget even
 * on 60 Hz displays (~2.4 frames); shorter gaps are normal scheduler noise.
 */
const RAF_GAP_THRESHOLD_MS = 40

/**
 * Emits `long_task` marks for the component's lifetime and `raf_gap` marks
 * while a response is streaming. Mount once per chat surface — a second
 * mount would double-count long tasks.
 */
export function useChatResponsivenessMarks(isStreaming: boolean): void {
  useEffect(() => {
    if (!isChatPerfClientEnabled()) return
    if (typeof PerformanceObserver === "undefined") return
    let observer: PerformanceObserver | null = null
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          markChatPerf("long_task", {
            durationMs: entry.duration,
            observedStartMs: entry.startTime,
          })
        }
      })
      // `buffered: false`: only tasks from this session forward; longtask is
      // unsupported in some engines (Safari) — the catch leaves this inert.
      observer.observe({ type: "longtask", buffered: false })
    } catch {
      observer = null
    }
    return () => observer?.disconnect()
  }, [])

  useEffect(() => {
    if (!isChatPerfClientEnabled() || !isStreaming) return
    if (typeof requestAnimationFrame !== "function") return
    let active = true
    let frameId: number
    let lastFrameAt: number | null = null
    const tick = (now: number) => {
      if (!active) return
      if (lastFrameAt !== null) {
        const gap = now - lastFrameAt
        if (gap > RAF_GAP_THRESHOLD_MS) {
          markChatPerf("raf_gap", {
            durationMs: gap,
            observedStartMs: lastFrameAt,
          })
        }
      }
      lastFrameAt = now
      frameId = requestAnimationFrame(tick)
    }
    frameId = requestAnimationFrame(tick)
    return () => {
      active = false
      cancelAnimationFrame(frameId)
      // Terminal cleanup can cancel the very frame that would report this gap.
      if (lastFrameAt !== null) {
        const gap = performance.now() - lastFrameAt
        if (gap > RAF_GAP_THRESHOLD_MS)
          markChatPerf("raf_gap", {
            durationMs: gap,
            observedStartMs: lastFrameAt,
          })
      }
    }
  }, [isStreaming])
}
