# Convex Schema Contractions

Convex validates existing documents when a schema is pushed. If a field is
removed from `convex/schema.ts` while deployed documents still contain that
field, `convex deploy` can fail after the frontend build succeeds. Do not
disable schema validation to work around this.

## Required Workflow

Use expand/migrate/contract for every schema contraction:

1. **Expand/compat:** keep the legacy field in `convex/schema.ts` as optional.
   Stop writing it from application code.
2. **Migrate:** add or run an idempotent cleanup mutation that patches the
   legacy field to `undefined`. In Convex, patching a field to `undefined`
   removes it from the document.
3. **Verify:** run read-only aggregate checks against the target deployment.
   Only table names, field names, and counts may be printed.
4. **Contract:** remove the field from `convex/schema.ts` only after every
   expected count is zero. Set the matching manifest status to `contracted`.

## Migration Manifests

Each contraction needs a JSON manifest in `convex/migrations/`.

```json
{
  "kind": "convex-schema-contraction",
  "id": "2026-05-22-example-field-removal",
  "status": "contracted",
  "description": "Why this field was removed.",
  "fields": [
    { "table": "messages", "field": "legacyField", "expectedCount": 0 }
  ],
  "cleanupFunction": "internal/example:cleanupLegacyField",
  "verifier": "bun run convex:schema-preflight",
  "rollback": "Reintroduce the optional field, redeploy, clean up, and retry."
}
```

`status` values:

- `expand`: compatibility schema is deployed and code no longer writes the
  field.
- `migrate`: cleanup exists or is running; the field must remain optional.
- `contracted`: zero counts have been verified and the schema field may be
  removed.

## PR Guard

The guard compares `convex/schema.ts` against `origin/main` and fails when a
field was removed without a matching `contracted` manifest.

```bash
bun run convex:schema-guard
```

This guard does not query production data, so it is safe for pull request CI and
forkable contexts. It intentionally does not block additive schema changes, such
as adding optional fields.

## Deploy Preflight

Run the preflight before `convex deploy` for production deploys:

```bash
bun run convex:schema-preflight
```

The preflight:

- loads contracted migration manifests from `convex/migrations/`
- detects schema field removals when a git base ref is available
- runs a read-only Convex inline query against the target deployment
- prints only `table.field` and aggregate count data
- fails closed if the read-only verification cannot run or any expected zero
  count is nonzero
- fails closed if the production diff base cannot be read

Production deploys use the shared deploy script so the preflight runs before
`convex deploy`:

```bash
bun run convex:deploy
```

Useful local checks:

```bash
node scripts/convex-schema-contract-preflight.mjs --dry-run
bun run convex:schema-preflight --dry-run
node scripts/convex-schema-contract-preflight.mjs --deployment dev
bun run convex:schema-preflight
```

## Aggregate Query Limits

The built-in preflight uses a read-only inline query that checks each
`table.field` with a full-table scan. The `.take(limit + 1)` cap limits how
many positive matches are returned, but proving a zero count still requires
Convex to scan the whole table. If the query times out or the Convex CLI
returns an operational error, the deploy is blocked because the counts are not
verified.

Keep manifests simple: every contracted field must still use
`"expectedCount": 0`. For very large tables, add an indexed cleanup or verifier
function in the migration notes and keep the legacy schema field optional until
the target deployment can be verified at zero.

## Rollback

If preflight fails:

1. Reintroduce the removed schema fields as optional.
2. Deploy the expand/compat schema.
3. Run the idempotent cleanup mutation again.
4. Rerun the preflight and verify every count is zero.
5. Retry the strict schema deploy.

Never paste raw production document output into logs, tickets, docs, or PRs.
