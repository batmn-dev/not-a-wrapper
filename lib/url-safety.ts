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
