"use client"

/**
 * @component Markdown
 * @source prompt-kit
 * @upstream https://prompt-kit.com/docs/markdown
 * @customized true
 * @customizations
 *   - Uses `LinkMarkdown` component for custom link handling with previews
 *   - Integrates `ButtonCopy` for one-click code copying in code blocks
 *   - Adds `CodeBlockGroup` header with language label display
 *   - Uses remark parser for block-level splitting (same parser as renderer)
 *   - Per-block memoization via `MemoizedMarkdownBlock` for better performance
 *   - Upstream has basic code/link handling; Not A Wrapper has enhanced UX features
 * @upgradeNotes
 *   - Preserve LinkMarkdown, ButtonCopy, and CodeBlockGroup integrations
 *   - Maintain per-block memoization pattern for performance
 *   - Keep parsing and rendering on the same remark-based pipeline
 *   - Verify INITIAL_COMPONENTS customizations are not overwritten
 */
import { useBrowserLayoutEffect } from "@/app/hooks/use-browser-layout-effect"
import {
  analyzeOpenFence,
  mendGrowingBlockTail,
} from "@/lib/markdown/growing-block-tail"
import {
  advanceMarkdownProjection,
  REMARK_MATH_OPTIONS,
  splitMarkdownSource,
  type MarkdownProjectionResult,
} from "@/lib/markdown/incremental-block-projection"
import {
  CODE_BLOCK_ATTRIBUTE,
  remarkCodeBlockAnnotation,
} from "@/lib/markdown/remark-code-block-annotation"
import { remarkLinkPresentation } from "@/lib/markdown/remark-link-presentation"
import { remarkUnwrapLinkParens } from "@/lib/markdown/remark-unwrap-link-parens"
import {
  observeStreamingDecay,
  settleStreamingDecay,
} from "@/lib/markdown/streaming-decay-overlay"
import { markMarkdownProjectionAnomaly } from "@/lib/observability/chat-performance-client"
import { cn } from "@/lib/utils"
import { RiCodeLine } from "@remixicon/react"
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react"
import ReactMarkdown, { Components, defaultUrlTransform } from "react-markdown"
import rehypeKatex from "rehype-katex"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import { ButtonCopy } from "./button-copy"
import { CodeBlock, CodeBlockCode, CodeBlockGroup } from "./code-block"
import { Icon } from "./icon"
import { LinkMarkdown } from "./markdown-link"

export type MarkdownProps = {
  children: string
  id?: string
  className?: string
  components?: Partial<Components>
  /**
   * True while the message that owns this Markdown is still live
   * (submitted/streaming). Only then can the TERMINAL parsed block be
   * `growing` (plan PR 3 stability rule); settled/aborted/failed messages and
   * every non-terminal block are always `stable`. Threaded from the message
   * row without changing how status is derived.
   */
  streaming?: boolean
}

/**
 * Block stability (plan PR 3): `growing` iff the block is the terminal parsed
 * Markdown block AND the owning message's render state is live. There is
 * deliberately NO fence parsing — every non-terminal block is definitionally
 * complete, and a terminal block settles when the message does or when a
 * later block appears after it.
 */
export type MarkdownBlockStability = "stable" | "growing"

/**
 * Legacy per-block record shape kept for the reference splitter below.
 * Production rendering uses `MarkdownProjectionBlock` from the incremental
 * projection, whose identities are monotonic per lineage (not index-derived)
 * so a finalized block keeps its key across every later append.
 */
export type MarkdownBlockRecord = {
  text: string
  id: string
  startOffset: number
  endOffset: number
}

/**
 * How a code block inside a Markdown block learns its stability without
 * per-block component identities (which would defeat `INITIAL_COMPONENTS`
 * memoization). Default `stable`: code rendered outside a live message —
 * or outside Markdown entirely — highlights normally.
 */
const MarkdownBlockStabilityContext =
  createContext<MarkdownBlockStability>("stable")

/**
 * Legacy full-source splitter, retained as the reference implementation and
 * benchmark baseline and full-parse oracle. Production rendering now flows
 * through `advanceMarkdownProjection`, whose reset/settlement paths run this
 * same authoritative parse.
 */
export function parseMarkdownIntoBlocks(
  markdown: string
): MarkdownBlockRecord[] {
  return splitMarkdownSource(markdown).map((block, index) => ({
    text: block.text,
    id: `block-${index}`,
    startOffset: block.startOffset,
    endOffset: block.endOffset,
  }))
}

function extractLanguage(className?: string): string {
  if (!className) return "plaintext"
  const match = className.match(/(?:^|\s)language-([^\s]+)/)
  return match ? match[1] : "plaintext"
}

function markdownUrlTransform(url: string): string {
  return /^tel:/i.test(url) ? url : defaultUrlTransform(url)
}

const LANGUAGE_LABELS: Record<string, string | null> = {
  plaintext: null,
  text: null,
  js: "JavaScript",
  javascript: "JavaScript",
  ts: "TypeScript",
  typescript: "TypeScript",
  "c++": "C++",
  cpp: "C++",
  "c#": "C#",
  cs: "C#",
  json: "JSON",
  sh: "Bash",
  shell: "Bash",
  bash: "Bash",
  diff: "Diff",
}

function formatLanguageLabel(language: string): string | null {
  return Object.hasOwn(LANGUAGE_LABELS, language)
    ? LANGUAGE_LABELS[language]
    : language
}

function getTableText(table: HTMLTableElement | null): string {
  if (!table) return ""

  return Array.from(table.rows)
    .map((row) =>
      Array.from(row.cells)
        .map((cell) => cell.innerText.trim())
        .join("\t")
    )
    .join("\n")
}

/**
 * One rendering shell for both the authoritative Markdown pipeline and the
 * direct growing-fence fast path. Keeping language parsing, labels, copy, and
 * code presentation here prevents the two paths from drifting as code-block
 * behavior evolves.
 */
function RenderedCodeBlock({
  className,
  code,
  growing,
}: {
  className?: string
  code: string
  growing: boolean
}) {
  const language = extractLanguage(className)
  const languageLabel = formatLanguageLabel(language)
  const hasHeader = languageLabel !== null

  return (
    <CodeBlock className={cn("markdown-code-block", className)}>
      {hasHeader ? (
        <div className="sticky top-[var(--sticky-padding-top,0px)] z-[2] select-none">
          <CodeBlockGroup className="flex h-12 w-full items-center justify-between bg-[var(--code-block-surface)] py-1.5 ps-4 pe-1.5 font-sans md:ps-5">
            <div className="flex max-w-[75%] min-w-0 cursor-default items-center gap-2 text-sm font-medium">
              <Icon icon={RiCodeLine} slotSize={20} />
              {languageLabel}
            </div>
            <div className="flex flex-row items-center gap-0.5">
              <ButtonCopy code={code} />
            </div>
          </CodeBlockGroup>
        </div>
      ) : (
        <div className="pointer-events-none absolute end-[5px] top-[3px] z-[2] md:end-[7px]">
          <ButtonCopy code={code} />
        </div>
      )}
      <CodeBlockCode
        className={cn(
          "markdown-code-block-code leading-5",
          !hasHeader && "pt-3"
        )}
        code={code}
        language={language}
        growing={growing}
      />
    </CodeBlock>
  )
}

const INITIAL_COMPONENTS: Partial<Components> = {
  code: function CodeComponent({ className, children, node: _, ...props }) {
    // Read before the inline-code early return (hooks must be unconditional).
    // Default "stable" outside a live message's terminal block.
    const stability = useContext(MarkdownBlockStabilityContext)
    const isBlock =
      (props as typeof props & Record<string, unknown>)[
        CODE_BLOCK_ATTRIBUTE
      ] === "true"

    if (!isBlock) {
      // Captured inline-code metrics: 0.875em /
      // 500, 4px radius, 0.15rem × 0.3rem padding, and the reference's
      // dedicated inline-code surface.
      return (
        <code
          className={cn(
            "rounded-[0.25rem] bg-[var(--inline-code-surface)] px-[0.3rem] py-[0.15rem] text-[0.875em] font-medium before:content-none after:content-none",
            className
          )}
          {...props}
        >
          {children}
        </code>
      )
    }

    // Named code blocks use the reference's sticky 48px language/action row.
    // Plain-text blocks keep only the overlaid copy action, leaving the code
    // surface compact. In both cases the code scrolls inside the rounded box.
    return (
      <RenderedCodeBlock
        className={className}
        code={children as string}
        growing={stability === "growing"}
      />
    )
  },
  a: function AComponent({ href, children, node: _, ...props }) {
    if (!href) return <span {...props}>{children}</span>

    const annotatedPresentation = (
      props as typeof props & Record<string, unknown>
    )["data-link-presentation"]
    const presentation = annotatedPresentation === "pill" ? "pill" : "inline"

    return (
      <LinkMarkdown href={href} presentation={presentation} {...props}>
        {children}
      </LinkMarkdown>
    )
  },
  pre: function PreComponent({ children }) {
    return <>{children}</>
  },
  // Reference table architecture: the container breaks out of the centered
  // content column to the full thread width and owns the horizontal scroll;
  // the wrapper re-indents the table to the content edge (globals.css
  // `.markdown-table-container` / `.markdown-table-wrapper`, their formula).
  table: function TableComponent({ children, node: _, ...props }) {
    const tableRef = useRef<HTMLTableElement>(null)

    return (
      <div className="markdown-table-container">
        <div className="markdown-table-wrapper group/markdown-table relative flex w-fit flex-col-reverse">
          <table
            ref={tableRef}
            className="w-fit min-w-[var(--thread-content-width)]"
            {...props}
          >
            {children}
          </table>
          <div className="absolute end-0 top-0 flex h-[33px] items-center">
            <ButtonCopy
              code={() => getTableText(tableRef.current)}
              label="Copy table"
              variant="table"
            />
          </div>
        </div>
      </div>
    )
  },
}

const MemoizedMarkdownBlock = memo(
  function MarkdownBlock({
    content,
    stability,
    components = INITIAL_COMPONENTS,
  }: {
    content: string
    stability: MarkdownBlockStability
    components?: Partial<Components>
  }) {
    return (
      <MarkdownBlockStabilityContext.Provider value={stability}>
        <ReactMarkdown
          remarkPlugins={[
            remarkGfm,
            remarkBreaks,
            [remarkMath, REMARK_MATH_OPTIONS],
            remarkCodeBlockAnnotation,
            remarkLinkPresentation,
            remarkUnwrapLinkParens,
          ]}
          rehypePlugins={[rehypeKatex]}
          urlTransform={markdownUrlTransform}
          components={components}
        >
          {content}
        </ReactMarkdown>
      </MarkdownBlockStabilityContext.Provider>
    )
  },
  function propsAreEqual(prevProps, nextProps) {
    // Stability participates so a block re-renders exactly when it settles
    // (growing → stable) — the moment its code block must highlight.
    return (
      prevProps.content === nextProps.content &&
      prevProps.stability === nextProps.stability
    )
  }
)

MemoizedMarkdownBlock.displayName = "MemoizedMarkdownBlock"

/**
 * Direct render for a growing OPEN fenced code block (investigation
 * 2026-07-28, fix 1): while the fence is open, every appended line is inert
 * interior text, so running the full Markdown pipeline per update just to
 * reach the same `CodeBlock` is pure O(block) overhead. This component
 * mirrors the block branch of `INITIAL_COMPONENTS.code` exactly — same
 * wrappers, classes, header rule, and copy affordance — so the settle
 * re-render through the real pipeline lands on identical DOM. Only used when
 * no consumer `components` override is present.
 */
const GrowingFenceBlock = memo(
  function GrowingFenceBlockComponent({ text }: { text: string }) {
    const fence = analyzeOpenFence(text)
    // Caller guarantees an open fence; a closed/absent fence renders nothing
    // for one frame and the normal pipeline takes over on the next update.
    if (!fence) return null
    const value = text.slice(fence.interiorStart).replace(/\n$/, "")
    // Parity with mdast-util-to-hast: the code text child is value + "\n".
    const code = `${value}\n`
    return (
      <RenderedCodeBlock
        className={
          fence.language === "" ? undefined : `language-${fence.language}`
        }
        code={code}
        growing
      />
    )
  },
  (prev, next) => prev.text === next.text
)

GrowingFenceBlock.displayName = "GrowingFenceBlock"

function MarkdownComponent({
  children,
  id,
  className,
  components,
  streaming = false,
}: MarkdownProps) {
  const generatedId = useId()
  const blockId = id ?? generatedId

  // Incremental block projection (ADR-0016): ordinary append-only
  // growth re-parses only the mutable tail; identity change, non-prefix
  // corrections, and parser-version drift reset; `streaming: false` runs the
  // authoritative settlement parse. The transition advances through React
  // state via the render-phase adjustment pattern — never a ref — so an
  // abandoned concurrent render can neither consume a one-shot transition
  // nor leak a half-advanced projection into a later commit:
  // `advanceMarkdownProjection` is pure and deterministic, and the setState
  // below re-runs the render with the adjusted state before committing.
  const [projection, setProjection] = useState<MarkdownProjectionResult>(() =>
    advanceMarkdownProjection({
      previous: null,
      source: children,
      streaming,
      identity: blockId,
    })
  )
  let current = projection
  if (
    current.state.source !== children ||
    current.state.identity !== blockId ||
    current.state.settled === streaming
  ) {
    current = advanceMarkdownProjection({
      previous: projection.state,
      source: children,
      streaming,
      identity: blockId,
    })
    setProjection(current)
  }

  // Anomaly marks (content-free, rare): resets after the initial parse,
  // incremental fallbacks, and settlement mismatches. Committed-state effect
  // so abandoned renders never emit.
  const lastMarkedRef = useRef<MarkdownProjectionResult | null>(null)
  useEffect(() => {
    if (lastMarkedRef.current === projection) return
    lastMarkedRef.current = projection
    markMarkdownProjectionAnomaly(projection)
  }, [projection])

  const mergedComponents = useMemo(
    () =>
      components
        ? { ...INITIAL_COMPONENTS, ...components }
        : INITIAL_COMPONENTS,
    [components]
  )

  // Streaming color-decay overlay (ADR-0016 amendment 2026-08-11): after
  // every streamed commit the overlay diffs this container's rendered text
  // and paints appended cohorts via CSS Custom Highlights — paint only, no
  // DOM ownership. Layout effect on purpose: a passive effect runs after the
  // browser paints, so appended text would flash one frame at full color and
  // then dim to bucket 0 — worst under CPU load, exactly the condition the
  // overlay exists to smooth. Deliberately no dependency array: the observe
  // must run per committed text update, and it is idempotent when nothing
  // changed.
  const containerRef = useRef<HTMLDivElement>(null)
  useBrowserLayoutEffect(() => {
    if (!streaming || !containerRef.current) return
    observeStreamingDecay(containerRef.current)
  })
  // Settlement, streaming→false, and unmount all clear this container's
  // cohorts before the settled content paints, so settled paint is plain
  // canonical color from its first frame.
  useBrowserLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    if (!streaming) settleStreamingDecay(container)
    return () => settleStreamingDecay(container)
  }, [streaming])

  const blocks = current.state.blocks
  return (
    <div className={className} ref={containerRef}>
      {blocks.map((block, index) => {
        const growing = streaming && index === blocks.length - 1
        // A growing open fence renders directly when no consumer override is
        // present. Lists intentionally stay on the canonical Markdown path:
        // splitting one semantic list into sibling roots changes accessibility
        // and selection-copy semantics even when sighted numbering is patched
        // with `start` attributes.
        if (growing && !components && block.nodeType === "code") {
          const fence = analyzeOpenFence(block.text)
          if (fence) {
            return (
              <GrowingFenceBlock
                key={`${blockId}-${block.id}`}
                text={block.text}
              />
            )
          }
        }
        // Render-boundary mend (ADR-0016 amendment 2026-08-11): the growing
        // terminal block completes provably-incomplete trailing inline
        // constructs and gates unproven table candidates, closing the
        // measured construct-wide raw-delimiter windows (`**Apache Fl`,
        // `](url…`, `|` header rows). Residual exposure is one token gap: a
        // chunk ending exactly on a bare opener (`foo **`) renders it raw
        // until the next chunk, because only an inline parse can tell an
        // unmatched opener from a legitimate literal. Canonical text is
        // untouched — stability flips to "stable" at settlement and this
        // branch re-renders exact canonical bytes. `code` blocks are
        // excluded: open-fence interiors are inert text the mend must not
        // rewrite, and the fence fast path above already renders them.
        const content =
          growing && block.nodeType !== "code"
            ? mendGrowingBlockTail(block.text)
            : block.text
        return (
          <MemoizedMarkdownBlock
            key={`${blockId}-${block.id}`}
            content={content}
            stability={growing ? "growing" : "stable"}
            components={mergedComponents}
          />
        )
      })}
    </div>
  )
}

const Markdown = memo(MarkdownComponent)
Markdown.displayName = "Markdown"

export { Markdown }
