import { Badge } from "@/components/ui/badge"
import { Favicon } from "@/components/ui/favicon"
import type { SourceUrlUIPart } from "ai"

/**
 * Opens the selected turn's Sources section. The cluster keeps the first three
 * unique hosts in source order; reversed DOM order preserves both left-to-right
 * order and overlap paint order.
 */

const MAX_CLUSTER_FAVICONS = 3

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
      <span className="flex flex-row-reverse">
        {[...cluster].reverse().map((source) => (
          <span
            key={source.sourceId}
            className="border-background bg-background group-hover/source-badge:border-border-default relative -ms-1.5 flex items-center overflow-clip rounded-full border-2 first:me-0"
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
