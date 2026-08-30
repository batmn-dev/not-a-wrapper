# 17. Chat surface owns its chrome

- Status: accepted (amended 2026-07-30: header DOM moved back OUTSIDE the
  `<main>` landmark — review found the original in-`#thread` placement made
  the `#main` skip link land before the header's nav controls and stripped
  `<header>`'s implicit banner role. The decision stays Chat's; the DOM
  position is the shell's, bridged by `chat-chrome-host.tsx`.)
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

Chat derives BOTH the surface and its header from one pure resolver,
`resolveChatChrome({ chatId, messageCount, hasProject })`
(`app/components/chat/chat-chrome.ts`). The DECISION is Chat's; the header's
DOM POSITION is the shell's: chat-bearing routes (`/`, `/c/[chatId]`,
`/p/[projectId]`) wrap LayoutApp in `<ChatChromeProvider initialAppHeader=…>`
and pass `header={<ChatChromeHeader/>}` (`chat-chrome-host.tsx`, mirroring the
ActivityPanelDockSlot host pattern). Chat publishes the resolved `appHeader`
fact from a pre-paint layout effect; the slot renders it BEFORE
`<main id="main">`, so the `#main` skip link bypasses the header and
`<header>` keeps its implicit banner role — nesting it inside `<main>`
forfeits both (found in review of the first cut, which rendered it inside
`#thread`). `initialAppHeader` mirrors the route's
SSR-known first surface (`/p/` false — always project onboarding; `/` and
`/c/` true), so server HTML, hydration, and the first client render agree.

Rules:

- New chat surfaces get a row in the resolver, not an ad-hoc conditional in
  `chat.tsx` or a per-route header slot.
- `LayoutApp`'s `header` slot remains for NON-chat pages only (e.g.
  `/projects`), whose chrome never flips client-side.
- Project onboarding keeps surface-owned chrome (compact mobile header inside
  `ProjectDetailSurface`, no desktop app header). The project surface (52px
  sticky page header; project/chat breadcrumb on threads opened from a project)
  is deliberately out of scope here and becomes a single-file change in this
  seam when taken up.

## Consequences

- A client-side flip can never show a thread without the thread's header; the
  invariant is pinned by `chat-chrome.test.ts`.
- The header's DOM position is unchanged from pre-ADR days (ScrollRoot child
  before `<main>`): sticky, scroll-shadow, stacking context, skip link, and
  banner landmark all behave as they always did. Only the visibility decision
  moved (into Chat's resolver, bridged by the chrome host context).
- Alternatives considered: a slot-fill context (keeps header DOM in the shell
  but preserves two agreeing-by-convention sites); a real Next.js navigation on
  first turn (rejected — the shallow handoff is load-bearing for stream,
  optimistic-row, and composer continuity); pathname conditionals in LayoutApp
  (rejected — the slot exists to avoid exactly that).

## 2026-08-23 rendering addendum

The ownership and DOM-position decision above is unchanged. The header contract
has since been reverified as a transparent, shadowless sticky
header whose fixed mode follows the resolved surface: home onboarding uses
`data-fixed-header="always"`, while threads use `data-fixed-header="never"`.
`ScrollRoot` therefore reserves the header height on onboarding and zeroes
sticky top padding for threads without subscribing to scroll position. Future
fixed-header variants remain valid extension points, and the active header does
not copy scroll state into React or need an effect-driven shadow.

The resolved `ChatSurface` now also drives `ThreadBottomContainer` posture
directly. The previous `variant` plus `isOnboarding` pair could express invalid
combinations and duplicated the resolver's decision. This does not change the
Composer's stable tree position: only the footer chrome changes across the
onboarding-to-thread flip, so draft, attachment, editor, and focus identity are
preserved.
