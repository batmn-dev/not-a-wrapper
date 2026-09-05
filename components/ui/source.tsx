/**
 * Based on prompt-kit: https://prompt-kit.com/docs/source
 * Source icons use the shared Favicon retrieval and fallback path.
 */
"use client"

import { Favicon } from "@/components/ui/favicon"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import {
  formatSourceDisplayUrl,
  resolveSourceLinkDestination,
  type SourceLinkDestination,
} from "@/lib/url-safety"
import { cn } from "@/lib/utils"
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { createContext, useContext } from "react"

const SourceContext = createContext<{
  href: string
  destination: SourceLinkDestination | null
  domain: string
} | null>(null)

function useSourceContext() {
  const ctx = useContext(SourceContext)
  if (!ctx) throw new Error("Source.* must be used inside <Source>")
  return ctx
}

function getFallbackSourceLabel(href: string): string {
  return href.split("/").pop() || href
}

export type SourceProps = {
  href: string
  children: React.ReactNode
}

export function Source({ href, children }: SourceProps) {
  const destination = resolveSourceLinkDestination(href)
  const domain = destination?.url.hostname ?? getFallbackSourceLabel(href)

  return (
    <SourceContext.Provider value={{ href, destination, domain }}>
      <HoverCard>{children}</HoverCard>
    </SourceContext.Provider>
  )
}

export type SourceTriggerProps = {
  label?: string | number
  showFavicon?: boolean
  className?: string
  render?: useRender.ComponentProps<"a">["render"]
}

export function SourceTrigger({
  label,
  showFavicon = false,
  className,
  render,
}: SourceTriggerProps) {
  const { href, destination, domain } = useSourceContext()
  const labelToShow = label ?? domain.replace("www.", "")
  const trigger = useRender({
    defaultTagName: "a",
    render,
    props: mergeProps<"a">(
      {
        href: destination?.href,
        target: destination?.target,
        rel: destination?.rel,
        className: cn(
          "bg-muted text-muted-foreground hover:bg-muted-foreground/30 hover:text-primary inline-flex h-5 max-w-32 items-center gap-1 overflow-hidden rounded-full py-0 text-xs no-underline",
          showFavicon ? "pr-2 pl-1" : "px-1",
          className
        ),
      },
      {}
    ),
  })

  return (
    <HoverCardTrigger delay={150} closeDelay={0} render={trigger}>
      {showFavicon && (
        <Favicon
          url={href}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-3.5"
        />
      )}
      <span className="truncate text-center font-normal tabular-nums">
        {labelToShow}
      </span>
    </HoverCardTrigger>
  )
}

export type SourceContentProps = {
  title: string
  description: string
  className?: string
}

export function SourceContent({
  title,
  description,
  className,
}: SourceContentProps) {
  const { href, destination, domain } = useSourceContext()

  return (
    <HoverCardContent className={cn("w-80 p-0", className)}>
      <a
        href={destination?.href}
        target={destination?.target}
        rel={destination?.rel}
        className="flex flex-col gap-2 p-3"
      >
        <div className="flex items-center gap-1.5">
          <Favicon url={href} alt="" loading="lazy" decoding="async" />
          <div className="text-primary truncate text-sm">
            {domain.replace("www.", "")}
          </div>
        </div>
        <div className="line-clamp-2 text-sm font-medium">{title}</div>
        <div className="text-muted-foreground line-clamp-2 text-sm">
          {description}
        </div>
      </a>
    </HoverCardContent>
  )
}

export type SourcesGalleryItemProps = {
  href: string
  title?: string
  siteName?: string
  description?: string
  faviconDomain?: string
  publishedDate?: string
}

const publishedDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
})

/** Date-only `YYYY-MM-DD` is a UTC calendar date so local TZ cannot shift the day. */
function formatSourcePublishedDate(value: string): string | undefined {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (dateOnly) {
    const year = Number(dateOnly[1])
    const month = Number(dateOnly[2])
    const day = Number(dateOnly[3])
    const parsed = new Date(Date.UTC(year, month - 1, day))
    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== day
    ) {
      return undefined
    }
    return publishedDateFormatter.format(parsed)
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return undefined
  return publishedDateFormatter.format(parsed)
}

function sourceIdentity(value: string): string {
  return formatSourceDisplayUrl(value).trim().toLowerCase()
}

function isSourceHeadline(
  title: string | undefined,
  href: string,
  siteName: string | undefined,
  hostname: string
): title is string {
  if (!title) return false
  const identity = sourceIdentity(title)
  return (
    identity !== sourceIdentity(href) &&
    identity !== sourceIdentity(hostname) &&
    (siteName == null || identity !== sourceIdentity(siteName))
  )
}

/** Activity sources are plain anchors; inline citations remain HoverCards. */
export function SourcesGalleryItem({
  href,
  title,
  siteName,
  description,
  faviconDomain,
  publishedDate,
}: SourcesGalleryItemProps) {
  const destination = resolveSourceLinkDestination(href)
  const hostname = destination?.url.hostname ?? getFallbackSourceLabel(href)
  const faviconUrl = faviconDomain ?? destination?.url.origin ?? href
  const publisher = siteName ?? hostname
  const formattedDate = publishedDate
    ? formatSourcePublishedDate(publishedDate)
    : undefined
  const headline = isSourceHeadline(title, href, siteName, hostname)
    ? title
    : formatSourceDisplayUrl(destination?.href ?? href)
  const descriptionText = description?.trim() ? description : undefined

  return (
    <a
      href={destination?.href}
      target={destination?.target}
      rel={destination?.rel}
      className="hover:bg-interactive-hover active:bg-interactive-pressed focus-visible:ring-focus-ring flex flex-col gap-0.5 rounded-[12px] px-3 py-2.5 outline-none focus-visible:ring-2"
    >
      <div className="flex h-6 items-center gap-2 text-xs">
        <Favicon
          url={faviconUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="bg-card size-4 shrink-0 rounded-full object-cover motion-safe:transition-opacity"
        />
        <span className="text-muted-foreground truncate">
          {formattedDate ? `${publisher} · ${formattedDate}` : publisher}
        </span>
      </div>
      <div className="line-clamp-2 text-sm font-semibold break-words">
        {headline}
      </div>
      {descriptionText ? (
        <div className="text-muted-foreground line-clamp-2 text-sm leading-snug">
          {descriptionText}
        </div>
      ) : null}
    </a>
  )
}
