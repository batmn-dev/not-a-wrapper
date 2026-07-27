/**
 * Presentation-reveal merge gate (ADR-0015, plan §9 / commit 5).
 *
 * Deterministic virtual-clock replay of the stream fixtures through the REAL
 * reveal pipeline (presentation-reveal core + stream-fade birth runtime),
 * following the PR 2 measurement pattern: exact counts under a virtual
 * clock, no wall time, no sampling. Canonical updates reach the reveal at
 * the 50 ms message-throttle cadence (leading + trailing approximation);
 * frames tick at 60 Hz; per-word visual updates are the birth-timeline
 * timestamps — the same stagger the DOM's `animationstart` events would
 * report.
 *
 * The assertions ARE the §9 acceptance criteria for the shipped profiles.
 * Reproduce the decision-doc table with:
 *
 *   bunx vitest run benchmarks/chat-performance/reveal-gate.test.ts --disable-console-intercept
 */
import { describe, expect, it } from "vitest"
import {
  advanceReveal,
  createRevealState,
  PROSE_REVEAL_PROFILE,
  reconcileCanonical,
  REASONING_REVEAL_PROFILE,
  type RevealPhase,
  type RevealProfile,
} from "../../lib/chat-performance/presentation-reveal"
import { createStreamFadeRuntime } from "../../lib/markdown/rehype-stream-fade"
import { buildStreamScript, type StreamChunkEvent } from "./fixtures"

const FRAME_MS = 1000 / 60
const THROTTLE_MS = 50

type CanonicalUpdate = { atMs: number; text: string }

/** Chunk arrivals coalesced to the 50 ms notification cadence the reveal
 * actually observes (leading edge immediate, then trailing per window). */
function buildCanonicalTimeline(
  script: StreamChunkEvent[],
  throttleMs: number
): { updates: CanonicalUpdate[]; charArrivalMs: number[]; finishAtMs: number } {
  const updates: CanonicalUpdate[] = []
  const charArrivalMs: number[] = []
  let text = ""
  let windowEnd = -1
  let finishAtMs = 0
  for (const event of script) {
    if (event.type === "text-delta") {
      for (let i = 0; i < event.delta.length; i++) {
        charArrivalMs.push(event.atMs)
      }
      text += event.delta
      if (event.atMs > windowEnd) {
        // Leading edge: first delta of a window notifies immediately.
        updates.push({ atMs: event.atMs, text })
        windowEnd = event.atMs + throttleMs
      } else {
        // Trailing edge: coalesce into the window boundary.
        const last = updates[updates.length - 1]
        if (last && last.atMs === windowEnd) {
          last.text = text
        } else {
          updates.push({ atMs: windowEnd, text })
        }
      }
    }
    if (
      event.type === "finish" ||
      event.type === "abort" ||
      event.type === "error"
    ) {
      finishAtMs = event.atMs
    }
  }
  return { updates, charArrivalMs, finishAtMs }
}

let segmenter: Intl.Segmenter | undefined
function countWords(text: string): number {
  segmenter ??= new Intl.Segmenter(undefined, { granularity: "word" })
  let count = 0
  for (const segment of segmenter.segment(text)) {
    if (/\S/.test(segment.segment)) count++
  }
  return count
}

function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
}

export type RevealGateMetrics = {
  commitCount: number
  commitsPerSecond: number
  firstTextToFirstCommitMs: number
  /** Stagger granularity: words per distinct birth timestamp — what the
   * animation-delay timeline schedules. */
  medianWordsPerVisualUpdate: number
  /** Paint granularity: words per 60 Hz frame bucket — what a display can
   * physically distinguish. The ≤1 product bar applies at TYPICAL token
   * rates (30–80 tok/s, §2.9); stress fixtures exceed 60 words/s, where
   * ≤1 word/paint is arithmetically impossible for ANY presentation. */
  medianWordsPerPaint: number
  p95WordsPerPaint: number
  p95VisibleGapMs: number
  lagP50Ms: number
  lagMaxMs: number
  drainMs: number
  visualUpdatesPerSecond: number
}

/** Replays one script through the real core + fade runtime. */
function simulateReveal(
  script: StreamChunkEvent[],
  profile: RevealProfile
): RevealGateMetrics {
  const { updates, charArrivalMs, finishAtMs } = buildCanonicalTimeline(
    script,
    THROTTLE_MS
  )
  const runtime = createStreamFadeRuntime()
  let state = createRevealState("", true)
  let canonical = ""
  let updateIndex = 0
  let wordCount = 0
  const commits: Array<{ t: number; displayedEnd: number }> = []
  const births: number[] = []
  let caughtUpAt: number | null = null

  const horizon = finishAtMs + profile.settleDrainMs + 2000
  for (let t = 0; t <= horizon; t += FRAME_MS) {
    while (updateIndex < updates.length && updates[updateIndex].atMs <= t) {
      canonical = updates[updateIndex].text
      state = reconcileCanonical(state, canonical, false).state
      updateIndex++
    }
    const phase: RevealPhase = t >= finishAtMs ? "settling" : "streaming"
    const result = advanceReveal(state, canonical, t, profile, phase)
    state = result.state
    if (result.shouldCommit) {
      commits.push({ t, displayedEnd: state.displayedEnd })
      const words = countWords(canonical.slice(0, state.displayedEnd))
      if (words > wordCount) {
        runtime.noteCommit("gate", words, t)
        for (let i = wordCount; i < words; i++) {
          const style = runtime.styleFor("gate", i, t)
          // animationDelay = birth − now, so birth = now + delay; words
          // already past their fade surface as instant (born at commit).
          births.push(
            style.style ? t + parseFloat(style.style.animationDelay) : t
          )
        }
        wordCount = words
      }
    }
    if (
      phase === "settling" &&
      result.caughtUp &&
      state.displayedEnd >= canonical.length &&
      updateIndex >= updates.length
    ) {
      caughtUpAt = t
      break
    }
  }
  if (caughtUpAt === null) {
    throw new Error("reveal never caught up within the horizon")
  }

  const firstTextAt = updates[0]?.atMs ?? 0
  const lastArrivalAt = updates[updates.length - 1]?.atMs ?? 0

  const birthTimes = [...new Set(births.map((b) => Math.round(b)))].sort(
    (a, b) => a - b
  )
  const groupSizes = new Map<number, number>()
  const paintSizes = new Map<number, number>()
  for (const birth of births) {
    const key = Math.round(birth)
    groupSizes.set(key, (groupSizes.get(key) ?? 0) + 1)
    const paintKey = Math.floor(birth / FRAME_MS)
    paintSizes.set(paintKey, (paintSizes.get(paintKey) ?? 0) + 1)
  }
  const sizes = [...groupSizes.values()].sort((a, b) => a - b)
  const paints = [...paintSizes.values()].sort((a, b) => a - b)

  const gaps: number[] = []
  for (let i = 1; i < birthTimes.length; i++) {
    if (birthTimes[i] > lastArrivalAt) break // backlog no longer exists
    gaps.push(birthTimes[i] - birthTimes[i - 1])
  }
  gaps.sort((a, b) => a - b)

  const streamLags: number[] = []
  let lagMax = 0
  for (const commit of commits) {
    const arrival = charArrivalMs[Math.max(0, commit.displayedEnd - 1)] ?? 0
    const lag = Math.max(0, commit.t - arrival)
    lagMax = Math.max(lagMax, lag)
    if (commit.t < finishAtMs) streamLags.push(lag)
  }
  streamLags.sort((a, b) => a - b)

  const durationSec = (caughtUpAt - firstTextAt) / 1000
  return {
    commitCount: commits.length,
    commitsPerSecond: commits.length / Math.max(0.001, durationSec),
    firstTextToFirstCommitMs: (commits[0]?.t ?? 0) - firstTextAt,
    medianWordsPerVisualUpdate: quantile(sizes, 0.5),
    medianWordsPerPaint: quantile(paints, 0.5),
    p95WordsPerPaint: quantile(paints, 0.95),
    p95VisibleGapMs: quantile(gaps, 0.95),
    lagP50Ms: quantile(streamLags, 0.5),
    lagMaxMs: lagMax,
    drainMs: caughtUpAt - finishAtMs,
    visualUpdatesPerSecond: birthTimes.length / Math.max(0.001, durationSec),
  }
}

/** Throttle-only baselines: every 50/32 ms notification IS the visual
 * update, revealing all newly arrived words at once (today's behavior). */
function simulateThrottleBaseline(
  script: StreamChunkEvent[],
  throttleMs: number
): Pick<
  RevealGateMetrics,
  "medianWordsPerVisualUpdate" | "p95VisibleGapMs" | "visualUpdatesPerSecond"
> {
  const { updates } = buildCanonicalTimeline(script, throttleMs)
  const sizes: number[] = []
  const gaps: number[] = []
  let previousWords = 0
  let previousAt: number | null = null
  for (const update of updates) {
    const words = countWords(update.text)
    if (words > previousWords) {
      sizes.push(words - previousWords)
      if (previousAt !== null) gaps.push(update.atMs - previousAt)
      previousAt = update.atMs
      previousWords = words
    }
  }
  sizes.sort((a, b) => a - b)
  gaps.sort((a, b) => a - b)
  const durationSec =
    ((updates[updates.length - 1]?.atMs ?? 0) - (updates[0]?.atMs ?? 0)) / 1000
  return {
    medianWordsPerVisualUpdate: quantile(sizes, 0.5),
    p95VisibleGapMs: quantile(gaps, 0.95),
    visualUpdatesPerSecond: sizes.length / Math.max(0.001, durationSec),
  }
}

/** Fade-only fallback (§8 ladder #2): births assigned per 50 ms canonical
 * commit, no extra reveal commits between notifications. */
function simulateFadeOnly(
  script: StreamChunkEvent[]
): Pick<
  RevealGateMetrics,
  "medianWordsPerVisualUpdate" | "p95VisibleGapMs" | "visualUpdatesPerSecond"
> {
  const { updates } = buildCanonicalTimeline(script, THROTTLE_MS)
  const runtime = createStreamFadeRuntime()
  const births: number[] = []
  let wordCount = 0
  for (const update of updates) {
    const words = countWords(update.text)
    if (words <= wordCount) continue
    runtime.noteCommit("gate", words, update.atMs)
    for (let i = wordCount; i < words; i++) {
      const style = runtime.styleFor("gate", i, update.atMs)
      births.push(
        style.style
          ? update.atMs + parseFloat(style.style.animationDelay)
          : update.atMs
      )
    }
    wordCount = words
  }
  const groupSizes = new Map<number, number>()
  for (const birth of births) {
    const key = Math.round(birth)
    groupSizes.set(key, (groupSizes.get(key) ?? 0) + 1)
  }
  const sizes = [...groupSizes.values()].sort((a, b) => a - b)
  const birthTimes = [...groupSizes.keys()].sort((a, b) => a - b)
  const gaps: number[] = []
  for (let i = 1; i < birthTimes.length; i++) {
    gaps.push(birthTimes[i] - birthTimes[i - 1])
  }
  gaps.sort((a, b) => a - b)
  const durationSec = (birthTimes[birthTimes.length - 1] - birthTimes[0]) / 1000
  return {
    medianWordsPerVisualUpdate: quantile(sizes, 0.5),
    p95VisibleGapMs: quantile(gaps, 0.95),
    visualUpdatesPerSecond: birthTimes.length / Math.max(0.001, durationSec),
  }
}

const mixedMarkdown30 = buildStreamScript({
  scenario: "mixed-markdown",
  chunksPerSecond: 30,
})
const prose100 = buildStreamScript({
  scenario: "text-only",
  chunksPerSecond: 100,
})
const codeBlock30 = buildStreamScript({
  scenario: "code-block",
  chunksPerSecond: 30,
})
// The §2.9 product bar's regime: 30 chunks/s × 10 chars ≈ 300 chars/s ≈
// 75 tok/s — the top of "typical token rates". The 40-char fixtures above
// are stress cadences (~300 tok/s), useful for cost/lag bounds but beyond
// what any 60 Hz presentation could show at one word per paint.
const proseTypical = buildStreamScript({
  scenario: "text-only",
  chunksPerSecond: 30,
  deltaSize: 10,
})

describe("presentation-reveal merge gate (§9)", () => {
  it("meets the ≤1-word bar at PAINT granularity at typical token rates (§2.9)", () => {
    const m = simulateReveal(proseTypical, PROSE_REVEAL_PROFILE)
    // ~75 tok/s (top of typical): at most one word starts fading per 60 Hz
    // frame — the strict product bar, measured the way a display shows it.
    expect(m.medianWordsPerPaint).toBeLessThanOrEqual(1)
    expect(m.p95VisibleGapMs).toBeLessThanOrEqual(100)
    expect(m.lagP50Ms).toBeLessThanOrEqual(300)
    expect(m.lagMaxMs).toBeLessThanOrEqual(1000)
    expect(m.drainMs).toBeLessThanOrEqual(500)
  })

  it("meets every gate criterion on mixed-markdown @ 30 chunks/s", () => {
    const m = simulateReveal(mixedMarkdown30, PROSE_REVEAL_PROFILE)
    expect(m.medianWordsPerVisualUpdate).toBeLessThanOrEqual(1) // smoothness
    expect(m.p95VisibleGapMs).toBeLessThanOrEqual(100)
    expect(m.firstTextToFirstCommitMs).toBeLessThanOrEqual(FRAME_MS + 1) // latency
    expect(m.lagP50Ms).toBeLessThanOrEqual(300)
    expect(m.lagMaxMs).toBeLessThanOrEqual(1000)
    expect(m.drainMs).toBeLessThanOrEqual(500)
    // Cost bound: the widened 48→96 ms gate caps reveal commits at ~21/s.
    expect(m.commitsPerSecond).toBeLessThanOrEqual(22)
  })

  it("meets every gate criterion on the 100 chunks/s prose stress stream", () => {
    const m = simulateReveal(prose100, PROSE_REVEAL_PROFILE)
    expect(m.medianWordsPerVisualUpdate).toBeLessThanOrEqual(1)
    expect(m.p95VisibleGapMs).toBeLessThanOrEqual(100)
    expect(m.firstTextToFirstCommitMs).toBeLessThanOrEqual(FRAME_MS + 1)
    expect(m.lagP50Ms).toBeLessThanOrEqual(300)
    expect(m.lagMaxMs).toBeLessThanOrEqual(1000)
    expect(m.drainMs).toBeLessThanOrEqual(500)
    expect(m.commitsPerSecond).toBeLessThanOrEqual(22)
  })

  it("keeps code-fence interiors at canonical cadence", () => {
    const m = simulateReveal(codeBlock30, PROSE_REVEAL_PROFILE)
    // Inside the fence the frontier fast-forwards, so displayed lag stays
    // within one throttle window + one commit interval of arrival.
    expect(m.lagP50Ms).toBeLessThanOrEqual(THROTTLE_MS + 96 + FRAME_MS)
    expect(m.lagMaxMs).toBeLessThanOrEqual(1000)
    // Fence interiors commit once per canonical notification (~20/s) by
    // decision #5 — the same per-notification render cost as the pre-reveal
    // baseline for code; prose around the fence stays gate-limited.
    const canonicalNotificationsPerSecond = 1000 / THROTTLE_MS // 20/s
    const proseCommitMargin = 6
    expect(m.commitsPerSecond).toBeLessThanOrEqual(
      canonicalNotificationsPerSecond + proseCommitMargin
    )
    expect(m.drainMs).toBeLessThanOrEqual(500)
  })

  it("reasoning profile drains within its tighter settle window", () => {
    const m = simulateReveal(mixedMarkdown30, REASONING_REVEAL_PROFILE)
    expect(m.drainMs).toBeLessThanOrEqual(350) // 250 ms target + backstop margin
    expect(m.medianWordsPerVisualUpdate).toBeLessThanOrEqual(1)
    expect(m.lagMaxMs).toBeLessThanOrEqual(1000)
  })

  it("prints the decision-doc variant table", () => {
    const row = (
      label: string,
      m: Partial<RevealGateMetrics> & {
        medianWordsPerVisualUpdate: number
        p95VisibleGapMs: number
        visualUpdatesPerSecond: number
      }
    ) =>
      [
        label.padEnd(26),
        String(m.medianWordsPerVisualUpdate).padStart(11),
        m.medianWordsPerPaint !== undefined
          ? `${m.medianWordsPerPaint}/${m.p95WordsPerPaint}`.padStart(11)
          : "          —",
        `${Math.round(m.p95VisibleGapMs)}ms`.padStart(9),
        m.lagP50Ms !== undefined ? `${Math.round(m.lagP50Ms)}ms`.padStart(8) : "       —",
        m.drainMs !== undefined ? `${Math.round(m.drainMs)}ms`.padStart(8) : "       —",
        m.commitsPerSecond !== undefined
          ? m.commitsPerSecond.toFixed(1).padStart(9)
          : "        —",
        m.visualUpdatesPerSecond.toFixed(1).padStart(9),
      ].join(" | ")

    for (const [name, script] of [
      ["prose-typical@75tok/s", proseTypical],
      ["mixed-markdown@30", mixedMarkdown30],
      ["prose@100", prose100],
    ] as const) {
      console.log(`\n[reveal-gate] ${name}`)
      console.log(
        "variant                    | words/upd | paint m/p95 |  p95 gap |  lag p50 |    drain | commits/s | visual/s"
      )
      console.log(row("baseline throttle 50ms", simulateThrottleBaseline(script, 50)))
      console.log(row("throttle 32ms (never ships)", simulateThrottleBaseline(script, 32)))
      console.log(row("fade-only @ 50ms", simulateFadeOnly(script)))
      console.log(
        row(
          "reveal minCommit 32",
          simulateReveal(script, {
            ...PROSE_REVEAL_PROFILE,
            minCommitMs: 32,
            maxCommitMs: 64,
          })
        )
      )
      console.log(
        row("reveal minCommit 48 (ships)", simulateReveal(script, PROSE_REVEAL_PROFILE))
      )
    }
    expect(true).toBe(true)
  })
})
