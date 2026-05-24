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

The guard prepares the configured base ref, compares `convex/schema.ts` against
that base, and fails when a field was removed without a matching `contracted`
manifest. The default base ref is `origin/main`.

```bash
bun run convex:schema-guard
```

This guard does not query production data, so it is safe for pull request CI and
forkable contexts. It intentionally does not block additive schema changes, such
as adding optional fields.

Base-ref setup is explicit and fail-closed. Fetch source order is:

1. `--repo-url` or `SCHEMA_GUARD_REPO_URL`, when explicitly configured.
2. The checkout's existing `origin` remote, preserving any credentials supplied
   by GitHub Actions, Vercel, a private fork, or another Git provider.
3. Vercel's public GitHub metadata, only when the provider is GitHub and no
   usable `origin` remote is present and
   `SCHEMA_GUARD_ALLOW_VERCEL_GITHUB_FALLBACK=1` is set.

Private forks, renamed repositories, non-GitHub clones, and Vercel projects
without a fetchable `origin` must set `SCHEMA_GUARD_REPO_URL` to a read-capable
repository URL or make `origin` fetchable. Public GitHub repos may opt into the
Vercel metadata fallback with `SCHEMA_GUARD_ALLOW_VERCEL_GITHUB_FALLBACK=1`.
Store credential-bearing URLs only in private CI/Vercel environment settings;
never expose them through `NEXT_PUBLIC_*` variables or committed files.

For private or renamed forks:

- GitHub Actions usually has a credentialed `origin` after `actions/checkout`.
  If your fork, mirror, or self-hosted runner does not, set
  `SCHEMA_GUARD_REPO_URL` as a repository secret or private variable.
- Vercel projects should set `SCHEMA_GUARD_REPO_URL` when the build checkout
  lacks a fetchable `origin`, uses a non-GitHub provider, or needs credentials
  to read the base branch.
- Contributors outside GitHub Actions and Vercel can either run from a checkout
  with a fetchable `origin` or pass `--repo-url` / `SCHEMA_GUARD_REPO_URL`.

Only enable `SCHEMA_GUARD_ALLOW_VERCEL_GITHUB_FALLBACK=1` for public GitHub
repositories where an unauthenticated `https://github.com/<owner>/<repo>.git`
fetch is expected to work.

## Deploy Preflight

Run the preflight before `convex deploy` for production deploys:

```bash
bun run convex:schema-preflight
```

The preflight:

- loads contracted migration manifests from `convex/migrations/`
- fetches and reads the configured git base ref before production checks
- detects schema field removals against that git base ref
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

`bun run convex:deploy` chooses the preflight mode from the deploy environment:

- Vercel preview/development deploys fetch the diff base, require it to be
  readable, and run a dry-run schema/manifest check before `convex deploy`.
  They do not query production data, because the preview deployment may not
  exist until `convex deploy` claims or creates it.
- Production, GitHub Actions main-branch deploys, and local production deploys
  fetch the diff base, require it to be readable, run the read-only aggregate
  production check, and only then run `convex deploy`.

Set `CONVEX_SCHEMA_PREFLIGHT_MODE=prod` or
`CONVEX_SCHEMA_PREFLIGHT_MODE=dry-run` only when a deploy environment needs an
explicit override.

Useful local checks:

```bash
node scripts/convex-schema-contract-preflight.mjs --dry-run
bun run convex:schema-preflight:dry-run
bun run convex:schema-preflight --dry-run
SCHEMA_GUARD_REPO_URL=<read-capable-repo-url> bun run convex:schema-preflight --dry-run
node scripts/convex-schema-contract-preflight.mjs --deployment dev
bun run convex:schema-preflight
```

`bun run convex:schema-preflight` is the production-oriented package command.
Appending `--dry-run` is intentional when you want the same production target
and required-base semantics without querying Convex, but the clearer local and
CI dry-run command is `bun run convex:schema-preflight:dry-run` or the direct
script invocation above.

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
