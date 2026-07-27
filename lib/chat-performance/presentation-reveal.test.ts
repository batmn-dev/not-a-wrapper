/**
 * Presentation-reveal core tests (plan §6.1 / commit 1). Each block pins one
 * specified behavior bullet: rate math (carry banking + the no-bank-on-cap
 * anti-burst rule), leading-edge first-word commit, hard-lag snap, settle
 * drain, commit-interval widening, word-boundary clamping (ASCII + CJK), the
 * six fence fixtures, and the reconcile snap rules.
 */
import { describe, expect, it } from "vitest"
import {
  advanceReveal,
  createCaughtUpRevealState,
  createRevealState,
  reconcileCanonical,
  type RevealPhase,
  type RevealProfile,
  type RevealState,
} from "./presentation-reveal"

/** 1 ms/char deterministic rate; commit gate wide open unless overridden. */
const TEST_PROFILE: RevealProfile = {
  drainMs: 1_000_000,
  maxCharIntervalMs: 1,
  maxCharsPerFrame: 10,
  minCommitMs: 0,
  maxCommitMs: 0,
  commitWidenChars: 1_000_000_000,
  maxLagMs: 1_000_000_000,
  settleDrainMs: 1_000_000,
}

function liveState(canonical: string): RevealState {
  const created = createRevealState("", true)
  return reconcileCanonical(created, canonical, false).state
}

function tick(
  state: RevealState,
  canonical: string,
  nowMs: number,
  overrides: Partial<RevealProfile> = {},
  phase: RevealPhase = "streaming"
) {
  return advanceReveal(
    state,
    canonical,
    nowMs,
    { ...TEST_PROFILE, ...overrides },
    phase
  )
}

describe("rate math", () => {
  // Boundaries every 2/3 chars so the frontier (not word clamping) is what
  // the assertions read.
  const text = "ab ".repeat(40)

  it("consumes floor(elapsed / interval) chars and banks the fractional remainder", () => {
    let { state } = tick(liveState(text), text, 0) // leading edge: frontier 2
    expect(state.frontier).toBe(2)
    ;({ state } = tick(state, text, 3.5))
    expect(state.frontier).toBe(5) // floor(3.5 / 1ms)
    expect(state.carryMs).toBeCloseTo(0.5)
    // The banked 0.5ms + 0.5ms elapsed crosses one whole interval.
    ;({ state } = tick(state, text, 4))
    expect(state.frontier).toBe(6)
    expect(state.carryMs).toBeCloseTo(0)
  })

  it("caps chars per tick and discards the surplus instead of banking it", () => {
    let { state } = tick(liveState(text), text, 0)
    ;({ state } = tick(state, text, 25)) // 25 chars owed, cap 10
    expect(state.frontier).toBe(12)
    expect(state.carryMs).toBe(0) // anti-burst: 15ms surplus discarded
    ;({ state } = tick(state, text, 25.5))
    expect(state.frontier).toBe(12) // 0.5ms < one interval — nothing banked from the cap
  })

  it("uses drainMs / backlog when it is below maxCharIntervalMs", () => {
    // backlog 118 after leading edge; drainMs 59 → interval 0.5ms/char.
    let { state } = tick(liveState(text), text, 0, { drainMs: 59 })
    ;({ state } = tick(state, text, 2, {
      drainMs: 59,
      maxCharsPerFrame: 1000,
      maxCharIntervalMs: 5,
    }))
    expect(state.frontier).toBe(6) // floor(2 / 0.5) = 4 chars
  })
})

describe("leading edge", () => {
  it("reveals at least the first word and commits on the first advance after text arrives", () => {
    const result = tick(liveState("Hello world"), "Hello world", 0)
    expect(result.shouldCommit).toBe(true)
    expect(result.state.displayedEnd).toBe(5)
  })

  it("never delays first text even when the commit gate would be closed", () => {
    const result = tick(liveState("Hello world"), "Hello world", 0, {
      minCommitMs: 10_000,
      maxCommitMs: 10_000,
    })
    expect(result.shouldCommit).toBe(true)
  })
})

describe("hard lag cap", () => {
  it("jumps the frontier so projected lag equals maxLagMs and reports the jump", () => {
    // maxCharsPerFrame 10 over maxLagMs 167 ≈ 100 clearable chars.
    const text = "hi " + "a".repeat(997)
    const result = tick(liveState(text), text, 0, { maxLagMs: 167 })
    expect(result.state.frontier).toBe(text.length - 100)
    // Callers arm the fade runtime's snap from this: jumped-over text must
    // render already-revealed, never as a wall of queued fades.
    expect(result.lagSnapped).toBe(true)
    const calm = tick(liveState("short text"), "short text", 0)
    expect(calm.lagSnapped).toBe(false)
  })
})

describe("settling", () => {
  it("drains with settleDrainMs and always commits the tick that catches up", () => {
    const text = "ab ab"
    let { state } = tick(liveState(text), text, 0, {
      minCommitMs: 10_000,
      maxCommitMs: 10_000,
    })
    expect(state.displayedEnd).toBe(2)
    // Gate is closed (10s), but the catch-up tick must still commit.
    const final = tick(
      state,
      text,
      10,
      { minCommitMs: 10_000, maxCommitMs: 10_000 },
      "settling"
    )
    expect(final.caughtUp).toBe(true)
    expect(final.shouldCommit).toBe(true)
    expect(final.state.displayedEnd).toBe(text.length)
  })

  it("settleDrainMs is a hard deadline even for a large backlog", () => {
    // 1200-char backlog, per-frame cap 10: rate alone could never finish in
    // 100ms — the deadline flush must land the tail.
    const text = "ab ".repeat(400)
    const overrides = { maxCharsPerFrame: 10, settleDrainMs: 100 }
    let { state } = tick(liveState(text), text, 0, overrides)
    let caughtAt: number | null = null
    for (let t = 10; t <= 400; t += 10) {
      const result = tick(state, text, t, overrides, "settling")
      state = result.state
      if (result.caughtUp) {
        caughtAt = t
        break
      }
    }
    expect(caughtAt).not.toBeNull()
    expect(caughtAt!).toBeLessThanOrEqual(100 + 20)
    expect(state.displayedEnd).toBe(text.length)
  })

  it("streaming holds a trailing partial word; settling releases it", () => {
    const text = "Hello wor"
    let { state } = tick(liveState(text), text, 0)
    const streamed = tick(state, text, 50)
    expect(streamed.state.displayedEnd).toBe(6) // "Hello " — partial "wor" held
    expect(streamed.caughtUp).toBe(true) // no further progress possible
    const settled = tick(streamed.state, text, 60, {}, "settling")
    expect(settled.state.displayedEnd).toBe(text.length)
    expect(settled.shouldCommit).toBe(true)
  })
})

describe("commit gate widening", () => {
  const gateProfile: Partial<RevealProfile> = {
    minCommitMs: 40,
    maxCommitMs: 80,
    commitWidenChars: 50,
    maxCharsPerFrame: 120,
  }

  it("widens the interval toward maxCommitMs as the tail block grows", () => {
    // Single giant block: by the second tick the displayed tail exceeds
    // commitWidenChars, so the interval is pinned at maxCommitMs.
    const text = "ab ".repeat(200)
    let { state } = tick(liveState(text), text, 0, gateProfile)
    expect(state.lastCommitMs).toBe(0)
    const at50 = tick(state, text, 50, gateProfile)
    expect(at50.state.displayedEnd).toBeGreaterThan(40)
    expect(at50.shouldCommit).toBe(false) // 50ms < widened interval
    const at90 = tick(at50.state, text, 90, gateProfile)
    expect(at90.shouldCommit).toBe(true) // 90ms ≥ maxCommitMs
  })

  it("keeps the narrow interval when a block boundary resets the tail", () => {
    // The "\n\n" right behind the cursor keeps tailBlockChars tiny, so the
    // interval stays near minCommitMs (40ms) and a 48ms gap commits — the
    // same gap the big-tail case above rejects.
    const text = "ab\n\ncd ef gh ij kl mn op qr st uv wx yz on and on"
    const narrow = { ...gateProfile, maxCharsPerFrame: 4 }
    let { state } = tick(liveState(text), text, 0, narrow)
    expect(state.lastCommitMs).toBe(0)
    const next = tick(state, text, 48, narrow)
    expect(next.state.lastBlockBoundary).toBe(4)
    expect(next.shouldCommit).toBe(true)
  })
})

describe("word-boundary clamp", () => {
  it("only ever lands on segmenter boundaries (ASCII)", () => {
    const text = "Alpha beta gamma"
    const boundaries = new Set([0, 5, 6, 10, 11, 16])
    let state = liveState(text)
    for (let t = 0; t <= 40; t += 1) {
      const result = tick(state, text, t, { maxCharsPerFrame: 1 })
      state = result.state
      expect(boundaries.has(state.displayedEnd)).toBe(true)
    }
  })

  it("segments CJK text on word boundaries, not chars", () => {
    const text = "今天天气很好"
    const seen = new Set<number>()
    let state = liveState(text)
    for (let t = 0; t <= 20; t += 1) {
      const result = tick(state, text, t, { maxCharsPerFrame: 1 }, "settling")
      state = result.state
      seen.add(state.displayedEnd)
    }
    expect(state.displayedEnd).toBe(text.length)
    // Fewer reveal steps than characters — word-level, CJK-correct.
    expect(seen.size).toBeLessThan(text.length)
  })
})

describe("fence fast-forward", () => {
  /** Run ticks until displayedEnd stops moving; return the fixed point. */
  function drain(state: RevealState, text: string, fromMs: number) {
    let current = state
    for (let t = fromMs; t < fromMs + 600; t += 10) {
      const result = tick(current, text, t, { maxCharsPerFrame: 120 })
      current = result.state
      if (result.caughtUp) break
    }
    return current
  }

  it("fence at message start reveals at canonical cadence", () => {
    const text = "```ts\nconst a = 1\nconst b = 2\n"
    const state = drain(liveState(text), text, 0)
    expect(state.displayedEnd).toBe(text.length)
  })

  it("prose before a fence reveals word-by-word, then the interior fast-forwards", () => {
    const prose = "Here is the code you asked for today.\n\n"
    const text = prose + "```ts\nconst a = 1\n"
    let state = liveState(text)
    const first = tick(state, text, 0)
    // Leading edge shows the first word only — not the fence interior.
    expect(first.state.displayedEnd).toBeLessThan(prose.length)
    state = drain(first.state, text, 10)
    expect(state.displayedEnd).toBe(text.length)
  })

  it("prose after a closed fence resumes the word reveal", () => {
    const text =
      "```ts\nconst a = 1\n```\nAfterwards some closing prose follows here."
    const fenceEnd = text.indexOf("```\n", 3) + 4
    let { state } = tick(liveState(text), text, 0)
    // The fast-forward stops at the closing fence line, not the text end.
    expect(state.displayedEnd).toBe(fenceEnd)
    state = drain(state, text, 10)
    expect(state.displayedEnd).toBeGreaterThan(fenceEnd)
  })

  it("an unterminated fence at stream end stays at canonical cadence", () => {
    let text = "```ts\nconst a = 1\n"
    let { state } = tick(liveState(text), text, 0)
    expect(state.displayedEnd).toBe(text.length)
    // More interior arrives — still revealed in full, immediately.
    text += "const b = 2\n"
    ;({ state } = reconcileCanonical(state, text, false))
    const grown = tick(state, text, 10)
    expect(grown.state.displayedEnd).toBe(text.length)
    expect(grown.caughtUp).toBe(true)
  })

  it("handles ~~~ fences", () => {
    const text = "~~~py\nprint(1)\nprint(2)\n"
    const state = drain(liveState(text), text, 0)
    expect(state.displayedEnd).toBe(text.length)
  })

  it("indented (4-space) code is not a fence — words reveal normally", () => {
    const text = "    ```not a fence\nplain prose continues here"
    let state = liveState(text)
    for (let t = 0; t <= 100; t += 10) {
      const result = tick(state, text, t, { maxCharsPerFrame: 2 })
      state = result.state
      // Fast-forward is the only way displayedEnd can pass the frontier.
      expect(state.displayedEnd).toBeLessThanOrEqual(state.frontier)
    }
    expect(state.displayedEnd).toBeLessThan(text.length)
  })

  it("a fence inside a blockquote is treated as prose (no fast-forward)", () => {
    const text = "> ```ts\n> const a = 1\n> ```\nplain prose tail here"
    let state = liveState(text)
    for (let t = 0; t <= 60; t += 10) {
      const result = tick(state, text, t, { maxCharsPerFrame: 2 })
      state = result.state
      expect(state.displayedEnd).toBeLessThanOrEqual(state.frontier)
    }
  })
})

describe("reconcileCanonical", () => {
  it("append-only growth keeps the cursor (no discontinuity)", () => {
    const first = "Hello world"
    let { state } = tick(liveState(first), first, 0)
    const grown = reconcileCanonical(state, first + " and more", false)
    expect(grown.discontinuity).toBe("none")
    expect(grown.state.displayedEnd).toBe(state.displayedEnd)
  })

  it("identity change snaps to a fresh live state", () => {
    const text = "Hello world"
    let { state } = tick(liveState(text), text, 0)
    const snapped = reconcileCanonical(state, text, true)
    expect(snapped.discontinuity).toBe("snap")
    expect(snapped.state.displayedEnd).toBe(0)
    expect(snapped.state.frontier).toBe(0)
  })

  it("a non-prefix replacement snaps", () => {
    const text = "Hello world"
    let { state } = tick(liveState(text), text, 0)
    expect(state.displayedEnd).toBe(5)
    const snapped = reconcileCanonical(state, "Goodbye world", false)
    expect(snapped.discontinuity).toBe("snap")
  })

  it("a shrink below the displayed prefix snaps", () => {
    const text = "Hello world"
    let { state } = tick(liveState(text), text, 0)
    const snapped = reconcileCanonical(state, "Hell", false)
    expect(snapped.discontinuity).toBe("snap")
  })

  it("a rewrite that preserves the displayed prefix keeps the cursor and clamps the frontier", () => {
    const text = "Hello world plus backlog text"
    let { state } = tick(liveState(text), text, 0)
    ;({ state } = tick(state, text, 3)) // frontier past the displayed end
    expect(state.displayedEnd).toBe(6) // "Hello " displayed, "wor…" backlog
    const next = "Hello wo"
    const result = reconcileCanonical(state, next, false)
    expect(result.discontinuity).toBe("none")
    expect(result.state.frontier).toBeLessThanOrEqual(next.length)
    expect(result.state.displayedEnd).toBe(state.displayedEnd)
  })

  it("non-live states stay pinned to canonical", () => {
    const state = createRevealState("history text", false)
    expect(state.displayedEnd).toBe("history text".length)
    const advanced = advanceReveal(
      state,
      "history text",
      0,
      TEST_PROFILE as RevealProfile,
      "streaming"
    )
    expect(advanced.caughtUp).toBe(true)
    expect(advanced.shouldCommit).toBe(false)
    const grown = reconcileCanonical(state, "history text grew", false)
    expect(grown.state.displayedEnd).toBe("history text grew".length)
  })

  it("createCaughtUpRevealState resumes the word reveal for later growth", () => {
    const snapped = createCaughtUpRevealState("Already shown.")
    expect(snapped.displayedEnd).toBe("Already shown.".length)
    const grown = reconcileCanonical(snapped, "Already shown. More words now", false)
    expect(grown.discontinuity).toBe("none")
    // First tick initializes the clock; the second consumes time.
    const warm = tick(grown.state, "Already shown. More words now", 0)
    const result = tick(warm.state, "Already shown. More words now", 50)
    expect(result.state.displayedEnd).toBeGreaterThan("Already shown.".length)
    expect(result.state.displayedEnd).toBeLessThan(
      "Already shown. More words now".length
    )
  })
})
