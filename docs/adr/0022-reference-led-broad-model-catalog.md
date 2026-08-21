# 0022 — Reference-led broad chat-model catalog

**Status:** accepted **Date:** 2026-08-20 **Amends:** ADR-0007 (replaces the
small per-vendor curation cap; keeps the snapshot-generated OpenRouter
workflow) **Uses:** ADR-0020 (logical models and server-owned route selection)

**Context.** T3 Chat's authenticated model settings exposed 101 model entries
on 2026-08-20, while this app intentionally limited OpenRouter to a small set
of flagship and workhorse models. That cap made the selector easier to scan,
but it also prevented users with their own OpenRouter key from choosing many
live, capable chat models. Adding every entry as a direct-provider record would
duplicate provider metadata, invent upstream ids for T3-specific names, and
split one model into multiple selector identities.

**Decision.** Treat the observed T3 Chat inventory as a broad product reference,
not as an upstream API contract. Add every referenced model that meets all of
these conditions:

1. a live route exists in the official OpenRouter model listing or in an
   already-supported direct provider catalog;
2. the route is a language model compatible with the app's text-generation
   runtime, including multimodal models that accept image input;
3. the entry is a concrete model, not a router, batch endpoint, duplicate fast
   tier, or provider-specialized variant.

OpenRouter-only records remain BYOK-gated. Existing direct records stay
canonical and gain an explicitly mapped OpenRouter route through ADR-0020.
Capabilities, context windows, output limits, release dates, and pricing remain
machine-derived from the refreshed OpenRouter snapshot. Human-authored fields
stay in the allowlist.

The 2026-08-20 inventory originally produced 89 supported chat models. Three
GPT-5.6 routes were added once direct OpenAI API and installed provider support
became available, bringing the supported reference inventory to 92 models.
Nine entries were not added:

- six image-generation-only models: Nano Banana, Nano Banana Pro, Nano Banana
  2, and GPT ImageGen 1, 1.5, and 2;
- Muse Spark 1.1 and 1.2, which had no route in the supported public provider
  catalogs;
- MiMo V2 Flash, which was absent from the live OpenRouter listing. Its former
  id succeeds to MiMo V2.5.

The SDK's remaining autocomplete-only omissions do not override the live-route
rule. In particular, Perplexity retired `sonar-reasoning` in favor of the
catalogued `sonar-reasoning-pro`, and Mistral deprecated its native Magistral
aliases in favor of reasoning on current Mistral Small and Medium models.

**Alternatives considered.** Hand-authoring direct routes for every maker was
rejected because the app has no key-bearing provider strategy for most of
them. Copying the 101 display entries regardless of routability was rejected
because it would knowingly expose dead selector rows. Keeping the old small
cap was rejected because it conflicts with the requested broad model surface.

**Consequences.** The selector becomes substantially denser, but favorites and
model visibility settings already provide the user-owned reduction mechanism.
Catalog refreshes may now touch more records, so the existing missing-id
failure and succession workflow become more important. Reference parity is a
dated observation, not an automatic sync: future additions still require a
live-route check and a committed snapshot refresh.
