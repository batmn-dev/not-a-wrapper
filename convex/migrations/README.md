# Convex schema contraction manifests

The manifest workflow is dormant for ordinary pre-launch development. Change
`convex/schema.ts` directly and wipe development data when needed.

Production may still contain smoke-test or manually created rows. Keep fields
that reached production optional until the deploy preflight proves contraction
is safe, or production is explicitly marked disposable. Existing manifests are
historical records of those production-facing contractions.

See [the migration guide](../../docs/convex-migrations.md) and AGENTS.md.
