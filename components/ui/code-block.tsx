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
  GROWING_HIGHLIGHT_DEBOUNCE_MS,
  GROWING_HIGHLIGHT_THROTTLE_MS,
  normalizeShikiLanguage,
  resolveStreamingCodeRenderMode,
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
   * `components/ui/markdown.tsx`). Ignored by the `legacy` render mode.
   */
  growing?: boolean
} & React.HTMLProps<HTMLDivElement>

/** A completed highlight and the exact inputs it was produced from. */
type HighlightedCode = {
  html: string
  code: string
  language: string
  theme: string
}

function CodeBlockCode({
  code,
  language = "tsx",
  className,
  growing = false,
  ...props
}: CodeBlockCodeProps) {
  const { resolvedTheme: appTheme } = useTheme()
  const theme = appTheme === "dark" ? "github-dark" : "github-light"
  // Streaming-code render mode (plan PR 3): resolved once per mount; `legacy`
  // is the default and the rollback path.
  const [mode] = useState(() => resolveStreamingCodeRenderMode())
  const [highlighted, setHighlighted] = useState<HighlightedCode | null>(null)

  // Legacy mode — the pre-PR-3 effect, byte-for-byte semantics: one full
  // highlight per (code, language, theme) change, exception-driven `text`
  // fallback, stale HTML shown until the next completion lands.
  useEffect(() => {
    if (mode !== "legacy") return
    let cancelled = false

    async function highlight() {
      if (!code) {
        setHighlighted(null)
        return
      }

      const highlighter = await getHighlighter()
      const legacyTheme = appTheme === "dark" ? "github-dark" : "github-light"

      let html: string
      try {
        html = highlighter.codeToHtml(code, { lang: language, theme: legacyTheme })
      } catch {
        html = highlighter.codeToHtml(code, { lang: "text", theme: legacyTheme })
      }

      if (!cancelled) {
        setHighlighted({ html, code, language, theme: legacyTheme })
      }
    }
    highlight()

    return () => {
      cancelled = true
    }
  }, [code, language, appTheme, mode])

  // Variant modes (plan PR 3). Stale async completions are invalidated by
  // generation token in addition to the cleanup flag; unmount and every input
  // change clear pending timers.
  const generationRef = useRef(0)
  // Wall-clock start of the last growing highlight, for the throttle window.
  const lastGrowingHighlightAtRef = useRef(0)

  useEffect(() => {
    if (mode === "legacy") return
    const generation = ++generationRef.current
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    // Empty code renders through the plain path (the display rule ignores any
    // stale record); nothing to highlight and no state to reset.
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
      setHighlighted({ html, code, language, theme })
    }

    if (!growing) {
      // Stable, settled, or become-non-terminal: highlight the final tuple.
      void runHighlight()
    } else if (mode === "throttled-highlight") {
      // Growing: keep the highlighted look, at most one highlight per
      // interval — leading edge immediately, then trailing.
      const elapsed = Date.now() - lastGrowingHighlightAtRef.current
      if (elapsed >= GROWING_HIGHLIGHT_THROTTLE_MS) {
        void runHighlight()
      } else {
        timer = setTimeout(
          () => void runHighlight(),
          GROWING_HIGHLIGHT_THROTTLE_MS - elapsed
        )
      }
    } else {
      // plain-while-growing: highlight only after deltas pause.
      timer = setTimeout(() => void runHighlight(), GROWING_HIGHLIGHT_DEBOUNCE_MS)
    }

    return () => {
      cancelled = true
      if (timer !== null) clearTimeout(timer)
    }
  }, [code, language, theme, growing, mode])

  // Captured code text metrics: 14px / 24px (0.875em at 1.71429), 20px inline
  // padding, 12px block padding; the container's card surface shows through.
  const classNames = cn(
    "w-full overflow-x-auto text-sm leading-6 [&>pre]:px-5 [&>pre]:py-3 [&>pre]:!bg-transparent",
    className
  )

  // Display rule. legacy/throttled-highlight: latest completed highlight
  // (throttled growth may lag the tail by at most one interval).
  // plain-while-growing: highlighted HTML only when it matches the CURRENT
  // inputs exactly — a later delta immediately returns the block to plain
  // React-escaped text, never showing stale code.
  const showHighlighted =
    highlighted !== null &&
    (mode === "legacy"
      ? true // legacy manages its own state lifecycle, including the empty-code reset
      : Boolean(code) &&
        (mode !== "plain-while-growing" ||
          (highlighted.code === code &&
            highlighted.language === language &&
            highlighted.theme === theme)))

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
