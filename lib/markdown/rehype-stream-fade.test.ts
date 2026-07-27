/**
 * Stream word-fade runtime + plugin tests (plan §6.2 / commit 2). The risky
 * logic: birth chaining and the cap, write-once frozen styles (the
 * animation-restart hazard), noteCommit idempotence under double render,
 * skip-list placement, and prune.
 */
import type { Element, Root, Text } from "hast"
import { describe, expect, it } from "vitest"
import { createStreamFadeRuntime, rehypeStreamFade } from "./rehype-stream-fade"

function paragraph(text: string): Element {
  return {
    type: "element",
    tagName: "p",
    properties: {},
    children: [{ type: "text", value: text }],
  }
}

function root(...children: Element[]): Root {
  return { type: "root", children }
}

function spansOf(node: Element): Element[] {
  const spans: Element[] = []
  const walk = (element: Element) => {
    for (const child of element.children) {
      if (child.type !== "element") continue
      if (child.tagName === "span") spans.push(child)
      walk(child)
    }
  }
  walk(node)
  return spans
}

describe("rehypeStreamFade placement", () => {
  it("wraps words, keeps whitespace as plain text, and preserves the text", () => {
    const runtime = createStreamFadeRuntime()
    const tree = root(paragraph("Hello brave world"))
    rehypeStreamFade({ runtime, blockKey: "block-0" })(tree)

    const p = tree.children[0] as Element
    const spans = spansOf(p)
    expect(spans).toHaveLength(3)
    expect(
      spans.every((span) =>
        (span.properties?.className as string[]).includes("stream-word")
      )
    ).toBe(true)
    // Whitespace stays as sibling text nodes, not inside spans.
    const textChildren = p.children.filter(
      (child): child is Text => child.type === "text"
    )
    expect(textChildren.map((child) => child.value)).toEqual([" ", " "])
    const flattened = p.children
      .map((child) =>
        child.type === "text"
          ? child.value
          : ((child as Element).children[0] as Text).value
      )
      .join("")
    expect(flattened).toBe("Hello brave world")
  })

  it("never descends into pre/code/table/svg or KaTeX subtrees", () => {
    const runtime = createStreamFadeRuntime()
    const pre: Element = {
      type: "element",
      tagName: "pre",
      properties: {},
      children: [
        {
          type: "element",
          tagName: "code",
          properties: {},
          children: [{ type: "text", value: "const x = 1" }],
        },
      ],
    }
    const table: Element = {
      type: "element",
      tagName: "table",
      properties: {},
      children: [paragraph("cell words here")],
    }
    const katex: Element = {
      type: "element",
      tagName: "span",
      properties: { className: ["katex"] },
      children: [{ type: "text", value: "x^2" }],
    }
    const tree = root(paragraph("Outside words"), pre, table, katex)
    rehypeStreamFade({ runtime, blockKey: "block-0" })(tree)

    expect(spansOf(tree.children[0] as Element)).toHaveLength(2)
    expect(spansOf(pre)).toHaveLength(0)
    expect(spansOf(table)).toHaveLength(0)
    expect(spansOf(katex)).toHaveLength(0)
  })
})

describe("rehypeStreamFade span bound", () => {
  it("unwraps elapsed words: spans exist only while a fade is in flight", () => {
    const runtime = createStreamFadeRuntime()
    const tree = root(paragraph("old words already elapsed plus fresh"))
    // Six words: five born long ago (pre-walked at an old timestamp), the
    // sixth new "now" — the transform must keep only in-flight words
    // wrapped, so span count tracks recent births, not block length.
    // Handcrafted nodes carry no source position, so keys fall back to
    // document-order ordinals (-1, -2, …) — pre-seed those.
    const oldMs = performance.now() - 5000
    runtime.noteCommit("block-0", 5, oldMs)
    for (let ordinal = 1; ordinal <= 5; ordinal++) {
      runtime.styleFor("block-0", -ordinal, oldMs)
    }
    rehypeStreamFade({ runtime, blockKey: "block-0" })(tree)
    const p = tree.children[0] as Element
    expect(spansOf(p)).toHaveLength(1)
    const flattened = p.children
      .map((child) =>
        child.type === "text"
          ? child.value
          : ((child as Element).children[0] as Text).value
      )
      .join("")
    expect(flattened).toBe("old words already elapsed plus fresh")
  })

  it("keeps a word's fade phase across a Markdown restructure (offset keys)", () => {
    const runtime = createStreamFadeRuntime()
    // `**hello` while the emphasis is still open: one literal text node at
    // source offset 0.
    const openTree = root({
      type: "element",
      tagName: "p",
      properties: {},
      children: [
        {
          type: "text",
          value: "**hello",
          position: {
            start: { line: 1, column: 1, offset: 0 },
            end: { line: 1, column: 8, offset: 7 },
          },
        },
      ],
    })
    rehypeStreamFade({ runtime, blockKey: "block-0" })(openTree)
    const helloSpan = spansOf(openTree.children[0] as Element).find(
      (span) => (span.children[0] as Text).value === "hello"
    )
    const originalDelay = helloSpan?.properties?.style

    // The closer arrives: "hello" is now inside <strong>, but its SOURCE
    // offset is unchanged (2) — it must resume its own fade, not restart
    // from a renumbered neighbor's phase.
    const closedTree = root({
      type: "element",
      tagName: "p",
      properties: {},
      children: [
        {
          type: "element",
          tagName: "strong",
          properties: {},
          children: [
            {
              type: "text",
              value: "hello",
              position: {
                start: { line: 1, column: 3, offset: 2 },
                end: { line: 1, column: 8, offset: 7 },
              },
            },
          ],
        },
        {
          type: "text",
          value: " world",
          position: {
            start: { line: 1, column: 10, offset: 9 },
            end: { line: 1, column: 16, offset: 15 },
          },
        },
      ],
    })
    rehypeStreamFade({ runtime, blockKey: "block-0" })(closedTree)
    const spans = spansOf(closedTree.children[0] as Element)
    const helloAfter = spans.find(
      (span) => (span.children[0] as Text).value === "hello"
    )
    expect(helloAfter?.properties?.style).toBe(originalDelay)
    // And the appended word still fades even though the RENDERED count
    // (2) sits below the open-syntax high-water mark (3): identity is the
    // offset, not the ordinal.
    const worldSpan = spans.find(
      (span) => (span.children[0] as Text).value === "world"
    )
    expect(worldSpan).toBeTruthy()
    expect(
      (worldSpan?.properties?.className as string[]).includes(
        "stream-word-revealed"
      )
    ).toBe(false)
  })
})

describe("birth timeline runtime", () => {
  it("freezes in-flight styles, then upgrades to revealed once the fade elapses", () => {
    const runtime = createStreamFadeRuntime()
    runtime.noteCommit("block-0", 2, 1000)
    const first = runtime.styleFor("block-0", 1, 1050)
    expect(first.style?.animationDelay).toBeDefined()
    // While the fade is in flight the object is frozen — re-reads must not
    // rewrite animation-delay on a live node.
    expect(runtime.styleFor("block-0", 1, 1100)).toBe(first)
    // Once elapsed, the entry upgrades: a finished animation sits at
    // opacity 1 either way, and elapsed words can unwrap / remount without
    // replaying a stale fade phase.
    const late = runtime.styleFor("block-0", 1, 1400)
    expect(late.className).toBe("stream-word stream-word-revealed")
    expect(late.style).toBeUndefined()
    expect(runtime.styleFor("block-0", 1, 2000)).toBe(late)
  })

  it("treats a shrunk rendered word count as a no-op, never a reset", () => {
    const runtime = createStreamFadeRuntime()
    runtime.noteCommit("block-0", 4, 1000)
    const frozen = runtime.styleFor("block-0", 1, 1010)
    // Append-only Markdown growth can shrink the RENDERED word count when
    // emphasis/link syntax closes; births and frozen styles must survive
    // or every span's delay would rewrite and the whole block would
    // re-fade.
    runtime.noteCommit("block-0", 3, 1050)
    expect(runtime.styleFor("block-0", 1, 1060)).toBe(frozen)
    // Regrowth past the high-water mark chains new births normally.
    runtime.noteCommit("block-0", 6, 1100)
    expect(runtime.styleFor("block-0", 5, 1100).className).toBe("stream-word")
  })

  it("emits negative delays for mid-fade words and no style once elapsed", () => {
    const runtime = createStreamFadeRuntime()
    runtime.noteCommit("block-0", 1, 1000)
    const midFade = runtime.styleFor("block-0", 0, 1100)
    expect(midFade.className).toBe("stream-word")
    expect(midFade.style?.animationDelay).toBe("-100ms")

    const late = createStreamFadeRuntime()
    late.noteCommit("block-0", 1, 1000)
    const elapsed = late.styleFor("block-0", 0, 1300)
    expect(elapsed.className).toBe("stream-word stream-word-revealed")
    expect(elapsed.style).toBeUndefined()
  })

  it("noteCommit with an unchanged count is a no-op (StrictMode double render)", () => {
    const runtime = createStreamFadeRuntime()
    runtime.noteCommit("block-0", 2, 0)
    runtime.styleFor("block-0", 0, 0)
    runtime.styleFor("block-0", 1, 0)
    // The duplicate at t=50 must not move the commit clock…
    runtime.noteCommit("block-0", 2, 50)
    runtime.noteCommit("block-0", 4, 100)
    // …so the observed gap is 100 (pace 50), not 50 (pace 25): word 3 is
    // born pace after word 2 → 50ms in the future at t=100. (Births assign
    // lazily in walk order.)
    runtime.styleFor("block-0", 2, 100)
    expect(runtime.styleFor("block-0", 3, 100).style?.animationDelay).toBe(
      "50ms"
    )
  })

  it("staggers by observed gap ÷ new words, clamped to [8, 80]ms", () => {
    const runtime = createStreamFadeRuntime()
    runtime.noteCommit("block-0", 1, 0)
    runtime.styleFor("block-0", 0, 0)
    runtime.noteCommit("block-0", 3, 1000) // gap 1000 / 2 words → clamp 80
    runtime.styleFor("block-0", 1, 1000)
    expect(runtime.styleFor("block-0", 2, 1000).style?.animationDelay).toBe(
      "80ms"
    )
  })

  it("caps births at now + gap + fade so a burst cannot schedule far-future fades", () => {
    const runtime = createStreamFadeRuntime()
    runtime.noteCommit("block-0", 100, 1000) // first commit: gap 0, cap 1180
    for (let i = 0; i < 99; i++) runtime.styleFor("block-0", i, 1000)
    expect(runtime.styleFor("block-0", 99, 1000).style?.animationDelay).toBe(
      "180ms"
    )
  })

  it("snap back-dates the next commit's births so snapped text queues no fades", () => {
    const runtime = createStreamFadeRuntime()
    runtime.snap()
    runtime.noteCommit("block-0", 3, 1000)
    expect(runtime.styleFor("block-0", 2, 1000).className).toBe(
      "stream-word stream-word-revealed"
    )
    // The snap is one-shot: the following commit fades normally.
    runtime.noteCommit("block-0", 4, 1050)
    expect(runtime.styleFor("block-0", 3, 1050).className).toBe("stream-word")
  })

  it("prune drops every block except the live one", () => {
    const runtime = createStreamFadeRuntime()
    runtime.noteCommit("block-0", 1, 0)
    runtime.noteCommit("block-1", 1, 0)
    const before = runtime.styleFor("block-0", 0, 10)
    runtime.prune("block-1")
    // block-0's cache and births are gone: a re-read recomputes fresh with
    // the unknown-word fallback (born now), not the old frozen entry.
    const after = runtime.styleFor("block-0", 0, 500)
    expect(after).not.toBe(before)
    expect(after.style?.animationDelay).toBe("0ms")
  })
})
