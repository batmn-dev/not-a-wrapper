# Convex Schema Contraction Manifests

This directory records schema contractions that can fail a Convex deploy if
existing documents still contain fields removed from `convex/schema.ts`.

Use the expand/migrate/contract workflow for field removals:

1. Expand/compat: keep legacy fields in `convex/schema.ts` as optional while app
   code stops writing them.
2. Migrate: run an idempotent cleanup mutation that patches legacy fields to
   `undefined`.
3. Verify: run aggregate checks against the target deployment and confirm every
   expected field count is zero.
4. Contract: remove the fields from `convex/schema.ts`, set the manifest
   `status` to `contracted`, and keep the manifest in this directory.

Manifest files are JSON and intentionally simple:

```json
{
  "kind": "convex-schema-contraction",
  "id": "2026-05-22-example-field-removal",
  "status": "contracted",
  "fields": [
    { "table": "messages", "field": "legacyField", "expectedCount": 0 }
  ],
  "cleanupFunction": "internal/example:cleanupLegacyField",
  "verifier": "bun run convex:schema-preflight",
  "rollback": "Reintroduce the optional field, redeploy, clean up, and retry."
}
```

`status` values:

- `expand`: compatibility schema is deployed and code should stop writing the
  legacy field.
- `migrate`: cleanup is available or running; the field must still remain
  optional in `convex/schema.ts`.
- `contracted`: aggregate counts are verified at zero and the schema field is
  allowed to be removed.

Run the local guard before removing fields:

```bash
bun run convex:schema-guard
```

The guard and preflight prepare their git diff base before reading
`convex/schema.ts` from that ref. By default they fetch `main` into
`origin/main`. Fetch source order is explicit `SCHEMA_GUARD_REPO_URL`, then the
checkout's `origin` remote, then Vercel's public GitHub metadata only when no
origin remote is present and `SCHEMA_GUARD_ALLOW_VERCEL_GITHUB_FALLBACK=1` is
set. Private forks and non-GitHub clones should make `origin` fetchable or set
`SCHEMA_GUARD_REPO_URL` in private CI/Vercel settings.

Use `SCHEMA_GUARD_REPO_URL` for private forks, renamed repositories, mirrors,
non-GitHub providers, and any environment where the base branch requires
credentials. Enable `SCHEMA_GUARD_ALLOW_VERCEL_GITHUB_FALLBACK=1` only for
public GitHub repositories that can be fetched without credentials. Never commit
credential-bearing repository URLs or expose them through `NEXT_PUBLIC_*`.

Run the production preflight before `convex deploy`:

```bash
bun run convex:schema-preflight
```

Production deploys should use the shared command, which runs the preflight
before `convex deploy`:

```bash
bun run convex:deploy
```

The shared command runs a required-base dry run for Vercel previews and a
required-base production aggregate preflight for production deploys. Use
`CONVEX_SCHEMA_PREFLIGHT_MODE=prod` or
`CONVEX_SCHEMA_PREFLIGHT_MODE=dry-run` only for explicit environment overrides.
For local or CI dry-run validation, prefer:

```bash
bun run convex:schema-preflight:dry-run
```

Appending `--dry-run` to `bun run convex:schema-preflight` is supported and
keeps the production command's target/base semantics while skipping the Convex
query, but the dedicated dry-run script is clearer for validation.

Both scripts print only table names, field names, and aggregate counts. The
preflight's built-in count query is a full-table scan per field; the limit caps
positive result payloads, but zero counts require the scan to finish. Query
timeouts or Convex CLI failures block deploys because the counts are not
verified.
