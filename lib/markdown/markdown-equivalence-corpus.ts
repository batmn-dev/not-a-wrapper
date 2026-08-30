/**
 * Equivalence corpus for the ADR-0016 incremental Markdown projection.
 *
 * Every fixture is a deterministic, content-safe Markdown source chosen
 * because its grammar can RECLASSIFY nearby source as it streams in —
 * paragraph continuation, setext underlines, late table delimiter rows, list
 * merges, fence closers, late emphasis/link closers, reference definitions —
 * or because its bytes stress chunk boundaries (CRLF, surrogate pairs,
 * combining marks). The test harness streams each fixture prefix-by-prefix
 * and at seeded random chunk boundaries, asserting after EVERY advance that
 * the incremental projection is block-for-block identical to the
 * authoritative full parse of the same prefix.
 *
 * Fixtures marked `charByChar` are small enough to stream at every single
 * character position in CI; the rest rely on the seeded chunkings plus
 * every-blank-line boundaries.
 */

export type EquivalenceFixture = {
  name: string
  source: string
  /** Stream at every character offset (keep sources ≤ ~600 chars). */
  charByChar?: boolean
}

const paragraphContinuation = `First paragraph starts here
and lazily continues on a second line
and a third.

Second paragraph after a blank line.`

const headings = `# ATX heading

Body paragraph.

Setext heading candidate
========================

More text.

Another candidate
-----------------

Trailing paragraph.`

const setextTrap = `A paragraph that will become a setext heading
=============

- then a list
- with two items`

const lists = `1. ordered one
2. ordered two
   1. nested ordered
3. ordered three

- unordered
- with items
  - nested
    - deeper

* [ ] task open
* [x] task done`

const lazyListContinuation = `- item one
continues lazily on the next line
- item two

paragraph after the list

- second list

  loose continuation paragraph inside item`

const blockquotes = `> quoted line one
> quoted line two
lazy quote continuation

regular paragraph

> new quote
>
> > nested quote`

const tableLateDelimiter = `Intro paragraph.

| first | second | third |
| --- | :---: | ---: |
| a | b | c |
| d | e | f |

After-table paragraph.`

const tableBecomingParagraph = `| looks like | a table header |
but this line breaks the table interpretation

real paragraph`

const fences = `Prose before.

\`\`\`ts
const one = 1
const two = "\`\`\` not a closer inside? no — flush left matters"
\`\`\`

Between fences.

\`\`\`\`md
inner \`\`\`
triple fence stays literal
\`\`\`\`

~~~python
tilde_fence = True
~~~

After.`

const unclosedFence = `Paragraph.

\`\`\`js
const stillOpen = true
// the fence never closes; everything below is code
- not a list
# not a heading`

const indentedCode = `Paragraph.

    indented code line one
    indented code line two

After indented code.

- list item

      indented code INSIDE the list item

Outside again.`

const inlineBackticks = `Inline \`code\` and double \`\`tick \` inside\`\` spans.

A paragraph with a dangling \`unclosed backtick that stays literal.

\`\`\`
fence after inline backticks
\`\`\``

const emphasisLateClosers = `Emphasis *opens here and only
closes on the next line* with **strong
spanning** and ~~strikethrough
split~~ across lines.

Dangling *asterisk stays literal.`

const links = `A [link](https://example.com/a) and an autolink https://example.com/auto
plus <https://example.com/bracket> and a [reference][ref] use.

[ref]: https://example.com/ref "Reference title"

A [collapsed][] reference too.

[collapsed]: https://example.com/collapsed`

const referenceDefinitionLate = `Uses [early][late-def] before its definition exists.

Middle paragraph.

[late-def]: https://example.com/late`

const math = `Inline math stays text with single dollars: $x + 1$.

$$
\\sum_{i=0}^{n} i^2 = \\frac{n(n+1)(2n+1)}{6}
$$

Paragraph between math blocks.

$$e^{i\\pi} + 1 = 0$$`

const htmlBlocks = `Paragraph.

<div class="note">
raw html block content
</div>

After html.

<span>inline html paragraph</span> trailing text.`

const thematicBreaks = `Before the break.

---

After a dash break.

***

- list after star break

___

Done.`

const blankLineShapes = `Para one.


Two blank lines above.

\t
Tab-blank line above this paragraph.

Space-blank line above this one.`

const crlf =
  "CRLF paragraph one line one\r\ncontinued line.\r\n\r\n" +
  "CRLF second paragraph.\r\n\r\n" +
  "| a | b |\r\n| --- | --- |\r\n| 1 | 2 |\r\n\r\n" +
  "```ts\r\nconst crlf = true\r\n```\r\n\r\nFinal CRLF paragraph.\r\n"

const unicode = `Emoji pairs 👩‍👩‍👧‍👦 and surrogate pairs 𝔘𝔫𝔦𝔠𝔬𝔡𝔢 inside prose.

Combining marks: é à ñ — clusters must not break blocks.

한국어 문단과 日本語の段落が blank line 규칙을 따릅니다.

> 인용문 with mixed 文字`

const customTransformShapes = `A code fence the annotation transform marks as a block:

\`\`\`ts
export const annotated = true
\`\`\`

A bare link in parens (https://example.com/unwrap) for the paren-unwrap
transform, plus a [pill link](https://example.com/pill) for presentation.`

const footnotes = `Text with a footnote reference[^note] in the first paragraph.

[^note]: The footnote definition arrives later
    with an indented continuation line.

Closing paragraph.`

const headingAfterParagraphNoBlank = `Paragraph immediately followed by
# heading without a blank line

- list right after
# another heading`

const shortProse = `Short prose answer that stays a single growing paragraph, with *light* emphasis and a trailing clause that arrives token by token.`

// An indented code block leaves "may continue" state that flips how the NEXT
// block parses: after it, `2. two` + a setext underline parse as heading +
// paragraph, while the identical text parses as ONE list standalone. The
// variants cover tab/space indentation, the `1.` control, and deeper documents.

const indentedCodeOrderedSetextTab = "\tindented\n\n2. two\n===\n=="

const indentedCodeOrderedSetextSpaces = `    indented code line

2. two
===
==`

const indentedCodeOrderedListControl = `\tindented

1. one
===
==`

const indentedCodeCarrierDeep = `First paragraph long settled.

Second paragraph settled.

    indented code block

2. two
===
== and a growing tail`

const footnoteIndentedContinuation = `Intro paragraph.

[^note]: definition first line

    indented continuation that belongs to the footnote

    second continuation chunk

After the footnote.`

export const EQUIVALENCE_FIXTURES: EquivalenceFixture[] = [
  { name: "paragraph-continuation", source: paragraphContinuation, charByChar: true },
  { name: "headings-atx-setext", source: headings, charByChar: true },
  { name: "setext-trap", source: setextTrap, charByChar: true },
  { name: "lists-nested-task", source: lists, charByChar: true },
  { name: "lazy-list-continuation", source: lazyListContinuation, charByChar: true },
  { name: "blockquotes", source: blockquotes, charByChar: true },
  { name: "table-late-delimiter", source: tableLateDelimiter, charByChar: true },
  { name: "table-becoming-paragraph", source: tableBecomingParagraph, charByChar: true },
  { name: "fences-backtick-tilde", source: fences, charByChar: true },
  { name: "unclosed-fence", source: unclosedFence, charByChar: true },
  { name: "indented-code", source: indentedCode, charByChar: true },
  { name: "inline-backticks", source: inlineBackticks, charByChar: true },
  { name: "emphasis-late-closers", source: emphasisLateClosers, charByChar: true },
  { name: "links-and-references", source: links, charByChar: true },
  { name: "reference-definition-late", source: referenceDefinitionLate, charByChar: true },
  { name: "math-blocks", source: math, charByChar: true },
  { name: "html-blocks", source: htmlBlocks, charByChar: true },
  { name: "thematic-breaks", source: thematicBreaks, charByChar: true },
  { name: "blank-line-shapes", source: blankLineShapes, charByChar: true },
  { name: "crlf-endings", source: crlf, charByChar: true },
  { name: "unicode-clusters", source: unicode, charByChar: true },
  { name: "custom-transform-shapes", source: customTransformShapes, charByChar: true },
  { name: "footnotes", source: footnotes, charByChar: true },
  { name: "heading-no-blank-line", source: headingAfterParagraphNoBlank, charByChar: true },
  { name: "short-prose", source: shortProse, charByChar: true },
  { name: "indented-code-ordered-setext-tab", source: indentedCodeOrderedSetextTab, charByChar: true },
  { name: "indented-code-ordered-setext-spaces", source: indentedCodeOrderedSetextSpaces, charByChar: true },
  { name: "indented-code-ordered-list-control", source: indentedCodeOrderedListControl, charByChar: true },
  { name: "indented-code-carrier-deep", source: indentedCodeCarrierDeep, charByChar: true },
  { name: "footnote-indented-continuation", source: footnoteIndentedContinuation, charByChar: true },
]

/** mulberry32 — matches the benchmark fixtures' deterministic PRNG. */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Deterministic random prefix ladder: strictly increasing offsets from 1 to
 * source.length, with chunk sizes drawn in [1, maxChunk]. Always ends at the
 * full source. Print the seed on failure to reproduce.
 */
export function seededPrefixOffsets(
  sourceLength: number,
  seed: number,
  maxChunk = 24
): number[] {
  const random = createSeededRandom(seed)
  const offsets: number[] = []
  let offset = 0
  while (offset < sourceLength) {
    offset = Math.min(
      sourceLength,
      offset + 1 + Math.floor(random() * maxChunk)
    )
    offsets.push(offset)
  }
  return offsets
}

/** Every character offset — exhaustive streaming for small fixtures. */
export function everyPrefixOffsets(sourceLength: number): number[] {
  const offsets: number[] = []
  for (let offset = 1; offset <= sourceLength; offset++) offsets.push(offset)
  return offsets
}
