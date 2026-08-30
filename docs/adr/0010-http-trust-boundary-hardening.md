# 10. HTTP trust-boundary hardening: authenticated-route seam, one SSRF gate, AAD-bound BYOK

- Status: accepted
- Date: 2026-07-05
- Context: Pre-launch security review of the BYOK / auth / outbound-fetch trust boundary

## Context

ADR-0003 made **Convex** auth structural. The Next.js **HTTP layer** in front of
it had not had the same treatment, and the pre-launch review found the gaps that
predicts:

1. **CSRF was scaffolding, not a control.** `lib/csrf.ts` minted a signed token,
   `/api/csrf` set it as a cookie, and `lib/fetch.ts` echoed it in an
   `x-csrf-token` header — but no route ever called `validateCsrfToken`. The
   token was generated, transported, and never checked. Actual protection rested
   entirely on the WorkOS session cookie being `SameSite=Lax` (verified: authkit
   default, no override), which is real but is a single point of failure.
2. **Every mutation route re-derived the same prologue by hand**
   (`getAuthenticatedWorkosSession()` → 401 → build a Convex client). One route,
   `/api/providers`, compared a **client-supplied** `userId` to the session
   instead of just using the session identity.
3. **SSRF policy for MCP URLs was applied per-callsite and unevenly.** The durable
   chat runtime resolved DNS and rejected private IPs; the persist path did a
   string-only check; and `/api/mcp-servers/test` connected to a **fully
   user-supplied URL with no validation at all** — a working SSRF to
   `169.254.169.254`, `localhost`, and private ranges for any authenticated user.
4. **BYOK ciphertext was unversioned and unbound.** AES-256-GCM with no AAD and
   no version tag: a stored key was not cryptographically tied to its owner or
   provider, and `ENCRYPTION_KEY` had no rotation story.

## Decision

### An authenticated-route seam (`app/api/_lib/authenticated-route.ts`)

`authenticatedRoute(handler, { csrf })` is the HTTP-layer counterpart to ADR-0003's
builders. It resolves the session (401 if absent), enforces the CSRF
double-submit on unsafe methods (`POST/PUT/PATCH/DELETE`), and hands the handler
a resolved `session` plus a pre-authenticated Convex client. Auth and CSRF move
**in front of** the handler body instead of being helpers each route remembers to
call. Migrated: `user-keys`, `mcp-servers`, `mcp-servers/test`, `projects/[id]`,
`user-preferences/favorite-models`, `providers`. `/api/providers` no longer reads
a client `userId`.

Follow-up (2026-08-30): `/api/providers` and the
`/api/projects/[projectId]` HTTP adapter were retired after caller-reachability
checks found no production consumer. Provider admission already resolves
server credentials directly, while project screens use the owner-checked
Convex project functions. The Projects feature and `/projects` page remain;
only the duplicate Next.js adapter was removed.

CSRF is now a real double-submit: `validateCsrfDoubleSubmit` requires the header
token to equal the cookie token **and** to carry a valid signature, compared with
`timingSafeEqual`. The cookie gained `SameSite=Lax`. `SameSite` remains the first
line of defense; the token is defense-in-depth that is now actually enforced.

Out of scope: `/api/chat` keeps its own auth (it serves anonymous guests and
streams via `DefaultChatTransport`, which does not attach the header); it is
covered by `SameSite=Lax`. Public GETs (`health`, `models`, `csrf`,
`rate-limits`) stay open by design.

### One SSRF gate for MCP (`assertMcpUrlAllowed`)

`lib/mcp/url-validation.ts` now exports `assertMcpUrlAllowed(url)`, which runs the
pure string check **and** the DNS-resolving rebinding check and throws on the
first failure. It is the single sanctioned way to open an MCP connection: both
`loadMCPToolsFromURL` (the test path) and the chat runtime call it before handing
a URL to the transport. `redirect: "error"` on the transport stays (ADR-era SSRF
hardening). The Convex mutation keeps its mirrored string check for the runtimes
where `node:dns` is unavailable.

### Per-identity rate limiting + security headers

The seam takes an optional `rateLimit: {bucket}` enforced after auth via
`convex/rateLimits.ts` (`consume`) — a fixed-window limiter keyed to `ctx.user`
(never a client id), backed by the `apiRateLimits` table, distinct from the
tool-scoped `toolLimits`. The bucket maps to a server-owned allowlisted policy in
Convex, so a direct public mutation caller cannot choose a different
`limit`/`windowMs` to reset allowance. `/api/mcp-servers/test` uses the `mcp_test`
policy (10/min/user; each call opens an outbound socket), returning 429 +
`Retry-After`.

`next.config.ts` now sets baseline security headers on every route: a scoped CSP
(`connect-src` limited to the env-derived Convex https/wss origins + PostHog;
Sentry is same-origin via its `/monitoring` tunnel; `frame-ancestors 'none'`,
`object-src 'none'`, `base-uri 'self'`, `form-action 'self'`; `img-src https:`
since images are inert), plus `X-Content-Type-Options`, `X-Frame-Options: DENY`,
`Referrer-Policy`, `Permissions-Policy`, and (production only) HSTS.

### AAD-bound, versioned BYOK envelope (`lib/encryption.ts`)

`encryptSecret(plaintext, binding)` / `decryptSecret(ct, iv, binding)` replace the
unbound `encryptKey`/`decryptKey`. Ciphertext is versioned (`v2:`) and uses a
12-byte GCM nonce. The `binding` (`{kind:"userKey", ownerId, provider}` or
`{kind:"mcpAuth", ownerId}`) is set as GCM **AAD**, so a row moved to another
user, provider, or secret type fails authentication instead of decrypting.
`ownerId` is the WorkOS subject — the one identifier available identically at the
encrypt boundary (`session.userId`) and the decrypt boundary (surfaced as
`ownerId` from `userKeys.getByProvider`, and via `users.getCurrent` in the MCP
loader). `ENCRYPTION_KEY` rotation is supported: `ENCRYPTION_KEY_PREVIOUS`
(comma-separated) is tried on decrypt only, so a key can be rotated by moving the
old value to `_PREVIOUS`, then dropped once rows re-encrypt.

## Consequences

- CSRF is enforced structurally on every migrated mutation route; forgetting it
  requires bypassing the seam. The token mechanism is no longer dead code.
- There is one place that owns MCP SSRF policy. The `/api/mcp-servers/test`
  hole is closed; the runtime and test paths cannot diverge again.
- BYOK keys are owner- and purpose-bound at rest and `ENCRYPTION_KEY` is
  rotatable. **Format change is not backward compatible** — pre-existing dev rows
  (unversioned) no longer decrypt and must be re-entered or wiped. This is
  acceptable pre-launch per `AGENTS.md` ("The Database Is Disposable"); revisit
  before real users exist.
- Telemetry scrubbing gained a shared value-level secret detector
  (`lib/observability/secret-patterns.ts`) wired into the Sentry scrubber and
  Braintrust, closing the gap where a key embedded in a free-text string (e.g. a
  provider 401 message) slipped past key-name/path redaction.

### Residual / follow-up

- MCP owner-binding depends on `users.getCurrent` in the loader. Auth-required
  MCP servers fail closed when the owner identity, stored credential material, or
  decrypted header cannot be produced, so the loader does not silently contact
  them anonymously.
- **DNS TOCTOU:** `assertMcpUrlAllowed` resolves, then the transport resolves
  again — a sub-second rebind between the two still slips through. Pinning the
  validated IP into the connection is the complete fix.
- **CSP `script-src` still allows `'unsafe-inline'`** (the App Router emits inline
  bootstrap scripts and we have not adopted nonce injection). The non-script
  directives carry the weight today; nonce-based `script-src` is the next step.
  The CSP was authored from the mapped client hosts and typechecks, but was not
  runtime-verified against a live authenticated instance (no env in the review
  worktree) — smoke-check the browser console for CSP violations before merge.
- **The encrypt boundary lives in the Next layer** while ownership is authoritative
  in Convex; moving encryption into a Convex action would let AAD bind the Convex
  user id directly and remove the WorkOS-subject threading.
