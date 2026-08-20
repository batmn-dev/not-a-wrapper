# 0020 — Logical model catalog and the server route resolver

**Status:** accepted **Date:** 2026-08-19 **Amends:** ADR-0007 (implements the
logical-model/route layer it deferred; the snapshot-generated OpenRouter
workflow is unchanged and remains authoritative for wrapped route facts)

**Context.** The selector shows 46 route-shaped entries (18 direct + 28
OpenRouter), 11 of which are second routes to a model already present
directly — the same Claude Sonnet 5 appears twice, disambiguated only by an
"OpenRouter" suffix the selector paints on wrapped rows. `ModelConfig` fuses
display identity, provider identity, upstream configuration, capabilities,
pricing, and access into one record; access is derived from the record's
single `providerId`, so a user with an OpenRouter key sees the direct Claude
row locked and the wrapped row open. Favorites act as a visibility filter
(any favorite hides every non-favorite), `getEffectiveProviderApiKey`
hard-codes BYOK-before-platform, and `validateAndResolveChatCredential`
derives exactly one provider from the selected id. Chats, messages, and runs
persist `model` + `provider` without a route-resolution receipt.

**Decision.** Split model identity from execution route, and centralize route
choice in one server-owned resolver.

## Domain model

- **Model route** — a concrete execution path: the existing `ModelConfig`
  record IS the route record, its `id` the stable route id. A wrapper type
  (`ModelRoute` in `lib/models/catalog.ts`) carries `{id, modelId, providerId,
  upstreamModelId, config}`; capabilities, pricing, and construction settings
  stay per-route on `config` and are never flattened upward.
- **Logical model** — the user-facing identity (`LogicalModel`): `{id, name,
  vendorId, description, tags, catalogStatus, routes}`. Its id **equals its
  canonical route id** (the direct route when one exists, else the sole
  wrapped route id). This keeps every persisted model id — chats, messages,
  runs, favorites, last-used — already a valid logical id or resolvable to
  one, so no data migration is needed and `getModelInfo`-style lookups stay
  total.
- **Mapping is explicit** — a wrapped OpenRouter record joins a direct
  logical model only through `logicalModelId` on its allowlist entry, emitted
  into the generated catalog. No fuzzy display-name matching. Compilation
  (`compileLogicalCatalog`) throws on a mapping that targets a missing id,
  a mapped (chained) target, or a duplicate route id — a bad mapping fails
  catalog module load, generation, CI, and tests loudly.
- The `:free` OpenRouter pool entries remain **their own logical models**
  even when a paid sibling exists (`qwen3-coder:free` vs `qwen3-coder`): the
  free pool is a genuinely different serving tier (rate caps, separate
  product policy in `FREE_MODELS_IDS`), and the allowlist already names them
  distinctly.

## Route resolver

`resolveModelRoute` (`lib/model-route-resolver.ts`, server-only) replaces
the provider derivation inside `validateAndResolveChatCredential`. Inputs:
the (possibly legacy) selected id, auth state, the Convex token, required
capabilities (vision when the turn carries images), and an optional pinned
provider for approval continuations. It:

1. normalizes the selection through `resolveModelSelection` (aliases →
   successions → logical id + `legacyRouteHint` for old `openrouter:*` ids);
2. filters the logical model's routes by capability and pin;
3. orders credential candidates in tiers — **priority BYOK → platform
   entitlement → fallback BYOK** — with the legacy hint promoted within its
   tier and a deterministic tie-break (direct provider before aggregator,
   then catalog order);
4. walks candidates resolving the actual server-side credential (BYOK
   decryption; platform env var), so a client key-status boolean or an
   undecryptable stale ciphertext can never admit a turn;
5. returns an immutable receipt `{modelId, routeId, providerId,
   upstreamModelId, credentialSource, routeReason}` plus the resolved key.

**Platform entitlement** is a typed seam (`lib/models/platform-entitlement.ts`)
whose only current implementation encodes the rules that already exist:
`FREE_MODELS_IDS` for authenticated platform use, `NON_AUTH_ALLOWED_MODELS`
for anonymous. A future plan/balance/quota system implements the same
interface without touching the catalog or selector. No balances or counters
are invented now.

**API-key preference** — `userKeys.preference` (`"priority" | "fallback"`,
optional, absent = priority) selects the tier a provider's BYOK candidates
occupy. Existing keys therefore keep today's BYOK-first behavior. The
preference is metadata beside the encrypted key; queries expose provider id,
presence, and preference — never key material.

## Persistence

`chats.model`, `messages.model`, `generationRuns.model` store the logical id
(unchanged values for direct models; new sends on deduplicated models always
store the logical id). The run additionally stores the receipt — `routeId`,
`credentialSource`, `routeReason` — beside the already-persisted `provider`;
messages keep `model` + `provider` for replay and link to the run's full
receipt via `generationRunId`. All new fields are optional for compatibility
with existing production documents.

## Compatibility and continuations

- `resolveModelSelection(oldId)` is the one compatibility layer: aliases and
  successions still resolve first (single hop, unchanged), then a mapped
  wrapped id resolves to its logical model with the original route id kept as
  `legacyRouteHint`. Old routed ids are not deleted; they remain valid route
  ids.
- Approval continuations stay pinned: Convex keeps enforcing
  `approvalRun.provider` fail-closed, and the resolver is additionally pinned
  to the paused run's provider (read server-side from the approval row) so a
  key added mid-pause cannot re-route the continuation.
- Cross-provider replay safety is untouched: `messages.provider` remains the
  adapter key, and foreign provider-native parts still project to text.

## Explicitly out of scope

- **Runtime failover** — Priority/Fallback is credential/route precedence
  *before* provider execution. No provider failure is retried on another
  route: auth errors, content refusals, and anything after possible provider
  consumption stay terminal. A future failover needs its own retryable-error
  taxonomy and idempotency proof.
- **Account balance / quota** — the entitlement seam is the extension point;
  nothing is simulated now.

## Alternatives considered

- **Minted logical ids** (`anthropic/claude-sonnet-5`-style namespace):
  cleaner identity, but forces a migration of every persisted model field and
  preference for zero user-visible gain; rejected.
- **UI-only dedup** (filter wrapped rows in the selector): leaves persistence
  and admission keyed to route ids, favorites/last-used split across two ids,
  and the key-status lock wrong; explicitly rejected by the product goal.
- **Hand-maintained logical registry file**: duplicates the generated
  OpenRouter data ADR-0007 exists to avoid; rejected in favor of compiling
  routes into models with the allowlist as the editorial mapping surface.

**Consequences.** The selector shows each model once (35 visible logical
models today), availability is "any eligible route", favorites rank instead
of filter, and route/credential choice is recorded per run for future cost
attribution and settlement. The OpenRouter snapshot/refresh/succession
workflow is unchanged; the allowlist gains one editorial field. The
`ModelConfig` shape stays the single route-record shape (no parallel
catalog).
