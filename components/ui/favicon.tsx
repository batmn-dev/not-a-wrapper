import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/utils"
import { RiGlobalLine } from "@remixicon/react"
import { cva, type VariantProps } from "class-variance-authority"

/**
 * Resolves the same-origin favicon endpoint from a source URL (full href) or
 * bare hostname. The endpoint normalizes upstream failures so every caller
 * receives the same unavailable signal and renders the same fallback.
 */
function resolveFaviconSrc(input: string | null | undefined): string | null {
  if (!input) return null
  const value = input.trim()
  if (!value) return null

  let hostname = value
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    try {
      const url = new URL(value)
      if (!["http:", "https:"].includes(url.protocol)) return null
      hostname = url.hostname
    } catch {
      return null
    }
  }
  if (!hostname) return null
  return `/api/favicon?domain=${encodeURIComponent(hostname)}`
}

const faviconVariants = cva("shrink-0", {
  variants: {
    shape: {
      circle: "rounded-full",
      rounded: "rounded-sm",
    },
    overlap: {
      true: "ring-card -ms-3 ring-2 first:-ms-1",
      false: "",
    },
  },
  defaultVariants: {
    shape: "circle",
    overlap: false,
  },
})

export type FaviconProps = {
  /** Source URL (full href) or bare hostname; resolved by the favicon endpoint. */
  url: string | null | undefined
  alt?: string
  className?: string
  /** Native `<img loading>` hint, forwarded through `AvatarImage`. */
  loading?: "lazy" | "eager"
  /** Native `<img decoding>` hint, forwarded through `AvatarImage`. */
  decoding?: "async" | "sync" | "auto"
} & VariantProps<typeof faviconVariants>

/**
 * Favicon — a masked, error-tolerant site icon built on the Avatar primitive.
 * It owns both retrieval and the canonical global-line fallback so callers
 * cannot drift. Defaults to a 16px circle; pass `shape="rounded"` for the
 * squared inline look, or `overlap` for stacked source-chip groups.
 */
export function Favicon({
  url,
  alt = "",
  shape,
  overlap,
  className,
  loading,
  decoding,
}: FaviconProps) {
  const src = resolveFaviconSrc(url)
  const radius = shape === "rounded" ? "rounded-sm" : "rounded-full"

  return (
    <Avatar
      className={cn(
        "not-prose size-4",
        faviconVariants({ shape, overlap }),
        className
      )}
    >
      {src ? (
        <AvatarImage
          src={src}
          alt={alt}
          loading={loading}
          decoding={decoding}
          className={radius}
        />
      ) : null}
      <AvatarFallback className={radius}>
        <Icon
          icon={RiGlobalLine}
          data-slot="favicon-placeholder"
          slotSize="100%"
          glyphInset={0}
        />
      </AvatarFallback>
    </Avatar>
  )
}
