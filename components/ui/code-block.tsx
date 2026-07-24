/**
 * @component CodeBlock
 * @source prompt-kit
 * @upstream https://prompt-kit.com/docs/code-block
 * @customized true
 * @customizations
 *   - Uses `useTheme()` hook for automatic dark/light mode switching
 *   - Upstream requires manual `theme` prop; Not A Wrapper auto-detects from app theme
 *   - Adds `[&>pre]:!bg-background` for consistent backgrounds across themes
 *   - SSR fallback renders plain code block before hydration
 * @upgradeNotes
 *   - Check if upstream still uses static theme prop vs auto-detection
 *   - Preserve useTheme() integration and SSR fallback pattern
 *   - Verify background styling classes are maintained
 */
"use client"

import {
  GROWING_HIGHLIGHT_THROTTLE_MS,
  normalizeShikiLanguage,
} from "@/lib/chat-performance/streaming-code-render"
import { cn } from "@/lib/utils"
import { useTheme } from "next-themes"
import React, { useEffect, useRef, useState } from "react"
import type { Highlighter } from "shiki"
import { createHighlighter } from "shiki"

const DEFAULT_LANGS = [
  "bash",
  "c",
  "cpp",
  "csharp",
  "css",
  "diff",
  "dockerfile",
  "go",
  "graphql",
  "html",
  "ini",
  "java",
  "javascript",
  "json",
  "jsx",
  "kotlin",
  "lua",
  "makefile",
  "markdown",
  "perl",
  "php",
  "powershell",
  "python",
  "ruby",
  "rust",
  "scala",
  "shell",
  "sql",
  "swift",
  "toml",
  "tsx",
  "typescript",
  "xml",
  "yaml",
] as const

let highlighterPromise: Promise<Highlighter> | null = null

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-dark", "github-light"],
      langs: [...DEFAULT_LANGS],
    })
  }
  return highlighterPromise
}

export type CodeBlockProps = {
  children?: React.ReactNode
  className?: string
} & React.HTMLProps<HTMLDivElement>

function CodeBlock({ children, className, ...props }: CodeBlockProps) {
  // Captured code-block box (2026-07-11): 24px-radius bordered surface with
  // 1rem top / 0.25rem bottom flow margins (their pre mt-2 collapsed with the
  // inner wrapper's mt-4/mb-1). Their --code-block-surface equals the page
  // background in dark mode; our card token is the same mapping.
  return (
    <div
      className={cn(
        "not-prose relative mt-4 mb-1 flex w-full flex-col overflow-clip border",
        // rounded-[24px] literal: the reference radius resolves to 24px;
        // our --radius-derived 3xl token is 22px, so the byte value is pinned.
        "border-border bg-card text-card-foreground rounded-[24px]",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export type CodeBlockCodeProps = {
  code: string
  language?: string
  className?: string
  /**
   * True only for the terminal code block of a live (submitted/streaming)
   * message (plan PR 3 stability rule, classified in
   * `components/ui/markdown.tsx`). Growing blocks re-highlight at most once
   * per `GROWING_HIGHLIGHT_THROTTLE_MS`; everything else highlights
   * immediately.
   */
  growing?: boolean
} & React.HTMLProps<HTMLDivElement>

function CodeBlockCode({
  code,
  language = "tsx",
  className,
  growing = false,
  ...props
}: CodeBlockCodeProps) {
  const { resolvedTheme: appTheme } = useTheme()
  const theme = appTheme === "dark" ? "github-dark" : "github-light"
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null)

  // Stale async completions are invalidated by generation token in addition
  // to the cleanup flag; unmount and every input change clear pending timers.
  const generationRef = useRef(0)
  // Wall-clock start of the last growing highlight, for the throttle window.
  const lastGrowingHighlightAtRef = useRef(0)

  useEffect(() => {
    const generation = ++generationRef.current
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    // Empty code renders through the plain path; nothing to highlight.
    if (!code) return

    const runHighlight = async () => {
      if (growing) {
        lastGrowingHighlightAtRef.current = Date.now()
      }
      const highlighter = await getHighlighter()
      if (cancelled || generation !== generationRef.current) return
      // Loaded-language query instead of exception-driven fallback: unknown
      // and plain ids normalize to Shiki's built-in `text` language.
      const lang = normalizeShikiLanguage(
        language,
        highlighter.getLoadedLanguages()
      )
      const html = highlighter.codeToHtml(code, { lang, theme })
      if (cancelled || generation !== generationRef.current) return
      setHighlightedHtml(html)
    }

    if (!growing) {
      // Stable, settled, or become-non-terminal: highlight the final tuple.
      void runHighlight()
    } else {
      // Growing terminal block: keep the highlighted look, at most one
      // highlight per interval — leading edge immediately, then trailing.
      // The visible highlight may lag the raw tail by at most one interval;
      // the settle pass above always renders the final tuple.
      const elapsed = Date.now() - lastGrowingHighlightAtRef.current
      if (elapsed >= GROWING_HIGHLIGHT_THROTTLE_MS) {
        void runHighlight()
      } else {
        timer = setTimeout(
          () => void runHighlight(),
          GROWING_HIGHLIGHT_THROTTLE_MS - elapsed
        )
      }
    }

    return () => {
      cancelled = true
      if (timer !== null) clearTimeout(timer)
    }
  }, [code, language, theme, growing])

  // Captured code text metrics: 14px / 24px (0.875em at 1.71429), 20px inline
  // padding, 12px block padding; the container's card surface shows through.
  const classNames = cn(
    "w-full overflow-x-auto text-sm leading-6 [&>pre]:px-5 [&>pre]:py-3 [&>pre]:!bg-transparent",
    className
  )

  // Latest completed highlight (throttled growth may lag the raw tail by at
  // most one interval; the settle pass renders the final tuple).
  const showHighlighted = highlightedHtml !== null && Boolean(code)

  // Plain path doubles as the SSR/pre-highlight fallback: React-escaped text
  // in the same wrapper, so `<script>`-like content renders as text.
  return showHighlighted ? (
    <div
      className={classNames}
      dangerouslySetInnerHTML={{ __html: highlightedHtml }}
      {...props}
    />
  ) : (
    <div className={classNames} {...props}>
      <pre>
        <code>{code ?? ""}</code>
      </pre>
    </div>
  )
}

export type CodeBlockGroupProps = React.HTMLAttributes<HTMLDivElement>

function CodeBlockGroup({
  children,
  className,
  ...props
}: CodeBlockGroupProps) {
  return (
    <div
      className={cn("flex items-center justify-between", className)}
      {...props}
    >
      {children}
    </div>
  )
}

export { CodeBlockGroup, CodeBlockCode, CodeBlock }
