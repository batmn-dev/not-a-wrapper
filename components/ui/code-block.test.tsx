/** @vitest-environment jsdom */

// ---------------------------------------------------------------------------
// CodeBlockCode streaming render modes (chat-responsiveness plan, PR 3).
//
// Shiki is mocked at the module seam so highlight CALL COUNTS and inputs are
// exact; timers and Date are fake, so throttle/debounce behavior is a
// deterministic virtual-clock fact. The first test intentionally runs against
// a COLD (deferred) highlighter init — the module-level singleton is warm for
// every test after it.
// ---------------------------------------------------------------------------

import {
  GROWING_HIGHLIGHT_DEBOUNCE_MS,
  GROWING_HIGHLIGHT_THROTTLE_MS,
} from "@/lib/chat-performance/streaming-code-render"
import { buildCodePayload } from "@/benchmarks/chat-performance/fixtures"
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { CodeBlockCode } from "./code-block"

const shikiMock = vi.hoisted(() => {
  const escapeHtml = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  const codeToHtml = vi.fn(
    (code: string, options: { lang: string; theme: string }) =>
      `<pre class="shiki" data-lang="${options.lang}" data-theme="${options.theme}"><code>${escapeHtml(code)}</code></pre>`
  )
  const highlighter = {
    codeToHtml,
    getLoadedLanguages: () => [
      "typescript",
      "ts",
      "tsx",
      "javascript",
      "js",
      "json",
      "shell",
      "sh",
      "bash",
    ],
  }
  const state = {
    deferInit: false,
    resolveInit: null as null | ((value: unknown) => void),
  }
  return {
    state,
    codeToHtml,
    highlighter,
    createHighlighter: vi.fn(() =>
      state.deferInit
        ? new Promise((resolve) => {
            state.resolveInit = resolve
          })
        : Promise.resolve(highlighter)
    ),
  }
})

vi.mock("shiki", () => ({
  createHighlighter: shikiMock.createHighlighter,
}))

const themeMock = vi.hoisted(() => ({ resolvedTheme: "light" as string }))

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: themeMock.resolvedTheme }),
}))

describe("CodeBlockCode streaming render modes (plan PR 3)", () => {
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
    vi.unstubAllEnvs()
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

  it("invalidates an out-of-order highlighter completion by generation token (cold init)", async () => {
    vi.stubEnv("NEXT_PUBLIC_STREAMING_CODE_RENDER_MODE", "throttled-highlight")
    shikiMock.state.deferInit = true

    const view = mount({ code: "const a = 1", language: "ts", growing: true })
    // Leading highlight for code A is in flight, blocked on highlighter init.
    view.rerender({ code: "const a = 1\nconst b = 2", language: "ts", growing: true })
    await advance(GROWING_HIGHLIGHT_THROTTLE_MS + 10)

    // Init resolves AFTER both attempts started: the stale generation must be
    // discarded before it ever reaches codeToHtml.
    await act(async () => {
      shikiMock.state.resolveInit?.(shikiMock.highlighter)
      shikiMock.state.deferInit = false
    })

    expect(shikiMock.codeToHtml).toHaveBeenCalledTimes(1)
    expect(shikiMock.codeToHtml).toHaveBeenCalledWith(
      "const a = 1\nconst b = 2",
      expect.objectContaining({ lang: "ts" })
    )
    expect(highlightedEl()?.textContent).toBe("const a = 1\nconst b = 2")
  })

  it("throttled-highlight: a 400-line stream produces bounded highlights, never one per delta", async () => {
    vi.stubEnv("NEXT_PUBLIC_STREAMING_CODE_RENDER_MODE", "throttled-highlight")
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

    const growingCalls = shikiMock.codeToHtml.mock.calls.length
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
    expect(shikiMock.codeToHtml.mock.calls.length).toBe(growingCalls + 1)
    expect(highlightedEl()?.textContent).toBe(payload)
  })

  it("plain-while-growing: escaped text during growth, idle debounce highlight, immediate re-growth return to plain", async () => {
    vi.stubEnv("NEXT_PUBLIC_STREAMING_CODE_RENDER_MODE", "plain-while-growing")
    const hostile = "<script>alert(1)</script>"

    const view = mount({ code: hostile, language: "ts", growing: true })
    // Growing: React-escaped plain text, no highlight scheduled yet, and the
    // hostile payload is inert text — never a live element.
    expect(shikiMock.codeToHtml).not.toHaveBeenCalled()
    expect(plainText()).toBe(hostile)
    expect(container?.querySelector("script")).toBeNull()

    // Idle: the inactivity debounce highlights the captured code.
    await advance(GROWING_HIGHLIGHT_DEBOUNCE_MS + 10)
    expect(shikiMock.codeToHtml).toHaveBeenCalledTimes(1)
    expect(highlightedEl()).not.toBeNull()
    expect(container?.querySelector("script")).toBeNull()

    // Re-growth: a later delta IMMEDIATELY returns to plain (no stale HTML),
    // before any timer runs.
    const grown = `${hostile}\nconst next = 2`
    view.rerender({ code: grown, language: "ts", growing: true })
    expect(highlightedEl()).toBeNull()
    expect(plainText()).toBe(grown)

    // And idles back into a highlight of the new code.
    await advance(GROWING_HIGHLIGHT_DEBOUNCE_MS + 10)
    expect(shikiMock.codeToHtml).toHaveBeenCalledTimes(2)
    expect(highlightedEl()?.textContent).toBe(grown)
  })

  it("settling (block becomes non-terminal or the message settles) highlights the final tuple once", async () => {
    vi.stubEnv("NEXT_PUBLIC_STREAMING_CODE_RENDER_MODE", "plain-while-growing")
    const view = mount({ code: "const done = true", language: "ts", growing: true })
    expect(shikiMock.codeToHtml).not.toHaveBeenCalled()

    view.rerender({ code: "const done = true", language: "ts", growing: false })
    await advance(10)
    expect(shikiMock.codeToHtml).toHaveBeenCalledTimes(1)
    expect(highlightedEl()?.textContent).toBe("const done = true")

    // No stray timers keep firing afterwards.
    await advance(1000)
    expect(shikiMock.codeToHtml).toHaveBeenCalledTimes(1)
  })

  it("re-highlights settled code on theme change with the new theme", async () => {
    vi.stubEnv("NEXT_PUBLIC_STREAMING_CODE_RENDER_MODE", "plain-while-growing")
    const view = mount({ code: "const t = 1", language: "ts", growing: false })
    await advance(10)
    expect(shikiMock.codeToHtml).toHaveBeenLastCalledWith(
      "const t = 1",
      expect.objectContaining({ theme: "github-light" })
    )

    themeMock.resolvedTheme = "dark"
    view.rerender({ code: "const t = 1", language: "ts", growing: false })
    await advance(10)
    expect(shikiMock.codeToHtml).toHaveBeenLastCalledWith(
      "const t = 1",
      expect.objectContaining({ theme: "github-dark" })
    )
    expect(highlightedEl()?.getAttribute("data-theme")).toBe("github-dark")
  })

  it("unmount clears pending debounce timers and never highlights afterwards", async () => {
    vi.stubEnv("NEXT_PUBLIC_STREAMING_CODE_RENDER_MODE", "plain-while-growing")
    const view = mount({ code: "const gone = 1", language: "ts", growing: true })
    view.unmount()
    await advance(1000)
    expect(shikiMock.codeToHtml).not.toHaveBeenCalled()
  })

  it("normalizes unknown and plain language ids by querying loaded languages", async () => {
    vi.stubEnv("NEXT_PUBLIC_STREAMING_CODE_RENDER_MODE", "throttled-highlight")
    const cases: Array<[string, string]> = [
      ["definitely-not-a-language", "text"],
      ["plaintext", "text"],
      ["js", "js"], // loaded alias survives
    ]
    for (const [input, expected] of cases) {
      const view = mount({ code: "x", language: input, growing: false })
      await advance(10)
      expect(shikiMock.codeToHtml).toHaveBeenLastCalledWith(
        "x",
        expect.objectContaining({ lang: expected })
      )
      view.unmount()
      container?.remove()
      container = null
    }
  })

  it("legacy mode still highlights every delta and ignores growing", async () => {
    vi.stubEnv("NEXT_PUBLIC_STREAMING_CODE_RENDER_MODE", "legacy")
    const view = mount({ code: "const a = 1", language: "ts", growing: true })
    await advance(10)
    view.rerender({ code: "const a = 1\nconst b = 2", language: "ts", growing: true })
    await advance(10)
    expect(shikiMock.codeToHtml).toHaveBeenCalledTimes(2)
    expect(highlightedEl()?.textContent).toBe("const a = 1\nconst b = 2")
  })
})
