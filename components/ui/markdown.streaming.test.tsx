/** @vitest-environment jsdom */

// ---------------------------------------------------------------------------
// Terminal-block stability through the full Markdown pipeline (plan PR 3).
//
// The stability rule under test — a code block is `growing` iff it is the
// TERMINAL parsed block AND the message is live (`streaming` prop) — is
// classified in markdown.tsx and consumed by CodeBlockCode. Shiki is mocked,
// so highlight calls are exact; there is deliberately no fence parser, so an
// unclosed terminal fence settles the moment the message does.
// ---------------------------------------------------------------------------

import { GROWING_HIGHLIGHT_DEBOUNCE_MS } from "@/lib/chat-performance/streaming-code-render"
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { Markdown } from "./markdown"

const shikiMock = vi.hoisted(() => {
  const escapeHtml = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  const codeToHtml = vi.fn(
    (code: string, options: { lang: string; theme: string }) =>
      `<pre class="shiki" data-lang="${options.lang}"><code>${escapeHtml(code)}</code></pre>`
  )
  return {
    codeToHtml,
    createHighlighter: vi.fn(async () => ({
      codeToHtml,
      getLoadedLanguages: () => ["typescript", "ts", "javascript", "js"],
    })),
  }
})

vi.mock("shiki", () => ({
  createHighlighter: shikiMock.createHighlighter,
}))

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}))

describe("Markdown terminal-block stability (plan PR 3)", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null
  const writeText = vi.fn()

  beforeAll(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    })
    vi.stubEnv("NEXT_PUBLIC_STREAMING_CODE_RENDER_MODE", "plain-while-growing")
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

  function mount(markdown: string, streaming: boolean) {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    const render = (nextMarkdown: string, nextStreaming: boolean) => {
      act(() => {
        root?.render(
          <Markdown id="stability" streaming={nextStreaming}>
            {nextMarkdown}
          </Markdown>
        )
      })
    }
    render(markdown, streaming)
    return { rerender: render }
  }

  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  // Two fences; the second is unclosed and terminal, with a longer outer
  // fence so inner triple backticks stay literal text while growing.
  const firstFence = 'const first = "done"'
  const growingTail = "const second = 1\n``` inner backticks ```"
  const multiFenceStreaming =
    "Intro prose.\n\n" +
    "```ts\n" +
    firstFence +
    "\n```\n\n" +
    "Some prose between fences.\n\n" +
    "````ts\n" +
    growingTail

  it("highlights every non-terminal fence while only the terminal fence grows as plain text", async () => {
    mount(multiFenceStreaming, true)
    // Well before the debounce: the completed first fence highlights; the
    // growing terminal fence does not.
    await advance(GROWING_HIGHLIGHT_DEBOUNCE_MS / 3)
    expect(shikiMock.codeToHtml).toHaveBeenCalledTimes(1)
    expect(shikiMock.codeToHtml).toHaveBeenCalledWith(
      `${firstFence}\n`,
      expect.objectContaining({ lang: "ts" })
    )

    // The growing fence renders its raw tail — inner backticks included — as
    // escaped text.
    const codeBlocks = container?.querySelectorAll(".markdown-code-block")
    expect(codeBlocks?.length).toBe(2)
    const growingBlock = codeBlocks?.[1]
    expect(growingBlock?.querySelector("pre.shiki")).toBeNull()
    expect(growingBlock?.querySelector("pre code")?.textContent).toContain(
      "``` inner backticks ```"
    )
  })

  it("settling the message (finish, Stop, or error) highlights the unclosed terminal fence", async () => {
    const view = mount(multiFenceStreaming, true)
    await advance(GROWING_HIGHLIGHT_DEBOUNCE_MS / 3)
    expect(shikiMock.codeToHtml).toHaveBeenCalledTimes(1)

    // Message settles with the fence still unclosed (Stop/error partial
    // output): the terminal block becomes stable and highlights.
    view.rerender(multiFenceStreaming, false)
    await advance(10)
    expect(shikiMock.codeToHtml).toHaveBeenCalledTimes(2)
    expect(shikiMock.codeToHtml).toHaveBeenLastCalledWith(
      `${growingTail}\n`,
      expect.objectContaining({ lang: "ts" })
    )
    const codeBlocks = container?.querySelectorAll(".markdown-code-block")
    expect(codeBlocks?.[1]?.querySelector("pre.shiki")).not.toBeNull()
  })

  it("a fence becomes non-terminal when prose streams after it and highlights without waiting for idle", async () => {
    const unclosed = "```ts\nconst tail = 1"
    const view = mount(unclosed, true)
    expect(shikiMock.codeToHtml).not.toHaveBeenCalled()

    // The fence closes and prose follows: the code block is no longer the
    // terminal block, so it highlights promptly — no debounce involved.
    view.rerender("```ts\nconst tail = 1\n```\n\nMore prose.", true)
    await advance(10)
    expect(shikiMock.codeToHtml).toHaveBeenCalledTimes(1)
    expect(shikiMock.codeToHtml).toHaveBeenCalledWith(
      "const tail = 1\n",
      expect.objectContaining({ lang: "ts" })
    )
  })

  it("copy during growth writes the raw code, and hostile code stays inert text", async () => {
    const hostile = '<script>alert("xss")</script>'
    mount("```ts\n" + hostile, true)

    expect(container?.querySelector("script")).toBeNull()
    const copyButton = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="Copy"]'
    )
    expect(copyButton).not.toBeNull()
    act(() => {
      copyButton?.click()
    })
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText.mock.calls[0][0]).toContain(hostile)
  })
})
