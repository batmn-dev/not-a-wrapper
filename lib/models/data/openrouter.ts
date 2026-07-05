// OpenRouter catalog — GENERATED since 2026-07-05 (ADR 0007). The entries
// live in `openrouter.generated.ts`, rendered from the committed snapshot
// (`openrouter.snapshot.json`, machine facts) + the curated allowlist
// (`openrouter.allowlist.ts`, editorial). Never hand-edit the generated file;
// refresh with `bun run catalog:openrouter:refresh`.
//
// Incident history: 2026-07-04 — OpenRouter delisted both then-current free
// entries (`deepseek/deepseek-r1:free`, `meta-llama/llama-3.3-8b-instruct:free`)
// overnight; the live API returned "No endpoints found". Successions live in
// `lib/models/model-id-migration.ts`. That churn class is why this catalog is
// generated: a delisting is now a loud generator failure with a ready-to-paste
// succession stub, not an archaeology session.
export { openrouterModels } from "./openrouter.generated"
