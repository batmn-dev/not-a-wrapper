/** @vitest-environment jsdom */

// ---------------------------------------------------------------------------
// CodeBlockCode streaming rendering (chat-responsiveness plan PR 3 +
// streaming plan PR C).
//
// The lazy highlighter SERVICE (lib/markdown/shiki-client.ts) is mocked at
// the module seam so highlight CALL COUNTS and inputs are exact and module
// loading can be deferred; timers and Date are fake, so throttle behavior is
// a deterministic virtual-clock fact. Language normalization lives inside
// the service (tested in lib/markdown/shiki-client.test.ts) — the component
// passes the fenced language through verbatim. Throttled highlighting is the
// sole render path (the former legacy / plain-while-growing modes were
// removed in the 2026-07-23 flag collapse).
// ---------------------------------------------------------------------------

import { GROWING_HIGHLIGHT_THROTTLE_MS } from "@/lib/chat-performance/streaming-code-render"
import { buildCodePayload } from "@/benchmarks/chat-performance/fixtures"
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { CodeBlockCode } from "./code-block"

const shikiClientMock = vi.hoisted(() => {
  const escapeHtml = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  const render = (code: string, language: string | undefined, theme: string) =>
    `<pre class="shiki" data-lang="${language ?? "text"}" data-theme="${theme}"><code>${escapeHtml(code)}</code></pre>`
  const state = {
    /** When true, highlight promises stay pending until manually resolved. */
    defer: false,
    pending: [] as Array<() => void>,
  }
  const highlightCode = vi.fn(
    (args: { code: string; language?: string; theme: string }) => {
      const html = render(args.code, args.language, args.theme)
      if (state.defer) {
        return new Promise<string>((resolve) => {
          state.pending.push(() => resolve(html))
        })
      }
      return Promise.resolve(html)
    }
  )
  return { state, highlightCode }
})

vi.mock("@/lib/markdown/shiki-client", () => ({
  highlightCode: shikiClientMock.highlightCode,
}))

const themeMock = vi.hoisted(() => ({ resolvedTheme: "light" as string }))

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: themeMock.resolvedTheme }),
}))

describe("CodeBlockCode streaming rendering (plan PR 3 / PR C)", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeAll(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  beforeEach(() => {
    vi.clearAllMocks()
    themeMock.resolvedTheme = "light"
    shikiClientMock.state.defer = false
    shikiClientMock.state.pending.length = 0
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    })
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

  type CodeProps = { code: string; language?: string; growing?: boolean }

  function mount(props: CodeProps) {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root?.render(<CodeBlockCode {...props} />)
    })
    return {
      rerender: (nextProps: CodeProps) => {
        act(() => {
          root?.render(<CodeBlockCode {...nextProps} />)
        })
      },
      unmount: () => {
        act(() => {
          root?.unmount()
        })
        root = null
      },
    }
  }

  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  const highlightedEl = () => container?.querySelector("pre.shiki")
  const plainText = () => container?.querySelector("pre code")?.textContent

  it("discards a stale async completion by generation token (deferred module load)", async () => {
    shikiClientMock.state.defer = true

    const view = mount({ code: "const a = 1", language: "ts", growing: true })
    // Leading highlight for code A is in flight, blocked on module loading.
    view.rerender({ code: "const a = 1\nconst b = 2", language: "ts", growing: true })
    await advance(GROWING_HIGHLIGHT_THROTTLE_MS + 10)
    expect(shikiClientMock.highlightCode).toHaveBeenCalledTimes(2)
    expect(shikiClientMock.highlightCode).toHaveBeenLastCalledWith(
      expect.objectContaining({ code: "const a = 1\nconst b = 2" })
    )

    // Resolve NEWEST first, stale generation LAST: the late stale completion
    // must not overwrite the newer code's highlight.
    await act(async () => {
      const pending = [...shikiClientMock.state.pending].reverse()
      shikiClientMock.state.pending.length = 0
      shikiClientMock.state.defer = false
      for (const resolve of pending) resolve()
    })
    expect(highlightedEl()?.textContent).toBe("const a = 1\nconst b = 2")
  })

  it("a 400-line stream produces bounded highlights, never one per delta", async () => {
    const payload = buildCodePayload(400)
    const lines = payload.split("\n")
    const deltaCount = 40
    const step = Math.ceil(lines.length / deltaCount)
    const growthStates = Array.from({ length: deltaCount }, (_, i) =>
      lines.slice(0, Math.min(lines.length, (i + 1) * step)).join("\n")
    )

    const view = mount({ code: growthStates[0], language: "typescript", growing: true })
    for (const state of growthStates.slice(1)) {
      await advance(50) // one delta per 50 ms — the PR 2 throttle cadence
      view.rerender({ code: state, language: "typescript", growing: true })
    }
    await advance(GROWING_HIGHLIGHT_THROTTLE_MS)

    const growingCalls = shikiClientMock.highlightCode.mock.calls.length
    const streamDurationMs = (deltaCount - 1) * 50
    expect(growingCalls).toBeGreaterThanOrEqual(2) // leading + trailing at minimum
    expect(growingCalls).toBeLessThanOrEqual(
      Math.ceil(streamDurationMs / GROWING_HIGHLIGHT_THROTTLE_MS) + 3
    )
    expect(growingCalls).toBeLessThan(deltaCount)

    // Settle: exactly one final highlight of the full tuple; the rendered
    // text matches the complete payload byte-for-byte.
    view.rerender({ code: payload, language: "typescript", growing: false })
    await advance(10)
    expect(shikiClientMock.highlightCode.mock.calls.length).toBe(growingCalls + 1)
    expect(highlightedEl()?.textContent).toBe(payload)
  })

  it("hostile code is inert escaped text on the pre-highlight plain path and after highlighting", async () => {
    shikiClientMock.state.defer = true
    const hostile = "<script>alert(1)</script>"

    mount({ code: hostile, language: "ts", growing: true })
    // The leading highlight is blocked on module loading, so the plain
    // fallback shows: React-escaped text, never a live element.
    expect(plainText()).toBe(hostile)
    expect(container?.querySelector("script")).toBeNull()

    await act(async () => {
      const pending = [...shikiClientMock.state.pending]
      shikiClientMock.state.pending.length = 0
      shikiClientMock.state.defer = false
      for (const resolve of pending) resolve()
    })
    expect(highlightedEl()).not.toBeNull()
    expect(container?.querySelector("script")).toBeNull()
    expect(highlightedEl()?.textContent).toBe(hostile)
  })

  it("settling (block becomes non-terminal or the message settles) highlights the final tuple and goes quiet", async () => {
    const view = mount({ code: "const done = true", language: "ts", growing: true })
    await advance(10)
    expect(shikiClientMock.highlightCode).toHaveBeenCalledTimes(1) // leading highlight

    view.rerender({ code: "const done = true", language: "ts", growing: false })
    await advance(10)
    expect(shikiClientMock.highlightCode).toHaveBeenCalledTimes(2) // settle highlight
    expect(highlightedEl()?.textContent).toBe("const done = true")

    // No stray timers keep firing afterwards.
    await advance(1000)
    expect(shikiClientMock.highlightCode).toHaveBeenCalledTimes(2)
  })

  it("re-highlights settled code on theme change with the new theme", async () => {
    const view = mount({ code: "const t = 1", language: "ts", growing: false })
    await advance(10)
    expect(shikiClientMock.highlightCode).toHaveBeenLastCalledWith(
      expect.objectContaining({ code: "const t = 1", theme: "github-light" })
    )

    themeMock.resolvedTheme = "dark"
    view.rerender({ code: "const t = 1", language: "ts", growing: false })
    await advance(10)
    expect(shikiClientMock.highlightCode).toHaveBeenLastCalledWith(
      expect.objectContaining({ code: "const t = 1", theme: "github-dark" })
    )
    expect(highlightedEl()?.getAttribute("data-theme")).toBe("github-dark")
  })

  it("keeps the plain fallback when the service rejects, then retries on input change", async () => {
    shikiClientMock.highlightCode.mockImplementationOnce(() =>
      Promise.reject(new Error("chunk load failed"))
    )
    const view = mount({ code: "const f = 1", language: "ts", growing: false })
    await advance(10)
    // Rejected load: plain escaped path stays, no crash.
    expect(highlightedEl()).toBeFalsy()
    expect(plainText()).toBe("const f = 1")

    // The next tuple change retries and succeeds.
    view.rerender({ code: "const f = 2", language: "ts", growing: false })
    await advance(10)
    expect(highlightedEl()?.textContent).toBe("const f = 2")
  })

  it("unmount clears a pending trailing highlight timer", async () => {
    const view = mount({ code: "const gone = 1", language: "ts", growing: true })
    await advance(10)
    expect(shikiClientMock.highlightCode).toHaveBeenCalledTimes(1) // leading

    // A delta inside the throttle window schedules a trailing timer…
    view.rerender({ code: "const gone = 1\nconst more = 2", language: "ts", growing: true })
    view.unmount()
    // …which must be inert after unmount.
    await advance(1000)
    expect(shikiClientMock.highlightCode).toHaveBeenCalledTimes(1)
  })
})
