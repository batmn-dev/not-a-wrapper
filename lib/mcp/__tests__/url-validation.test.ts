import * as dns from "node:dns/promises"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  assertMcpUrlAllowed,
  isPrivateIP,
  isPrivateIPv6,
  McpUrlValidationError,
  resolveMcpUrlForConnection,
  validateResolvedUrl,
  validateServerUrl,
} from "../url-validation"

vi.mock("node:dns/promises")

describe("validateServerUrl", () => {
  // Valid URLs

  describe("valid URLs", () => {
    it("accepts HTTPS URLs with valid hostnames", () => {
      expect(validateServerUrl("https://mcp.example.com")).toBeNull()
    })

    it("accepts HTTP URLs (allowed for development)", () => {
      expect(validateServerUrl("http://mcp.example.com")).toBeNull()
    })

    it("accepts URLs with paths", () => {
      expect(validateServerUrl("https://example.com/mcp/v1")).toBeNull()
    })

    it("accepts URLs with ports", () => {
      expect(validateServerUrl("https://example.com:8080")).toBeNull()
    })

    it("accepts URLs with query parameters", () => {
      expect(validateServerUrl("https://example.com/mcp?key=value")).toBeNull()
    })

    it("accepts public IP addresses", () => {
      expect(validateServerUrl("https://8.8.8.8")).toBeNull()
      expect(validateServerUrl("https://1.1.1.1")).toBeNull()
      expect(validateServerUrl("https://203.0.113.1")).toBeNull()
    })

    it("accepts subdomain URLs", () => {
      expect(validateServerUrl("https://mcp.api.example.com")).toBeNull()
    })

    it("accepts IPs just outside private ranges", () => {
      // 172.15.x.x is NOT in the 172.16-31.x.x private range
      expect(validateServerUrl("http://172.15.0.1")).toBeNull()
      // 172.32.x.x is NOT in the 172.16-31.x.x private range
      expect(validateServerUrl("http://172.32.0.1")).toBeNull()
      // 192.167.x.x is NOT in the 192.168.x.x private range
      expect(validateServerUrl("http://192.167.1.1")).toBeNull()
    })
  })

  // Localhost rejection

  describe("localhost rejection", () => {
    it("rejects localhost", () => {
      const result = validateServerUrl("http://localhost:3000")
      expect(result).toBe("Localhost and local network URLs are not allowed")
    })

    it("rejects localhost without port", () => {
      const result = validateServerUrl("http://localhost")
      expect(result).toBe("Localhost and local network URLs are not allowed")
    })

    it("rejects 0.0.0.0", () => {
      const result = validateServerUrl("http://0.0.0.0:8080")
      expect(result).toBe("Localhost and local network URLs are not allowed")
    })

    it("rejects IPv6 loopback [::1]", () => {
      const result = validateServerUrl("http://[::1]:8080")
      expect(result).toBe("Localhost and local network URLs are not allowed")
    })

    it("rejects .local domains", () => {
      const result = validateServerUrl("http://myservice.local")
      expect(result).toBe("Localhost and local network URLs are not allowed")
    })

    it("rejects nested .local domains", () => {
      const result = validateServerUrl("http://deep.nested.myservice.local")
      expect(result).toBe("Localhost and local network URLs are not allowed")
    })
  })

  // IPv6 private range rejection (SSRF bypass prevention)

  describe("IPv6 private range rejection", () => {
    const blocked = "Private IPv6 addresses are not allowed"

    it("rejects unspecified address [::]", () => {
      expect(validateServerUrl("http://[::]:8080")).toBe(blocked)
    })

    it("rejects IPv4-mapped IPv6 loopback (::ffff:127.0.0.1)", () => {
      // URL parsers normalize dotted to hex: [::ffff:7f00:1]
      expect(validateServerUrl("http://[::ffff:127.0.0.1]")).toBe(blocked)
    })

    it("rejects IPv4-mapped IPv6 private (::ffff:10.0.0.1)", () => {
      expect(validateServerUrl("http://[::ffff:10.0.0.1]")).toBe(blocked)
    })

    it("rejects IPv4-mapped IPv6 private (::ffff:192.168.1.1)", () => {
      expect(validateServerUrl("http://[::ffff:192.168.1.1]")).toBe(blocked)
    })

    it("rejects IPv4-mapped IPv6 metadata endpoint (::ffff:169.254.169.254)", () => {
      expect(validateServerUrl("http://[::ffff:169.254.169.254]")).toBe(blocked)
    })

    it("rejects link-local IPv6 (fe80::1)", () => {
      expect(validateServerUrl("http://[fe80::1]")).toBe(blocked)
    })

    it("rejects unique local IPv6 (fc00::1)", () => {
      expect(validateServerUrl("http://[fc00::1]")).toBe(blocked)
    })

    it("rejects unique local IPv6 (fd00::1)", () => {
      expect(validateServerUrl("http://[fd00::1]")).toBe(blocked)
    })

    it("allows public IPv6 addresses", () => {
      expect(validateServerUrl("http://[2001:db8::1]")).toBeNull()
      expect(validateServerUrl("http://[2607:f8b0:4004:800::200e]")).toBeNull()
    })
  })

  // Private IP rejection

  describe("private IP rejection", () => {
    it("rejects 10.0.0.0/8 range", () => {
      expect(validateServerUrl("http://10.0.0.1")).toBe(
        "Private IP addresses are not allowed"
      )
      expect(validateServerUrl("http://10.255.255.255")).toBe(
        "Private IP addresses are not allowed"
      )
      expect(validateServerUrl("http://10.100.50.25")).toBe(
        "Private IP addresses are not allowed"
      )
    })

    it("rejects 172.16.0.0/12 range", () => {
      expect(validateServerUrl("http://172.16.0.1")).toBe(
        "Private IP addresses are not allowed"
      )
      expect(validateServerUrl("http://172.31.255.255")).toBe(
        "Private IP addresses are not allowed"
      )
      expect(validateServerUrl("http://172.20.10.5")).toBe(
        "Private IP addresses are not allowed"
      )
    })

    it("rejects 192.168.0.0/16 range", () => {
      expect(validateServerUrl("http://192.168.0.1")).toBe(
        "Private IP addresses are not allowed"
      )
      expect(validateServerUrl("http://192.168.1.1")).toBe(
        "Private IP addresses are not allowed"
      )
      expect(validateServerUrl("http://192.168.255.255")).toBe(
        "Private IP addresses are not allowed"
      )
    })

    it("rejects 169.254.0.0/16 link-local range", () => {
      expect(validateServerUrl("http://169.254.0.1")).toBe(
        "Private IP addresses are not allowed"
      )
      expect(validateServerUrl("http://169.254.169.254")).toBe(
        "Private IP addresses are not allowed"
      )
    })

    it("rejects 127.0.0.0/8 loopback range", () => {
      expect(validateServerUrl("http://127.0.0.1")).toBe(
        "Private IP addresses are not allowed"
      )
      expect(validateServerUrl("http://127.255.255.255")).toBe(
        "Private IP addresses are not allowed"
      )
    })

    it("rejects 0.0.0.0/8 range (0.x.x.x except 0.0.0.0 caught earlier)", () => {
      // 0.0.0.0 is caught by hostname check, but 0.1.2.3 is caught here
      expect(validateServerUrl("http://0.1.2.3")).toBe(
        "Private IP addresses are not allowed"
      )
    })
  })

  // Invalid URL format

  describe("invalid URL format", () => {
    it("rejects empty string", () => {
      expect(validateServerUrl("")).toBe("Invalid URL format")
    })

    it("rejects non-URL strings", () => {
      expect(validateServerUrl("not-a-url")).toBe("Invalid URL format")
    })

    it("rejects URLs without protocol", () => {
      expect(validateServerUrl("example.com")).toBe("Invalid URL format")
    })

    it("rejects strings with spaces", () => {
      expect(validateServerUrl("http://example .com")).toBe(
        "Invalid URL format"
      )
    })
  })

  // Protocol restrictions

  describe("protocol restrictions", () => {
    it("rejects ftp:// protocol", () => {
      expect(validateServerUrl("ftp://example.com")).toBe(
        "Only HTTP and HTTPS URLs are supported"
      )
    })

    it("rejects file:// protocol", () => {
      expect(validateServerUrl("file:///etc/passwd")).toBe(
        "Only HTTP and HTTPS URLs are supported"
      )
    })

    it("rejects ws:// protocol", () => {
      expect(validateServerUrl("ws://example.com")).toBe(
        "Only HTTP and HTTPS URLs are supported"
      )
    })
  })

  // Edge cases

  describe("edge cases", () => {
    it("handles URLs with authentication in them", () => {
      // user:pass@host URLs — should validate the host part
      expect(validateServerUrl("https://user:pass@mcp.example.com")).toBeNull()
    })

    it("handles URLs with fragments", () => {
      expect(validateServerUrl("https://example.com/mcp#section")).toBeNull()
    })

    it("handles case-insensitive hostnames", () => {
      // Should normalize to lowercase
      expect(validateServerUrl("http://LOCALHOST")).toBe(
        "Localhost and local network URLs are not allowed"
      )
    })
  })
})

// isPrivateIP

describe("isPrivateIP", () => {
  it("detects private IPs", () => {
    expect(isPrivateIP("10.0.0.1")).toBe(true)
    expect(isPrivateIP("127.0.0.1")).toBe(true)
    expect(isPrivateIP("192.168.1.1")).toBe(true)
    expect(isPrivateIP("172.16.0.1")).toBe(true)
    expect(isPrivateIP("169.254.169.254")).toBe(true)
  })

  it("allows public IPs", () => {
    expect(isPrivateIP("8.8.8.8")).toBe(false)
    expect(isPrivateIP("1.1.1.1")).toBe(false)
    expect(isPrivateIP("203.0.113.1")).toBe(false)
  })

  it("returns false for non-IP strings", () => {
    expect(isPrivateIP("example.com")).toBe(false)
    expect(isPrivateIP("not-an-ip")).toBe(false)
  })
})

// isPrivateIPv6

describe("isPrivateIPv6", () => {
  it("detects loopback ::1", () => {
    expect(isPrivateIPv6("::1")).toBe(true)
  })

  it("detects unspecified address ::", () => {
    expect(isPrivateIPv6("::")).toBe(true)
  })

  describe("IPv4-mapped addresses (::ffff:*)", () => {
    it("detects ::ffff:127.0.0.1 (dotted notation)", () => {
      expect(isPrivateIPv6("::ffff:127.0.0.1")).toBe(true)
    })

    it("detects ::ffff:7f00:1 (hex notation — URL-parser normalized)", () => {
      expect(isPrivateIPv6("::ffff:7f00:1")).toBe(true)
    })

    it("detects ::ffff:10.0.0.1 (dotted)", () => {
      expect(isPrivateIPv6("::ffff:10.0.0.1")).toBe(true)
    })

    it("detects ::ffff:a00:1 (hex for 10.0.0.1)", () => {
      expect(isPrivateIPv6("::ffff:a00:1")).toBe(true)
    })

    it("detects ::ffff:192.168.1.1 (dotted)", () => {
      expect(isPrivateIPv6("::ffff:192.168.1.1")).toBe(true)
    })

    it("detects ::ffff:c0a8:101 (hex for 192.168.1.1)", () => {
      expect(isPrivateIPv6("::ffff:c0a8:101")).toBe(true)
    })

    it("detects ::ffff:169.254.169.254 (AWS metadata, dotted)", () => {
      expect(isPrivateIPv6("::ffff:169.254.169.254")).toBe(true)
    })

    it("detects ::ffff:a9fe:a9fe (hex for 169.254.169.254)", () => {
      expect(isPrivateIPv6("::ffff:a9fe:a9fe")).toBe(true)
    })

    it("allows ::ffff:8.8.8.8 (public, dotted)", () => {
      expect(isPrivateIPv6("::ffff:8.8.8.8")).toBe(false)
    })

    it("allows ::ffff:808:808 (hex for 8.8.8.8)", () => {
      expect(isPrivateIPv6("::ffff:808:808")).toBe(false)
    })
  })

  describe("link-local (fe80::/10)", () => {
    it("detects fe80::1", () => {
      expect(isPrivateIPv6("fe80::1")).toBe(true)
    })

    it("detects fe80::abcd:1234", () => {
      expect(isPrivateIPv6("fe80::abcd:1234")).toBe(true)
    })

    it("detects febf::1 (upper end of fe80::/10)", () => {
      expect(isPrivateIPv6("febf::1")).toBe(true)
    })

    it("handles zone IDs (fe80::1%25eth0)", () => {
      expect(isPrivateIPv6("fe80::1%25eth0")).toBe(true)
    })
  })

  describe("unique local (fc00::/7)", () => {
    it("detects fc00::1", () => {
      expect(isPrivateIPv6("fc00::1")).toBe(true)
    })

    it("detects fd00::1", () => {
      expect(isPrivateIPv6("fd00::1")).toBe(true)
    })

    it("detects fdab:cdef::1", () => {
      expect(isPrivateIPv6("fdab::1")).toBe(true)
    })
  })

  it("allows public IPv6 addresses", () => {
    expect(isPrivateIPv6("2001:db8::1")).toBe(false)
    expect(isPrivateIPv6("2607:f8b0:4004:800::200e")).toBe(false)
  })
})

// validateResolvedUrl (DNS rebinding protection)

describe("validateResolvedUrl", () => {
  const mockResolve4 = vi.mocked(dns.resolve4)
  const mockResolve6 = vi.mocked(dns.resolve6)

  beforeEach(() => {
    mockResolve4.mockReset()
    mockResolve6.mockReset()
    // Default: no AAAA records
    mockResolve6.mockRejectedValue(new Error("ENOTFOUND"))
  })

  it("rejects domains that resolve to private IPs", async () => {
    mockResolve4.mockResolvedValue(["127.0.0.1"])
    const result = await validateResolvedUrl("https://evil.example.com")
    expect(result).toMatch(/resolves to private IP/)
  })

  it("rejects if any resolved IP is private", async () => {
    mockResolve4.mockResolvedValue(["8.8.8.8", "10.0.0.1"])
    const result = await validateResolvedUrl("https://evil.example.com")
    expect(result).toMatch(/resolves to private IP/)
  })

  it("allows domains that resolve to public IPs", async () => {
    mockResolve4.mockResolvedValue(["93.184.216.34"])
    const result = await validateResolvedUrl("https://example.com")
    expect(result).toBeNull()
  })

  it("skips DNS for literal public IPs", async () => {
    const result = await validateResolvedUrl("https://8.8.8.8")
    expect(result).toBeNull()
    expect(mockResolve4).not.toHaveBeenCalled()
  })

  it("still catches literal private IPs", async () => {
    const result = await validateResolvedUrl("https://10.0.0.1")
    expect(result).toBe("Private IP addresses are not allowed")
  })

  it("fails closed when DNS resolution cannot validate any address", async () => {
    mockResolve4.mockRejectedValue(new Error("ENOTFOUND"))
    const result = await validateResolvedUrl("https://nonexistent.example.com")
    expect(result).toBe("Domain could not be resolved to a public IP address")
  })

  it("fails closed when DNS returns no addresses", async () => {
    mockResolve4.mockResolvedValue([])
    mockResolve6.mockResolvedValue([])
    const result = await validateResolvedUrl("https://empty.example.com")
    expect(result).toBe("Domain could not be resolved to a public IP address")
  })

  it("allows a single-family DNS gap when another family resolves publicly", async () => {
    mockResolve4.mockResolvedValue(["93.184.216.34"])
    mockResolve6.mockRejectedValue(new Error("ENOTFOUND"))
    const result = await validateResolvedUrl("https://example.com")
    expect(result).toBeNull()
  })

  describe("IPv6 DNS rebinding protection", () => {
    it("rejects domains that resolve to private IPv6 (::1)", async () => {
      mockResolve4.mockRejectedValue(new Error("ENOTFOUND"))
      mockResolve6.mockResolvedValue(["::1"])
      const result = await validateResolvedUrl("https://evil.example.com")
      expect(result).toMatch(/resolves to private IPv6/)
    })

    it("rejects domains that resolve to link-local IPv6", async () => {
      mockResolve4.mockRejectedValue(new Error("ENOTFOUND"))
      mockResolve6.mockResolvedValue(["fe80::1"])
      const result = await validateResolvedUrl("https://evil.example.com")
      expect(result).toMatch(/resolves to private IPv6/)
    })

    it("rejects domains that resolve to unique local IPv6", async () => {
      mockResolve4.mockRejectedValue(new Error("ENOTFOUND"))
      mockResolve6.mockResolvedValue(["fd00::1"])
      const result = await validateResolvedUrl("https://evil.example.com")
      expect(result).toMatch(/resolves to private IPv6/)
    })

    it("allows domains that resolve to public IPv6", async () => {
      mockResolve4.mockRejectedValue(new Error("ENOTFOUND"))
      mockResolve6.mockResolvedValue(["2607:f8b0:4004:800::200e"])
      const result = await validateResolvedUrl("https://example.com")
      expect(result).toBeNull()
    })

    it("catches private IPv6 even when IPv4 is public", async () => {
      mockResolve4.mockResolvedValue(["93.184.216.34"])
      mockResolve6.mockResolvedValue(["fd00::1"])
      const result = await validateResolvedUrl("https://evil.example.com")
      expect(result).toMatch(/resolves to private IPv6/)
    })
  })
})

// assertMcpUrlAllowed — the single SSRF chokepoint (string + DNS)

describe("assertMcpUrlAllowed", () => {
  const mockResolve4 = vi.mocked(dns.resolve4)
  const mockResolve6 = vi.mocked(dns.resolve6)

  beforeEach(() => {
    mockResolve4.mockReset()
    mockResolve6.mockReset()
    mockResolve6.mockRejectedValue(new Error("ENOTFOUND"))
  })

  it("throws on the cloud metadata IP", async () => {
    await expect(
      assertMcpUrlAllowed("http://169.254.169.254/latest/meta-data/")
    ).rejects.toThrow(/Private IP/)
    await expect(
      assertMcpUrlAllowed("http://169.254.169.254/latest/meta-data/")
    ).rejects.toBeInstanceOf(McpUrlValidationError)
  })

  it("throws on localhost and loopback", async () => {
    await expect(assertMcpUrlAllowed("http://localhost:6379")).rejects.toThrow()
    await expect(assertMcpUrlAllowed("http://127.0.0.1:5432")).rejects.toThrow()
  })

  it("throws on private IPv4 ranges", async () => {
    await expect(assertMcpUrlAllowed("http://10.0.0.5")).rejects.toThrow()
    await expect(assertMcpUrlAllowed("http://192.168.1.1")).rejects.toThrow()
  })

  it("throws on a public hostname that resolves to a private IP (rebinding)", async () => {
    mockResolve4.mockResolvedValue(["169.254.169.254"])
    await expect(
      assertMcpUrlAllowed("https://rebind.evil.example.com")
    ).rejects.toThrow(/DNS rebinding|private IP/i)
  })

  it("rejects non-http(s) schemes", async () => {
    await expect(assertMcpUrlAllowed("file:///etc/passwd")).rejects.toThrow()
  })

  it("allows a public hostname resolving to a public IP", async () => {
    mockResolve4.mockResolvedValue(["93.184.216.34"])
    await expect(
      assertMcpUrlAllowed("https://mcp.example.com")
    ).resolves.toBeUndefined()
  })

  it("throws when DNS cannot validate any address", async () => {
    mockResolve4.mockRejectedValue(new Error("ENOTFOUND"))
    await expect(
      assertMcpUrlAllowed("https://nonexistent.example.com")
    ).rejects.toThrow(/could not be resolved/)
  })
})

// resolveMcpUrlForConnection — returns the public addresses that transport code pins

describe("resolveMcpUrlForConnection", () => {
  const mockResolve4 = vi.mocked(dns.resolve4)
  const mockResolve6 = vi.mocked(dns.resolve6)

  beforeEach(() => {
    mockResolve4.mockReset()
    mockResolve6.mockReset()
    mockResolve6.mockRejectedValue(new Error("ENOTFOUND"))
  })

  it("returns resolved public addresses for hostnames", async () => {
    mockResolve4.mockResolvedValue(["93.184.216.34"])
    mockResolve6.mockResolvedValue(["2606:2800:220:1:248:1893:25c8:1946"])

    await expect(
      resolveMcpUrlForConnection("https://mcp.example.com")
    ).resolves.toMatchObject({
      hostname: "mcp.example.com",
      addresses: [
        { address: "93.184.216.34", family: 4 },
        { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
      ],
    })
  })

  it("returns literal public IPs without DNS", async () => {
    await expect(
      resolveMcpUrlForConnection("https://8.8.8.8")
    ).resolves.toMatchObject({
      hostname: "8.8.8.8",
      addresses: [{ address: "8.8.8.8", family: 4 }],
    })
    expect(mockResolve4).not.toHaveBeenCalled()
  })
})
