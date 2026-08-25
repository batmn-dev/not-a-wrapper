# ADR-0025: Model lifecycle and derived Legacy priority

**Status:** Accepted
**Date:** 2026-08-25

## Context

The model catalog needs a Legacy classifier so presentation surfaces can
prioritize current models without deleting older usable models. The previous
`catalogStatus` union mixed editorial visibility with lifecycle: only
`"visible"` records entered the selector, so `"legacy"` meant hidden rather
than lower priority.

A global age threshold is not a useful definition. Models can be deprecated
soon after release, while older specialist models can remain the current member
of their product lane. Against the 2026-08-25 catalog, a 90-day age threshold
would classify 81 of 102 visible logical models as Legacy.

Provider lifecycle vocabulary also describes different scopes. A model can be
retired on one direct API while another route remains usable. ADR-0020 already
keeps execution facts on concrete routes and uses the canonical route record as
the authored source of logical-model presentation facts.

## Decision

Legacy means: **still usable, but no longer recommended by an explicit maker
portfolio or within its recommendation lane**.

The catalog keeps six independent facts:

1. `catalogStatus: "visible" | "hidden"` is editorial selector visibility.
2. `lifecycle` is dated evidence for one concrete route. It records status,
   source, verification date, optional retirement date, and optional
   replacement logical-model id.
3. `lineageId` names an explicitly curated recommendation lane: models that
   compete to be the same user choice, including across product-name changes.
   Its closed TypeScript vocabulary catches typos, but membership remains on
   model records rather than in a second registry of current heads. It is never
   inferred from a model name or the display-oriented `modelFamily`.
4. `releaseStage: "stable" | "preview" | "experimental"` defaults to stable.
   A preview or experimental model never supersedes a stable predecessor.
5. A dated maker recommendation policy may name an exact set of Current
   logical model ids. Unlisted models from that maker remain visible and
   selectable, but classify as Legacy. This is reserved for an intentional
   product portfolio, not inferred from names, age, or availability.
6. `snapshotDate` records the upstream snapshot's UTC calendar date when a
   dated checkpoint needs to remain distinguishable. It is explicit metadata,
   never parsed from an id or display name, and does not classify a model by
   itself.

Catalog dates use strict `YYYY-MM-DD` UTC calendar dates. Compilation rejects
ambiguous formats and impossible dates. `classifyLogicalModel` derives
`current | legacy` for a supplied UTC `asOf` date. It applies these rules in
order:

1. explicit canonical lifecycle evidence (`legacy`, `deprecated`, or
   `retired`);
2. an explicit lifecycle replacement;
3. a canonical scheduled retirement within 90 days;
4. an applicable exact maker recommendation policy;
5. a newer released, visible, stable model in the same recommendation lane that
   is not Legacy from applicable lifecycle evidence, after a 30-day successor
   grace period.

Age alone never changes classification. Future releases cannot start the grace
period or become recommendations. When several eligible stable successors
exist, the first successor release determines when the predecessor became
Legacy and the newest successor is returned as the recommendation.

The canonical route's lifecycle evidence can classify the logical model.
Lifecycle evidence on additional routes remains route-specific and is exposed
in the route summary; an aggregator route's retirement cannot incorrectly make
an active direct logical model Legacy.

`LogicalModelView` exposes:

- `classification`;
- `classificationReason`;
- `classificationSource` when lifecycle evidence or an editorial policy
  decided the result;
- `successorModelId` when known;
- `classificationEffectiveAt`;
- route lifecycle evidence in each route summary.

The API computes every model in one response with the same injected `asOf`
date. No cron mutates stored Legacy booleans.

The model selector consumes `classification` as presentation priority. It
hides Legacy models initially and adds one `Show legacy models...` option for
each maker with hidden Legacy models. Revealing one maker does not reveal any
other maker, and the option disappears once that maker is revealed. This state
lasts only for the current open popover; closing it hides every Legacy model
again, except that the composer's selected Legacy model remains visible as
explicit chat state. Only that selected row bypasses disclosure; the maker's
other Legacy models remain collapsed. This never changes catalog visibility,
classification, favorites, or route lifecycle metadata. Disclosure replaces
the maker's option in place with its Legacy rows; Current and favorite rows keep
their existing order.
Anthropic's option uses the Claude product mark, matching its model rows.

Snapshot codes such as `0423`, `0731`, and `0905` do not belong in ordinary
model names. Current rows use the stable product label. When a dated snapshot
is classified Legacy and its maker is revealed, the selector appends the
explicit snapshot date as a muted, readable month and year. Closing the
popover removes both the Legacy row and its date detail. Canonical and raw
route ids remain unchanged, and `LogicalModelView.routes` continues to expose
the unmodified route lifecycle evidence.

## Source authority

Official provider lifecycle documentation is authoritative for model-level
status. Provider and aggregator APIs supply route-level availability and
retirement facts. OpenRouter snapshot generation preserves `expiration_date`
as dated route evidence. Third-party catalogs may be used to detect drift but
are not runtime dependencies.

Editorial lifecycle evidence is allowed only with a verification date. Catalog
compilation fails when a lifecycle replacement is missing or hidden, or when
replacement edges form a cycle. An explicit replacement may cross
recommendation lanes only with a `sourceUrl`; this supports documented product
transitions without weakening the ordinary same-lane invariant.

Recommendation policies are also dated catalog data. Compilation rejects
duplicate maker policies, duplicate or missing current ids, current ids from a
different maker, and hidden current models. The exact portfolios are currently:

- OpenAI: GPT-5.6 Sol, Terra, and Luna.
- Anthropic: Claude Fable 5, Opus 5, Sonnet 5, and Haiku 4.5.
- Google: Gemini 3.5 Flash-Lite, 3.7 Flash, and 3.1 Pro.

Because each policy is an allowlist, a newly cataloged model from any of these
makers defaults to Legacy until its portfolio is deliberately updated.

`bun run catalog:models:audit` is a non-blocking editorial review tool. It
reports a current recommendation-lane head when it trails the same maker's
newest current stable model by at least 90 days. This signal can reveal an
orphaned lane, but it never mutates data, fails a build, or changes runtime
classification. Age requests review; lifecycle, portfolio, and lane evidence
decide.

## Compatibility

Existing records previously marked `catalogStatus: "legacy"` remain hidden to
preserve current selector behavior. Their lifecycle and replacement facts move
to `lifecycle`. Historical execution selection continues to use
`legacyRouteHint`; that compatibility-routing term is unrelated to model
priority classification.

No persisted model ids change. The logical model and route split from ADR-0020
remains intact.

## Consequences

- Backend consumers receive a deterministic, explainable priority fact without
  duplicating lifecycle logic.
- Without an exact maker policy, adding a stable model to an existing
  recommendation lane automatically transitions older members after the grace
  period.
- DeepSeek chat, reasoning, and fast snapshots use separate lanes; Kimi's
  general and code-focused models do the same. Explicit lifecycle evidence can
  mark a known replaced snapshot Legacy immediately without weakening the
  global successor grace period.
- Recommendation lanes must be curated carefully. Peer tiers and specialist
  models use different lanes even when their names share a generation number;
  product-name changes may stay in one lane when they replace the same choice.
- Models without a maker policy or trustworthy lineage or lifecycle evidence
  remain Current. This fails conservatively instead of guessing from age or
  names, while the audit makes suspicious stale lanes visible for human review.
- The selector prioritizes Current models through provider-scoped disclosure
  while keeping favorites and explicit user visibility authoritative.

## Alternatives considered

- **Global age cutoff.** Rejected because it labels most of the broad catalog
  Legacy and misclassifies specialist models without successors.
- **Hand-maintained Legacy boolean.** Rejected because it becomes stale and
  loses the reason and effective date.
- **Reuse `catalogStatus`.** Rejected because visibility, route availability,
  and logical priority have different consumers and behavior.
- **Runtime dependency on an external model registry.** Rejected because
  lifecycle authority varies by field and provider, and catalog availability
  must remain deterministic from committed data.
- **Central registry of current lane heads.** Rejected because it duplicates
  release and lifecycle facts already carried by model records and creates a
  second source of drift. The exact maker policy is narrower: it is used only
  when product explicitly defines a bounded default portfolio, as OpenAI does
  here, and it safely defaults newly added models to Legacy pending review.
- **Automated provider-document scraping.** Rejected because prose is not a
  stable machine contract. Official documentation remains evidence for curated
  changes rather than a runtime or CI dependency.
