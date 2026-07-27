/** @vitest-environment jsdom */

// ---------------------------------------------------------------------------
// usePresentationReveal (plan §6.4 / commit 3). The risky logic: loop
// lifecycle (self-stop on catch-up, restart on growth), commit gating,
// terminal handling that never depends on animation frames (immediate snap,
// drain backstop, hidden-tab snap), the reduced-motion short-circuit, and
// revealKey resets. rAF is mocked directly so frame timestamps are exact.
// ---------------------------------------------------------------------------

import {
  PROSE_REVEAL_PROFILE,
  type RevealProfile,
} from "@/lib/chat-performance/presentation-reveal"
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { usePresentationReveal } from "./use-presentation-reveal"

/** 1 ms/char, wide-open commit gate — reveals fast and predictably. */
const FAST_PROFILE: RevealProfile = {
  drainMs: 1_000_000,
  maxCharIntervalMs: 1,
  maxCharsPerFrame: 200,
  minCommitMs: 0,
  maxCommitMs: 0,
  commitWidenChars: 1_000_000_000,
  maxLagMs: 1_000_000_000,
  settleDrainMs: 50,
}

type HookResult = ReturnType<typeof usePresentationReveal>
type HookArgs = Parameters<typeof usePresentationReveal>[0]

const latest: { result: HookResult | null } = { result: null }

function Probe(args: HookArgs) {
  const result = usePresentationReveal(args)
  // Captured post-commit (render-phase writes to shared state are illegal);
  // every assertion runs after an act() flush, so this is always current.
  React.useEffect(() => {
    latest.result = result
  })
  return null
}

describe("usePresentationReveal", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null
  let rafCallbacks: Map<number, FrameRequestCallback>
  let rafId: number
  let frameNow: number
  let matchMediaMatches: boolean

  beforeAll(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    rafCallbacks = new Map()
    rafId = 0
    frameNow = 0
    matchMediaMatches = false
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      rafCallbacks.set(++rafId, callback)
      return rafId
    }
    window.cancelAnimationFrame = (id: number) => {
      rafCallbacks.delete(id)
    }
    window.matchMedia = ((query: string) => ({
      matches: matchMediaMatches,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia
    setVisibility("visible")
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    latest.result = null
  })

  afterEach(() => {
    const mountedRoot = root
    if (mountedRoot) {
      act(() => {
        mountedRoot.unmount()
      })
    }
    container?.remove()
    container = null
    root = null
    vi.useRealTimers()
  })

  function setVisibility(state: "visible" | "hidden") {
    Object.defineProperty(document, "visibilityState", {
      value: state,
      configurable: true,
    })
  }

  function render(args: Partial<HookArgs> & { text: string; live: boolean }) {
    act(() => {
      root?.render(
        <Probe
          settleMode="drain"
          revealKey="m1"
          profile={FAST_PROFILE}
          {...args}
        />
      )
    })
  }

  /** Fires all pending rAF callbacks, advancing the frame clock per step. */
  function flushFrames(count: number, stepMs = 16) {
    for (let i = 0; i < count; i++) {
      frameNow += stepMs
      const callbacks = [...rafCallbacks.values()]
      rafCallbacks.clear()
      const at = frameNow
      act(() => {
        for (const callback of callbacks) callback(at)
      })
    }
  }

  it("is inert for rows that were never live", () => {
    render({ text: "history text", live: false })
    expect(latest.result?.text).toBe("history text")
    expect(latest.result?.caughtUp).toBe(true)
    expect(latest.result?.fadeRuntime).toBeUndefined() // no runtime → no plugin
    expect(rafCallbacks.size).toBe(0)
  })

  it("reveals from empty, self-stops on catch-up, and restarts on growth", () => {
    render({ text: "", live: true })
    render({ text: "Hello brave world ", live: true })
    expect(rafCallbacks.size).toBe(1)
    flushFrames(8)
    expect(latest.result?.text).toBe("Hello brave world")
    expect(rafCallbacks.size).toBe(0) // caught up → loop self-stopped

    render({ text: "Hello brave world and beyond ", live: true })
    expect(rafCallbacks.size).toBe(1) // growth restarted the loop
    flushFrames(8)
    expect(latest.result?.text).toBe("Hello brave world and beyond")
  })

  it("gates commits below the frame rate", () => {
    const gated: RevealProfile = {
      ...FAST_PROFILE,
      maxCharsPerFrame: 4,
      minCommitMs: 48,
      maxCommitMs: 48,
    }
    render({ text: "", live: true, profile: gated })
    render({
      text: "aa bb cc dd ee ff gg hh ii jj kk ll mm nn ",
      live: true,
      profile: gated,
    })
    const seen = new Set<string>()
    const frames = 12
    for (let i = 0; i < frames; i++) {
      flushFrames(1)
      if (latest.result) seen.add(latest.result.text)
    }
    // 12 frames at 16ms with a 48ms commit gate → at most ~5 distinct
    // commits (leading edge + one per gate window), far below one-per-frame.
    expect(seen.size).toBeGreaterThan(1)
    expect(seen.size).toBeLessThanOrEqual(6)
  })

  it("settleMode immediate snaps to canonical in the same commit", () => {
    render({ text: "", live: true })
    render({ text: "Partial reveal then stop now.", live: true })
    flushFrames(1) // leading edge only — most text still unrevealed
    expect(latest.result?.text.length).toBeLessThan(10)

    render({
      text: "Partial reveal then stop now.",
      live: false,
      settleMode: "immediate",
    })
    expect(latest.result?.text).toBe("Partial reveal then stop now.")
    expect(latest.result?.caughtUp).toBe(true)
  })

  it("drain settle force-snaps via the timer backstop when frames never run", () => {
    render({ text: "", live: true })
    render({ text: "Streamed text that must fully land.", live: true })
    flushFrames(1)
    render({
      text: "Streamed text that must fully land.",
      live: false,
      settleMode: "drain",
    })
    // No frames fire (hidden/throttled tab): the backstop must converge.
    act(() => {
      vi.advanceTimersByTime(FAST_PROFILE.settleDrainMs + 100 + 10)
    })
    expect(latest.result?.text).toBe("Streamed text that must fully land.")
    expect(latest.result?.caughtUp).toBe(true)
  })

  it("snaps on visibility hidden and on canonical updates while hidden", () => {
    render({ text: "", live: true })
    render({ text: "First chunk of text here.", live: true })
    flushFrames(1)
    setVisibility("hidden")
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
    expect(latest.result?.text).toBe("First chunk of text here.")

    // A canonical update while hidden snaps too — no frames involved.
    render({ text: "First chunk of text here. And more.", live: true })
    expect(latest.result?.text).toBe("First chunk of text here. And more.")
    expect(rafCallbacks.size).toBe(0)
  })

  it("reduced motion short-circuits: canonical text, no rAF, no runtime at all", () => {
    matchMediaMatches = true
    render({ text: "", live: true })
    render({ text: "Streaming with reduced motion.", live: true })
    expect(latest.result?.text).toBe("Streaming with reduced motion.")
    expect(latest.result?.caughtUp).toBe(true)
    // Undefined (not a noop object): Markdown must install NO plugin, so a
    // reduced-motion stream carries zero .stream-word structure.
    expect(latest.result?.fadeRuntime).toBeUndefined()
    expect(rafCallbacks.size).toBe(0)
  })

  it("never renders stale text on a same-key non-prefix correction", () => {
    render({ text: "", live: true })
    render({ text: "Original words revealed ", live: true })
    flushFrames(8)
    expect(latest.result?.text).toBe("Original words revealed")
    // The correction replaces canonical entirely. The very first committed
    // render must already satisfy the prefix invariant (render-phase
    // resync) — a live row restarts from empty, never paints "Original…".
    render({ text: "Corrected text", live: true })
    expect(latest.result?.text).toBe("")
    flushFrames(8)
    expect(latest.result?.text).toBe("Corrected ") // trailing word held

    // A still-settling row (drain pending) snaps to the corrected
    // canonical instantly instead of re-animating.
    render({ text: "Corrected text", live: false })
    render({ text: "Different final", live: false })
    expect(latest.result?.text).toBe("Different final")
  })

  it("resets fully on revealKey change", () => {
    render({ text: "", live: true })
    render({ text: "Old message text streaming ", live: true })
    flushFrames(8)
    expect(latest.result?.text).toBe("Old message text streaming")
    const oldRuntime = latest.result?.fadeRuntime

    // New live target starting empty: displayed resets and re-reveals.
    render({ text: "", live: true, revealKey: "m2" })
    expect(latest.result?.text).toBe("")
    expect(latest.result?.fadeRuntime).not.toBe(oldRuntime)
    render({ text: "New message ", live: true, revealKey: "m2" })
    flushFrames(8)
    expect(latest.result?.text).toBe("New message")
  })

  it("lands a stalled trailing word within maxLagMs (elapsed-time cap)", () => {
    const stallProfile: RevealProfile = { ...FAST_PROFILE, maxLagMs: 500 }
    render({ text: "", live: true, profile: stallProfile })
    render({ text: "a", live: true, profile: stallProfile })
    flushFrames(2)
    expect(latest.result?.text).toBe("a")
    // The word grows but never completes and the stream stalls: the clamp
    // holds mid-word and the loop self-stops. The elapsed-time backstop
    // must land the text within maxLagMs — canonical chars can never wait
    // indefinitely for whitespace.
    render({ text: "abcdefghijkl", live: true, profile: stallProfile })
    flushFrames(8)
    expect(latest.result?.text).toBe("a")
    act(() => {
      vi.advanceTimersByTime(500 + 10)
    })
    expect(latest.result?.text).toBe("abcdefghijkl")
  })

  it("revealKey change on a live entry resets to empty even with non-empty text", () => {
    render({ text: "", live: true })
    render({ text: "First message words ", live: true })
    flushFrames(8)
    expect(latest.result?.text).toBe("First message words")
    // Branch switch / regeneration into an already-growing target: the plan
    // requires a full reset — reveal from empty, never a flash of the new
    // target's accumulated text.
    render({ text: "Second message already long", live: true, revealKey: "m2" })
    expect(latest.result?.text).toBe("")
    flushFrames(8)
    expect(latest.result?.text.startsWith("Second")).toBe(true)
  })

  it("adopts mid-stream text instantly (remount) and animates only later appends", () => {
    render({ text: "Already streamed half of the answer", live: true })
    // Non-empty at engagement → shown instantly, no re-typing.
    expect(latest.result?.text).toBe("Already streamed half of the answer")
    render({ text: "Already streamed half of the answer plus more ", live: true })
    expect(rafCallbacks.size).toBe(1)
    flushFrames(8)
    expect(latest.result?.text).toBe(
      "Already streamed half of the answer plus more"
    )
  })

  it("keeps revealing after a StrictMode mount→unmount→remount cycle", () => {
    // Regression: the unmount cleanup must null the rAF/backstop refs — a
    // stale non-null rafRef makes every later startLoop() a no-op and the
    // reveal buffers everything until the terminal snap (found live in the
    // dev-server smoke, where next dev runs StrictMode).
    const renderStrict = (text: string) => {
      act(() => {
        root?.render(
          <React.StrictMode>
            <Probe
              text={text}
              live
              settleMode="drain"
              revealKey="m1"
              profile={FAST_PROFILE}
            />
          </React.StrictMode>
        )
      })
    }
    renderStrict("")
    renderStrict("Words that must reveal live ")
    expect(rafCallbacks.size).toBeGreaterThan(0)
    flushFrames(8)
    expect(latest.result?.text).toBe("Words that must reveal live")
  })

  it("uses the reasoning-vs-prose profile it is given", () => {
    // Sanity pin: the hook honors the injected profile object (the
    // reasoning wiring passes REASONING_REVEAL_PROFILE).
    render({ text: "", live: true, profile: PROSE_REVEAL_PROFILE })
    render({ text: "word ", live: true, profile: PROSE_REVEAL_PROFILE })
    flushFrames(1)
    expect(latest.result?.text).toBe("word")
  })
})
