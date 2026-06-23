# Convex Schema Migrations — DORMANT (pre-launch)

This project has **no users and no production data**. Schema changes are made
directly in `convex/schema.ts`; if existing dev data conflicts, wipe it and move
on. There is no migration ceremony to perform.

See **AGENTS.md → "Pre-Launch: The Database Is Disposable"** for the policy.

The expand/migrate/contract workflow, migration manifests
(`convex/migrations/`), and the schema-guard / deploy preflight are **not in
effect until the app launches**. The full pre-launch procedure (manifests,
aggregate zero-count verification, `convex:schema-guard`, `convex:schema-preflight`)
is preserved in git history and should be restored when real users exist.
