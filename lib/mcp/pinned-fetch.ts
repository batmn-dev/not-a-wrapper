import type { LookupAddress, LookupOptions } from "node:dns"
import { request as httpRequest } from "node:http"
import type { IncomingHttpHeaders, RequestOptions } from "node:http"
import { request as httpsRequest } from "node:https"
import type { LookupFunction } from "node:net"
import { isIP } from "node:net"
import { Readable } from "node:stream"
import type { ReadableStream as NodeReadableStream } from "node:stream/web"
import type { ResolvedMcpUrl } from "./url-validation"

type PinnedRequestOptions = RequestOptions & { servername?: string }

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname
}

function familyFromLookupOptions(options: LookupOptions): 4 | 6 | 0 {
  if (options.family === "IPv4") return 4
  if (options.family === "IPv6") return 6
  if (options.family === 4 || options.family === 6) return options.family
  return 0
}

function createLookupError(message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException
  error.code = "ENOTFOUND"
  return error
}

export function createPinnedLookup({
  hostname,
  addresses,
}: ResolvedMcpUrl): LookupFunction {
  const expectedHostname = stripIpv6Brackets(hostname).toLowerCase()

  return (lookupHostname, options, callback) => {
    const requestedHostname = stripIpv6Brackets(lookupHostname).toLowerCase()
    if (requestedHostname !== expectedHostname) {
      callback(
        createLookupError(
          `Pinned MCP lookup refused unexpected host: ${lookupHostname}`
        ),
        "",
        0
      )
      return
    }

    const family = familyFromLookupOptions(options)
    const matching =
      family === 0
        ? addresses
        : addresses.filter((address) => address.family === family)

    if (matching.length === 0) {
      callback(
        createLookupError(
          `Pinned MCP lookup has no IPv${family} address for ${hostname}`
        ),
        "",
        family
      )
      return
    }

    if (options.all) {
      callback(
        null,
        matching.map((address): LookupAddress => ({
          address: address.address,
          family: address.family,
        }))
      )
      return
    }

    const [address] = matching
    callback(null, address.address, address.family)
  }
}

function appendResponseHeaders(
  headers: Headers,
  responseHeaders: IncomingHttpHeaders
) {
  for (const [name, value] of Object.entries(responseHeaders)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item)
      }
    } else {
      headers.append(name, String(value))
    }
  }
}

function mergeRequestHeaders(
  request: Request | undefined,
  initHeaders: HeadersInit | undefined,
  host: string
): Headers {
  const headers = new Headers(request?.headers)
  if (initHeaders) {
    new Headers(initHeaders).forEach((value, key) => headers.set(key, value))
  }
  headers.set("host", host)
  return headers
}

function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {}
  headers.forEach((value, key) => {
    record[key] = value
  })
  return record
}

async function writeRequestBody(
  request: ReturnType<typeof httpRequest>,
  body: BodyInit | null | undefined
): Promise<void> {
  if (body == null) {
    request.end()
    return
  }

  if (typeof body === "string" || body instanceof Uint8Array) {
    request.end(body)
    return
  }

  if (body instanceof ArrayBuffer) {
    request.end(Buffer.from(body))
    return
  }

  if (ArrayBuffer.isView(body)) {
    request.end(Buffer.from(body.buffer, body.byteOffset, body.byteLength))
    return
  }

  if (body instanceof URLSearchParams) {
    request.end(body.toString())
    return
  }

  if (body instanceof Blob) {
    request.end(Buffer.from(await body.arrayBuffer()))
    return
  }

  if (body instanceof ReadableStream) {
    Readable.fromWeb(body as NodeReadableStream<Uint8Array>).pipe(request)
    return
  }

  throw new TypeError("Unsupported MCP request body type")
}

function makeRedirectError(): TypeError {
  const error = new TypeError("fetch failed")
  error.cause = new Error("unexpected redirect")
  return error
}

function isRedirect(statusCode: number | undefined): boolean {
  return statusCode !== undefined && statusCode >= 300 && statusCode < 400
}

function responseAllowsBody(statusCode: number): boolean {
  return statusCode !== 204 && statusCode !== 205 && statusCode !== 304
}

function isIpLiteral(hostname: string): boolean {
  return isIP(stripIpv6Brackets(hostname)) !== 0
}

function assertSameOrigin(url: URL, originalUrl: URL) {
  if (url.origin !== originalUrl.origin) {
    throw new Error(
      `Pinned MCP fetch refused cross-origin request: ${url.origin}`
    )
  }
}

async function fetchWithPinnedLookup(
  url: URL,
  init: RequestInit,
  lookup: LookupFunction
): Promise<Response> {
  const requestFn = url.protocol === "https:" ? httpsRequest : httpRequest
  const headers = init.headers as Headers
  const options: PinnedRequestOptions = {
    method: init.method,
    headers: headersToRecord(headers),
    lookup,
    signal: init.signal ?? undefined,
  }

  if (url.protocol === "https:" && !isIpLiteral(url.hostname)) {
    options.servername = url.hostname
  }

  return await new Promise<Response>((resolve, reject) => {
    const req = requestFn(url, options, (res) => {
      if (init.redirect === "error" && isRedirect(res.statusCode)) {
        res.resume()
        reject(makeRedirectError())
        return
      }

      const responseHeaders = new Headers()
      appendResponseHeaders(responseHeaders, res.headers)
      const status = res.statusCode ?? 500

      resolve(
        new Response(
          responseAllowsBody(status)
            ? (Readable.toWeb(res) as ReadableStream<Uint8Array>)
            : null,
          {
            status,
            statusText: res.statusMessage,
            headers: responseHeaders,
          }
        )
      )
    })

    req.on("error", reject)

    writeRequestBody(req, init.body).catch((error) => {
      req.destroy(error)
      reject(error)
    })
  })
}

export function createPinnedMcpFetch(resolved: ResolvedMcpUrl): typeof fetch {
  const lookup = createPinnedLookup(resolved)

  return async (input, init) => {
    const request =
      typeof Request !== "undefined" && input instanceof Request
        ? input
        : undefined
    const url = request
      ? new URL(request.url)
      : new URL(input instanceof URL ? input : String(input))
    assertSameOrigin(url, resolved.originalUrl)

    const headers = mergeRequestHeaders(request, init?.headers, url.host)
    const body = init?.body ?? request?.body ?? null
    const method = init?.method ?? request?.method ?? (body ? "POST" : "GET")

    return await fetchWithPinnedLookup(
      url,
      {
        ...init,
        body,
        headers,
        method,
        redirect: init?.redirect ?? request?.redirect ?? "error",
        signal: init?.signal ?? request?.signal ?? null,
      },
      lookup
    )
  }
}
