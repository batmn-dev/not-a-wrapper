export function toSafeWebHref(href: string | null | undefined): string | null {
  if (!href) return null

  const value = href.trim()
  if (!value) return null

  const urlText = value.startsWith("//") ? `https:${value}` : value

  try {
    const url = new URL(urlText)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    return url.toString()
  } catch {
    return null
  }
}

/**
 * Parse a display href into a `URL` only if it is a safe http(s) link, else
 * null. Pairs with `toSafeWebHref` (which gates the parse), so safe-URL
 * consumers get a structured `URL` (hostname / origin / …) without
 * re-implementing the protocol guard.
 */
export function parseSafeExternalUrl(href: string): URL | null {
  const safeHref = toSafeWebHref(href)
  if (!safeHref) return null

  try {
    return new URL(safeHref)
  } catch {
    return null
  }
}

export type SourceLinkDestination = {
  href: string
  target: "_blank"
  rel: "noopener noreferrer"
  /** Safe, untracked URL for display metadata such as hostname and origin. */
  url: URL
}

/**
 * The single destination policy for model- and tool-supplied source links.
 * Only http(s) links can navigate; accepted links receive the same research
 * attribution without changing the URL used for display metadata.
 */
export function resolveSourceLinkDestination(
  href: string
): SourceLinkDestination | null {
  const url = parseSafeExternalUrl(href)
  if (!url) return null

  const destination = new URL(url)
  destination.searchParams.set("utm_source", "not-a-wrapper.com")
  destination.searchParams.set("utm_medium", "research")

  return {
    href: destination.toString(),
    target: "_blank",
    rel: "noopener noreferrer",
    url,
  }
}
