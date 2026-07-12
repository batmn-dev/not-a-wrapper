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
import { remarkUnwrapLinkParens } from "@/lib/markdown/remark-unwrap-link-parens"
import { cn } from "@/lib/utils"
import { memo, useId, useMemo } from "react"
import ReactMarkdown, { Components } from "react-markdown"
import rehypeKatex from "rehype-katex"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"
import remarkMath, { type Options as RemarkMathOptions } from "remark-math"
import remarkParse from "remark-parse"
import { unified } from "unified"
import { ButtonCopy } from "../common/button-copy"
import { CodeBlock, CodeBlockCode, CodeBlockGroup } from "./code-block"
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

const INITIAL_COMPONENTS: Partial<Components> = {
  code: function CodeComponent({ className, children, ...props }) {
    const isInline =
      !props.node?.position?.start.line ||
      props.node?.position?.start.line === props.node?.position?.end.line

    if (isInline) {
      // Captured inline-code metrics: 0.875em /
      // 500, 4px radius, 0.15rem × 0.3rem padding; their gray-100/gray-700
      // surface maps onto our secondary token.
      return (
        <span
          className={cn(
            "bg-secondary rounded-[0.25rem] px-[0.3rem] py-[0.15rem] font-mono text-[0.875em] font-medium",
            className
          )}
          {...props}
        >
          {children}
        </span>
      )
    }

    const language = extractLanguage(className)

    // Code-block header: one sticky 48px row (language label left,
    // actions right) that rides the scroll under the app header, with a 1px
    // divider that sticks along; the code scrolls beneath both, clipped by
    // the rounded container.
    return (
      <CodeBlock className={className}>
        <div className="sticky top-[var(--sticky-padding-top,0px)] z-[2] select-none">
          <CodeBlockGroup className="bg-card flex h-12 w-full items-center justify-between py-1.5 ps-4 pe-1.5 font-sans md:ps-5">
            <div className="flex max-w-[75%] min-w-0 cursor-default items-center text-sm font-medium">
              {language}
            </div>
            <div className="flex flex-row items-center gap-0.5">
              <ButtonCopy code={children as string} />
            </div>
          </CodeBlockGroup>
          <div className="bg-border h-px" />
        </div>
        <CodeBlockCode code={children as string} language={language} />
      </CodeBlock>
    )
  },
  a: function AComponent({ href, children, ...props }) {
    if (!href) return <span {...props}>{children}</span>

    return (
      <LinkMarkdown href={href} {...props}>
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
  table: function TableComponent({ children, ...props }) {
    return (
      <div className="markdown-table-container">
        <div className="markdown-table-wrapper flex w-fit flex-col-reverse">
          <table
            className="w-fit min-w-[var(--thread-content-width)]"
            {...props}
          >
            {children}
          </table>
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
          remarkUnwrapLinkParens,
        ]}
        rehypePlugins={[rehypeKatex]}
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
