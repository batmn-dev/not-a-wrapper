import { createHash, createHmac } from "node:crypto"
import { describe, expect, it } from "vitest"
import { hmacSha256Hex, sha256Hex, timingSafeEqualHex } from "./sha256"

// The hand-rolled digest signs every execution grant and admission proof, so
// it is checked against published answers (FIPS 180-4, RFC 4231) and against
// Node's implementation at the block-padding boundaries.

const nodeSha256 = (input: string) =>
  createHash("sha256").update(input, "utf8").digest("hex")
const nodeHmac = (key: string, message: string) =>
  createHmac("sha256", Buffer.from(key, "utf8"))
    .update(message, "utf8")
    .digest("hex")

describe("sha256Hex", () => {
  it.each([
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    [
      "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    ],
  ])("matches the FIPS 180-4 known answer for %j", (input, digest) => {
    expect(sha256Hex(input)).toBe(digest)
  })

  it("matches Node at the padding boundaries and for multi-byte UTF-8", () => {
    const inputs = [
      ...[55, 56, 63, 64, 65, 119, 120, 1000].map((n) => "a".repeat(n)),
      "héllo wörld ✓ 🚀",
    ]
    for (const input of inputs) {
      expect(sha256Hex(input)).toBe(nodeSha256(input))
    }
  })
})

describe("hmacSha256Hex", () => {
  it("matches the RFC 4231 test case 2 known answer", () => {
    expect(hmacSha256Hex("Jefe", "what do ya want for nothing?")).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
    )
  })

  it("matches Node for short, block-sized, and over-long keys", () => {
    const cases: Array<[string, string]> = [
      ["", ""],
      ["k".repeat(64), "block-sized key"],
      ["k".repeat(100), "key longer than the block is hashed first"],
      ["secret ✓", "unicode message 🚀"],
    ]
    for (const [key, message] of cases) {
      expect(hmacSha256Hex(key, message)).toBe(nodeHmac(key, message))
    }
  })
})

describe("timingSafeEqualHex", () => {
  const digest = sha256Hex("abc")

  it("is true only for identical digests", () => {
    expect(timingSafeEqualHex(digest, digest)).toBe(true)
    expect(timingSafeEqualHex(digest, digest.slice(0, -1) + "e")).toBe(false)
    expect(timingSafeEqualHex(digest, digest.slice(0, 32))).toBe(false)
  })
})
