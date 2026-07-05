# Model catalog expansion — implementation plan

**Status:** investigation complete, ready to implement. **Investigated:** 2026-07-04
(all file:line references and live-API facts verified that day, on branch
`darknight/bludhaven`; baseline `bunx tsc --noEmit` and `bun run test` green).

> **Concurrency note (2026-07-04 ~23:30):** while this plan was being written,
> a separate uncommitted refactor landed in the working tree touching
> `lib/openproviders/{provider-map,create-language-model,model-factory,provider-strategy}.ts`,
> `lib/models/types.ts`, and `scripts/smoke-openrouter.ts` — it split
> `getProviderForModel` into `getProviderForResolvedModel` + a resolving
> wrapper, centralized id resolution in the model factory, made the
> `ModelReasoningSettings` variants mutually exclusive (`never` fields), and
> stopped the smoke script printing masked key material. All citations below
> were re-verified against that state. Nothing in it conflicts with this plan;
> if those files move again before implementation, anchor on the quoted symbol
> names, not just the line numbers.

This document is self-contained: it carries the architecture decision, the
evidence-cited model matrix, the verified seam inventory, phased steps, per-phase
verification, risks, and the product decisions that need the owner. An
implementing agent should not need any other context, but MUST re-verify model
facts against the cited sources before shipping — model catalogs rot (see §8
evidence log; every fact below carries its source and retrieval date).

**Why this exists.** OpenRouter is the app's default BYOK provider
([byok-section.tsx:46-54](../app/components/layout/settings/apikeys/byok-section.tsx),
default-selected at :108), yet the catalog ships exactly two `:free` OpenRouter
models — a user who saves an OpenRouter key can reach almost nothing with it, and
paid OpenRouter credits are structurally unspendable. The four direct-provider
catalogs have also drifted behind current generations (Claude tops out at 4.6,
OpenAI at GPT-5.4, Gemini at 2.5, Grok at 4.1-fast). The 2026-07-04 delisting
incident (commit `f872214`: two `:free` ids vanished overnight) proved that any
expansion multiplies churn surface — the architecture below makes drift cheap to
detect and cheap to fix.

---

## 1. Decision summary

**Chosen architecture: snapshot-generated OpenRouter catalog + hand-authored
direct-provider refresh** (a hybrid of options 2 and 1 below).

- **OpenRouter (the churn-heavy side)** moves to a generator: a committed,
  pruned snapshot of `GET https://openrouter.ai/api/v1/models` + a curated
  allowlist-with-overrides file + a script that renders
  `lib/models/data/openrouter.generated.ts`. Refreshing the catalog becomes one
  command; a delisting becomes a diff, not an archaeology session. Facts that
  rot (context length, pricing, `supported_parameters`, listing existence)
  are machine-derived from the snapshot; editorial content (names,
  descriptions, tags, curation, reasoning policy) lives in the allowlist.
- **Direct providers (slow-churn, 4 small files)** stay hand-authored. There is
  no single free machine-readable source across Anthropic/OpenAI/Google/xAI
  worth building tooling for; entries change a few times a year.
- **Logical-model layer is deferred**, not rejected forever. The wrapped-id
  scheme (`openrouter:vendor/model`) already encodes the underlying vendor, so
  a future dedupe/routing layer can be added at the selector level without
  changing persisted ids.

### Options considered

Scored against: maintainability under churn / selector clarity / gating
simplicity / type safety / blast radius / test surface / agent-implementability.

**Option 1 — extended status quo** (hand-author ~28 more `ModelConfig` entries).
Rejected for OpenRouter: the free pool alone churned twice in four months
(delisting incident of 2026-07-04), and hand-maintaining `verifiedAgainst` /
`lastVerifiedAt` / pricing / `supported_parameters`-derived flags across ~28
wrapped entries is exactly the transcription-error surface that PR #97 warned
about. Accepted for the four direct catalogs, where entries are few and stable.

**Option 2 — snapshot-generated catalog.** Chosen for OpenRouter.
Maintainability: refresh = `bun run catalog:openrouter:refresh`; drift = a
readable JSON diff; a delisted id fails generation loudly with the succession
stub printed. Selector/gating/type-safety: unchanged — the generator emits the
same `ModelConfig[]` shape, `getAllModels()` and everything downstream is
untouched. Blast radius: one script + two data files. Test surface: one focused
generator test. CI can gate cheaply (`--check` regenerates from the *committed*
snapshot — deterministic, no network). Agent-implementability: high; a
deterministic generator beats 28 hand-built literals.

**Option 3 — logical-model layer** (one canonical model, multiple routes,
selector dedupe, per-route availability, routing preference). Most composable,
honestly sized: it touches `ModelConfig` (routes array), both gating paths
(`lib/models/index.ts:25-30` and `lib/model-store/provider.tsx:111-124`), the
selector, favorites persistence (`convex/schema.ts:67` stores flat id strings),
chat/message persistence (`convex/schema.ts:76,137` store the routed id), the
adapter registry, and analytics dimensions. That is 3-4× the blast radius of
option 2 for a UX win (dedupe of ~6 dual-route models) the owner hasn't asked
for yet. Deferred; see Open decision D2 for the interim presentation.

### ADR draft (proposal for `docs/adr/0007-snapshot-generated-openrouter-catalog.md`)

The implementer should commit this as ADR 0007 (adjust number if taken):

> **# 0007 — Snapshot-generated OpenRouter catalog**
>
> **Status:** accepted **Date:** (implementation date)
>
> **Context.** The OpenRouter catalog is our highest-churn model surface:
> `:free` ids get delisted without notice (2026-07-04 incident, commit
> `f872214`), pricing and `supported_parameters` drift, and every entry carries
> hand-maintained provenance fields (`verifiedAgainst`, `lastVerifiedAt`).
> Expanding from 2 to ~28 wrapped entries multiplies that maintenance surface.
> The live listing (`GET /api/v1/models`, keyless, free) is authoritative for
> ids, pricing, context length, and capability parameters.
>
> **Decision.** OpenRouter catalog entries are generated, not hand-written.
> Three artifacts live in the repo: (1) `lib/models/data/openrouter.snapshot.json`
> — a pruned copy of the live listing restricted to allowlisted ids, stamped
> with its retrieval date; (2) `lib/models/data/openrouter.allowlist.ts` — the
> curated id list plus per-model editorial overrides and reasoning policy;
> (3) `lib/models/data/openrouter.generated.ts` — the emitted `ModelConfig[]`,
> never hand-edited. `scripts/generate-openrouter-catalog.ts` converts (1)+(2)
> into (3); `--fetch` refreshes the snapshot from the live API first; `--check`
> re-generates offline and fails on diff (wired into CI). Generation fails
> loudly when an allowlisted id is absent from the snapshot, printing the
> succession stub for `lib/models/model-id-migration.ts`.
>
> **Consequences.** Catalog drift is detected by CI (`--check`) and by the
> keyless smoke (`bun run smoke:openrouter`), and fixed by one command plus a
> curated diff review. Editorial quality stays human-owned in the allowlist.
> The `ModelConfig` shape and all downstream seams are unchanged. Direct
> provider catalogs remain hand-authored (low churn). A logical-model/route
> layer remains possible later because wrapped ids already encode the vendor.

---

## 2. Model matrix

Conventions used below:

- **Wrapped id** = `openrouter:` + bare OpenRouter slug. `verifiedAgainst` =
  the bare slug; `idKind: "wrapped"`; `providerId: "openrouter"`;
  `provider: "OpenRouter"`; `webSearch: false` (no OpenRouter search tool —
  [provider-strategy.ts:274](../lib/openproviders/provider-strategy.ts)).
- **Reasoning config**: `reasoning: { effort: "medium" }` is set iff the live
  `supported_parameters` for that slug includes `reasoning` (verified
  2026-07-04, snapshot §8-E1) and we want reasoning surfaced; those entries
  also get `reasoningText: true`. This is CONSTRUCTION-TIME config — the
  OpenRouter provider is spec-V3 and ignores ai@7's per-call unified
  `reasoning` option (§3 seam S4).
- **History adapter** is what `resolveAdapter` will pick after Phase 1
  ([adapters/index.ts:57-76](../app/api/chat/adapters/index.ts)): the vendor
  prefix of the slug, mapped through the registry.
- **Access tier**: `BYOK` = accessible only when the user saved an OpenRouter
  key (automatic — `lib/model-store/provider.tsx:111-124` +
  `app/api/chat/api.ts:174`); `free` = also in `FREE_MODELS_IDS` (only if
  Open decision D4 approves); `platform` = reachable through a platform env
  key (only if D5 approves).
- **Prices** are USD per 1M input/output tokens.

### 2A. OpenRouter-wrapped — existing entries (keep, regenerate)

Evidence for every 2A/2B/2C row: live `GET https://openrouter.ai/api/v1/models`,
retrieved **2026-07-04** (340 models; snapshot to be committed as
`openrouter.snapshot.json`). Per-row page: `https://openrouter.ai/<slug>`.

| Our catalog id (wrapped) | verifiedAgainst | Ctx | $in/$out | Reasoning cfg | Adapter | tools/vision | Tier | Status |
|---|---|---|---|---|---|---|---|---|
| `openrouter:openai/gpt-oss-120b:free` | `openai/gpt-oss-120b:free` | 131,072 | 0/0 | `{effort:"medium"}` | openai | ✓/✗ | free (already in `FREE_MODELS_IDS`) | visible |
| `openrouter:meta-llama/llama-3.3-70b-instruct:free` | `meta-llama/llama-3.3-70b-instruct:free` | 131,072 | 0/0 | none (no `reasoning` param live) | openai-compatible (new; was default) | ✓/✗ | free (already) | visible |

Succession notes: none — both remain live-listed as of 2026-07-04.
Note: existing entry `llama-3.3-70b` has `webSearch: true` at
[openrouter.ts:72](../lib/models/data/openrouter.ts) — the generator should emit
`webSearch: false` for all wrapped entries (OpenRouter path has no native search
tool); this is a deliberate correction, record it in the allowlist comment.

### 2B. OpenRouter-wrapped — new `:free` candidates (3)

All $0.00/$0.00. Free-pool rules: 50 req/day (20 RPM) without credits; 1000/day
with ≥$10 lifetime credits — <https://openrouter.ai/docs/api/reference/limits>
(retrieved 2026-07-04).

| Our catalog id | verifiedAgainst | Ctx | maxOut | Reasoning cfg | Adapter | tools/vision | Tier | Status |
|---|---|---|---|---|---|---|---|---|
| `openrouter:qwen/qwen3-coder:free` | `qwen/qwen3-coder:free` | 1,048,576 | 262,000 | none (`reasoning` not in params) | openai-compatible | ✓/✗ | BYOK now; D4 candidate for free | visible |
| `openrouter:google/gemma-4-26b-a4b-it:free` | `google/gemma-4-26b-a4b-it:free` | 262,144 | 32,768 | `{effort:"medium"}` | google | ✓/✓ | BYOK now; D4 candidate | visible |
| `openrouter:nvidia/nemotron-3-ultra-550b-a55b:free` | `nvidia/nemotron-3-ultra-550b-a55b:free` | 1,000,000 | 65,536 | `{effort:"medium"}` | openai-compatible | ✓/✗ | BYOK now; D4 candidate | visible |

(Free-pool alternates seen live 2026-07-04, for future refresh consideration:
`poolside/laguna-xs-2.1:free`, `cohere/north-mini-code:free`,
`nvidia/nemotron-3-super-120b-a12b:free`, `openai/gpt-oss-20b:free`.)

### 2C. OpenRouter-wrapped — new paid candidates (23, BYOK-gated)

All BYOK tier, `catalogStatus: "visible"`, `idKind: "wrapped"`. Reasoning cfg
`{effort:"medium"}` everywhere the live params include `reasoning` (all rows
below except where noted). Anthropic slugs on OpenRouter use **dots**
(`claude-opus-4.8`), unlike the direct API's dashes — the wrapped id and the
direct id are different strings on purpose.

| Our catalog id | verifiedAgainst | Ctx | maxOut | $in/$out | Adapter | tools/vision | Notes |
|---|---|---|---|---|---|---|---|
| `openrouter:anthropic/claude-sonnet-5` | `anthropic/claude-sonnet-5` | 1,000,000 | 128,000 | 2.00/10.00 (intro; sticker 3/15 after 2026-08-31) | anthropic | ✓/✓ | |
| `openrouter:anthropic/claude-opus-4.8` | `anthropic/claude-opus-4.8` | 1,000,000 | 128,000 | 5.00/25.00 | anthropic | ✓/✓ | skip `-fast` variant ($10/$50) |
| `openrouter:anthropic/claude-fable-5` | `anthropic/claude-fable-5` | 1,000,000 | 128,000 | 10.00/50.00 | anthropic | ✓/✓ | may return `refusal` stop; requires 30-day-retention orgs upstream — note in description |
| `openrouter:anthropic/claude-haiku-4.5` | `anthropic/claude-haiku-4.5` | 200,000 | 64,000 | 1.00/5.00 | anthropic | ✓/✓ | |
| `openrouter:openai/gpt-5.5` | `openai/gpt-5.5` | 1,050,000 | 128,000 | 5.00/30.00 | openai | ✓/✓ | |
| `openrouter:openai/gpt-5.4` | `openai/gpt-5.4` | 1,050,000 | 128,000 | 2.50/15.00 | openai | ✓/✓ | |
| `openrouter:openai/gpt-5.4-mini` | `openai/gpt-5.4-mini` | 400,000 | 128,000 | 0.75/4.50 | openai | ✓/✓ | |
| `openrouter:google/gemini-3.5-flash` | `google/gemini-3.5-flash` | 1,048,576 | 65,536 | 1.50/9.00 | google | ✓/✓ | |
| `openrouter:google/gemini-3.1-pro-preview` | `google/gemini-3.1-pro-preview` | 1,048,576 | 65,536 | 2.00/12.00 | google | ✓/✓ | preview id — succession-ready when stable ships |
| `openrouter:google/gemini-3.1-flash-lite` | `google/gemini-3.1-flash-lite` | 1,048,576 | 65,536 | 0.25/1.50 | google | ✓/✓ | |
| `openrouter:x-ai/grok-4.3` | `x-ai/grok-4.3` | 1,000,000 | (unlisted) | 1.25/2.50 | xai (→ openai-compatible via registry) | ✓/✓ | |
| `openrouter:deepseek/deepseek-v4-pro` | `deepseek/deepseek-v4-pro` | 1,048,576 | 384,000 | 0.43/0.87 | openai-compatible (new) | ✓/✗ | |
| `openrouter:deepseek/deepseek-v4-flash` | `deepseek/deepseek-v4-flash` | 1,048,576 | 16,384 | 0.09/0.18 | openai-compatible (new) | ✓/✗ | |
| `openrouter:z-ai/glm-5.2` | `z-ai/glm-5.2` | 1,048,576 | 131,072 | 0.74/2.33 | openai-compatible (new) | ✓/✗ | |
| `openrouter:z-ai/glm-5` | `z-ai/glm-5` | 202,752 | (unlisted) | 0.60/1.92 | openai-compatible (new) | ✓/✗ | |
| `openrouter:moonshotai/kimi-k2.6` | `moonshotai/kimi-k2.6` | 262,144 | 262,144 | 0.66/3.41 | openai-compatible (new) | ✓/✓ | |
| `openrouter:minimax/minimax-m3` | `minimax/minimax-m3` | 1,048,576 | 512,000 | 0.30/1.20 | openai-compatible (new) | ✓/✓ | |
| `openrouter:minimax/minimax-m2.5` | `minimax/minimax-m2.5` | 204,800 | 196,608 | 0.12/0.48 | openai-compatible (new) | ✓/✗ | |
| `openrouter:qwen/qwen3.7-max` | `qwen/qwen3.7-max` | 1,000,000 | 65,536 | 1.25/3.75 | openai-compatible (new) | ✓/✗ | |
| `openrouter:qwen/qwen3-coder` | `qwen/qwen3-coder` | 1,048,576 | 65,536 | 0.22/1.80 | openai-compatible (new) | ✓/✗ | no `reasoning` param → no reasoning cfg, `reasoningText: false` |
| `openrouter:meta-llama/llama-4-maverick` | `meta-llama/llama-4-maverick` | 1,048,576 | 16,384 | 0.15/0.60 | openai-compatible (new) | ✓/✓ | no `reasoning` param → no cfg |
| `openrouter:xiaomi/mimo-v2.5` | `xiaomi/mimo-v2.5` | 1,048,576 | (unlisted) | 0.10/0.28 | openai-compatible (new) | ✓/✓ | |
| `openrouter:inclusionai/ling-2.6-flash` | `inclusionai/ling-2.6-flash` | 262,144 | 32,768 | 0.01/0.03 | openai-compatible (new) | ✓/✗ | no `reasoning` param → no cfg |

Succession notes for 2A-2C: no existing catalog id is removed, so **no new
entries in `MODEL_ID_SUCCESSIONS` are required** by this expansion. The
generator must enforce the invariant documented at
[model-id-migration.ts:95-97](../lib/models/model-id-migration.ts): successions
resolve in a single hop and must target live catalog ids — if a future refresh
deletes any id above, add a succession from it to its family's nearest survivor.

**Deliberately excluded** (record in the allowlist file as comments so the next
curator doesn't re-litigate): `openai/gpt-5.5-pro` / `gpt-5.4-pro` wrapped
($30/$180 — direct catalog already carries 5.4-pro), `o3`/`o3-pro` (previous
gen), `anthropic/*-fast` variants (2× price), `x-ai/grok-build-0.1` (xAI "Code
API" product — unverified on the chat surface), `x-ai/grok-4.20*` (superseded by
4.3), `openrouter/auto|free|fusion` router pseudo-models (variable pricing
sentinel `-1000000`), image/audio/video models (Nano Banana, Lyria, Imagine,
GPT-Image, TTS/Live), `moonshotai/kimi-k2.7-code` (16k maxOut, code-only),
`minimax/minimax-m2-her` (no tools, 2k maxOut).

**Appendix-A reference-list reconciliation** (competing app's list, transcribed
2026-07-04): every family on that list maps to a live vendor above — Claude ✓,
GPT ✓, Gemini ✓, Grok ✓ (their "Grok 4.20" = `x-ai/grok-4.20`, dated
`-0309` ids on xAI direct), DeepSeek ✓, GLM = `z-ai/*` ✓, Kimi = `moonshotai/*`
✓, MiniMax ✓, Qwen ✓, MiMo = `xiaomi/*` ✓, Ling = `inclusionai/*` ✓, Gemma ✓,
Llama ✓, GPT-OSS ✓. **"Owl Alpha" has NO live match** (no id or name contains
"owl"; likely a delisted stealth model) — do not invent an entry for it.
"MiMo v2 Flash" and "Ling 2.6 Flash" names correspond to `xiaomi/mimo-v2.5`-era
and `inclusionai/ling-2.6-flash` slugs; display names in the reference app are
not API ids — never copy them verbatim.

### 2D. Direct-provider refresh — new entries

| Our id (= API id) | File | idKind | Ctx | maxOut | $in/$out | Reasoning | Status | Evidence (retrieved 2026-07-04) |
|---|---|---|---|---|---|---|---|---|
| `claude-opus-4-8` | claude.ts | stable | 1,000,000 | 128,000 | 5/25 | `reasoningText: true`, `thinkingMode: "adaptive"` | visible | <https://platform.claude.com/docs/en/about-claude/models/overview.md> |
| `claude-sonnet-5` | claude.ts | stable | 1,000,000 | 128,000 | 3/15 (intro 2/10 → 2026-08-31) | adaptive | visible | same |
| `claude-fable-5` | claude.ts | stable | 1,000,000 | 128,000 | 10/50 | adaptive (always-on upstream) | visible (owner may prefer hidden — D1) | same; note: refusal stop-reason + 30-day-retention requirement |
| `gpt-5.5` | openai.ts | stable | 1,050,000 | 128,000 | 5/30 | `reasoningText: true` | visible | <https://developers.openai.com/api/docs/models> + <https://developers.openai.com/api/docs/pricing> |
| `gpt-5.4-mini` | openai.ts | stable | 400,000 | 128,000 | 0.75/4.50 | true | visible | same |
| `gpt-5.4-nano` | openai.ts | stable | 400,000 | 128,000 | 0.20/1.25 | true | hidden (routable, not promoted) | pricing page lists it; models page does not headline it |
| `gemini-3.5-flash` | gemini.ts | stable | 1,048,576 | 65,536 | 1.50/9.00 | true | visible | <https://ai.google.dev/gemini-api/docs/models> (stable) + <https://ai.google.dev/gemini-api/docs/pricing> |
| `gemini-3.1-pro-preview` | gemini.ts | stable | 1,048,576 | 65,536 | 2.00/12.00 (≤200k prompts; 4.00/18.00 above) | true | visible | same (listed **preview**) |
| `gemini-3.1-flash-lite` | gemini.ts | stable | 1,048,576 | 65,536 | 0.25/1.50 | true | visible | same (stable) |
| `grok-4.3` | grok.ts | stable | 1,000,000 | (docs don't state; leave unset) | 1.25/2.50 | true | visible | <https://docs.x.ai/docs/models> |

Direct-id verification warnings for the implementer:

- **xAI ids are NOT the OpenRouter slugs.** xAI docs list `grok-4.3`,
  `grok-4.20-0309-reasoning`, `grok-4.20-0309-non-reasoning`,
  `grok-4.20-multi-agent-0309`, `grok-build-0.1` (2026-07-04). The strategy
  routes xAI through the **Responses API**
  ([provider-strategy.ts:220-229](../lib/openproviders/provider-strategy.ts));
  the four currently-cataloged Grok ids were verified against it 2026-07-03
  (comment at :225-227). `grok-4.3` must get the same one-off keyed
  verification before flipping visible (Phase 3 verification).
- **Gemini 3.1 Pro is still a preview id.** When Google ships a stable
  `gemini-3.1-pro`, retire the preview id with a succession entry.
- Do **not** add `gpt-5.6` (partner-preview only per OpenAI models page) or
  any Gemini `-tts`/`-live`/`-image` ids.
- Corroboration caveat: the exact `gpt-5.5` context value (1,050,000) and the
  Gemini 3.x token limits in §2D come from the OpenRouter listing (E1) — the
  OpenAI page rounds to "1M" and Google's models page doesn't render limits to
  a headless fetch. Re-verify on the provider pages at implementation time.

### 2E. Direct-provider refresh — modifications to existing entries

| Id | File:lines | Change | Why (evidence 2026-07-04) |
|---|---|---|---|
| `claude-opus-4-6` | [claude.ts:4-36](../lib/models/data/claude.ts) | `catalogStatus: "legacy"`, `replacementModelId: "claude-opus-4-8"`; fix `contextWindow` 200000 → **1000000**; refresh `lastVerifiedAt` | Anthropic overview.md legacy table: 1M ctx, still active |
| `claude-sonnet-4-6` | [claude.ts:38-70](../lib/models/data/claude.ts) | `catalogStatus: "legacy"`, `replacementModelId: "claude-sonnet-5"`; fix ctx 200000 → **1000000**, maxOutput 64000 → **128000** | same |
| `claude-haiku-4-5-20251001` | claude.ts:106-136 | keep visible; refresh `lastVerifiedAt` | still Anthropic's current fast tier |
| `gpt-5.4` | [openai.ts:4-35](../lib/models/data/openai.ts) | keep visible (workhorse price point); refresh verification date | OpenAI pricing page |
| `gpt-5.4-pro` | openai.ts:37-68 | keep visible; price stays 30/180 | same |
| `gpt-5-mini` | openai.ts:136-166 | **DO NOT TOUCH** (in `FREE_MODELS_IDS`, `NON_AUTH_ALLOWED_MODELS`, and both defaults) | guard, see Phase 3 |
| `gemini-2.5-pro` | [gemini.ts:63-90](../lib/models/data/gemini.ts) | `legacy`, `replacementModelId: "gemini-3.1-pro-preview"` | 3.x generation shipped |
| `gemini-2.5-flash` | gemini.ts:34-61 | `legacy`, `replacementModelId: "gemini-3.5-flash"` | same |
| `gemini-2.5-flash-lite` | gemini.ts:5-32 | `legacy`, `replacementModelId: "gemini-3.1-flash-lite"` | same |
| `grok-4-1-fast-reasoning` | [grok.ts:35-63](../lib/models/data/grok.ts) | `legacy`, `replacementModelId: "grok-4.3"` (id still routable — verified against Responses API 2026-07-03 per provider-strategy.ts:225-227 — but absent from xAI's current models page) | docs.x.ai/docs/models |
| `grok-code-fast-1` | grok.ts:93-119 | `legacy`, `replacementModelId: "grok-4.3"` | same |

`catalogStatus: "legacy"` keeps ids routable for existing chats while removing
them from the selector (`isVisibleModel`,
[lib/models/index.ts:32-36](../lib/models/index.ts);
`isModelVisibleInSelector`, [lib/model-store/utils.ts:32-36](../lib/model-store/utils.ts)).
Because no id is deleted, no migration entries are needed for 2E either.

### 2F. Companion config updates

- **`FALLBACK_PROVIDER_MAP`**
  ([provider-map.ts:7-121](../lib/openproviders/provider-map.ts)): add the new
  direct ids (`claude-opus-4-8`, `claude-sonnet-5`, `claude-fable-5`,
  `gpt-5.5`, `gpt-5.4-mini`, `gpt-5.4-nano`, `gemini-3.5-flash`,
  `gemini-3.1-pro-preview`, `gemini-3.1-flash-lite`, `grok-4.3`) — repo
  convention keeps cataloged direct ids in the fallback map too (e.g.
  `claude-opus-4-6` at :100). Wrapped ids need nothing (the `openrouter:`
  prefix short-circuits in `getProviderForResolvedModel`, :124-126).
- **`DEFAULT_MODEL_ORDER`**
  ([lib/model-store/utils.ts:11-30](../lib/model-store/utils.ts)): new curated
  order, replacing demoted ids with successors:
  `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5-20251001`,
  `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5-mini`,
  `gemini-3.1-pro-preview`, `gemini-3.5-flash`, `gemini-3.1-flash-lite`,
  `grok-4.3`, `mistral-large-2512`, `mistral-small-2506`, `codestral-2508`,
  `sonar`, `sonar-reasoning-pro`, then the wrapped OpenRouter ids (frees first,
  then the 2C list in table order).
- **Icons**: wrapped entries set `baseProviderId` to the real vendor
  (`deepseek`, `qwen`, `z-ai`, `moonshotai`, `minimax`, `meta`, `xiaomi`,
  `inclusionai`, `nvidia`) and `icon: "openrouter"` where no vendor icon
  exists. The registry ([lib/providers/index.ts:23-84](../lib/providers/index.ts))
  has icons for openrouter/openai/mistral/deepseek/gemini/claude/grok/xai/
  google/anthropic/meta/perplexity only. `getProviderIcon`
  ([models-settings.tsx:117-120](../app/components/layout/settings/models/models-settings.tsx))
  must gain a fallback: unknown `baseProviderId` → the OpenRouter icon
  (today it silently renders no icon).

---

## 3. Seam inventory (verified 2026-07-04)

How a model id flows through the system, and where "one model ↔ one provider"
is baked in. Every claim below was read at these exact lines this session.

**S1. Catalog shape and load.**
`ModelConfig` — [lib/models/types.ts:22-88](../lib/models/types.ts); status
enum :4 (`visible|hidden|legacy`); id kinds :6; construction-time
`ModelReasoningSettings` :18-20 and the `reasoning` field :75.
`STATIC_MODELS` concatenation — [lib/models/index.ts:14-23](../lib/models/index.ts)
(note: `deepseekModels` and `llamaModels` are empty arrays;
`lib/models/data/llama.ts` is **orphaned** — exported, never imported).
`getAllModels()` :39-41 (async but static); `getModelInfo` resolves migrations
then looks up :89-92.

**S2. Access tiers / gating.**
Constants — [lib/config.ts:14](../lib/config.ts) (`NON_AUTH_ALLOWED_MODELS =
["gpt-5-mini"]`), :16-22 (`FREE_MODELS_IDS`: 2 wrapped frees + `pixtral-large-2411`,
`mistral-large-2512`, `gpt-5-mini`), :24-31 (defaults; both = `gpt-5-mini`).
Base `accessible` = membership in `FREE_MODELS_IDS`
([lib/models/index.ts:25-30](../lib/models/index.ts)) → served by
[app/api/models/route.ts:9-31](../app/api/models/route.ts) → client overlays
"user has provider key" via Convex `getProviderStatus`
([lib/model-store/provider.tsx:94, 111-124](../lib/model-store/provider.tsx)).
Server enforcement — [app/api/chat/api.ts:147-186](../app/api/chat/api.ts):
anonymous → only `NON_AUTH_ALLOWED_MODELS` (:158, 401 `AUTH_REQUIRED`);
authenticated without provider key → only `FREE_MODELS_IDS` (:174, 401
`MISSING_API_KEY`). Pro-model rate limiting = NOT in `FREE_MODELS_IDS`
(:76-78 → Convex `checkUsage`). Selector-side mirror:
[lib/model-store/utils.ts:42-55](../lib/model-store/utils.ts).
**The "free models 401 without any key" chain**: `FREE_MODELS_IDS` passes
api.ts:174 for key-less authenticated users, but the runtime env preflight
([chat-turn-runtime.ts:439-460](../app/api/chat/chat-turn-runtime.ts)) throws
`MISSING_API_KEY` when `OPENROUTER_API_KEY` is unset — so today the two
OpenRouter "free" entries work only for users who saved their own key (BYOK) or
deployments that set the platform env var. Anonymous users can never reach them
(S2 anonymous rule). This is Open decision D5.

**S3. Routing.**
`getProviderForModel` — [provider-map.ts:134-136](../lib/openproviders/provider-map.ts)
resolves migrations then delegates to `getProviderForResolvedModel` (:123-132):
`openrouter:` prefix → `"openrouter"` (:124-126), else catalog `providerId`,
else `FALLBACK_PROVIDER_MAP` (:7-121), else throw.
Factory — [create-language-model.ts:10-22](../lib/openproviders/create-language-model.ts)
accepts `string | Pick<ModelConfig,"id"|"reasoning">`; only config inputs carry
construction settings (colocated proof:
[create-language-model.test.ts:36-51](../lib/openproviders/create-language-model.test.ts));
id resolution happens once, in
[model-factory.ts:19-29](../lib/openproviders/model-factory.ts) (`resolveModelId`
at :24) → strategy registry.

**S4. Provider strategy (the V3-shim seam).**
[provider-strategy.ts:145-278](../lib/openproviders/provider-strategy.ts).
OpenRouter strategy :253-277: no default singleton, self-resolved env fallback
:265, `compatibility: "strict"` :266, `.chat(id, settings)` :269-273 with the
`openrouter:` strip (:33-37) and reasoning mapping effort/max_tokens → snake_case
(:45-54). `ProviderLanguageModel = LanguageModelV4 | LanguageModelV3` :87 with
the documented degradation list :74-86 and `TODO(openrouter-v4)` :83.
**Verified against installed packages 2026-07-04**: `@openrouter/ai-sdk-provider`
2.10.0 is BOTH installed and npm-latest
(<https://registry.npmjs.org/@openrouter/ai-sdk-provider/latest>, peer `ai ^6`),
and its dist carries `specificationVersion = "v3"` (24 occurrences). No v4-spec
release exists — every wrapped entry MUST configure reasoning at construction
time via `ModelConfig.reasoning`, never per-call.

**S5. Request shaping.**
[request-shaping.ts:72-109](../lib/openproviders/request-shaping.ts) switches on
`providerId`; `"openrouter"` deliberately unreachable for reasoning (:98-105) —
wrapped models get `providerOptions: {}`. Headers :121-137: the Anthropic
token-efficient beta header applies only when `providerId === "anthropic"` —
wrapped Claude via OpenRouter does NOT get it (fine; OpenRouter manages its own
upstream headers). **One shaping change IS required for the direct Claude
refresh**: the anthropic branch (:79-88) downgrades every
`thinkingMode: "adaptive"` model to `{type: "enabled", budgetTokens: 10000}`
whenever search tools are active (the pause_turn workaround documented at
:46-70). `budget_tokens` is accepted on Opus/Sonnet 4.6 (deprecated but
functional) but **rejected with a 400 on Opus 4.7+, Sonnet 5, and Fable 5**
(parameter removed; Fable 5 additionally rejects every non-adaptive `thinking`
config). Without the Phase 3 step-5 guard, the three new direct Claude entries
would fail every search-enabled turn. The wrapped Claude route is unaffected
(`providerId: "openrouter"` → empty providerOptions; OpenRouter maps the
construction-time `reasoning` setting upstream itself).

**S6. Chat request path.**
[route.ts:94](../app/api/chat/route.ts) `resolveModelId(requestedModel)` (+
migration log :110-119) → gating (S2) →
[chat-turn-runtime.ts:409-420](../app/api/chat/chat-turn-runtime.ts) catalog
lookup (400 `INVALID_REQUEST` if absent — **a model must be in the catalog to
be routable**), :424 provider, :428-434 `getEffectiveApiKey` (BYOK first, env
fallback — [lib/user-keys.ts:71-87](../lib/user-keys.ts)), :439-460 env
preflight, **:465 `createLanguageModel(modelConfig, apiKey)`** — the full
config flows in, so catalog `reasoning` reaches `.chat()` — and :876
`shapeRequest(...)`. Verified absent (grep of chat-turn-runtime.ts,
2026-07-04): the runtime sends **no** `temperature`/`topP`/`maxOutputTokens`
on `streamText` (call at :1154 passes model/instructions/messages/tools/
stopWhen/abortSignal/telemetry/prepareStep + callbacks only) — so the
4.7+/5-generation Claude models' removed-sampling-params rule is never
triggered by this codebase; the only known 400 vector is the thinking
downgrade (S5 / Phase 3 step 5).

**S7. History replay.**
Registry — [adapters/index.ts:41-51](../app/api/chat/adapters/index.ts) maps
openai/anthropic/google + xai,mistral→openai-compatible +
perplexity→text-only. OpenRouter resolution :57-76: strip prefix, take vendor
segment, look up `KNOWN_UNDERLYING_PROVIDERS` (:17-23 — **only
anthropic/openai/google/xai/mistral today**), else `defaultAdapter`.
`defaultAdapter` **drops all tool parts and reasoning**
([default.ts:13-21](../app/api/chat/adapters/default.ts)). The live impact
today is confined to `openrouter:meta-llama/llama-3.3-70b-instruct:free` — the
one cataloged wrapped model whose vendor prefix (`meta-llama`) is outside the
known list — its tool history is silently dropped on every replay (lossy
context, no error). For DeepSeek/GLM/Kimi/Qwen/MiniMax/x-ai the same gap is
**latent**, not live: non-catalog ids can't reach the runtime (400 at
[chat-turn-runtime.ts:415-420](../app/api/chat/chat-turn-runtime.ts)), so it
becomes real exactly when Phase 2 ships those entries — which is why Phase 1
lands first. `openaiCompatibleAdapter`
([openai-compatible.ts:61-73](../app/api/chat/adapters/openai-compatible.ts))
preserves complete tool triples, drops orphans and reasoning — the right shape
for OpenRouter's OpenAI-compatible wire format. Replay-shape failures are
detected by message-pattern match `isReplayShapeError`
([chat-turn-runtime.ts:281-294](../app/api/chat/chat-turn-runtime.ts): OpenAI/
Anthropic/Google native strings) and only **logged** (:1352-1364), not retried;
new-vendor errors arriving via OpenRouter may use different strings — extend
patterns only from observed logs, don't guess.
The optional **replay-compiler stage** (env flag `HISTORY_REPLAY_COMPILER_V1`,
[lib/config.ts:254-257](../lib/config.ts); default off) has its own, smaller
registry: ONLY `openai` and `anthropic`
([replay/compilers/index.ts:19-21](../app/api/chat/replay/compilers/index.ts)).
`compileReplay` **throws** for every other provider id (:38-43), and
`adaptHistoryForProvider` catches the throw and falls back to the legacy
adapter with a `replay_compile_fallback` warning
([adapters/index.ts:120-139](../app/api/chat/adapters/index.ts)). New vendor
ids therefore take exactly the path `google`/`xai`/`mistral` take today when
the flag is on — safe, but expect one benign fallback warning per wrapped
DeepSeek/GLM/Kimi/… request. Per-vendor replay compilers are NOT required for
this expansion (§7); do not "fix" the warning by registering stub compilers.

**S8. Persistence.**
Convex: `chats.model` ([convex/schema.ts:76](../convex/schema.ts)),
`messages.model/provider` (:137-138), `generationRuns.model/provider`
(:163-164, required), `users.favoriteModels` (:67). Client: localStorage
`lastUsedModel` + `cachedFavoriteModels`
([lib/model-store/provider.tsx:88, 148-151, 207-239](../lib/model-store/provider.tsx))
— all read paths run `resolveModelId` + known-id filtering, so stored stale ids
degrade gracefully as long as migrations stay total.

**S9. Selector & display.**
Selector — [components/common/model-selector/base.tsx:46-129](../components/common/model-selector/base.tsx)
(`filterAndSortModels`, locked→ProModelDialog at :85-102);
sorting/favorites — [lib/model-store/utils.ts:65-106](../lib/model-store/utils.ts)
with `DEFAULT_MODEL_ORDER` :11-30 (stale ids: `claude-opus-4-6`, `gpt-5.4`
top slots); settings grouping puts ALL wrapped models in one "openrouter"
section ([models-settings.tsx:66-70](../app/components/layout/settings/models/models-settings.tsx));
icon lookup by `baseProviderId` :117-120 against
[lib/providers/index.ts:23-84](../lib/providers/index.ts). BYOK settings —
[byok-section.tsx:46-103](../app/components/layout/settings/apikeys/byok-section.tsx)
(7 providers, OpenRouter default at :108). Env-status probe —
[app/api/providers/route.ts:21-29](../app/api/providers/route.ts).

**S10. Verification infra inherited.**
`scripts/smoke-openrouter.ts`: keyless mode checks live listing +
`supported_parameters` reasoning drift for every catalog entry (:80-125); keyed
mode runs real streamed generations through the production factory asserting
reasoning deltas (:126-180, loop at :206). **It currently iterates ALL
`openrouterModels` in keyed mode — after this expansion that would spend real money; Phase 2 gates it
before any paid entry lands.** Seam tests: `create-language-model.test.ts`
(construction settings), `provider-map.test.ts`, `provider-strategy.test.ts`,
`request-shaping.test.ts`, `*.ai-sdk-seam.test.ts`. CI
([.github/workflows/ci-cd.yml:20-63](../.github/workflows/ci-cd.yml)): lint,
typecheck, contract tests, full vitest — **no live-network checks** (smoke is
deliberately not wired in, :22-23 of the smoke script header).

**Incidental findings** (not blocking, noted for hygiene): `SUB_AGENT_MODELS`
([lib/config.ts:263-274](../lib/config.ts)) is dead (zero imports) and contains
two ids that don't exist upstream (`claude-opus-4-5-20250929`,
`claude-haiku-4-5-20250929` — real ids are `claude-opus-4-5-20251101`,
`claude-haiku-4-5-20251001`); `lib/models/data/llama.ts` is an orphaned empty
module. Both are out of scope (§7) — do not fix them in this change.

---

## 4. Phased implementation steps

House rules for every phase: bun only (`bun run test`, `bunx tsc --noEmit`,
`bun run smoke:openrouter`); work on the current branch — **never create or
switch branches**; do not push or open PRs; keep new tests lean and
concentrated on risky logic (generator invariants, adapter routing), no
snapshot sprawl. The tree must be green after every phase.

### Phase 1 — underlying-vendor adapter coverage

Smallest blast radius, unblocks everything. One deliberate behavior change for
a cataloged model: the Llama free model's tool history starts surviving replay
(today `defaultAdapter` strips it — §3 S7); everything else is latent until
Phase 2.

1. [app/api/chat/adapters/index.ts](../app/api/chat/adapters/index.ts):
   extend `KNOWN_UNDERLYING_PROVIDERS` (:17-23) with exactly the vendor
   prefixes used by the §2 slugs that aren't covered today:
   `x-ai`, `deepseek`, `z-ai`, `moonshotai`, `minimax`, `qwen`, `meta-llama`,
   `xiaomi`, `inclusionai`, `nvidia`. Watch the hyphen: the slug prefix is
   `x-ai`, but today's list only has `xai` — `extractUnderlyingProvider`
   returns `null` for `x-ai/…`, so wrapped Grok slugs would fall to
   `defaultAdapter` — latent today (no wrapped Grok is cataloged), live the
   moment Phase 2 ships §2C. The already-live case is `meta-llama` (§3 S7).
2. Map the new vendors in the same file's registry wiring so
   `resolveAdapter` finds them (:57-76 reads `registry.get(vendor)`):
   `x-ai` → `openaiCompatibleAdapter` (same adapter direct `xai` uses), and
   every other new vendor → `openaiCompatibleAdapter` (OpenRouter normalizes
   to the OpenAI chat-completions wire shape; this adapter preserves complete
   tool triples and strips reasoning — replay-safe for reasoning models whose
   thought blocks must not be echoed back). Keep `defaultAdapter` as the
   terminal fallback for genuinely unknown vendors.
3. Type note: `KNOWN_UNDERLYING_PROVIDERS` feeds a string union — extending it
   plus the registry keeps `resolveAdapter` total.
4. Add ONE lean unit test in `app/api/chat/adapters/__tests__/` asserting
   `resolveAdapter("openrouter", {targetModelId})` picks: anthropic slug →
   anthropicAdapter, `deepseek/…` → openaiCompatibleAdapter, `x-ai/…` →
   openaiCompatibleAdapter, unknown vendor → defaultAdapter.
5. No replay-compiler change (§3 S7): `compileReplay` covers only
   openai/anthropic and throws-then-falls-back for everything else — the new
   vendors inherit the same caught-fallback path `google`/`xai`/`mistral` use
   today. Do NOT register stub compilers to silence the fallback warning.

**Do NOT** change `isReplayShapeError` patterns speculatively, and do NOT
change the non-OpenRouter branches of `resolveAdapter`.

### Phase 2 — generator, snapshot, allowlist, expanded wrapped catalog

1. **Gate the smoke script first** (before any paid entry exists):
   in `scripts/smoke-openrouter.ts`, keyed mode filters to
   `(config.inputCost ?? 0) === 0` unless `--paid` is passed; add `--model
   <id>` to target one entry; `--paid` prints an estimated cost table before
   running (≈60 input + ≤600 output tokens per model at catalog prices — the
   whole 2C set costs well under $0.25/run, dominated by Fable 5 at ~$0.03)
   and sets `maxOutputTokens: 600` on the `streamText` call so reasoning
   models still produce text. Keep the existing reasoning-delta assertion.
2. **`scripts/generate-openrouter-catalog.ts`** (new):
   - default: read `lib/models/data/openrouter.snapshot.json` +
     `lib/models/data/openrouter.allowlist.ts`, emit
     `lib/models/data/openrouter.generated.ts` (sorted by allowlist order,
     banner comment "GENERATED — edit the allowlist/snapshot and re-run
     `bun run catalog:openrouter`").
   - `--fetch`: GET `https://openrouter.ai/api/v1/models`, prune to allowlisted
     ids, keep only the fields used (id, name, created, context_length,
     `top_provider.max_completion_tokens`, pricing.prompt/completion,
     supported_parameters, `architecture.input_modalities`), stamp
     `retrievedAt`, write the snapshot, then generate.
   - `--check`: regenerate to a temp path and byte-diff against the committed
     generated file; non-zero exit on mismatch. **Offline and deterministic**
     (reads only committed files) so it can run in CI.
   - Hard failure if an allowlisted id is missing from the snapshot; the error
     prints a ready-to-paste `MODEL_ID_SUCCESSIONS` stub.
   - Output hygiene, so `--check` is stable and CI lint passes: format the
     emitted TS through prettier's Node API with the repo's resolved config
     (prettier is already a devDependency) — then an editor's format-on-save
     is a no-op on the generated file and cannot create phantom `--check`
     diffs; omit `maxOutput` when the snapshot's
     `top_provider.max_completion_tokens` is null (several live entries — e.g.
     `x-ai/grok-4.3` — report null); write the snapshot with entries sorted by
     id and a fixed key order so refresh diffs stay reviewable.
   - Field derivation: `verifiedAgainst` = bare slug; `lastVerifiedAt` =
     snapshot `retrievedAt`; `contextWindow`/`maxOutput`/`inputCost`/
     `outputCost` from the snapshot; `reasoningText`/`reasoning` from
     `supported_parameters` ∋ `reasoning` AND the allowlist's per-model policy
     (allowlist may opt out, never opt in without the parameter); `vision` from
     input_modalities ∋ `image`; `tools` from supported_parameters ∋ `tools`;
     `webSearch: false` always; editorial fields (name, description, tags,
     modelFamily, baseProviderId, icon, speed, intelligence, releasedAt,
     apiDocs = `https://openrouter.ai/<slug>`) from the allowlist.
3. **Allowlist content**: the 2A+2B+2C set (28 ids) with the editorial
   overrides and the exclusion comments from §2C.
4. **`lib/models/data/openrouter.ts`** becomes the incident-history header +
   `export { openrouterModels } from "./openrouter.generated"` — imports in
   [lib/models/index.ts:8](../lib/models/index.ts) stay untouched.
5. **package.json scripts**: `"catalog:openrouter"`, `"catalog:openrouter:refresh"
   (--fetch)`, `"catalog:openrouter:check" (--check)`.
6. **CI**: add `bun run catalog:openrouter:check` to the validate job after
   typecheck ([ci-cd.yml:41-43](../.github/workflows/ci-cd.yml)).
7. ONE lean generator test (vitest): missing-id failure fires, and a tiny
   two-model fixture generates the expected `ModelConfig` fields (reasoning
   derivation on/off, webSearch false).
8. Commit the ADR from §1 as `docs/adr/0007-…`.

**Do NOT** touch `FREE_MODELS_IDS`, `NON_AUTH_ALLOWED_MODELS`,
`MODEL_DEFAULT_*`, or `getDefaultModelForUser` in this phase — new paid wrapped
entries are automatically BYOK-gated by S2 (`accessible: false` without an
OpenRouter key; server 401 without a key), and that is the intended state.
**Do NOT** hand-edit `openrouter.generated.ts` — CI `--check` exists to catch it.

### Phase 3 — direct-provider refresh + migrations + companion config

1. Apply §2D additions and §2E modifications in
   `lib/models/data/{claude,openai,gemini,grok}.ts` (set
   `lastVerifiedAt: "<implementation date>"`, `verifiedAgainst` = the exact
   documented id).
2. `FALLBACK_PROVIDER_MAP` additions (§2F) in
   [provider-map.ts](../lib/openproviders/provider-map.ts).
3. `DEFAULT_MODEL_ORDER` update (§2F) in
   [lib/model-store/utils.ts:11-30](../lib/model-store/utils.ts).
4. Icon fallback in `getProviderIcon`
   ([models-settings.tsx:117-120](../app/components/layout/settings/models/models-settings.tsx)):
   unknown `baseProviderId` → OpenRouter icon component.
5. **Request-shaping guard for 4.7+/5-generation Claude** — without this, the
   three new direct Claude entries 400 on every search-enabled turn (§3 S5).
   [request-shaping.ts:79-88](../lib/openproviders/request-shaping.ts) currently
   downgrades every `thinkingMode: "adaptive"` model to
   `{type: "enabled", budgetTokens: 10000}` when `ctx.searchToolsActive` — a
   pause_turn workaround written for Opus/Sonnet 4.6, where `budget_tokens`
   still functions. On `claude-opus-4-8`, `claude-sonnet-5`, and
   `claude-fable-5` the parameter is removed upstream (HTTP 400; Fable 5
   accepts only adaptive or omitted thinking). Make the downgrade
   catalog-driven: add optional `searchThinkingDowngrade?: boolean` to
   `ModelConfig` ([lib/models/types.ts:22-88](../lib/models/types.ts)), set it
   `true` on exactly `claude-opus-4-6` and `claude-sonnet-4-6`, and change the
   condition at :80 so only flagged models downgrade — every other adaptive
   model sends `{type: "adaptive"}` unconditionally. Extend
   `request-shaping.test.ts` with the two behaviors (this is where the lean
   test budget belongs — it's the riskiest logic in the phase). During manual
   smoke, run a search-enabled reasoning turn per new Claude model and watch
   for the original pause_turn zero-text symptom on ai@7.0.15; if it recurs,
   record a follow-up (SDK-level fix) rather than resurrecting the budget
   downgrade for 4.7+ models.
6. No `MODEL_ID_SUCCESSIONS`/`MODEL_ID_ALIASES` changes (no id removed). If the
   owner later chooses to hide `gpt-5.1`/`gpt-5` completely, they already carry
   `replacementModelId` and stay routable — leave them.

**Do NOT**: change `gpt-5-mini`, `pixtral-large-2411`, `mistral-large-2512`
entries (free tier and defaults depend on them — S2); change anything in
`convex/`; rename any existing id.

### Phase 4 — selector/settings polish

1. Verify wrapped paid models render as locked (padlock → ProModelDialog) for
   key-less users and unlocked with an OpenRouter key — this is existing S2/S9
   behavior, phase is verification + small fixes only.
2. Settings "openrouter" section will now hold ~28 entries in one group
   ([models-settings.tsx:66-70](../app/components/layout/settings/models/models-settings.tsx)) —
   acceptable for v1 (search exists); if the owner wants vendor sub-grouping,
   that's a follow-up, not this change.
3. Confirm favorites drag/reorder and `isModelHidden` work with wrapped ids
   (they're plain strings; expected no-op).

### Phase 5 — verification additions

1. Extend the smoke script further only if Phase 2's gating left gaps
   (`--paid` + `--model` should already cover targeted paid verification).
2. Add the manual browser checklist results to the PR/commit description
   (see §5).

### Phase 6 (OWNER-GATED — do not start without explicit approval)

Free-tier & defaults changes per §6 decisions: `FREE_MODELS_IDS` additions
(D4), platform `OPENROUTER_API_KEY` (D5), default model change (D3). Each is a
one-line config change with outsized blast radius; land separately with its own
verification.

---

## 5. Per-phase verification

Baseline (verified green 2026-07-04 before any change): `bunx tsc --noEmit`
and `bun run test` both pass.

**Every phase:** `bunx tsc --noEmit && bun run lint && bun run test` — all green.

**Phase 1:** the new adapter-routing unit test passes; full suite green
(existing adapter tests in `app/api/chat/adapters/__tests__/` must not change
behavior for non-OpenRouter providers).

**Phase 2:**
- `bun run catalog:openrouter:refresh` produces a snapshot dated today and a
  generated file that typechecks.
- `bun run catalog:openrouter:check` exits 0; then hand-edit one byte of the
  generated file and confirm it exits 1 (revert).
- `bun run smoke:openrouter` (keyless) — every wrapped entry "listed live", no
  reasoning-drift failures.
- `bun run smoke:openrouter` with a key (owner's, via `SMOKE_OPENROUTER_KEY`) —
  free entries only by default; confirm the paid set is skipped without
  `--paid`.
- Opt-in paid probe (owner approval; costs < $0.25):
  `SMOKE_OPENROUTER_KEY=… bun run smoke:openrouter -- --paid` or per-model
  `-- --paid --model openrouter:anthropic/claude-sonnet-5`. Assert reasoning
  deltas arrive for every entry with a `reasoning` config.

**Phase 3:**
- Grok one-off: a single keyed Responses-API generation against `grok-4.3`
  (mirroring the 2026-07-03 verification noted at provider-strategy.ts:225-227)
  before it ships visible; cap output tokens.
- If direct-provider platform keys exist in `.env.local`, one browser turn per
  new visible direct model.

**Manual browser smoke checklist — run per newly enabled model** (use the
owner's long-running dev server on :3000 through their signed-in browser; do
not restart it):

1. Select the model in the selector (locked state correct for the auth/key
   state; unlock path via Settings → API Keys works).
2. Send a turn → streamed reply; when the entry carries `reasoning` config,
   the thinking/reasoning affordance shows deltas. For the three new direct
   Claude models, repeat the turn **with web search enabled** — this exercises
   the Phase 3 shaping guard (must not 400; watch for pause_turn empty-text).
3. Multi-turn with tool history: enable a tool (e.g. Exa search), get a tool
   call, then send a follow-up — no `replay_shape_error` in server logs
   (structured tag at chat-turn-runtime.ts:1352-1364), and the model clearly
   still "remembers" the tool result (adapter didn't strip it).
4. Reload — the reply persisted (Convex `messages`), the chat reopens on the
   same model.
5. For OpenRouter models: the request appears in <https://openrouter.ai/logs>
   ("as expected" = correct slug + token counts).
6. For `:free` entries at peak hours: a 429 shows the friendly saturation
   message, not a crash.

---

## 6. Open product decisions (owner) — with recommendations

- **D1 — Final curation cut.** §2 proposes 28 wrapped + 10 direct additions.
  Recommendation: accept as-is; trim `nvidia/nemotron-3-ultra` and
  `inclusionai/ling-2.6-flash` first if 28 feels heavy. Also: should
  `claude-fable-5` (direct + wrapped) be `visible` or `hidden`? Recommendation:
  visible — flagship breadth is the point of this change; its BYOK gate already
  keeps it off the free path.
- **D2 — Dual-route presentation** (Claude/GPT/Gemini/Grok reachable direct AND
  via OpenRouter). Recommendation: keep both visible; the settings screen
  already groups wrapped models under an OpenRouter section
  (models-settings.tsx:66-70) and the selector shows the provider name per row.
  Defer the logical-model dedupe layer (§1 option 3).
- **D3 — Defaults.** `MODEL_DEFAULT_ANONYMOUS`/`_AUTHENTICATED` are both
  `gpt-5-mini` (lib/config.ts:24-25). Recommendation: change nothing now;
  revisit after D5 (a platform OpenRouter key would make a `:free` reasoning
  model a plausible authenticated default).
- **D4 — Free-tier composition.** Recommendation: after one clean week of the
  expanded catalog, add `openrouter:qwen/qwen3-coder:free` and
  `openrouter:google/gemma-4-26b-a4b-it:free` to `FREE_MODELS_IDS` (they clear
  the quality bar: tools + big ctx). Keep the pool ≤ 6 — every entry is also a
  "not pro" rate-limit classification (api.ts:76-78).
- **D5 — Platform `OPENROUTER_API_KEY` for key-less users.** Today the two
  "free" OpenRouter entries 401 for everyone without a saved key (S2 chain).
  Recommendation: yes — provision a platform key on an account with ≥$10
  lifetime credits (unlocks 1000 free-model requests/day pool-wide, 20 RPM;
  $0.00/request on `:free` models, so dollar exposure is zero and the paid
  path stays BYOK-only because api.ts:174 blocks non-free models without a
  user key). Risk: the 1000/day pool is shared across all users — watch 429s.
  Anonymous users stay on `gpt-5-mini` regardless (api.ts:158).
- **D6 — Sonnet 5 intro pricing display.** OpenRouter currently returns the
  intro $2/$10 (snapshot) while Anthropic's sticker is $3/$15 after 2026-08-31.
  Recommendation: catalog shows what the API charges today (snapshot values);
  the post-August snapshot refresh updates it automatically. Direct entry
  records sticker with an intro note in `description`.

---

## 7. Out of scope (deliberately untouched)

- The logical-model/route-dedupe layer (§1 option 3) and any `ModelConfig`
  schema change.
- Mistral and Perplexity direct catalogs (current enough:
  `mistral-large-2512` Dec 2025, `sonar*`), and any new BYOK provider
  (DeepSeek-direct, Moonshot-direct, etc. — their models arrive via OpenRouter).
- `FREE_MODELS_IDS` / defaults / anonymous policy changes (Phase 6, owner-gated).
- Image/video/audio/TTS models on any provider; OpenRouter router
  pseudo-models (`openrouter/auto`, `openrouter/free`, `openrouter/fusion`).
- Replay-compiler per-vendor compilers and `isReplayShapeError` pattern
  expansion (only if live logs show new patterns).
- Provider strategy interface changes; the `TODO(openrouter-v4)` upgrade
  (blocked on an upstream v4-spec release — none exists as of 2026-07-04).
- Dead-code cleanup: `SUB_AGENT_MODELS` (lib/config.ts:263-274, unused +
  contains two invalid ids) and orphaned `lib/models/data/llama.ts` — flag for
  a separate hygiene commit.
- Convex schema, billing/usage UI, MCP/tools infrastructure.

---

## 8. Evidence log (retrieval dates — re-verify before shipping)

- **E1** OpenRouter live catalog: `GET https://openrouter.ai/api/v1/models`,
  2026-07-04 — 340 models, 23 `:free`; per-model `supported_parameters`,
  pricing, context, `created` timestamps. (Commit as
  `openrouter.snapshot.json` in Phase 2; a working copy from this
  investigation exists in the session scratchpad as `openrouter-models.json`.)
- **E2** OpenRouter free-tier limits:
  <https://openrouter.ai/docs/api/reference/limits>, 2026-07-04 — 50 req/day +
  20 RPM without credits; 1000 req/day with ≥$10 lifetime credits (RPM
  unchanged).
- **E3** Anthropic models & pricing:
  <https://platform.claude.com/docs/en/about-claude/models/overview.md>,
  2026-07-04 — ids/aliases, 1M ctx & 128k out for Fable 5/Opus 4.8/4.7/4.6/
  Sonnet 5/Sonnet 4.6; Sonnet 5 intro pricing note (through 2026-08-31);
  Opus 4.1 deprecated, retires 2026-08-05.
- **E4** OpenAI models & pricing:
  <https://developers.openai.com/api/docs/models> and
  <https://developers.openai.com/api/docs/pricing>, 2026-07-04 — gpt-5.5
  ($5/$30, 1M ctx, 128k out), gpt-5.4 ($2.50/$15), gpt-5.4-mini ($0.75/$4.50),
  gpt-5.4-nano ($0.20/$1.25), gpt-5.5-pro/gpt-5.4-pro ($30/$180); gpt-5.6 is
  partner-preview only.
- **E5** Google models & pricing:
  <https://ai.google.dev/gemini-api/docs/models> and
  <https://ai.google.dev/gemini-api/docs/pricing>, 2026-07-04 —
  `gemini-3.5-flash` (stable, $1.50/$9), `gemini-3.1-flash-lite` (stable,
  $0.25/$1.50), `gemini-3.1-pro-preview` (preview, $2/$12 ≤200k prompts,
  $4/$18 above), `gemini-3-flash-preview` ($0.50/$3); 2.5 family still active.
- **E6** xAI models: <https://docs.x.ai/docs/models>, 2026-07-04 — `grok-4.3`
  (1M ctx, $1.25/$2.50, recommended), `grok-4.20-0309-*` variants,
  `grok-build-0.1` (Code API, $1/$2); `grok-4-1-fast*`/`grok-code-fast` no
  longer listed (repo-side note: still functional against the Responses API
  per provider-strategy.ts:225-227, verified 2026-07-03).
- **E7** OpenRouter AI-SDK provider:
  <https://registry.npmjs.org/@openrouter/ai-sdk-provider/latest>, 2026-07-04 —
  latest = 2.10.0 (matches installed), peer `ai ^6.0.0`; installed dist emits
  `specificationVersion = "v3"` → the V3-shim constraint (S4) holds.
- **E8** OpenRouter rankings (<https://openrouter.ai/rankings>) is
  client-rendered and not fetchable headlessly (two attempts 2026-07-04); the
  keyless `/api/frontend/models/find` endpoint 404s. Curation policy therefore
  uses: the live listing's per-vendor recency + the competitive reference set
  (§2C reconciliation) + manual rankings sampling at each refresh. **Curation
  policy for future refreshes:** per vendor keep at most flagship + workhorse
  (+1 specialist where the family warrants, e.g. coder), cap ~4/vendor
  (Anthropic) and ~2-3 elsewhere; `:free` pool entries must have `tools` or
  `reasoning` in `supported_parameters` AND ctx ≥ 128k, cap ~6; drop anything
  delisted at snapshot time with a succession entry.

## 9. Risks & rollback

| Risk | Detection signal | Mitigation / rollback |
|---|---|---|
| **Delisting churn** (any `:free` or paid slug vanishes; "No endpoints found") | `bun run smoke:openrouter` keyless FAIL ("Not in the live listing"); `catalog:openrouter:refresh` hard-fails naming the id | Remove id from allowlist, add printed succession stub to `MODEL_ID_SUCCESSIONS`, regenerate — one command + one paste. Persisted chats keep working via `resolveModelId`. |
| **Free-pool saturation** (429s at peak; shared 1000/day platform pool if D5 ships) | smoke classifier "Free pool saturated"; user-facing 429s; openrouter.ai/logs | Retry off-peak; keep ≥$10 lifetime credits on the platform account; if persistent, demote the noisy `:free` entry to `hidden` (regenerate). |
| **V3-shim regressions** (reasoning silently stops flowing; or upstream ships v4 and semantics shift) | keyed smoke asserts reasoning-delta per configured entry; `create-language-model.test.ts:36-51` guards the construction path | Reasoning stays construction-time only (never per-call). On a v4-spec provider release: follow `TODO(openrouter-v4)` (provider-strategy.ts:83-86) as its own change, not here. |
| **Per-vendor replay-shape errors** (new vendors' tool-history quirks via OpenRouter) | structured `replay_shape_error` log (chat-turn-runtime.ts:1352-1364); manual checklist step 3. Note: with `HISTORY_REPLAY_COMPILER_V1` on, `replay_compile_fallback` warnings for non-openai/anthropic vendors are expected and benign (pre-existing for google/xai/mistral) — not a regression signal | Phase 1 maps new vendors to `openaiCompatibleAdapter` (tool triples preserved, reasoning stripped). Rollback per vendor = one registry line back to `defaultAdapter` (text-only history — lossy but safe). Extend `isReplayShapeError` patterns only from observed messages. |
| **4.7+/5 Claude thinking-config 400** (search downgrade sends removed `budget_tokens`) | immediate Anthropic 400 on any search-enabled turn with `claude-opus-4-8`/`claude-sonnet-5`/`claude-fable-5`; caught by the Phase 3 `request-shaping.test.ts` cases + manual checklist step 2 | Phase 3 step 5 gates the downgrade to the 4.6 entries via `searchThinkingDowngrade`; rollback while investigating = set the affected new entries to `catalogStatus: "hidden"` (one field each). |
| **Cost exposure** | smoke `--paid` prints cost preview; OpenRouter dashboard | Paid wrapped models are BYOK-only by S2 (server 401 without user key). Platform env key can only ever be spent on `FREE_MODELS_IDS` ($0.00 `:free` entries) — bounded by rate limit, not dollars. Keyed smoke defaults to free-only after Phase 2 step 1. |
| **Default-model blast radius** (accidental change to `gpt-5-mini`, `FREE_MODELS_IDS`, `NON_AUTH_ALLOWED_MODELS`) | `bun run test` (gating tests), code review of lib/config.ts diff — should be EMPTY through Phase 5 | Explicit do-NOT guards in Phases 2-3; Phase 6 is owner-gated. |
| **Preview-id churn** (`gemini-3.1-pro-preview`) | provider deprecation notes; smoke/refresh failures | Succession-ready: replace with the stable id + succession entry when Google ships it. |
| **Fable 5 refusal behavior** (safety classifiers return `refusal` stop reason on cyber/bio-adjacent asks) | finishReason anomalies in logs/PostHog for that model | Documented in the entry description; if it confuses users, demote to `hidden` (one field). |
| **Sonnet 5 price step-up** (intro ends 2026-08-31) | snapshot refresh diff shows 2/10 → 3/15 | Schedule a catalog refresh in early September; generated pricing updates automatically. |
| **Generated-file hand edits** | CI `catalog:openrouter:check` fails | Re-run the generator; edits belong in allowlist/snapshot. |
