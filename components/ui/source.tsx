/**
 * @component Source
 * @source prompt-kit
 * @upstream https://prompt-kit.com/docs/source
 * @customized true
 * @customizations
 *   - ESLint disables for `@next/next/no-img-element` are intentional
 *   - Uses Google Favicon API for dynamic external favicons
 *   - next/image optimization not beneficial for external dynamic URLs
 *   - Each ESLint disable has inline comment explaining the reason
 * @upgradeNotes
 *   - Preserve ESLint disable comments with explanations
 *   - Do NOT convert img tags to next/image (dynamic external URLs)
 *   - Verify Google Favicon API URL format remains current
 */
"use client"

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { parseSafeExternalUrl } from "@/lib/url-safety"
import { cn } from "@/lib/utils"
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { createContext, useContext } from "react"

const SourceContext = createContext<{
  href: string
  safeHref: string | undefined
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
  const safeUrl = parseSafeExternalUrl(href)
  const safeHref = safeUrl?.toString()
  const domain = safeUrl?.hostname ?? getFallbackSourceLabel(href)

  return (
    <SourceContext.Provider value={{ href, safeHref, domain }}>
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
  const { href, safeHref, domain } = useSourceContext()
  const labelToShow = label ?? domain.replace("www.", "")
  const trigger = useRender({
    defaultTagName: "a",
    render,
    props: mergeProps<"a">(
      {
        href: safeHref,
        target: safeHref ? "_blank" : undefined,
        rel: safeHref ? "noopener noreferrer" : undefined,
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
        // eslint-disable-next-line @next/next/no-img-element -- Dynamic external favicon, optimization not beneficial
        <img
          src={`https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(
            href
          )}`}
          alt="favicon"
          width={14}
          height={14}
          className="size-3.5 rounded-full"
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
  const { href, safeHref, domain } = useSourceContext()

  return (
    <HoverCardContent className={cn("shadow-border-md w-80 p-0", className)}>
      <a
        href={safeHref}
        target={safeHref ? "_blank" : undefined}
        rel={safeHref ? "noopener noreferrer" : undefined}
        className="flex flex-col gap-2 p-3"
      >
        <div className="flex items-center gap-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element -- Dynamic external favicon, optimization not beneficial */}
          <img
            src={`https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(
              href
            )}`}
            alt="favicon"
            className="size-4 rounded-full"
            width={16}
            height={16}
          />
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
  /** Anchor href; opened in a new tab. */
  href: string
  /** Primary, two-line-clamped title. */
  title: string
  /** Row-1 site text; falls back to `new URL(href).hostname`. */
  siteName?: string
  /** Two-line-clamped snippet; the slot is rendered even when empty. */
  description?: string
  /** Favicon ORIGIN; falls back to `new URL(href).origin`. */
  faviconDomain?: string
}

/**
 * SourcesGalleryItem — a single full-bleed source row for the Activity panel
 * sources gallery. Unlike `Source`/`SourceTrigger`/`SourceContent` (a HoverCard
 * citation pill), this is a plain anchor with an internal favicon, site name,
 * semibold title, and a reserved description slot. Favicon is requested at
 * `sz=32` against the page ORIGIN and rendered in a fixed 16px box to avoid
 * layout shift across a large gallery.
 */
export function SourcesGalleryItem({
  href,
  title,
  siteName,
  description,
  faviconDomain,
}: SourcesGalleryItemProps) {
  const safeUrl = parseSafeExternalUrl(href)
  const safeHref = safeUrl?.toString()
  const hostname = safeUrl?.hostname ?? getFallbackSourceLabel(href)

  let origin = faviconDomain
  if (!origin) {
    origin = safeUrl?.origin ?? ""
  }

  return (
    <a
      href={safeHref}
      target={safeHref ? "_blank" : undefined}
      rel={safeHref ? "noopener noreferrer" : undefined}
      className="hover:bg-foreground/[0.07] focus-visible:ring-ring flex flex-col gap-0.5 rounded-[12px] px-3 py-2.5 outline-none focus-visible:ring-2"
    >
      <div className="flex h-6 items-center gap-2 text-xs">
        {/* eslint-disable-next-line @next/next/no-img-element -- Dynamic external favicon, optimization not beneficial */}
        <img
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(
            origin
          )}&sz=32`}
          alt=""
          width={16}
          height={16}
          loading="lazy"
          decoding="async"
          className="bg-card size-4 shrink-0 rounded-full object-cover motion-safe:transition-opacity"
        />
        <span className="text-muted-foreground truncate">
          {siteName ?? hostname}
        </span>
      </div>
      <div className="line-clamp-2 text-sm font-semibold break-words">
        {title}
      </div>
      <div className="text-muted-foreground line-clamp-2 text-sm leading-snug">
        {description}
      </div>
    </a>
  )
}
