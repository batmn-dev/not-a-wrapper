import { Badge } from "@/components/ui/badge"
import { Favicon } from "@/components/ui/favicon"
import type { SourceUrlUIPart } from "ai"

/**
 * SourcesBadge — the ChatGPT-style sources affordance rendered LAST in a
 * settled, search-grounded assistant turn's actions row. Clicking it projects
 * the turn into the Activity panel with the Sources section scrolled into
 * view (the store's `openTurn(turnId, { section: "sources" })`).
 *
 * Spec extracted from reference-ui/ChatGPT
 * `pages/conversation-with-activity-panel/{desktop,tablet,mobile}` (the badge
 * markup is byte-identical at all three breakpoints; cross-checked against the
 * newer 2026-06-30 `conversation-ui-editable-markdown-ui` capture, which
 * supersedes the older pill-style `chatgpt-conversation-html-example`):
 *  - `<button aria-label="Sources">` as the trailing child of the response
 *    actions row, inside the row's hover-reveal mask; settled answers only.
 *  - Box and label styling live on `Badge` `variant="source"`.
 *  - Favicon cluster: the first ≤3 UNIQUE-host sources in source order (the
 *    113-source capture shows blog.tally.so once despite consecutive
 *    citations), DOM-reversed inside `flex-row-reverse` so the first source
 *    renders leftmost AND paints on top of the stack; 16px favicons in 20px
 *    wrappers — a 2px ring in the page background that flips to the hover
 *    wash while the badge is hovered — overlapped by 6px (`-ms-1.5`), each
 *    favicon carrying a hairline border.
 *  - Label: the literal word "Sources" (no count — verified at 2 sources and
 *    at 113), with the reference's -1px optical top margin.
 * Deliberate deltas: favicon load-in uses the Avatar fallback surface instead
 * of the reference's 200ms img opacity fade; hover/reveal motion rides the
 * actions row's existing mask (same mechanism the reference uses).
 */

const MAX_CLUSTER_FAVICONS = 3

/** First ≤3 unique-host sources, in source order. Hostname granularity
 * matches the reference cluster (subdomains stay distinct favicons). */
function clusterSources(sources: SourceUrlUIPart[]): SourceUrlUIPart[] {
  const seenHosts = new Set<string>()
  const cluster: SourceUrlUIPart[] = []
  for (const source of sources) {
    let host = source.url
    try {
      host = new URL(source.url).hostname
    } catch {
      // Non-parseable source urls dedupe by their raw value.
    }
    if (seenHosts.has(host)) continue
    seenHosts.add(host)
    cluster.push(source)
    if (cluster.length === MAX_CLUSTER_FAVICONS) break
  }
  return cluster
}

export type SourcesBadgeProps = {
  /** Deduped sources from the Assistant turn view — never re-extracted here. */
  sources: SourceUrlUIPart[]
  /** True when this turn is projected into the open Activity panel. */
  open: boolean
  /** Opens the Activity panel on this turn's Sources section. */
  onOpen: () => void
  /** DOM id of the controlled panel surface, for aria-controls. */
  controlsId?: string
}

export function SourcesBadge({
  sources,
  open,
  onOpen,
  controlsId,
}: SourcesBadgeProps) {
  if (sources.length === 0) return null

  const cluster = clusterSources(sources)

  return (
    <Badge
      variant="source"
      render={
        <button
          type="button"
          aria-label="Sources"
          aria-expanded={open}
          aria-controls={controlsId}
          onClick={onOpen}
        />
      }
    >
      {/* Reversed DOM inside flex-row-reverse: the first source ends up
          leftmost and, as the last sibling, paints on top of the overlap. */}
      <span className="flex flex-row-reverse">
        {[...cluster].reverse().map((source) => (
          <span
            key={source.sourceId}
            className="border-background bg-background group-hover/source-badge:border-accent/60 relative -ms-1.5 flex items-center overflow-clip rounded-full border-2 first:me-0"
          >
            <Favicon
              url={source.url}
              loading="lazy"
              decoding="async"
              className="border-border border-[0.5px]"
            />
          </span>
        ))}
      </span>
      <span className="mt-[-1px]">Sources</span>
    </Badge>
  )
}
