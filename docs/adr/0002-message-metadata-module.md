# 2. Message metadata is a deep module that owns its key-set and write surface

- Status: accepted
- Date: 2026-06-23
- Context: Architecture deepening — message metadata; branch `darknight/batarang`

## Context

A chat message's `metadata` was a shallow, leaky data structure rather than a
module. The same knowledge — "metadata is a `Record<string, unknown>` you guard,
then poke specific keys" — was re-derived everywhere:

- the `isRecord` guard was reimplemented at three sites
  (`lib/chat-messages/branch.ts`, `lib/chat-store/turns/selected-path.ts`,
  `lib/chat-messages/ui-message-adapter.ts`);
- the set of server-owned keys was declared once in `selected-path.ts` but
  hand-copied by the durable adapter in `ui-message-adapter.ts`, with nothing
  linking them — drop a key in the adapter and the projection's merge/delete
  loop silently desynced; and
- the persisted assistant-metadata blob was written to Convex as an opaque
  `v.any()`: whatever the AI SDK accumulated across stream parts landed in the
  database un-namespaced, so even the persisted truth was un-owned.

The deletion test confirmed there was no real module boundary: deleting the
canonical key-set list broke nothing at compile time.

## Decision

Introduce `lib/chat-messages/metadata.ts` as the single front door for reading
and writing message metadata:

1. **One owned key-set, two writers.** The server-owned key-set is defined once
   (`DURABLE_FIELD_MAP` / `SERVER_OWNED_METADATA_KEYS`). `stampServerFields`
   projects a stored message's durable fields into metadata (the durable
   adapter's write), keeping the `extended`/`runtime` mode gate and branch
   normalization; `adoptServerOwned` merges a server message's owned metadata
   onto a live one (the branch projection's write), returning the original
   reference on a no-op so the projection's idempotence/`React.memo` contract
   holds. Both derive from the one key-set, so a drift test can assert they
   agree — the test that was impossible while the list was duplicated.

2. **Typed readers, no casts.** `getServerMessageId` and `getBranch` are the
   accessors; callers no longer reach through `metadata as Record<string,
   unknown>`. The `isRecord` guard lives once in `branch.ts` (the lower module
   that also needs it) and is re-exported as the canonical metadata guard.

3. **The write surface is owned at the persist boundary.**
   `convex/lib/messageMetadata.ts` defines `vToolInvocationStreamMetadata`, a
   named validator mirroring the client `ToolInvocationStreamMetadata` type — a
   compile-time assertion locks the two against drift. It is the
   `markGenerationRunCompleted` args validator (malformed writes rejected at the
   boundary), and `projectPersistedMessageMetadata` runs in the route before
   persistence, keeping only the known keys so the stored value always conforms.

## Consequences

- Metadata knowledge concentrates in one module. Adding a server-owned key is a
  one-line change to the field map; the drift test fails if the two writers
  disagree.
- The persisted blob is owned for every new write: only the named key-set is
  stored, and the AI SDK can no longer slip un-namespaced keys into the column.
- The storage column (`messages.metadata`) is narrowed to the same named
  validator, so the stored shape is provably the owned key-set rather than an
  opaque `v.any()`. This was safe because there is no production data; the
  narrowed schema pushed cleanly to the dev deployment. Note this is a validator
  *narrowing*, which the repo's expand/migrate/contract tooling
  (`convex:schema-guard` / `convex:schema-preflight`) does **not** guard — that
  tooling detects field *removals* only. A future narrowing against a populated
  deployment would need a bespoke cleanup + verifier (Convex strict objects
  reject unknown keys, and the preflight would not catch non-conforming rows),
  not the removal-oriented manifest flow.

## Note on ADR-0001

ADR-0001 states the message model's `metadata` "stays `unknown` (to match the
SDK's `UIMessage` for variance)." That justification is imprecise: the AI SDK
types `metadata?: METADATA` as a generic *defaulting* to `unknown`, not a hard
`unknown`, and the codebase already applies a concrete type via
`DurableAdaptedUiMessage = UIMessage & { metadata?: ChatMessageMetadata }`. A
concrete or branded metadata type is assignable into the SDK's optional field;
the accessor-narrowing pattern is a defensible ergonomic choice, not a variance
requirement. This module keeps applying typing at the accessors/writers rather
than re-typing the SDK base — the same outcome ADR-0001 chose — but for the
correct reason.
