/** @vitest-environment jsdom */

// ---------------------------------------------------------------------------
// Streaming cadence measurement (streaming plan §8, PR D).
//
// Replays the deterministic ~12 KB mixed-Markdown stream into the REAL
// <Markdown> component (incremental projection + memoized blocks; Shiki
// service mocked to isolate render cost from grammar I/O) at each candidate
// AI SDK notification cadence, measuring per-notification main-thread commit
// cost. The provider emits 40 chars every 10 ms (100 chunks/s — the
// baseline harness's fastest profile); a cadence of N ms coalesces every
// notification inside its window, exactly like the AI SDK throttle.
//
// This is decision evidence, not a strict gate: the one enforced assertion
// is the long-task canary — no single notification commit may exceed 50 ms
// at any candidate cadence. Numbers print for the measurement report; the
// browser-trace verification of the CHOSEN value happens in the production
// verification pass.
// ---------------------------------------------------------------------------

import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { beforeAll, describe, expect, it, vi } from "vitest"
import { Markdown } from "@/components/ui/markdown"
import { buildMarkdownPayload } from "./fixtures"

vi.mock("@/lib/markdown/shiki-client", () => ({
  highlightCode: vi.fn(async (args: { code: string }) => `<pre class="shiki"><code>${args.code.replace(/</g, "&lt;")}</code></pre>`),
}))

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}))

const DELTA_INTERVAL_MS = 10
const DELTA_SIZE = 40

type CadenceResult = {
  cadenceMs: number
  notifications: number
  totalMs: number
  meanMs: number
  p95Ms: number
  maxMs: number
}

function notificationStates(payload: string, cadenceMs: number): string[] {
  // Provider delta i completes at (i+1)*DELTA_INTERVAL_MS. A notification at
  // time T carries every completed delta; notifications fire every cadenceMs
  // (cadence 0 = one notification per delta, the unthrottled case).
  const deltaCount = Math.ceil(payload.length / DELTA_SIZE)
  const streamEndMs = deltaCount * DELTA_INTERVAL_MS
  const interval = cadenceMs === 0 ? DELTA_INTERVAL_MS : cadenceMs
  const states: string[] = []
  for (let t = interval; t < streamEndMs + interval; t += interval) {
    const completed = Math.min(deltaCount, Math.floor(t / DELTA_INTERVAL_MS))
    const text = payload.slice(0, completed * DELTA_SIZE)
    if (text.length && text !== states[states.length - 1]) states.push(text)
  }
  return states
}

function measureCadence(payload: string, cadenceMs: number): CadenceResult {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  const render = (text: string, streaming: boolean) => {
    act(() => {
      root.render(
        <Markdown id={`cadence-${cadenceMs}`} streaming={streaming}>
          {text}
        </Markdown>
      )
    })
  }

  const states = notificationStates(payload, cadenceMs)
  const samples: number[] = []
  for (const text of states) {
    const start = performance.now()
    render(text, true)
    samples.push(performance.now() - start)
  }
  const settleStart = performance.now()
  render(payload, false)
  samples.push(performance.now() - settleStart)

  act(() => {
    root.unmount()
  })
  host.remove()

  const sorted = [...samples].sort((a, b) => a - b)
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] ?? 0
  const totalMs = samples.reduce((sum, value) => sum + value, 0)
  return {
    cadenceMs,
    notifications: samples.length,
    totalMs,
    meanMs: totalMs / samples.length,
    p95Ms: at(0.95),
    maxMs: sorted[sorted.length - 1] ?? 0,
  }
}

describe("notification cadence candidates (measurement)", () => {
  beforeAll(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  it("measures per-notification commit cost at 0/16/32/50 ms and stays under the long-task bound", () => {
    const payload = buildMarkdownPayload()
    // Warm module/JIT paths once so candidate 0 is not penalized by First-run
    // costs (KaTeX, react-markdown pipeline construction).
    measureCadence(payload, 100)

    const results = [0, 16, 32, 50].map((cadence) =>
      measureCadence(payload, cadence)
    )
    const streamSeconds =
      Math.ceil(payload.length / DELTA_SIZE) * DELTA_INTERVAL_MS / 1000

    for (const result of results) {
      const mainThreadShare = result.totalMs / (streamSeconds * 1000)
      console.log(
        `[cadence] ${String(result.cadenceMs).padStart(2)} ms: ` +
          `${result.notifications} notifications, ` +
          `mean ${result.meanMs.toFixed(2)} ms, ` +
          `p95 ${result.p95Ms.toFixed(2)} ms, ` +
          `max ${result.maxMs.toFixed(2)} ms, ` +
          `total ${result.totalMs.toFixed(0)} ms ` +
          `(${(mainThreadShare * 100).toFixed(1)}% of stream time)`
      )
      // Long-task canary: no notification may cost a full frame budget at
      // any candidate cadence now that projection cost tracks the tail.
      expect(
        result.maxMs,
        `cadence ${result.cadenceMs} ms produced a >50 ms commit`
      ).toBeLessThan(50)
    }
  })
})
