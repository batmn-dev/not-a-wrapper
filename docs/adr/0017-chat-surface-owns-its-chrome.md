# 17. Chat surface owns its chrome

- Status: accepted
- Date: 2026-07-30
- Related: ADR-0012 (atomic first-turn creation — the shallow pushState handoff
  this decision accommodates), ADR-0013 (back-navigation detach — the other
  in-place chat-id transition), `app/components/chat/chat-chrome.ts` (the
  resolver this records the rule for).

## Context

The app header was chosen at server-route altitude: `LayoutApp`'s `header`
slot is fixed when a page renders (`/` and `/c/` used the default `<Header/>`,
`/p/[projectId]` passed `null` because the project surface brings its own
compact chrome). But which surface is actually visible — project onboarding,
home onboarding, or a thread — is decided by client state (`chatId` + the
rendered turn array) that changes without a server navigation: the first-turn
handoff is a shallow `window.history.pushState`, and since the immediate
optimistic insert the surface flips in the same frame as the send.

The two decision sites drifted: after a first send from a project page, the
mounted `/p/` page's `header={null}` persisted while Chat flipped to the
thread view — a thread with no header until a hard reload. The home route only
avoided this because its header choice coincidentally matched the thread's.

## Decision

Chat-bearing routes (`/`, `/c/[chatId]`, `/p/[projectId]`) pass
`header={null}` and delegate the app header to Chat. Chat derives BOTH the
surface and its header from one pure resolver,
`resolveChatChrome({ chatId, messageCount, hasProject })`
(`app/components/chat/chat-chrome.ts`), and renders `<Header/>` inside its own
tree (first child of `#thread`, sticky within the shared ScrollRoot — the same
placement the project surface's mobile header already proved out).

Rules:

- New chat surfaces get a row in the resolver, not an ad-hoc conditional in
  `chat.tsx` or a per-route header slot.
- `LayoutApp`'s `header` slot remains for NON-chat pages only (e.g.
  `/projects`), whose chrome never flips client-side.
- Project onboarding keeps surface-owned chrome (compact mobile header inside
  `ProjectDetailSurface`, no desktop app header). ChatGPT parity for the
  project surface (52px sticky page header; project/chat breadcrumb on threads
  opened from a project — both measured live 2026-07-30) is deliberately out of
  scope here and becomes a single-file change in this seam when taken up.

## Consequences

- A client-side flip can never show a thread without the thread's header; the
  invariant is pinned by `chat-chrome.test.ts`.
- The header moved from a ScrollRoot sibling of `<main>` into `#thread`.
  Sticky/scroll-shadow behavior is unchanged (`useScrollRoot` is
  context-based, and the `/main` container queries name their container), but
  the header now shares the thread's stacking context — future z-index work
  should account for it.
- Alternatives considered: a slot-fill context (keeps header DOM in the shell
  but preserves two agreeing-by-convention sites); a real Next.js navigation on
  first turn (rejected — the shallow handoff is load-bearing for stream,
  optimistic-row, and composer continuity); pathname conditionals in LayoutApp
  (rejected — the slot exists to avoid exactly that).
