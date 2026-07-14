const SUCCESS_CACHE_CONTROL = "public, max-age=86400, s-maxage=604800"
const FAILURE_CACHE_CONTROL = "public, max-age=3600, s-maxage=3600"

function faviconUnavailable(): Response {
  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": FAILURE_CACHE_CONTROL },
  })
}

export async function GET(request: Request): Promise<Response> {
  const domain = new URL(request.url).searchParams.get("domain")?.trim()
  if (!domain) return new Response(null, { status: 400 })

  const upstreamUrl = new URL("https://www.google.com/s2/favicons")
  upstreamUrl.searchParams.set("domain", domain)
  upstreamUrl.searchParams.set("sz", "64")

  try {
    const upstream = await fetch(upstreamUrl, {
      next: { revalidate: 604800 },
    })
    const contentType = upstream.headers.get("content-type")

    if (!upstream.ok || !contentType?.startsWith("image/")) {
      return faviconUnavailable()
    }

    return new Response(upstream.body, {
      headers: {
        "Cache-Control": SUCCESS_CACHE_CONTROL,
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch {
    return faviconUnavailable()
  }
}
