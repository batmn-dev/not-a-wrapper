import { createCipheriv, createDecipheriv, randomBytes } from "crypto"

const ALGORITHM = "aes-256-gcm"
// Ciphertext format version. Bump when the on-the-wire shape changes so decrypt
// can branch instead of silently misreading old rows.
const VERSION = "v2"
// GCM's standard nonce length. 12 bytes is the NIST-recommended size and what
// every GCM implementation is tuned for.
const IV_LENGTH = 12

// Lazy, cached key material. `primary` encrypts; `all` (primary + any previous
// keys) are tried on decrypt so ENCRYPTION_KEY can be rotated without a flag day:
// set ENCRYPTION_KEY to the new key and ENCRYPTION_KEY_PREVIOUS to the old one,
// re-encrypt lazily, then drop the previous key.
let _keys: { primary: Buffer; all: Buffer[] } | null = null

function parseKey(raw: string, label: string): Buffer {
  const key = Buffer.from(raw.trim(), "base64")
  if (key.length !== 32) {
    throw new Error(`${label} must decode to 32 bytes`)
  }
  return key
}

function getKeys(): { primary: Buffer; all: Buffer[] } {
  if (_keys) return _keys

  const primaryRaw = process.env.ENCRYPTION_KEY
  if (!primaryRaw) {
    throw new Error("ENCRYPTION_KEY is required")
  }
  const primary = parseKey(primaryRaw, "ENCRYPTION_KEY")

  const previous = (process.env.ENCRYPTION_KEY_PREVIOUS ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k, i) => parseKey(k, `ENCRYPTION_KEY_PREVIOUS[${i}]`))

  _keys = { primary, all: [primary, ...previous] }
  return _keys
}

/**
 * The Additional Authenticated Data bound into every ciphertext. AAD is not
 * encrypted but is covered by the GCM auth tag, so a ciphertext authenticates
 * only when decrypted with the *same* AAD. Binding the owner + purpose here
 * means a row moved to another user, another provider, or another secret type
 * (e.g. splicing an MCP auth value into a userKeys row) fails to decrypt rather
 * than silently returning someone else's credential.
 */
export type SecretBinding =
  | { kind: "userKey"; ownerId: string; provider: string }
  | { kind: "mcpAuth"; ownerId: string }

function aadFor(binding: SecretBinding): Buffer {
  const parts =
    binding.kind === "userKey"
      ? ["userKey", binding.ownerId, binding.provider]
      : ["mcpAuth", binding.ownerId]
  return Buffer.from(parts.join(" "), "utf8")
}

export type EncryptedSecret = { encrypted: string; iv: string }

/**
 * Encrypt a secret, binding it to its owner + purpose via AAD. Returns the
 * versioned ciphertext (`v2:<ct>:<tag>`) and the per-record IV, matching the
 * two-column storage shape (`encryptedKey` / `iv`).
 */
export function encryptSecret(
  plaintext: string,
  binding: SecretBinding
): EncryptedSecret {
  const { primary } = getKeys()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, primary, iv)
  cipher.setAAD(aadFor(binding))

  let encrypted = cipher.update(plaintext, "utf8", "hex")
  encrypted += cipher.final("hex")
  const authTag = cipher.getAuthTag().toString("hex")

  return {
    encrypted: `${VERSION}:${encrypted}:${authTag}`,
    iv: iv.toString("hex"),
  }
}

/**
 * Decrypt a secret produced by {@link encryptSecret}. The same `binding` must be
 * supplied — a mismatch (wrong owner/provider/purpose) fails authentication and
 * throws. Tries each configured key so a rotated-out key still decrypts until
 * the row is re-encrypted.
 */
export function decryptSecret(
  encryptedData: string,
  ivHex: string,
  binding: SecretBinding
): string {
  const parts = encryptedData.split(":")
  if (parts.length !== 3) {
    throw new Error("Unsupported or malformed ciphertext")
  }
  const [version, encrypted, authTagHex] = parts
  if (version !== VERSION || !encrypted || !authTagHex) {
    throw new Error("Unsupported or malformed ciphertext")
  }

  const iv = Buffer.from(ivHex, "hex")
  const authTag = Buffer.from(authTagHex, "hex")
  const aad = aadFor(binding)

  let lastError: unknown
  for (const key of getKeys().all) {
    try {
      const decipher = createDecipheriv(ALGORITHM, key, iv)
      decipher.setAAD(aad)
      decipher.setAuthTag(authTag)
      let decrypted = decipher.update(encrypted, "hex", "utf8")
      decrypted += decipher.final("utf8")
      return decrypted
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Decryption failed")
}

export function maskKey(key: string): string {
  if (key.length <= 8) {
    return "*".repeat(key.length)
  }
  return key.slice(0, 4) + "*".repeat(key.length - 8) + key.slice(-4)
}
