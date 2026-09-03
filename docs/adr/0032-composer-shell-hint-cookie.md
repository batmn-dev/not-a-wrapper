# ADR-0032: Server-rendered composer shell seeded from a device-memory cookie

**Status:** Accepted
**Date:** 2026-09-02

## Context

The server-rendered composer showed the tier default ("5 Mini / Medium") and
flipped to the saved model and effort after the client hydrated, a visible
flicker on every cold load of `/`. t3.chat's shell already looks like the
final composer. Three inputs the composer resolves from were all unavailable
on the server:

- the last-used model and the per-model effort are device memory
  (`localStorage`, ADR-0026: "device-local, mirrors `lastUsedModel`"), which
  no server render can read;
- the model catalog was fetched from `/api/models` after mount, so even the
  hydrated client resolved to the default until that response landed — the
  route computed `getVisibleLogicalModelViews()` with no per-request input,
  i.e. static data the client bundle already carried via `getModelInfo`;
- the last-used model was gated on the Convex user document (favorites) even
  when it was already known, so an authenticated load could show the default,
  then the last-used model, once `users.getCurrent` delivered.

Options for the device memory:

1. Move model/effort memory to Convex `userPreferences` and read it in the
   root layout. Adds a Convex round trip before the HTML streams (the layout
   only awaits the WorkOS session today; `getUserAuth` fetches nothing else),
   changes the product semantics ADR-0026 deliberately deferred (cross-device
   sync), and leaves guests with nothing.
2. Make a cookie the only store. Cookies ride every request (the per-model
   effort map grows with the catalog), have no `storage` event for the
   cross-tab fold-in the effort store relies on, and would rewrite two tested
   memory modules.
3. Keep `localStorage` as the source of truth and mirror the two values the
   new-chat shell needs — the last-used model and that model's effort — into
   one small cookie the layout reads off the request.

## Decision

- **Composer shell hint** (`lib/composer-shell-hint.ts`): one cookie,
  `composer_shell`, carrying `{ m: logicalModelId, e?: effort }`. It is
  written at the two device-memory writers (`ModelProvider.setLastUsedModel`,
  Turn context `setReasoningEffort` when the selection is for the last-used
  model) and re-synced after hydration only when device memory drifted from
  the seed. The root layout reads it beside `getUserAuth()`
  (`lib/composer-shell-hint.server.ts`): request cookies only, no network.
- **Untrusted input.** `parseComposerShellHint` validates the model against
  the logical catalog (through `resolveModelSelection`, like `localStorage`)
  and the effort against the union and the model's own `effortLevels`;
  anything else is dropped. Selectability for the auth state remains the
  resolver's job (`resolvePreferredModelId`), so an inaccessible hint yields
  the real default, never an invalid label. Guests and users with no memory
  get the real default on the server too. One presentation exception: key
  status (`userKeys.getProviderStatus`) is a client read that lands after the
  user document, so until it does a signed-in device's last-used model keeps
  the accessibility it had when it was chosen; a key-backed selection thus
  paints in the shell instead of the default, and a stale one still drops to
  the default once status arrives. Admission never reads this flag.
- **One source of truth.** Device memory is the live `useSyncExternalStore`
  snapshot for both values (`ModelProvider.lastUsedModel`, the Turn context's
  stored effort); the hint is only their server snapshot. The server render
  and hydration therefore paint the saved selection, React re-renders after
  hydration only if the live read genuinely differs, and a mount effect
  rewrites the cookie only on that drift.
- **Static catalog.** `ModelProvider` builds the visible logical views from
  the bundled catalog on first render; `/api/models` and the store's
  `isLoading`/`refreshAll` are gone (key status was already reactive via
  Convex). The server shell and the client resolve the same list.
- **Last-used is not gated on favorites.** `useSessionModel` passes
  `lastUsedModel` from the first render; only the favorite fallback waits for
  `modelPrefsHydrated`, which now also waits for key status, so the Turn
  context's auto-submit gate never dispatches a `?autoSubmit=1` turn on a
  provisional selection. The model selector likewise holds a click on a
  key-backed model until key status has answered (`whenKeyStatusReady`) and
  then selects it or opens the Pro dialog, instead of deciding on a guess.

## Consequences

- Cold load of `/` with a saved selection paints the saved model and effort
  in the server HTML; the sampling harness
  (`benchmarks/chat-performance/browser/composer-shell.ts`) counts zero label
  changes and zero composer layout shift after the change.
- A key-backed (BYOK-only) saved model paints in the shell as well: the
  last-used model keeps its accessibility until key status lands, and a
  stale selection drops to the default afterwards, as before.
- First load after deploy on a device with existing `localStorage` memory
  still flips once (no cookie yet); the hydration re-sync writes it, and
  every later load is seeded.
- A user who never picked a model but set an effort on the default model has
  no hint (the hint mirrors the last-used model's effort), so that effort
  label still appears after hydration. Users with favorites but no last-used
  model resolve to the favorite after the Convex user read, as before.
- Chat pages (`/c/[id]`) seed the shell with the last-used model, then show
  the chat's own model once it loads; the chat document is not read on the
  server (ADR-0001's client-renders-server-path posture is unchanged).
- The cookie is ~80 bytes, `SameSite=Lax`, one year, not `HttpOnly` (the
  client writes it). It carries a model id and an effort level only.
