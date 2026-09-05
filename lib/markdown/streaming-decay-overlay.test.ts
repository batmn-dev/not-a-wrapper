/** @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest"
import {
  advanceDecayCohorts,
  DECAY_BUCKET_COUNT,
  DECAY_BUCKET_MS,
  DECAY_TOTAL_MS,
  decayBucketOf,
  decayStylesheetText,
  MAX_WORD_MERGE_CHARS,
  observeStreamingDecay,
  setStreamingDecayEnabled,
  settleStreamingDecay,
  type DecayCohort,
} from "./streaming-decay-overlay"

describe("decayStylesheetText", () => {
  it("emits one motion-gated ::highlight rule per bucket on the 4%→96% ramp", () => {
    const css = decayStylesheetText()
    expect(
      css.startsWith("@media (prefers-reduced-motion: no-preference)")
    ).toBe(true)
    const rules =
      css.match(/\[data-streaming-decay-root\]::highlight\(naw-stream-decay-\d+\)/g) ?? []
    expect(rules.length).toBe(DECAY_BUCKET_COUNT)
    expect(css).toContain(
      "::highlight(naw-stream-decay-0) { color: color-mix(in oklab, var(--foreground) 4%, transparent); }"
    )
    expect(css).toContain(
      `::highlight(naw-stream-decay-${DECAY_BUCKET_COUNT - 1}) { color: color-mix(in oklab, var(--foreground) 96%, transparent); }`
    )
  })
})

describe("advanceDecayCohorts", () => {
  it("seeds the baseline without animating on first observation", () => {
    expect(
      advanceDecayCohorts({
        previousText: null,
        nextText: "adopted after reload",
        cohorts: [],
        now: 1000,
      })
    ).toEqual([])
  })

  it("creates one cohort for an appended suffix", () => {
    expect(
      advanceDecayCohorts({
        previousText: "Hello",
        nextText: "Hello world",
        cohorts: [],
        now: 1000,
      })
    ).toEqual([{ start: 5, end: 11, arrivedAt: 1000 }])
  })

  it("accumulates cohorts across word-separated appends and prunes by age", () => {
    const first = advanceDecayCohorts({
      previousText: "one ",
      nextText: "one two ",
      cohorts: [],
      now: 0,
    })
    const second = advanceDecayCohorts({
      previousText: "one two ",
      nextText: "one two three",
      cohorts: first,
      now: DECAY_TOTAL_MS - 1,
    })
    expect(second.map((c) => c.start)).toEqual([4, 8])
    const third = advanceDecayCohorts({
      previousText: "one two three",
      nextText: "one two three four",
      cohorts: second,
      now: DECAY_TOTAL_MS,
    })
    // The now-expired first cohort is gone; the sub-window second survives.
    expect(third.map((c) => c.start)).toEqual([8, 13])
  })

  it("snaps a mid-word append back to the word boundary (word-atomic fade)", () => {
    // "hel" arrives, then "lo world": the word "hello" must fade as a unit,
    // so the "hel" fragment moves out of the live preceding cohort into the
    // new one.
    const first = advanceDecayCohorts({
      previousText: "say ",
      nextText: "say hel",
      cohorts: [],
      now: 0,
    })
    const second = advanceDecayCohorts({
      previousText: "say hel",
      nextText: "say hello world",
      cohorts: first,
      now: 50,
    })
    expect(second).toEqual([{ start: 4, end: 15, arrivedAt: 50 }])
  })

  it("shrinks (not drops) the preceding cohort when only its word tail merges", () => {
    // "one t" arrives as one cohort, then "wo": only "t" belongs to the
    // continuing word — "one " keeps its original decay timing.
    const first = advanceDecayCohorts({
      previousText: "",
      nextText: "one t",
      cohorts: [],
      now: 0,
    })
    const second = advanceDecayCohorts({
      previousText: "one t",
      nextText: "one two",
      cohorts: first,
      now: 50,
    })
    expect(second).toEqual([
      { start: 0, end: 4, arrivedAt: 0 },
      { start: 4, end: 7, arrivedAt: 50 },
    ])
  })

  it("does not compound decay across unspaced-script (CJK) appends", () => {
    // Chinese streams ~2 chars per commit with no whitespace anywhere. The
    // bounded merge must leave earlier appends aging normally — the
    // unbounded scan collapsed the whole run into ONE cohort re-timed to
    // `now` on every append, pinning the entire streamed text near-transparent
    // until the stream paused.
    const full = "机器学习模型的训练需要大量的数据和计算资源没有任何空格"
    let cohorts: DecayCohort[] = []
    let previousText: string | null = null
    let now = 0
    for (let i = 2; i <= full.length; i += 2) {
      const nextText = full.slice(0, i)
      cohorts = advanceDecayCohorts({ previousText, nextText, cohorts, now })
      previousText = nextText
      now += 50
    }
    expect(cohorts.length).toBeGreaterThan(1)
    // The oldest surviving cohort kept its original arrival time instead of
    // being refreshed by later appends.
    expect(now - cohorts[0]!.arrivedAt).toBeGreaterThan(DECAY_BUCKET_MS * 4)
    // No cohort spans more than the merge window plus one append.
    for (const cohort of cohorts.slice(1)) {
      expect(cohort.end - cohort.start).toBeLessThanOrEqual(
        MAX_WORD_MERGE_CHARS + 2
      )
    }
  })

  it("does not merge into a word longer than MAX_WORD_MERGE_CHARS", () => {
    const first = advanceDecayCohorts({
      previousText: "see ",
      nextText: "see Supercalifragilisticexp",
      cohorts: [],
      now: 0,
    })
    const second = advanceDecayCohorts({
      previousText: "see Supercalifragilisticexp",
      nextText: "see Supercalifragilisticexpialidocious",
      cohorts: first,
      now: 50,
    })
    // The overlong word's earlier fragment keeps its own decay; only the
    // appended tail fades fresh (a two-tone word beats re-tinting settled
    // paint or an unbounded scan).
    expect(second).toEqual([
      { start: 4, end: 27, arrivedAt: 0 },
      { start: 27, end: 38, arrivedAt: 50 },
    ])
  })

  it("never re-tints fully-decayed text on a slow mid-word append", () => {
    // The word fragment's cohort already expired: the append must not reach
    // back into settled paint, even though the word continues.
    const stale = advanceDecayCohorts({
      previousText: "say hel",
      nextText: "say hello",
      cohorts: [],
      now: DECAY_TOTAL_MS * 3,
    })
    expect(stale).toEqual([{ start: 7, end: 9, arrivedAt: DECAY_TOTAL_MS * 3 }])
  })

  it("keeps earlier fades across a list-marker parse flip", () => {
    // Rendered text of "First item" + paragraph "2." → the marker becomes a
    // CSS ::marker and leaves textContent as item content arrives:
    // "First item2." → "First itemSecond thing". The fade on "item" must
    // survive and the rewritten suffix fades fresh.
    const live = [{ start: 6, end: 12, arrivedAt: 0 }]
    const next = advanceDecayCohorts({
      previousText: "First item2.",
      nextText: "First itemSecond thing",
      cohorts: live,
      now: 100,
    })
    expect(next).toEqual([
      { start: 6, end: 10, arrivedAt: 0 },
      { start: 10, end: 22, arrivedAt: 100 },
    ])
  })

  it("clips surviving cohorts on a small shrink without animating", () => {
    expect(
      advanceDecayCohorts({
        previousText: "Hello",
        nextText: "Hell",
        cohorts: [{ start: 0, end: 5, arrivedAt: 0 }],
        now: 1,
      })
    ).toEqual([{ start: 0, end: 4, arrivedAt: 0 }])
  })

  it("resets without animating on a large rewrite", () => {
    const previousText = "x".repeat(200)
    expect(
      advanceDecayCohorts({
        previousText,
        nextText: "completely different content",
        cohorts: [{ start: 0, end: 200, arrivedAt: 0 }],
        now: 1,
      })
    ).toEqual([])
  })

  it("prunes without animating when text is unchanged", () => {
    expect(
      advanceDecayCohorts({
        previousText: "same",
        nextText: "same",
        cohorts: [{ start: 0, end: 4, arrivedAt: 0 }],
        now: DECAY_TOTAL_MS + 1,
      })
    ).toEqual([])
  })
})

describe("decayBucketOf", () => {
  it("maps age monotonically from newest to last bucket", () => {
    const cohort = { start: 0, end: 1, arrivedAt: 0 }
    expect(decayBucketOf(cohort, 0)).toBe(0)
    expect(decayBucketOf(cohort, DECAY_BUCKET_MS)).toBe(1)
    expect(decayBucketOf(cohort, DECAY_TOTAL_MS - 1)).toBe(
      DECAY_BUCKET_COUNT - 1
    )
    // Clock skew never indexes out of range.
    expect(decayBucketOf(cohort, DECAY_TOTAL_MS * 10)).toBe(
      DECAY_BUCKET_COUNT - 1
    )
    expect(decayBucketOf({ ...cohort, arrivedAt: 50 }, 0)).toBe(0)
  })
})

describe("manager without CSS Custom Highlight support (jsdom)", () => {
  it("observe and settle are safe no-ops", () => {
    const container = document.createElement("div")
    container.textContent = "streaming text"
    expect(() => {
      observeStreamingDecay(container)
      observeStreamingDecay(container)
      settleStreamingDecay(container)
    }).not.toThrow()
    expect(container.hasAttribute("data-streaming-decay-root")).toBe(false)
  })
})

describe("setStreamingDecayEnabled preference gate", () => {
  it("disables observe as a no-op and re-enables cleanly", () => {
    const container = document.createElement("div")
    container.textContent = "streaming text"
    expect(() => {
      setStreamingDecayEnabled(false)
      observeStreamingDecay(container)
      setStreamingDecayEnabled(true)
      observeStreamingDecay(container)
      settleStreamingDecay(container)
    }).not.toThrow()
  })
})

describe("paint pipeline with a stubbed CSS Custom Highlight API", () => {
  it.each(["frame", "append", "deadline crossing"] as const)(
    "pauses off-screen tails on %s expiry and resumes only current cohorts",
    (expiry) => {
    class FakeHighlight extends Set<unknown> {}
    class FakeStaticRange {
      constructor(readonly init: StaticRangeInit) {}
    }
    class FakeIntersectionObserver {
      static instances: FakeIntersectionObserver[] = []
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
      constructor(readonly callback: (entries: Array<{
        target: Element
        isIntersecting: boolean
      }>) => void) {
        FakeIntersectionObserver.instances.push(this)
      }
      emit(target: Element, isIntersecting: boolean) {
        this.callback([{ target, isIntersecting }])
      }
    }
    const highlights = new Map<string, FakeHighlight>()
    const clock = vi.spyOn(performance, "now").mockReturnValue(0)
    const clears = vi.spyOn(FakeHighlight.prototype, "clear")
    let nextFrame: FrameRequestCallback | undefined
    const raf = vi.fn((callback: FrameRequestCallback) => {
      nextFrame = callback
      return 1
    })
    const cancel = vi.fn(() => { nextFrame = undefined })
    vi.stubGlobal("CSS", { highlights })
    vi.stubGlobal("Highlight", FakeHighlight)
    vi.stubGlobal("StaticRange", FakeStaticRange)
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver)
    vi.stubGlobal("requestAnimationFrame", raf)
    vi.stubGlobal("cancelAnimationFrame", cancel)
    const container = document.createElement("div")
    container.innerHTML = "<p>Ready</p>"
    document.body.append(container)
    try {
      observeStreamingDecay(container)
      const observer = FakeIntersectionObserver.instances[0]!
      const originalTail = container.lastElementChild!
      expect(observer.observe).toHaveBeenCalledWith(originalTail)
      originalTail.append(" new")
      observeStreamingDecay(container)
      expect(highlights.get("naw-stream-decay-0")!.size).toBeGreaterThan(0)
      observer.emit(originalTail, false)
      // A preceding visible cohort keeps its normal fade after the tail exits.
      expect(highlights.get("naw-stream-decay-0")!.size).toBeGreaterThan(0)
      expect(cancel).not.toHaveBeenCalled()

      clock.mockReturnValue(100)
      originalTail.append(" hidden")
      observeStreamingDecay(container)
      clock.mockReturnValue(200)
      container.insertAdjacentHTML("beforeend", "<p> latest</p>")
      observeStreamingDecay(container)
      const newTail = container.lastElementChild!
      expect(observer.unobserve).toHaveBeenCalledWith(originalTail)
      expect(observer.observe).toHaveBeenLastCalledWith(newTail)
      clock.mockReturnValue(300)
      observer.emit(newTail, false)
      // Target replacement and repeated off-screen reports must not extend grace.
      clock.mockReturnValue(DECAY_TOTAL_MS + 1)
      if (expiry === "frame") {
        const finalGraceFrame = nextFrame!
        nextFrame = undefined
        finalGraceFrame(DECAY_TOTAL_MS + 1)
      } else {
        if (expiry === "deadline crossing") {
          clock.mockReturnValueOnce(DECAY_TOTAL_MS - 1)
        }
        newTail.append(" at expiry")
        observeStreamingDecay(container)
      }
      expect([...highlights.values()].every((bucket) => bucket.size === 0)).toBe(true)
      expect(nextFrame).toBeUndefined()
      const clearsWhileHidden = clears.mock.calls.length
      const framesWhileHidden = raf.mock.calls.length
      clock.mockReturnValue(500)
      newTail.append(" offscreen")
      observeStreamingDecay(container)
      observer.emit(originalTail, true)
      expect(clears).toHaveBeenCalledTimes(clearsWhileHidden)
      expect(raf).toHaveBeenCalledTimes(framesWhileHidden)

      clock.mockReturnValue(550)
      observer.emit(newTail, true)
      expect(highlights.get("naw-stream-decay-0")!.size).toBe(0)
      expect(highlights.get("naw-stream-decay-1")!.size).toBeGreaterThan(0)
      expect(raf).toHaveBeenCalledTimes(framesWhileHidden + 1)
      settleStreamingDecay(container)
      expect(observer.disconnect).toHaveBeenCalledTimes(1)
      const clearsAfterSettle = clears.mock.calls.length
      observer.emit(newTail, false)
      expect(clears).toHaveBeenCalledTimes(clearsAfterSettle)

      observeStreamingDecay(container)
      setStreamingDecayEnabled(false)
      expect(FakeIntersectionObserver.instances[1]!.disconnect)
        .toHaveBeenCalledTimes(1)
    } finally {
      setStreamingDecayEnabled(false)
      setStreamingDecayEnabled(true)
      container.remove()
      clock.mockRestore()
      clears.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  it("registers bucket highlights over appended text and clears on settle", () => {
    class FakeHighlight {
      ranges: unknown[]
      constructor(...ranges: unknown[]) {
        this.ranges = ranges
      }
      clear() {
        this.ranges = []
      }
      add(range: unknown) {
        this.ranges.push(range)
      }
    }
    class FakeStaticRange {
      startContainer: Node
      startOffset: number
      endContainer: Node
      endOffset: number
      constructor(init: {
        startContainer: Node
        startOffset: number
        endContainer: Node
        endOffset: number
      }) {
        this.startContainer = init.startContainer
        this.startOffset = init.startOffset
        this.endContainer = init.endContainer
        this.endOffset = init.endOffset
      }
    }
    const highlights = new Map<string, FakeHighlight>()
    vi.stubGlobal("CSS", { highlights })
    vi.stubGlobal("Highlight", FakeHighlight)
    vi.stubGlobal("StaticRange", FakeStaticRange)
    vi.stubGlobal("requestAnimationFrame", () => 1)
    vi.stubGlobal("cancelAnimationFrame", () => {})
    const container = document.createElement("div")
    const setAttribute = vi.spyOn(container, "setAttribute")
    try {
      document.body.appendChild(container)
      container.textContent = "Hello"
      // First observation seeds the baseline — the persistent bucket
      // highlights register once (empty), and nothing is painted: registry
      // KEYS must never churn per paint (Chromium invalidates ::highlight
      // matching document-wide on registry mutation — the B1 layout storm).
      observeStreamingDecay(container)
      expect(container.hasAttribute("data-streaming-decay-root")).toBe(true)
      const emptyRangeCount = () =>
        [...highlights.values()].reduce(
          (total, highlight) => total + highlight.ranges.length,
          0
        )
      expect(highlights.size).toBe(12)
      expect(emptyRangeCount()).toBe(0)

      container.textContent = "Hello world"
      observeStreamingDecay(container)
      expect(setAttribute).toHaveBeenCalledExactlyOnceWith(
        "data-streaming-decay-root",
        ""
      )
      const newest = highlights.get("naw-stream-decay-0")
      expect(newest).toBeDefined()
      // The appended suffix (offsets 5–11) is fully covered by newest-bucket
      // ranges anchored to the container's text node.
      const ranges = newest!.ranges as FakeStaticRange[]
      expect(ranges.length).toBeGreaterThan(0)
      expect(Math.min(...ranges.map((r) => r.startOffset))).toBe(5)
      expect(Math.max(...ranges.map((r) => r.endOffset))).toBe(11)
      expect(ranges[0]!.startContainer).toBe(container.firstChild)

      // Settlement clears every bucket's ranges synchronously; the
      // registered highlights persist (mutated in place, never re-keyed).
      settleStreamingDecay(container)
      expect(container.hasAttribute("data-streaming-decay-root")).toBe(false)
      expect(highlights.size).toBe(12)
      expect(emptyRangeCount()).toBe(0)
      // A long settled prefix must not multiply JS range-construction work.
      container.innerHTML =
        "<p>Settled text. </p>".repeat(1000) + "<p>Ready </p>"
      observeStreamingDecay(container)
      container.lastElementChild!.insertAdjacentHTML(
        "beforeend",
        "<b>new</b> words"
      )
      const forward = vi.spyOn(TreeWalker.prototype, "nextNode")
      const backward = vi.spyOn(TreeWalker.prototype, "previousNode")
      const last = vi.spyOn(TreeWalker.prototype, "lastChild")
      try {
        observeStreamingDecay(container)
        const tailRanges = [...highlights.values()].flatMap(
          (highlight) => highlight.ranges as FakeStaticRange[]
        )
        expect(
          tailRanges
            .map((range) =>
              range.startContainer.textContent!.slice(
                range.startOffset,
                range.endOffset
              )
            )
            .sort()
        ).toEqual([" words", "new"])
        expect(
          forward.mock.calls.length +
            backward.mock.calls.length +
            last.mock.calls.length
        ).toBeLessThan(8)
      } finally {
        forward.mockRestore()
        backward.mockRestore()
        last.mockRestore()
      }
      // Preference cleanup also releases roots that have already disconnected.
      container.remove()
      setStreamingDecayEnabled(false)
      expect(container.hasAttribute("data-streaming-decay-root")).toBe(false)
      expect(highlights.size).toBe(0)
    } finally {
      setAttribute.mockRestore()
      container.remove()
      // The manager is a module singleton: reset its rAF handle (armed with
      // the stubbed requestAnimationFrame above) so later observes can
      // schedule a real loop.
      setStreamingDecayEnabled(false)
      setStreamingDecayEnabled(true)
      vi.unstubAllGlobals()
    }
  })
})
