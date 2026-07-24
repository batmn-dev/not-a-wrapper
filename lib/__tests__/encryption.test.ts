import {
  decryptSecret,
  encryptSecret,
  maskKey,
  type SecretBinding,
} from "@/lib/encryption"
import { beforeEach, describe, expect, it, vi } from "vitest"

// A deterministic 32-byte key (base64) for the primary, and a distinct one used
// to exercise rotation. Set before importing the module under test, which reads
// the env lazily on first use.
const PRIMARY = Buffer.alloc(32, 1).toString("base64")
const PREVIOUS = Buffer.alloc(32, 2).toString("base64")

process.env.ENCRYPTION_KEY = PRIMARY

const userKeyBinding: SecretBinding = {
  kind: "userKey",
  ownerId: "user_alice",
  provider: "openai",
}

describe("encryptSecret / decryptSecret", () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = PRIMARY
    delete process.env.ENCRYPTION_KEY_PREVIOUS
  })

  it("round-trips a secret with the same binding", () => {
    const plaintext = "sk-ant-api03-super-secret-value"
    const { encrypted, iv } = encryptSecret(plaintext, userKeyBinding)
    expect(decryptSecret(encrypted, iv, userKeyBinding)).toBe(plaintext)
  })

  it("round-trips an empty plaintext", () => {
    const { encrypted, iv } = encryptSecret("", userKeyBinding)
    expect(encrypted).toMatch(/^v3::[0-9a-f]+$/)
    expect(decryptSecret(encrypted, iv, userKeyBinding)).toBe("")
  })

  it("emits versioned ciphertext and a fresh IV per call", () => {
    const a = encryptSecret("same", userKeyBinding)
    const b = encryptSecret("same", userKeyBinding)
    expect(a.encrypted.startsWith("v3:")).toBe(true)
    // GCM nonce must never repeat under one key.
    expect(a.iv).not.toBe(b.iv)
    expect(a.encrypted).not.toBe(b.encrypted)
  })

  it("never stores the plaintext in the ciphertext", () => {
    const plaintext = "sk-or-v1-plaintext-should-not-appear"
    const { encrypted } = encryptSecret(plaintext, userKeyBinding)
    expect(encrypted).not.toContain(plaintext)
  })

  // ---- AAD binding: the owner-splice defense ----

  it("rejects decryption under a different owner", () => {
    const { encrypted, iv } = encryptSecret("secret", userKeyBinding)
    expect(() =>
      decryptSecret(encrypted, iv, {
        ...userKeyBinding,
        ownerId: "user_mallory",
      })
    ).toThrow()
  })

  it("rejects decryption under a different provider", () => {
    const { encrypted, iv } = encryptSecret("secret", userKeyBinding)
    expect(() =>
      decryptSecret(encrypted, iv, { ...userKeyBinding, provider: "anthropic" })
    ).toThrow()
  })

  it("rejects delimiter-colliding userKey bindings", () => {
    const { encrypted, iv } = encryptSecret("secret", {
      kind: "userKey",
      ownerId: "user alice",
      provider: "openai",
    })

    expect(() =>
      decryptSecret(encrypted, iv, {
        kind: "userKey",
        ownerId: "user",
        provider: "alice openai",
      })
    ).toThrow()
  })

  it("rejects cross-purpose reuse (userKey ciphertext read as mcpAuth)", () => {
    const { encrypted, iv } = encryptSecret("secret", userKeyBinding)
    expect(() =>
      decryptSecret(encrypted, iv, { kind: "mcpAuth", ownerId: "user_alice" })
    ).toThrow()
  })

  // ---- Tamper evidence ----

  it("rejects a tampered ciphertext body", () => {
    const { encrypted, iv } = encryptSecret("secret", userKeyBinding)
    const [version, body, tag] = encrypted.split(":")
    const flipped = body.slice(0, -1) + (body.endsWith("0") ? "1" : "0")
    expect(() =>
      decryptSecret(`${version}:${flipped}:${tag}`, iv, userKeyBinding)
    ).toThrow()
  })

  it("rejects a malformed / unversioned ciphertext", () => {
    const { iv } = encryptSecret("secret", userKeyBinding)
    expect(() =>
      decryptSecret("deadbeef:cafef00d", iv, userKeyBinding)
    ).toThrow(/Unsupported or malformed/)
  })

  it("rejects ciphertext with trailing envelope segments", () => {
    const { encrypted, iv } = encryptSecret("secret", userKeyBinding)
    expect(() =>
      decryptSecret(`${encrypted}:trailing-data`, iv, userKeyBinding)
    ).toThrow(/Unsupported or malformed/)
  })

  // ---- Key rotation ----

  it("decrypts a value encrypted under a rotated-out key", async () => {
    // Encrypt with the (soon-to-be) previous key under a fresh module instance...
    process.env.ENCRYPTION_KEY = PREVIOUS
    const legacy = await freshEncryptionModule()
    const { encrypted, iv } = legacy.encryptSecret(
      "legacy-secret",
      userKeyBinding
    )

    // ...then rotate: PRIMARY becomes current, PREVIOUS moves to the fallback set.
    process.env.ENCRYPTION_KEY = PRIMARY
    process.env.ENCRYPTION_KEY_PREVIOUS = PREVIOUS
    const rotated = await freshEncryptionModule()
    expect(rotated.decryptSecret(encrypted, iv, userKeyBinding)).toBe(
      "legacy-secret"
    )
  })

  it("fails when no configured key can decrypt", async () => {
    process.env.ENCRYPTION_KEY = PREVIOUS
    delete process.env.ENCRYPTION_KEY_PREVIOUS
    const oldKeyMod = await freshEncryptionModule()
    const { encrypted, iv } = oldKeyMod.encryptSecret("secret", userKeyBinding)

    // Rotate WITHOUT keeping the old key in the fallback set.
    process.env.ENCRYPTION_KEY = PRIMARY
    delete process.env.ENCRYPTION_KEY_PREVIOUS
    const newKeyMod = await freshEncryptionModule()
    expect(() =>
      newKeyMod.decryptSecret(encrypted, iv, userKeyBinding)
    ).toThrow()
  })
})

describe("maskKey", () => {
  it("masks all but the first and last four characters", () => {
    expect(maskKey("sk-1234567890abcd")).toBe("sk-1*********abcd")
  })
  it("fully masks short values", () => {
    expect(maskKey("short")).toBe("*****")
  })
})

// The module caches key material on first use. Rotation tests need a fresh cache
// that re-reads the current env, which `vi.resetModules()` + dynamic import gives.
async function freshEncryptionModule() {
  vi.resetModules()
  return await import("@/lib/encryption")
}
