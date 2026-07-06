import { resolve4, resolve6 } from "node:dns/promises"

export class McpUrlValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "McpUrlValidationError"
  }
}

export type ResolvedMcpAddress = {
  address: string
  family: 4 | 6
}

export type ResolvedMcpUrl = {
  originalUrl: URL
  hostname: string
  addresses: ResolvedMcpAddress[]
}

/**
 * Check whether an IPv4 address falls in a private/reserved range.
 * Shared by both the pure URL validator and the async DNS resolution check.
 */
export function isPrivateIP(ip: string): boolean {
  const parts = ip.split(".").map(Number)
  if (parts.length !== 4 || parts.some((n) => isNaN(n) || n < 0 || n > 255)) {
    return false
  }
  const [a, b] = parts
  return (
    a === 10 || // 10.0.0.0/8
    a === 127 || // 127.0.0.0/8
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 — CGNAT (RFC 6598)
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) || // 192.168.0.0/16
    (a === 169 && b === 254) || // 169.254.0.0/16
    a === 0 // 0.0.0.0/8
  )
}

/**
 * Check whether an IPv6 address falls in a private/reserved range.
 *
 * Covers:
 * - Loopback — `::1`
 * - Unspecified — `::`
 * - IPv4-mapped — `::ffff:x.x.x.x` / `::ffff:HHHH:HHHH` (delegates to isPrivateIP)
 * - Link-local — `fe80::/10` (fe80:: through febf::)
 * - Unique local — `fc00::/7` (fc00:: through fdff::)
 *
 * @param rawIpv6 - The raw IPv6 address WITHOUT surrounding brackets
 */
export function isPrivateIPv6(rawIpv6: string): boolean {
  // Strip zone/scope ID if present (e.g. %25eth0 in URL-encoded form, %eth0 raw)
  const addr = rawIpv6.toLowerCase().replace(/%.*$/, "")

  // Loopback — ::1
  if (addr === "::1") return true

  // Unspecified — ::
  if (addr === "::") return true

  // IPv4-mapped IPv6 — ::ffff:x.x.x.x or ::ffff:HHHH:HHHH
  if (addr.startsWith("::ffff:")) {
    const suffix = addr.slice(7) // strip "::ffff:"

    // Dotted notation: ::ffff:127.0.0.1 (may appear in user input)
    if (suffix.includes(".")) {
      return isPrivateIP(suffix)
    }

    // Hex notation: ::ffff:7f00:1 (URL parsers normalize to this form)
    const hexParts = suffix.split(":")
    if (hexParts.length === 2) {
      const hi = parseInt(hexParts[0], 16)
      const lo = parseInt(hexParts[1], 16)
      if (!isNaN(hi) && !isNaN(lo)) {
        const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
        return isPrivateIP(ipv4)
      }
    }
  }

  // Extract the first 16-bit group for prefix-based range checks.
  // For addresses starting with "::" (like ::1), firstGroup is empty —
  // those cases are already handled above.
  const firstGroup = addr.split(":")[0]
  if (!firstGroup) return false

  // Link-local — fe80::/10 (first 10 bits: 1111111010)
  // Matches fe80:: through febf:: (third hex char: 8, 9, a, b)
  if (/^fe[89ab][0-9a-f]$/.test(firstGroup)) return true

  // Unique local — fc00::/7 (first 7 bits: 1111110)
  // Matches fc00:: through fdff::
  if (/^f[cd][0-9a-f]{2}$/.test(firstGroup)) return true

  return false
}

/**
 * Validate a URL against SSRF rules.
 * Pure function — no side effects, no DNS resolution.
 *
 * Mirrors the validation in convex/mcpServers.ts (Convex runtime can't import
 * from lib/). Both must stay in sync — changes to one should be reflected in
 * the other.
 *
 * Rejects: private IPs (10.x, 127.x, 100.64-127.x, 172.16-31.x, 192.168.x, 169.254.x),
 * localhost, 0.0.0.0, .local hostnames, and private/reserved IPv6 addresses
 * (::1, ::, fe80::/10, fc00::/7, ::ffff:private-ip).
 *
 * @returns Error message string if invalid, null if valid
 */
export function validateServerUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return "Invalid URL format"
  }

  const hostname = parsed.hostname.toLowerCase()

  // Block localhost and special hostnames
  if (
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    hostname === "[::1]" ||
    hostname.endsWith(".local")
  ) {
    return "Localhost and local network URLs are not allowed"
  }

  // Block private IPv4 ranges
  if (isPrivateIP(hostname)) {
    return "Private IP addresses are not allowed"
  }

  // Block private IPv6 ranges (IPv4-mapped, link-local, unique local)
  // URL parser wraps IPv6 in brackets: [fe80::1], [::ffff:7f00:1], etc.
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    const ipv6 = hostname.slice(1, -1)
    if (isPrivateIPv6(ipv6)) {
      return "Private IPv6 addresses are not allowed"
    }
  }

  // Must be http or https
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "Only HTTP and HTTPS URLs are supported"
  }

  return null // valid
}

/**
 * Resolve a URL's hostname via DNS and return the public IPs that future
 * connection code must pin to. Prevents DNS rebinding attacks where a public
 * domain resolves to a private IP after passing the pure string-level
 * validation.
 *
 * Call this at connection time, NOT as a replacement for the pure
 * validateServerUrl — that one runs in Convex too where DNS isn't available.
 *
 * @throws McpUrlValidationError with the specific rejection reason if the URL is disallowed.
 */
export async function resolveMcpUrlForConnection(
  url: string
): Promise<ResolvedMcpUrl> {
  const stringError = validateServerUrl(url)
  if (stringError) throw new McpUrlValidationError(stringError)

  const parsed = new URL(url)
  const hostname = parsed.hostname.toLowerCase()

  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    const ipv6 = hostname.slice(1, -1)
    if (isPrivateIPv6(ipv6)) {
      throw new McpUrlValidationError("Private IPv6 addresses are not allowed")
    }

    return {
      originalUrl: parsed,
      hostname,
      addresses: [{ address: ipv6, family: 6 }],
    }
  }

  if (isPrivateIP(hostname)) {
    throw new McpUrlValidationError("Private IP addresses are not allowed")
  }

  const ipParts = hostname.split(".").map(Number)
  if (
    ipParts.length === 4 &&
    ipParts.every((n) => !isNaN(n) && n >= 0 && n <= 255)
  ) {
    return {
      originalUrl: parsed,
      hostname,
      addresses: [{ address: hostname, family: 4 }],
    }
  }

  const [v4Result, v6Result] = await Promise.allSettled([
    resolve4(hostname),
    resolve6(hostname),
  ])

  const addresses: ResolvedMcpAddress[] = []

  if (v4Result.status === "fulfilled") {
    for (const addr of v4Result.value) {
      if (isPrivateIP(addr)) {
        throw new McpUrlValidationError(
          `Domain resolves to private IP (${addr}) — possible DNS rebinding`
        )
      }
      addresses.push({ address: addr, family: 4 })
    }
  }

  if (v6Result.status === "fulfilled") {
    for (const addr of v6Result.value) {
      if (isPrivateIPv6(addr)) {
        throw new McpUrlValidationError(
          `Domain resolves to private IPv6 (${addr}) — possible DNS rebinding`
        )
      }
      addresses.push({ address: addr, family: 6 })
    }
  }

  if (addresses.length === 0) {
    throw new McpUrlValidationError(
      "Domain could not be resolved to a public IP address"
    )
  }

  return { originalUrl: parsed, hostname, addresses }
}

/**
 * Resolve a URL's hostname via DNS and verify none of the resolved IPs are
 * private. Prevents DNS rebinding attacks where a public domain resolves to
 * a private IP after passing the pure string-level validation.
 *
 * Fails closed when neither A nor AAAA records can be validated. Single-family
 * gaps are allowed: a missing AAAA record does not block a public A record, and
 * vice versa.
 *
 * @returns Error message string if any resolved IP is private, null if safe
 */
export async function validateResolvedUrl(url: string): Promise<string | null> {
  try {
    await resolveMcpUrlForConnection(url)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : "URL DNS validation failed"
  }
}

/**
 * The single SSRF gate every outbound MCP connection must pass through.
 *
 * Combines the pure string check (`validateServerUrl`) with DNS resolution and
 * throws on the first failure, so a caller cannot connect to a URL that skipped
 * one layer. Connection callers should use `resolveMcpUrlForConnection`
 * directly so they can also pin the transport to the vetted address.
 *
 * Requires a Node runtime (uses `node:dns`); do not call from the Convex
 * runtime, which keeps its own mirrored string check.
 *
 * @throws McpUrlValidationError with the specific rejection reason if the URL
 * is disallowed.
 */
export async function assertMcpUrlAllowed(url: string): Promise<void> {
  await resolveMcpUrlForConnection(url)
}
