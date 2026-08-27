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

import { GROWING_HIGHLIGHT_IDLE_MS } from "@/lib/chat-performance/streaming-code-render"
import { highlightCode } from "@/lib/markdown/shiki-client"
import {
  isChatPerfClientEnabled,
  markChatPerf,
} from "@/lib/observability/chat-performance"
import { cn } from "@/lib/utils"
import { useTheme } from "next-themes"
import React, { useEffect, useRef, useState } from "react"

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
   * `components/ui/markdown.tsx`). Growing blocks render changed code as
   * escaped plain text immediately and highlight after
   * `GROWING_HIGHLIGHT_IDLE_MS` without another tuple change; everything else
   * highlights immediately.
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
  const [highlighted, setHighlighted] = useState<{
    code: string
    language: string
    theme: "github-dark" | "github-light"
    html: string
  } | null>(null)

  // Stale async completions are invalidated by generation token in addition
  // to the exact tuple carried by `highlighted`; unmount and every input
  // change clear pending timers.
  const generationRef = useRef(0)

  useEffect(() => {
    const generation = ++generationRef.current
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    // Empty code renders through the plain path; nothing to highlight.
    if (!code) return

    const runHighlight = async () => {
      try {
        // Lazy service (ADR-0016 "Lazy Shiki"): Shiki core, themes, and the
        // grammar for this language load on first demand; unknown/plain ids
        // resolve to the grammar-less `text` language inside the service.
        // Highlight duration (measurement plan Phase 2): includes any lazy
        // grammar/theme module load on first use. Duration only, never code.
        const highlightStartedAt = isChatPerfClientEnabled()
          ? performance.now()
          : null
        const html = await highlightCode({ code, language, theme })
        if (highlightStartedAt !== null) {
          markChatPerf("shiki_highlight", {
            durationMs: performance.now() - highlightStartedAt,
          })
        }
        if (cancelled || generation !== generationRef.current) return
        setHighlighted({ code, language, theme, html })
      } catch {
        // Module or grammar loading failed: keep the React-escaped plain
        // fallback for this tuple; a later input change retries.
      }
    }

    if (!growing) {
      // Stable, settled, or become-non-terminal: highlight the final tuple.
      void runHighlight()
    } else {
      // True inactivity boundary: every growing tuple change cancels and
      // restarts this timer. There is no leading or periodic highlight while
      // canonical code continues changing inside the window.
      timer = setTimeout(() => void runHighlight(), GROWING_HIGHLIGHT_IDLE_MS)
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

  // Render highlighted HTML only for the exact current tuple. A code,
  // language, or theme change therefore exposes the new canonical code
  // immediately through the escaped plain fallback while any older async
  // result or idle timer becomes obsolete.
  const showHighlighted =
    highlighted !== null &&
    highlighted.code === code &&
    highlighted.language === language &&
    highlighted.theme === theme &&
    Boolean(code)

  // Plain path doubles as the SSR/pre-highlight fallback: React-escaped text
  // in the same wrapper, so `<script>`-like content renders as text.
  return showHighlighted ? (
    <div
      className={classNames}
      dangerouslySetInnerHTML={{ __html: highlighted.html }}
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
