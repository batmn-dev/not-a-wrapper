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
