/**
 * Presentation-reveal core benchmark (plan §8 commit 1).
 *
 * Replays the deterministic mixed-markdown stream's growth states through
 * `reconcileCanonical` + `advanceReveal`. The property under measurement:
 * per-update cost is O(appended slice), not O(message) — the incremental
 * fence scan and the windowed word segmentation are what keep it flat, so
 * the 10× message must not cost ~10× per update.
 *
 * Run with: bun run bench:chat
 */
import { bench, describe } from "vitest"
import {
  advanceReveal,
  createRevealState,
  PROSE_REVEAL_PROFILE,
  reconcileCanonical,
  type RevealState,
} from "../../lib/chat-performance/presentation-reveal"
import { buildMarkdownPayload, buildStreamScript } from "./fixtures"

/** Canonical growth states + virtual timestamps for a text stream. */
function buildGrowthStates(
  payloadRepeat: number
): Array<{ text: string; atMs: number }> {
  const states: Array<{ text: string; atMs: number }> = []
  if (payloadRepeat === 1) {
    const script = buildStreamScript({
      scenario: "mixed-markdown",
      chunksPerSecond: 30,
    })
    let text = ""
    for (const event of script) {
      if (event.type !== "text-delta") continue
      text += event.delta
      states.push({ text, atMs: event.atMs })
    }
    return states
  }
  // Longer synthetic message: same 40-char deltas over a repeated payload.
  const payload = buildMarkdownPayload().repeat(payloadRepeat)
  let atMs = 0
  for (let offset = 40; offset <= payload.length; offset += 40) {
    atMs += Math.round(1000 / 30)
    states.push({ text: payload.slice(0, offset), atMs })
  }
  return states
}

function replay(states: Array<{ text: string; atMs: number }>): RevealState {
  let state = createRevealState("", true)
  for (const { text, atMs } of states) {
    state = reconcileCanonical(state, text, false).state
    // Two frames per canonical update approximates the rAF loop cadence.
    state = advanceReveal(state, text, atMs, PROSE_REVEAL_PROFILE, "streaming")
      .state
    state = advanceReveal(
      state,
      text,
      atMs + 8,
      PROSE_REVEAL_PROFILE,
      "streaming"
    ).state
  }
  return state
}

const mixedMarkdownStates = buildGrowthStates(1)
const longMessageStates = buildGrowthStates(10)

console.log(
  `[reveal-bench] mixed-markdown updates: ${mixedMarkdownStates.length}, ` +
    `long-message updates: ${longMessageStates.length} — compare per-update ` +
    `cost (time/op ÷ updates); O(appended) means they stay comparable.`
)

describe("presentation-reveal core", () => {
  bench(
    "mixed-markdown @ 30 chunks/s (full stream replay)",
    () => {
      replay(mixedMarkdownStates)
    },
    { warmupIterations: 3, iterations: 20, time: 0, warmupTime: 0 }
  )

  bench(
    "10× message length (per-update cost must stay flat)",
    () => {
      replay(longMessageStates)
    },
    { warmupIterations: 2, iterations: 5, time: 0, warmupTime: 0 }
  )
})
