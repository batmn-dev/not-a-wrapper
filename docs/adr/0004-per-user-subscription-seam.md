# 4. Per-user Convex live reads go through a gated subscription seam

- Status: accepted
- Date: 2026-06-25
- Context: Architecture deepening — Convex function-call cost; branch `darknight/crime-alley`

> **Status note (2026-07-23).** ADR-0005 subsequently replaced
> `chats.getForCurrentUser` with the bounded-window reads, and the
> `usePublicQuery` passthrough described below was removed because it never had
> a caller. The authenticated per-user query and pagination seams remain active.

## Context

Four app-wide live `useQuery` subscriptions accounted for ~900K of 927K Convex
function calls: `chats.getForCurrentUser`, `userKeys.getProviderStatus`,
`projects.getForCurrentUser`, and `userPreferences.get`. A read-set audit (each
query's read-set derived independently, every writer enumerated and reconciled
against the measured per-query split) found the cost was **not** one mechanism:

- **`chats.getForCurrentUser` — read-set breadth.** It `.collect()`s the whole
  `chats.by_user` range, and the chat-turn lifecycle bumps `chats.updatedAt`
  inside that range several times per turn (`chatRuntime.ts` startGenerationRun /
  markGenerationRunCompleted, `messages.ts` selectBranch). Each bump
  re-collects and re-sorts every chat. A textbook hot write inside a read-set
  range; the model reproduces the ~225K.

- **`userKeys` / `projects` / `userPreferences` — subscription lifecycle.** All
  three resolve the caller through the same `getCurrentUser` →
  `getUserByWorkosSubject` read used by the control query `users.getCurrent`,
  which costs **3.7K**. Their own collections are written only by rare,
  user-initiated CRUD. A pure read-set model therefore predicts they should be as
  cheap as the control — yet they measured ~225K. The difference is _when and how
  often they subscribe_, which a read-set model does not capture.

The lifecycle difference traced to the **subscribe gate predicate**, which had
drifted across call sites:

| Query                           | Gate                    | Source             |
| ------------------------------- | ----------------------- | ------------------ |
| `users.getCurrent` (3.7K)       | `isConvexAuthenticated` | `useConvexAuth()`  |
| `chats.getForCurrentUser`       | `isConvexAuthenticated` | `useConvexAuth()`  |
| `userPreferences.get`           | `!!userId`              | WorkOS prop        |
| `projects.getForCurrentUser`    | `!!user` (`isLoggedIn`) | WorkOS (`useUser`) |
| `userKeys.getProviderStatus` ×2 | _(none)_                | —                  |

`useConvexAuth()` flips true only once the Convex JWT is synced; WorkOS session
presence flips true earlier. Gating on WorkOS presence (or not gating at all)
subscribes during the auth-sync window — the query executes server-side,
`getCurrentUser` resolves no identity, returns a wrong-empty result, then
re-executes when the token lands — and `userKeys` ran for guests entirely, twice
(`lib/model-store/provider.tsx` and a duplicate in `settings/tools/tool-keys.tsx`).
The cheap control proves the cheap predicate. The gate was a per-call-site
convention living in five heads, and the deletion test confirmed it carried no
structural weight: `userKeys` forgot it with no compile-time signal.

This is the client mirror of the problem ADR-0003 solved on the server, where
~33 handlers re-derived auth inline until a builder seam made it structural.

## Decision

Introduce the **Per-user subscription** seam: a `usePerUserQuery` hook
(`lib/convex/use-per-user-query.ts`) every per-user Convex live read goes
through. It owns the one correct predicate — `isConvexAuthenticated` — and
returns `"skip"` to Convex until it is true, so a signed-out or mid-auth-sync
caller never opens a subscription or executes a wrong-empty read. Callers may
still pass `"skip"` themselves (e.g. no chat selected); the gate is the
conjunction. The hook returns `{ data, isAuthReady, isLoading }`, so providers
stop re-deriving `data === undefined && authState` loading logic by hand.

Genuinely-public reads (share links, public chats — no user concept) go through a
sibling `usePublicQuery` passthrough: the explicit escape hatch, the client
counterpart to the server's public `query` sitting beside `maybeAuthQuery`.

A `no-restricted-syntax` lint rule (`eslint.config.mjs`, scoped to
`app/`/`lib/`/`components/`, exempting `lib/convex/**` and tests) bans importing
`useQuery` from `convex/react` outside the hook module, so every call site
declares **per-user** vs **public** — the same `maybeAuthQuery`-vs-`query` choice
the backend makes, enforced the same way ADR-0003 enforced its seam.

All nine client `useQuery` sites were migrated:

- `chats.getForCurrentUser`, `users.getCurrent` — already gated on
  `isConvexAuthenticated`; routed through the hook with no behavior change.
- `userPreferences.get`, `projects.getForCurrentUser` — predicate **corrected**
  from WorkOS presence to Convex-auth readiness. The WorkOS flag is retained only
  where it is a genuine UI concern (the localStorage-vs-server branch in the
  preferences provider; hiding the projects section for guests).
- `userKeys.getProviderStatus` — gate **added** in `ModelProvider`; the duplicate
  subscription in `tool-keys.tsx` **removed** in favor of reading
  `useModel().userKeyStatus` from the single owner.
- `mcpServers.list`, `mcpToolApprovals.listByServer`, `messages.getForChat` —
  ungated per-user reads brought under the seam. `getForChat` requires an owned
  chat, so the gate also prevents a throw if it opens before the JWT syncs.

The new term **Per-user subscription** is recorded in `CONTEXT.md` under a
**Client** subheading, as the counterpart to the backend **Authenticated
handler**.

## Consequences

- The subscribe gate is structural: a new per-user live read is Convex-auth-gated
  by construction, and the lint rule blocks raw `useQuery`. Forgetting the gate
  (the `userKeys` regression) stops being possible.
- The gate predicate concentrates in one module — proven once, inherited by every
  call site. Providers shed their hand-rolled loading derivations.
- `userKeys` no longer runs for guests, and its second subscription is gone.
  `userPreferences` and `projects` no longer subscribe during the auth-sync
  window. These directly target the subscription-lifecycle cost of three of the
  four dominant queries.
- This decision does **not** by itself address the `chats.getForCurrentUser` cost,
  which is read-set breadth, not lifecycle. That is a separate deepening (isolate
  the streaming `updatedAt` writes from the chat-list read-set) and is out of
  scope here.
- The headline cost split should be confirmed against the Convex Functions
  dashboard (initial-subscribe vs invalidation re-runs per query; guest-caller
  count on `userKeys`). The static read-set model proves `chats` is read-set
  driven and that the other three _should_ be cheap like the control; the
  dashboard settles how much of their measured cost was the now-closed lifecycle
  channel versus grouped/approximate bucketing.
- Deliberately out of scope: server-side `fetchQuery`/`preloadQuery` reads (a
  different seam — they already reuse the authenticated handlers via a token),
  `useMutation` / `useConvex` (no subscription to gate), and the app-shell preload
  candidate (preload session-static data, keep the chat list live), which remains
  unbuilt.
