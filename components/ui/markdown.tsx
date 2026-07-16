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
import {
  CODE_BLOCK_ATTRIBUTE,
  remarkCodeBlockAnnotation,
} from "@/lib/markdown/remark-code-block-annotation"
import { remarkLinkPresentation } from "@/lib/markdown/remark-link-presentation"
import { remarkUnwrapLinkParens } from "@/lib/markdown/remark-unwrap-link-parens"
import { cn } from "@/lib/utils"
import { RiCodeLine } from "@remixicon/react"
import { memo, useId, useMemo, useRef } from "react"
import ReactMarkdown, {
  Components,
  defaultUrlTransform,
} from "react-markdown"
import rehypeKatex from "rehype-katex"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"
import remarkMath, { type Options as RemarkMathOptions } from "remark-math"
import remarkParse from "remark-parse"
import { unified } from "unified"
import { ButtonCopy } from "./button-copy"
import { CodeBlock, CodeBlockCode, CodeBlockGroup } from "./code-block"
import { Icon } from "./icon"
import { LinkMarkdown } from "./markdown-link"

export type MarkdownProps = {
  children: string
  id?: string
  className?: string
  components?: Partial<Components>
}

const REMARK_MATH_OPTIONS = {
  singleDollarTextMath: false,
} satisfies RemarkMathOptions

const markdownProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath, REMARK_MATH_OPTIONS)

function parseMarkdownIntoBlocks(markdown: string): string[] {
  const tree = markdownProcessor.parse(markdown)

  return tree.children.flatMap((node) => {
    const start = node.position?.start.offset
    const end = node.position?.end.offset

    if (typeof start !== "number" || typeof end !== "number") {
      return []
    }

    return markdown.slice(start, end)
  })
}

function extractLanguage(className?: string): string {
  if (!className) return "plaintext"
  const match = className.match(/language-(\w+)/)
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

const INITIAL_COMPONENTS: Partial<Components> = {
  code: function CodeComponent({ className, children, node: _, ...props }) {
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

    const language = extractLanguage(className)
    const languageLabel = formatLanguageLabel(language)
    const hasHeader = languageLabel !== null

    // Named code blocks use the reference's sticky 48px language/action row.
    // Plain-text blocks keep only the overlaid copy action, leaving the code
    // surface compact. In both cases the code scrolls inside the rounded box.
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
                <ButtonCopy code={children as string} />
              </div>
            </CodeBlockGroup>
          </div>
        ) : (
          <div className="pointer-events-none absolute end-[5px] top-[3px] z-[2] md:end-[7px]">
            <ButtonCopy code={children as string} />
          </div>
        )}
        <CodeBlockCode
          className={cn(
            "markdown-code-block-code leading-5",
            !hasHeader && "pt-3"
          )}
          code={children as string}
          language={language}
        />
      </CodeBlock>
    )
  },
  a: function AComponent({ href, children, node: _, ...props }) {
    if (!href) return <span {...props}>{children}</span>

    const annotatedPresentation = (
      props as typeof props & Record<string, unknown>
    )["data-link-presentation"]
    const presentation =
      annotatedPresentation === "pill" ? "pill" : "inline"

    return (
      <LinkMarkdown
        href={href}
        presentation={presentation}
        {...props}
      >
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
    components = INITIAL_COMPONENTS,
  }: {
    content: string
    components?: Partial<Components>
  }) {
    return (
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
    )
  },
  function propsAreEqual(prevProps, nextProps) {
    return prevProps.content === nextProps.content
  }
)

MemoizedMarkdownBlock.displayName = "MemoizedMarkdownBlock"

function MarkdownComponent({
  children,
  id,
  className,
  components,
}: MarkdownProps) {
  const generatedId = useId()
  const blockId = id ?? generatedId
  const blocks = useMemo(() => parseMarkdownIntoBlocks(children), [children])
  const mergedComponents = useMemo(
    () =>
      components
        ? { ...INITIAL_COMPONENTS, ...components }
        : INITIAL_COMPONENTS,
    [components]
  )

  return (
    <div className={className}>
      {blocks.map((block, index) => (
        <MemoizedMarkdownBlock
          key={`${blockId}-block-${index}`}
          content={block}
          components={mergedComponents}
        />
      ))}
    </div>
  )
}

const Markdown = memo(MarkdownComponent)
Markdown.displayName = "Markdown"

export { Markdown }
