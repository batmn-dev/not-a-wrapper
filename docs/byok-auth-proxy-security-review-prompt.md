# Prompt: BYOK / Auth / Proxy Security Review (Pre-Launch)

> Copy everything below this line into a fresh agent/engineer session, run from the repo root.

---

## Mission

You are a senior security engineer performing a **one-time, thorough security review of the authentication, secret-handling (BYOK), and outbound-request (proxy/fetch) surface** of this app before it gains real users. Two phases:

1. **Audit**: systematically enumerate and assess the trust boundaries — who can authenticate, what they can reach, how user-supplied secrets (BYOK API keys) are stored/used/logged, and how the server makes outbound requests on a user's behalf (provider calls, MCP servers, web fetch). Produce an evidence-backed findings report ranked by severity, distinguishing **confirmed vulnerabilities** from **hardening opportunities**.
2. **Fix**: remediate confirmed issues. When choosing how, **lean toward composable, mature, industry-standard designs — including an architectural refactor if one is genuinely warranted**. The app is pre-launch with **no users and a disposable dev database** (see `AGENTS.md`, "The Database Is Disposable"), so schema, protocol, and structural changes are cheap now and expensive after launch. Do not refactor for its own sake; do refactor when the honest answer to "what would a mature system do here?" is structurally different from what exists. This is the review that should happen **before** the "revert the disposable-database section and re-activate migration discipline" launch step — treat it as the security gate for launch.

## Threat model & scope

Assume a **malicious authenticated user** and a **malicious external server** (a provider endpoint or MCP server the user points us at) as the primary adversaries, plus the usual unauthenticated attacker at the edge. In scope:

### 1. Secret handling (BYOK) — highest priority
- Encryption at rest: `lib/encryption.ts` (AES-256-GCM, `ENCRYPTION_KEY` from env, 32-byte base64). Review the full construction: IV generation and length (note the code uses a 16-byte IV — confirm GCM usage, tag handling, and AAD are correct and that ciphertext/iv/tag are stored and recombined safely), key rotation story, and what happens if `ENCRYPTION_KEY` is missing/wrong.
- Storage & access: `lib/user-keys.ts`, `convex/userKeys.ts`, `convex/schema.ts`. Are decrypted keys ever persisted, cached, returned to the client, or exposed via a query? Is decryption authorized per-user (can user A read/use user B's key)?
- Usage: `lib/openproviders/*` (request-shaping, provider-strategy), `app/api/user-keys/route.ts`. Are keys attached only to the intended provider's request? Can a crafted request cause a key to be sent to an attacker-controlled endpoint?
- Leakage: `sentry-scrub.ts` (the `SENSITIVE_KEY_PATTERN` scrubber) and `lib/observability/braintrust.ts`. Verify keys/tokens cannot reach Sentry, Braintrust, server logs, or error responses. Test the scrubber against realistic nested payloads and the actual shapes that flow through it.

### 2. Auth & authorization
- Edge auth: `proxy.ts` (`authkitProxy()` from WorkOS AuthKit) and its `matcher` — confirm the matcher actually covers every protected route and that no API route is unintentionally public. `lib/auth/workos.ts`, `convex/workosAuth.ts`, `convex/auth.config.ts`.
- The authenticated-handler seam (`docs/adr/0003-authenticated-handler-seam.md`) and per-user subscription seam (ADR 0004): verify every Convex query/mutation/action that touches user data enforces identity, and that no `api.*` function trusts a client-supplied user id.
- CSRF: `lib/csrf.ts`, `app/api/csrf/route.ts`. Confirm state-changing routes actually require and validate the token, and that the scheme is sound (origin binding, not just presence).

### 3. Outbound requests / SSRF
- The centralized fetch: `lib/fetch.ts`. Is there a single hardened outbound path, or do routes call `fetch` directly?
- MCP: `lib/mcp/load-mcp-from-url.ts` (note the existing `redirect: "error"` SSRF hardening comment), `lib/mcp/load-tools.ts`, `convex/mcpServers.ts`, `app/api/mcp-servers/route.ts`. A user supplies an arbitrary MCP server URL — assess SSRF to internal metadata endpoints (169.254.169.254, localhost, RFC-1918), DNS-rebinding, redirect bypass, and what credentials/headers we attach to that outbound call.
- Provider/web-fetch paths and `app/api/rate-limits`: confirm rate limiting and any allowlisting actually gate abuse.

### Verified starting facts (re-verify against current code)
- BYOK keys are AES-256-GCM encrypted at rest; the review's job is to confirm the whole construction and lifecycle, not assume it.
- MCP outbound uses `redirect: "error"` deliberately as SSRF hardening — do not remove it; assess whether it is sufficient.
- A `sentry-scrub.ts` redaction layer exists — assess coverage, don't assume completeness.
- Relevant ADRs: `docs/adr/0003-authenticated-handler-seam.md`, `docs/adr/0004-per-user-subscription-seam.md`.

## Audit requirements

- Enumerate the full attack surface before assessing: list every `app/api/*` route and every exported Convex `query`/`mutation`/`action`, and for each note auth requirement, authorization check, inputs, and outbound calls. This inventory is a deliverable.
- For each finding, provide: concrete exploit scenario (inputs → impact), affected file/line, severity (Critical/High/Medium/Low with CVSS-style reasoning), and whether it is confirmed or theoretical. **Prove exploitability where feasible** — a failing test or a script demonstrating the issue beats an assertion.
- Explicitly check the classics against this stack: IDOR/broken object-level auth on Convex functions, missing-auth routes, SSRF via user-supplied URLs, secret leakage to observability/logs, CSRF on mutations, key confusion (sending one user's/provider's key elsewhere), timing/oracle issues in key validation, and injection into MCP tool arguments.
- Distinguish **confirmed vulnerabilities** (fix now) from **hardening opportunities** (fix if the mature redesign subsumes them; otherwise document).

## Fix philosophy

- Prefer the design a mature system would have over the smallest patch. Candidates worth honest evaluation (not a mandate): a single hardened outbound-fetch chokepoint (with allowlist/IP-guard/redirect policy) that all provider/MCP/web calls route through; a centralized authorization helper so every Convex data function enforces ownership the same way; envelope encryption / documented key-rotation for BYOK; a defense-in-depth secret-redaction layer that fails closed. If the mature design needs schema changes — take them; migration ceremony is explicitly dormant pre-launch.
- Extend existing seams (the authenticated-handler seam, `lib/fetch.ts`, the scrubber) rather than adding parallel systems. Root causes over symptoms. Never log secrets; treat BYOK keys as encrypted-at-rest at all times.
- Any security invariant you establish gets an ADR in `docs/adr/` (follow existing numbering/style).
- Tests: this repo prefers **lean** suites — concentrate coverage on the security-critical logic (authz checks, the scrubber, SSRF guards, encryption round-trip and failure modes), following the style of the existing `*.test.ts` files. Do not blanket the codebase.
- Use **bun** (`bun run`, `bunx`); work on the current branch, no new branches, no pushes/PRs.

## Verification & deliverables

1. The attack-surface inventory (routes + Convex functions with auth/authz/outbound notes).
2. A ranked findings report: each finding with exploit scenario, location, severity, confirmed-vs-theoretical, and remediation status.
3. For fixed issues: a test or reproduction demonstrating the vuln before and its closure after. Full existing suite green (`bun run test` / `vitest`) plus new targeted security tests.
4. Confirmation that BYOK keys never reach the client, logs, Sentry, or Braintrust (demonstrate the scrubber against real payload shapes).
5. New/updated ADR(s) for any security invariant introduced, and a short launch-readiness statement: what is now safe, and any residual risks with their severity and suggested follow-up.
