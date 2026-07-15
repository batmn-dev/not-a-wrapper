import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { cva, type VariantProps } from "class-variance-authority"
import type { ReactNode } from "react"

/**
 * Resolves a Google s2 favicon URL from a source URL (full href) or bare
 * hostname. Consolidates the favicon logic previously duplicated across
 * `markdown-link.tsx`, `source.tsx`, and `sources-list.tsx`, canonicalized at
 * `sz=64` for crisp rendering at small display sizes.
 */
function resolveFaviconSrc(
  input: string | null | undefined,
  fallbackOnMissing = false
): string | null {
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
  if (fallbackOnMissing) {
    return `/api/favicon?domain=${encodeURIComponent(hostname)}`
  }
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=64`
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
  /** Source URL (full href) or bare hostname; resolved via the Google s2 API. */
  url: string | null | undefined
  alt?: string
  className?: string
  /** Optional decorative content shown when the favicon cannot load. */
  fallback?: ReactNode
  /** Route missing upstream favicons through the supplied fallback. */
  fallbackOnMissing?: boolean
  /** Native `<img loading>` hint, forwarded through `AvatarImage`. */
  loading?: "lazy" | "eager"
  /** Native `<img decoding>` hint, forwarded through `AvatarImage`. */
  decoding?: "async" | "sync" | "auto"
} & VariantProps<typeof faviconVariants>

/**
 * Favicon — a masked, error-tolerant site icon built on the Avatar primitive.
 * `AvatarFallback` handles load failures declaratively, replacing the
 * per-call-site `failedFavicons` bookkeeping. Defaults to a 16px circle; pass
 * `shape="rounded"` for the squared inline look, or `overlap` for stacked
 * source-chip groups.
 */
export function Favicon({
  url,
  alt = "",
  shape,
  overlap,
  className,
  fallback,
  fallbackOnMissing,
  loading,
  decoding,
}: FaviconProps) {
  const src = resolveFaviconSrc(url, fallbackOnMissing)
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
      <AvatarFallback className={radius}>{fallback}</AvatarFallback>
    </Avatar>
  )
}
