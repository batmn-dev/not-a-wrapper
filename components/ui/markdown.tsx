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
import remarkMath from "remark-math"
import remarkParse from "remark-parse"
import { unified } from "unified"
import { ButtonCopy } from "../common/button-copy"
import {
  CodeBlock,
  CodeBlockCode,
  CodeBlockGroup,
} from "./code-block"
import { LinkMarkdown } from "./markdown-link"

export type MarkdownProps = {
  children: string
  id?: string
  className?: string
  components?: Partial<Components>
}

const markdownProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)

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
      return (
        <span
          className={cn(
            "bg-primary-foreground rounded-sm px-1 font-mono text-sm",
            className
          )}
          {...props}
        >
          {children}
        </span>
      )
    }

    const language = extractLanguage(className)

    return (
      <CodeBlock className={className}>
        <CodeBlockGroup className="flex h-9 items-center justify-between px-4">
          <div className="text-muted-foreground py-1 pr-2 font-mono text-xs">
            {language}
          </div>
        </CodeBlockGroup>
        <div className="sticky top-16 lg:top-0">
          <div className="absolute right-0 bottom-0 flex h-9 items-center pr-1.5">
            <ButtonCopy code={children as string} />
          </div>
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
        remarkPlugins={[remarkGfm, remarkBreaks, remarkMath, remarkUnwrapLinkParens]}
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
  const blocks = useMemo(
    () => parseMarkdownIntoBlocks(children),
    [children]
  )
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
