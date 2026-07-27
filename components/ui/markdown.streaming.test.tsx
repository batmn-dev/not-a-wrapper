/** @vitest-environment jsdom */

// ---------------------------------------------------------------------------
// Terminal-block stability through the full Markdown pipeline (plan PR 3).
//
// The stability rule under test — a code block is `growing` iff it is the
// TERMINAL parsed block AND the message is live (`streaming` prop) — is
// classified in markdown.tsx and consumed by CodeBlockCode, whose growing
// blocks re-highlight at most once per GROWING_HIGHLIGHT_THROTTLE_MS while
// stable blocks highlight immediately. Shiki is mocked, so highlight calls
// are exact; there is deliberately no fence parser, so an unclosed terminal
// fence settles the moment the message does.
// ---------------------------------------------------------------------------

import { GROWING_HIGHLIGHT_THROTTLE_MS } from "@/lib/chat-performance/streaming-code-render"
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

  it("highlights both fences but rate-limits re-highlighting of the growing terminal fence", async () => {
    const view = mount(multiFenceStreaming, true)
    await advance(10)
    // One highlight each: the completed first fence (stable, immediate) and
    // the growing terminal fence's leading highlight.
    expect(shikiMock.codeToHtml).toHaveBeenCalledTimes(2)
    expect(shikiMock.codeToHtml).toHaveBeenCalledWith(
      `${firstFence}\n`,
      expect.objectContaining({ lang: "ts" })
    )

    // The growing fence's raw tail — inner backticks included — flows through
    // as literal text.
    const codeBlocks = container?.querySelectorAll(".markdown-code-block")
    expect(codeBlocks?.length).toBe(2)
    expect(
      codeBlocks?.[1]?.querySelector("pre code")?.textContent
    ).toContain("``` inner backticks ```")

    // Deltas inside the throttle window do NOT re-highlight the growing
    // fence; the trailing highlight lands once the interval elapses, with the
    // grown tail. The stable first fence never re-highlights (content
    // unchanged, block memoized).
    const grown = multiFenceStreaming + "\nconst third = 3"
    view.rerender(grown, true)
    expect(shikiMock.codeToHtml).toHaveBeenCalledTimes(2)
    await advance(GROWING_HIGHLIGHT_THROTTLE_MS + 10)
    expect(shikiMock.codeToHtml).toHaveBeenCalledTimes(3)
    expect(shikiMock.codeToHtml).toHaveBeenLastCalledWith(
      expect.stringContaining("const third = 3"),
      expect.objectContaining({ lang: "ts" })
    )
  })

  it("settling the message (finish, Stop, or error) highlights the unclosed terminal fence", async () => {
    const view = mount(multiFenceStreaming, true)
    await advance(10)
    expect(shikiMock.codeToHtml).toHaveBeenCalledTimes(2)

    // Message settles with the fence still unclosed (Stop/error partial
    // output): the terminal block becomes stable and highlights its final
    // tuple immediately — no throttle window involved.
    view.rerender(multiFenceStreaming, false)
    await advance(10)
    expect(shikiMock.codeToHtml).toHaveBeenCalledTimes(3)
    expect(shikiMock.codeToHtml).toHaveBeenLastCalledWith(
      `${growingTail}\n`,
      expect.objectContaining({ lang: "ts" })
    )
    const codeBlocks = container?.querySelectorAll(".markdown-code-block")
    expect(codeBlocks?.[1]?.querySelector("pre.shiki")).not.toBeNull()
  })

  it("a fence becomes non-terminal when prose streams after it and highlights immediately", async () => {
    const unclosed = "```ts\nconst tail = 1"
    const view = mount(unclosed, true)
    await advance(10)
    // Leading highlight of the growing fence.
    expect(shikiMock.codeToHtml).toHaveBeenCalledTimes(1)

    // The fence closes and prose follows: the code block is no longer the
    // terminal block, so it re-highlights its settled content immediately —
    // no throttle window involved.
    view.rerender("```ts\nconst tail = 1\n```\n\nMore prose.", true)
    await advance(10)
    expect(shikiMock.codeToHtml).toHaveBeenCalledTimes(2)
    expect(shikiMock.codeToHtml).toHaveBeenLastCalledWith(
      "const tail = 1\n",
      expect.objectContaining({ lang: "ts" })
    )
  })

  it("streaming growth re-renders only the terminal block subtree", () => {
    // A paragraph-render counter stands in for React Profiler commit
    // attribution: each <p> render is one block-subtree render.
    const renderedParagraphs: string[] = []
    const CountingP = ({
      children,
      node: _,
      ...props
    }: React.ComponentPropsWithoutRef<"p"> & { node?: unknown }) => {
      renderedParagraphs.push("p")
      return <p {...props}>{children}</p>
    }
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    const render = (markdown: string) => {
      act(() => {
        root?.render(
          <Markdown id="confine" streaming components={{ p: CountingP }}>
            {markdown}
          </Markdown>
        )
      })
    }
    const settledPrefix = "First paragraph.\n\nSecond paragraph.\n\n"
    render(settledPrefix + "Growing tail")
    expect(renderedParagraphs.length).toBe(3)

    // Append-only growth touches only the terminal block: the two settled
    // blocks must memo-bail — exactly one paragraph (the terminal block)
    // re-renders per commit.
    renderedParagraphs.length = 0
    render(settledPrefix + "Growing tail with more")
    expect(renderedParagraphs.length).toBe(1)
    renderedParagraphs.length = 0
    render(settledPrefix + "Growing tail with more words")
    expect(renderedParagraphs.length).toBe(1)
  })

  it("renders byte-identically after streaming settles vs a fresh settled mount", async () => {
    const markdown =
      "Some **bold** prose with `inline code`.\n\n```ts\nconst x = 1\n```\n\nTail paragraph."
    const mountInto = () => {
      const host = document.createElement("div")
      document.body.appendChild(host)
      const hostRoot = createRoot(host)
      const render = (streaming: boolean) => {
        act(() => {
          hostRoot.render(
            <Markdown id="parity" streaming={streaming}>
              {markdown}
            </Markdown>
          )
        })
      }
      return { host, hostRoot, render }
    }

    // One tree streams and settles; the control mounts already settled.
    // Their settled DOM must match byte-for-byte.
    const streamed = mountInto()
    streamed.render(true)
    streamed.render(false)
    const control = mountInto()
    control.render(false)
    await advance(GROWING_HIGHLIGHT_THROTTLE_MS + 10)
    // base-ui autogenerates per-instance tooltip ids; they differ between
    // mounts regardless of the streaming path — normalize before comparing.
    const normalize = (html: string) => html.replace(/base-ui-[_a-z0-9]+/g, "base-ui-x")
    expect(normalize(streamed.host.innerHTML)).toBe(
      normalize(control.host.innerHTML)
    )

    act(() => {
      streamed.hostRoot.unmount()
      control.hostRoot.unmount()
    })
    streamed.host.remove()
    control.host.remove()
  })

  it("copy during growth writes the raw code, and hostile code stays inert text", async () => {
    const hostile = '<script>alert("xss")</script>'
    mount("```ts\n" + hostile, true)
    await advance(10) // leading highlight of the growing fence completes

    // Escaped everywhere — never a live element, before or after highlight.
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
