import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { cva, type VariantProps } from "class-variance-authority"

/**
 * Resolves a Google s2 favicon URL from a source URL (full href) or bare
 * hostname. Consolidates the favicon logic previously duplicated across
 * `markdown-link.tsx`, `source.tsx`, and `sources-list.tsx`, canonicalized at
 * `sz=64` for crisp rendering at small display sizes.
 */
function resolveFaviconSrc(input: string | null | undefined): string | null {
  if (!input) return null
  let hostname = input
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
    try {
      const url = new URL(input)
      if (!["http:", "https:"].includes(url.protocol)) return null
      hostname = url.hostname
    } catch {
      return null
    }
  }
  if (!hostname) return null
  return `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`
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
}: FaviconProps) {
  const src = resolveFaviconSrc(url)
  const radius = shape === "rounded" ? "rounded-sm" : "rounded-full"

  return (
    <Avatar
      className={cn("size-4", faviconVariants({ shape, overlap }), className)}
    >
      {src ? <AvatarImage src={src} alt={alt} className={radius} /> : null}
      <AvatarFallback className={radius} />
    </Avatar>
  )
}
