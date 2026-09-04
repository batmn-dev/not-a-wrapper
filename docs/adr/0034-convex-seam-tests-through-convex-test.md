# ADR-0034: Registration-level seam tests through convex-test

- Status: accepted
- Date: 2026-09-04
- Context: architecture review candidate 10 ("the Convex test surface is not
  the caller seam"); branch `darknight/convex-run-lifecycle`
- Related: ADR-0003 (the Authenticated handler seam this makes testable),
  ADR-0011 / ADR-0020 (the grants and admission proof signed by
  `convex/lib/sha256.ts`)

## Context

Every Convex backend test imported a `...ForChat` / `...Handler` core and
hand-built a fake `ctx` — eleven independent in-memory `db.query / withIndex /
insert / patch` fakes across eleven files, each with its own index-emulation
fidelity. The cores were well covered; the seam callers actually cross was not:

- argument validators, `returns` validators, and the auth builders
  (`convex/lib/authedFunctions.ts`, 253 lines) had no direct test;
- index semantics that carry documented invariants (`schema.ts`: "a document
  missing `leaseExpiresAt` sorts as `undefined`, so every reaper range MUST
  exclude undefined") were enforced by no fake;
- the hand-rolled SHA-256 / HMAC that signs every execution grant and admission
  proof had no known-answer test — every consumer test faked digests as plain
  strings, so a wrong implementation passed the whole suite.

The gap was not hypothetical. Three registrations (`prepareGeneration`,
`approveToolCall`, `denyToolCall`) had drifted off the ADR-0003 seam onto raw
`mutation({...})` with inline auth, while CONTEXT.md asserted the opposite.
Nothing could catch that, because nothing tested at the registration.

Options considered:

1. **Adopt `convex-test` for a small set of seam tests only.** Convex's own
   library runs the real registered functions with real validators, indexes,
   identity, and scheduler. Existing core-level tests keep their fakes.
2. **Extract one shared hand fake** and migrate files as they get touched. No
   new dependency, but it never reaches the validators or the builders, so the
   doors stay untested.
3. **Big-bang migration** of every backend test onto `convex-test`. The
   `chatRuntime.test.ts` file alone is ~6,000 lines built on its fake; the
   payoff does not justify the churn.

## Decision

Option 1, with these rules:

- **Two dev dependencies:** `convex-test` and `@edge-runtime/vm`. Seam test
  files carry `/** @vitest-environment edge-runtime */` at the top — the same
  per-file convention the jsdom tests use — so the global Vitest config and
  the existing node-environment Convex tests are untouched.
- **One harness file,** `convex/test.setup.ts`, exports the module table via
  `import.meta.glob`. It is deploy-safe because the Convex CLI skips any
  basename with more than one dot (the same rule that keeps `*.test.ts` out of
  a push); the glob excludes those files for the same reason. Never put an
  `import.meta.glob` in a single-dot file under `convex/`.
- **Seam tests are few and targeted.** They exist for security-critical
  registrations (the auth builders through their real registrations, the
  admission-proof gate) and for index-range invariants no fake enforces. What
  a core does once admitted stays in the core-level tests. A seam test that
  re-tests core behaviour is the wrong shape.
- **Core-level fakes consolidate lazily.** A test file already being edited
  may move onto a shared fake or onto `convex-test`; no file is migrated for
  its own sake.
- **Crypto gets known-answer vectors** (`convex/lib/sha256.test.ts`): FIPS
  180-4 and RFC 4231 published answers plus cross-checks against Node's
  implementation at the block-padding boundaries and with multi-byte UTF-8.

Environment variables the functions read (`CHAT_ADMISSION_SECRET`) are set
per test with `vi.stubEnv`; the edge runtime exposes `process.env`.

## Consequences

- The test surface and the caller seam coincide for the handlers that matter:
  a permissions drift like the one above fails a test before it ships.
- `convex/chatRuntime.seam.test.ts` covers `prepareGeneration` (guest, foreign
  chat, tampered proof, valid proof), `approveToolCall` / `denyToolCall`
  (guest, foreign approval, owner decision), `stopGenerationRun` (foreign run),
  and `reapExpiredGenerationRuns` (a lease-less running run is never reaped).
- `convex-test` runs under Vercel's edge runtime, which is similar to but not
  the Convex runtime; its own docs say to still test new code manually. Error
  message text is our own thrown text, so matching on it is stable.
- Still untested through the seam: the remaining owned-resource builders
  (project, MCP server), `returns` validators generally, and OCC retry. Add a
  seam test when one of those becomes security-critical, not before.
