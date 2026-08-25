// OpenRouter catalog — GENERATED since 2026-07-05 (ADR 0007). The entries
// live in `openrouter.generated.ts`, rendered from the committed snapshot
// (`openrouter.snapshot.json`, machine facts) + the curated allowlist
// (`openrouter.allowlist.ts`, editorial). Never hand-edit the generated file;
// refresh with `bun run catalog:openrouter:refresh`.
//
// Incident history: OpenRouter has repeatedly delisted free-pool ids without
// notice (2026-07-04, 2026-08-20, and 2026-08-25). Successions live in
// `lib/models/model-id-migration.ts`. That churn class is why this catalog is
// generated: a delisting is a loud generator failure with a ready-to-paste
// succession stub, not an archaeology session.
export { openrouterModels } from "./openrouter.generated"
