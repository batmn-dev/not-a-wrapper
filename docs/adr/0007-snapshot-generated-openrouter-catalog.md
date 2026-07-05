# 0007 — Snapshot-generated OpenRouter catalog

**Status:** accepted **Date:** 2026-07-05

**Context.** The OpenRouter catalog is our highest-churn model surface:
`:free` ids get delisted without notice (2026-07-04 incident, commit
PR #98, `063a4be`), pricing and `supported_parameters` drift, and every entry
carries hand-maintained provenance fields (`verifiedAgainst`,
`lastVerifiedAt`). Expanding from 2 to ~28 wrapped entries multiplies that
maintenance surface. The live listing (`GET /api/v1/models`, keyless, free) is
authoritative for ids, pricing, context length, and capability parameters.

**Decision.** OpenRouter catalog entries are generated, not hand-written.
Three artifacts live in the repo: (1) `lib/models/data/openrouter.snapshot.json`
— a pruned copy of the live listing restricted to allowlisted ids, stamped
with its retrieval date; (2) `lib/models/data/openrouter.allowlist.ts` — the
curated id list plus per-model editorial overrides and reasoning policy;
(3) `lib/models/data/openrouter.generated.ts` — the emitted `ModelConfig[]`,
never hand-edited. `scripts/generate-openrouter-catalog.ts` converts (1)+(2)
into (3); `--fetch` refreshes the snapshot from the live API first; `--check`
re-generates offline and fails on diff (wired into CI). Generation fails
loudly when an allowlisted id is absent from the snapshot, printing the
succession stub for `lib/models/model-id-migration.ts`.

**Consequences.** Catalog drift is detected by CI (`--check`) and by the
keyless smoke (`bun run smoke:openrouter`), and fixed by one command plus a
curated diff review. Editorial quality stays human-owned in the allowlist.
The `ModelConfig` shape and all downstream seams are unchanged. Direct
provider catalogs remain hand-authored (low churn). A logical-model/route
layer remains possible later because wrapped ids already encode the vendor.
