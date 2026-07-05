# Prompt: BYOK / Auth / Proxy Security Review (Pre-Launch)

> Copy everything below this line into a fresh agent/engineer session, run from the repo root.

---

## Mission

You are a senior security engineer performing a **one-time, pre-launch security review** of this app's trust boundary: the BYOK (bring-your-own-key) credential path, the authentication/authorization layer, and every server-side surface that fetches, proxies, or forwards on behalf of a user. This app is an open-source multi-AI chat app (Next.js App Router + Convex + WorkOS AuthKit + AI SDK) about to take real users; this review is the last cheap moment to fix anything structural.

Your job has two phases:

1. **Investigate**: enumerate the full attack surface, trace every trust boundary end-to-end with the actual code (not assumptions), and produce a findings list where every finding has a concrete attack scenario — inputs, actor, and impact. No hand-waving severity; if you can't articulate how it's exploited, it's a hardening note, not a finding.
2. **Fix**: remediate confirmed findings. When choosing how, **lean toward composable, mature, industry-standard designs — including an architectural refactor if one is genuinely warranted**. This app is pre-launch with **no users and a disposable dev database** (see `AGENTS.md`, "The Database Is Disposable"), so schema changes, credential-format changes, and structural refactors are cheap right now and expensive later. Do not refactor for its own sake; do refactor when the honest answer to "what would a mature system do here?" is structurally different from what exists. A security review that leaves a fragile design in place because the diff was smaller has failed.

## Scope — the trust boundary, mapped to code

Re-verify every path below against current code before relying on it.

**1. BYOK credential lifecycle** (highest-value target — these are users' provider API keys):

- Write path: Settings UI → `app/api/user-keys/route.ts` → `lib/user-keys.ts` → `lib/encryption.ts` (AES-256-GCM, key from `ENCRYPTION_KEY` env) → `convex/userKeys.ts` → `convex/schema.ts`.
- Read/use path: chat runtime resolving a user's key for a provider call (`lib/openproviders/*`, the chat route in `app/api/chat/`), plus MCP server credentials in `convex/mcpServers.ts` / `app/api/mcp-servers/route.ts`.
- Review: authorization on every read/write (can user A read/overwrite/delete user B's key — check the Convex function args and auth identity checks, not just the Next route); whether decrypted keys ever leave the server (API responses, client components, logs, error messages, Sentry events — `sentry-scrub.ts` exists, verify it actually catches the shapes these keys travel in, including nested provider-SDK error objects and request bodies); GCM nonce/IV handling and whether ciphertext is bound to its owner (an attacker who can write rows shouldn't be able to splice user B's ciphertext under user A's id — consider AAD binding userId+provider); key-rotation story for `ENCRYPTION_KEY`; timing/oracle behavior of validation endpoints ("is this key valid?" checks that relay provider responses).

**2. Authentication & authorization layer**:

- `proxy.ts` is the WorkOS `authkitProxy()` with a matcher — audit the matcher regex for unauthenticated gaps (which paths does it _not_ cover, and is every one of those safe to be public? e.g. `app/api/health`, static extensions list). `lib/auth/workos.ts`, `convex/workosAuth.ts`, `convex/auth.config.ts` bridge WorkOS identity into Convex.
- The critical pattern to audit repo-wide: **Convex functions are their own trust boundary.** Any `query`/`mutation`/`action` that trusts a caller-supplied `userId`/`chatId`/document id without deriving identity from `ctx.auth` is broken regardless of what the Next.js route checked. Enumerate every public Convex function (`convex/*.ts`) and classify: identity-derived, ownership-checked, or trusting-args. ADR 0003 (authenticated handler seam) and ADR 0004 (per-user subscription seam) in `docs/adr/` document the intended patterns — verify the implementation matches the ADRs and flag drift.
- Cross-tenant reads via live queries/subscriptions: can a subscription be pointed at another user's chat/messages/files?
- `lib/csrf.ts` + `app/api/csrf/route.ts`: verify the token scheme (generation, binding, validation) and that every state-changing route actually enforces it; check cookie attributes (SameSite/Secure/HttpOnly) and whether any mutation route is reachable without it.

**3. Server-side request surfaces (SSRF & forwarding)**:

- MCP: `lib/mcp/load-mcp-from-url.ts` already sets `redirect: "error"` as deliberate SSRF hardening — **keep it** (do not "fix" redirect-following back in; this was an explicit decision). But redirect-blocking alone is not SSRF protection: audit whether user-supplied MCP URLs can point at private ranges / localhost / cloud metadata (169.254.169.254), whether DNS-rebinding is considered, what headers/credentials get attached to those outbound calls, and how MCP tool approvals (`convex/mcpToolApprovals.ts`) gate execution.
- Any other user-influenced outbound fetch: provider base-URL overrides, file/URL ingestion in the chat route, `app/api/providers/route.ts`, search tools in `app/api/chat/search-tools.ts`, webhook or callback URLs. Enumerate them all; each needs the same private-range/metadata analysis.
- Outbound header/body hygiene: verify user BYOK keys and internal secrets are only ever attached to the host they belong to.

**4. Supporting surfaces** (audit briefly, escalate only if broken): rate limiting (`app/api/rate-limits`, and whether expensive routes — chat generation, key validation, MCP connection — are actually behind it, keyed to identity not IP alone); file upload path (`convex/files.ts` — content-type/size validation, who can fetch whose files); environment/secret handling (`docs/environment.md`, no secrets in `NEXT_PUBLIC_*`, `.env` files gitignored — remember this repo is **open source**, so also scan git history for ever-committed secrets); security headers/CSP in `next.config.ts` / `vercel.json`.

## Investigation requirements

- Trace with the code, end-to-end, before writing any finding. For each of the four scope areas, produce a short data-flow map (where the secret/identity enters, every hop, where it's checked, where it exits).
- **Demonstrate, don't speculate.** For each candidate finding, write the concrete attack: the request an attacker sends, as which principal, and what they get. Where feasible, prove it against the dev deployment (dev database is disposable — you may create test users/rows freely; use the Convex MCP per `docs/convex-access.md` to inspect state). A finding you tried and failed to exploit gets downgraded with the reason noted.
- Severity-rank findings: **Critical** (cross-user data/key access, auth bypass), **High** (SSRF to internal targets, key leakage to logs/telemetry, CSRF on mutations), **Medium** (missing rate limits, oracle behaviors, weak cookie attributes), **Hardening** (defense-in-depth gaps with no current exploit).
- Distinguish **confirmed vulnerabilities** from **design smells**. Fix confirmed vulnerabilities and any smell the composable redesign naturally subsumes; document the rest.

## Fix philosophy

- Prefer the design a mature system would have over the smallest patch. Candidates worth honest evaluation (not a mandate): a single authenticated-handler/ownership-check seam that every Convex function goes through (extending ADR 0003) instead of per-function ad-hoc checks; a centralized outbound-fetch gateway (one module that owns SSRF policy, redirect policy, and credential attachment) instead of per-callsite `fetch` hygiene; envelope encryption or AAD-bound ciphertext for BYOK keys if the current format can't support rotation or owner-binding. If the mature design requires schema or credential-format changes — take them; the dev database is disposable and migration ceremony is explicitly dormant pre-launch (re-encrypting or wiping stored dev keys is acceptable).
- Extend existing seams (the ADR 0003 authenticated-handler seam, `lib/fetch.ts`, `sentry-scrub.ts`) rather than adding parallel systems. Root causes over symptoms. Never log secrets at any point, including in debugging you add during this review; treat BYOK keys as encrypted-at-rest at all times.
- Any security invariant you establish or change gets an ADR in `docs/adr/` (follow the existing numbering/style). If you replace a per-function pattern with a seam, update or supersede the ADR that documented the old pattern.
- Tests: this repo prefers **lean** suites. Concentrate coverage on the security-critical logic — authorization checks, the scrubber against real payload shapes, SSRF guards, encryption round-trip and failure modes — following the style of the existing `*.test.ts` files. Do not blanket the codebase.
- Use **bun** (`bun run`, `bunx`); work on the current branch, no new branches, no pushes/PRs.

## Verification & deliverables

1. The attack-surface inventory: every `app/api/*` route and public Convex function, classified (identity-derived / ownership-checked / trusting-args), plus the four data-flow maps.
2. A severity-ranked findings report: each finding with its concrete attack scenario, location, confirmed-vs-hardening status, and remediation status.
3. For fixed findings: a test or reproduction demonstrating the issue before and its closure after. Full existing suite green (`bun run test` / `vitest`) plus new targeted security tests.
4. Demonstrated confirmation that BYOK keys never reach the client, logs, Sentry, or Braintrust — exercise the scrubber against the actual shapes keys travel in.
5. New/updated ADR(s) for any security invariant introduced, and a short launch-readiness statement: what is now safe, and any residual risks with their severity and suggested follow-up.
