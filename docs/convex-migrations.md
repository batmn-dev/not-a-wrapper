# Convex Schema Migrations

This project has **no users**. Development schema changes are made directly in
`convex/schema.ts`; if existing dev data conflicts, wipe it and move on. There is
no migration ceremony for disposable non-production data.

See **AGENTS.md → "Pre-Launch: The Database Is Disposable"** for the policy.

Production deploys are different: production Convex may contain smoke-test or
manual rows, and Convex validates existing documents against the pushed schema.
Keep fields that have reached production optional until the production data is
cleaned or intentionally discarded. The deploy preflight remains active for
production and CI dry-run checks, and can be skipped for production only by
deliberately setting `CONVEX_PROD_DB_DISPOSABLE=true`.
