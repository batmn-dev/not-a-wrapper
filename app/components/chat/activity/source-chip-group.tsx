"use client"

import { Badge } from "@/components/ui/badge"
import { Favicon } from "@/components/ui/favicon"
import { toSafeWebHref } from "@/lib/url-safety"
import { cn } from "@/lib/utils"

function hostnameOf(href: string): string {
  const safeHref = toSafeWebHref(href)
  if (!safeHref) return href

  try {
    return new URL(safeHref).hostname.replace(/^www\./, "")
  } catch {
    return href
  }
}

export type SourceChipProps = {
  href: string
  /** Visible label; defaults to the bare hostname. */
  label?: string
  className?: string
}

/**
 * SourceChip — a pill citation chip for the Activity timeline, built on the
 * shipped `Badge` `source` variant (no new badge variant). Hover-inverts to the
 * primary color over 150ms (carried by the variant) and opens in a new tab.
 * Leading favicon is lazy/async per R8 (GA §D8, §C13, §4 rows 10-14).
 */
export function SourceChip({ href, label, className }: SourceChipProps) {
  const safeHref = toSafeWebHref(href)

  return (
    <Badge
      variant="source"
      size="md"
      className={cn("max-w-full px-3", className)}
      render={
        safeHref ? (
          <a href={safeHref} target="_blank" rel="noopener noreferrer" />
        ) : undefined
      }
    >
      <Favicon
        url={safeHref ?? href}
        loading="lazy"
        decoding="async"
        className="size-3"
      />
      <span className="truncate">{label ?? hostnameOf(href)}</span>
    </Badge>
  )
}

export type OverflowChipProps = {
  /** Number of hidden sources; also the accessible name (`{count} more`). */
  count: number
  /** Up to 3 are rendered as decorative overlapping favicons. */
  faviconUrls?: string[]
  onClick?: () => void
  className?: string
}

/**
 * OverflowChip — a real `<button>` ("{count} more") sharing the chip skin, with
 * up to 3 decorative overlapping favicons. Keyboard activation + focus styling
 * are correct now; the click can be wired to expansion in commit 5 (GA §D9).
 */
export function OverflowChip({
  count,
  faviconUrls = [],
  onClick,
  className,
}: OverflowChipProps) {
  return (
    <Badge
      variant="source"
      size="md"
      className={cn("group/overflow max-w-full cursor-pointer px-3", className)}
      render={<button type="button" onClick={onClick} />}
    >
      {faviconUrls.length > 0 ? (
        <span className="flex items-center" aria-hidden>
          {faviconUrls.slice(0, 3).map((url, index) => (
            <Favicon
              key={index}
              url={url}
              overlap
              loading="lazy"
              decoding="async"
              className="size-3 group-hover/overflow:ring-foreground"
            />
          ))}
        </span>
      ) : null}
      <span className="truncate">{count} more</span>
    </Badge>
  )
}

export type SourceChipGroupSource = {
  href: string
  label?: string
}

export type SourceChipGroupProps = {
  sources: SourceChipGroupSource[]
  /** Max chips shown before the rest fold into the overflow chip. */
  max?: number
  onOverflowClick?: () => void
  className?: string
}

/**
 * SourceChipGroup — exactly ONE flex-wrap row of chips + an optional overflow
 * chip. The reference's always-empty reserved first row is intentionally
 * dropped (GA §6.3).
 */
export function SourceChipGroup({
  sources,
  max,
  onOverflowClick,
  className,
}: SourceChipGroupProps) {
  if (sources.length === 0) return null

  const limit = max ?? sources.length
  const visible = sources.slice(0, limit)
  const overflow = sources.slice(limit)

  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {visible.map((source, index) => (
        <SourceChip key={index} href={source.href} label={source.label} />
      ))}
      {overflow.length > 0 ? (
        <OverflowChip
          count={overflow.length}
          faviconUrls={overflow.map((source) => source.href)}
          onClick={onOverflowClick}
        />
      ) : null}
    </div>
  )
}
