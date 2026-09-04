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
  /** Safe URL for display metadata such as hostname and origin. */
  url: URL
}

/**
 * The single destination policy for model- and tool-supplied source links.
 * Only http(s) links can navigate. Accepted URLs remain unchanged because
 * provider- and tool-supplied query parameters may be signature-sensitive.
 */
export function resolveSourceLinkDestination(
  href: string
): SourceLinkDestination | null {
  const url = parseSafeExternalUrl(href)
  if (!url) return null

  return {
    href: url.toString(),
    target: "_blank",
    rel: "noopener noreferrer",
    url,
  }
}

function parseDisplayUrl(href: string): URL | null {
  const safeUrl = parseSafeExternalUrl(href)
  if (safeUrl) return safeUrl
  try {
    return new URL(href.trim())
  } catch {
    return null
  }
}

/** Host (including an explicit port) + path + query + hash, no scheme. Trailing slash is pathname-only. */
export function formatSourceDisplayUrl(href: string): string {
  const url = parseDisplayUrl(href)
  if (url?.host) {
    const host = url.host.replace(/^www\./i, "")
    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "")
    return `${host}${path}${url.search}${url.hash}`
  }
  return href.replace(/^https?:\/\//i, "").replace(/^www\./i, "")
}
