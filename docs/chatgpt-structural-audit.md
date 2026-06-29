# ChatGPT Conversation-Page Structural Alignment — Status

Audit of ChatGPT's desktop conversation DOM/layout topology vs ours, reduced to what's left. **9 of 10 recommendations shipped on `darknight/gcpd-rooftop` (2026-06-29); Rank 4 deferred.** This doc tracks outstanding work; the completed analysis (full skeletons, divergence map, per-rec write-ups) has been removed as stale.

## Shipped

| # | Change | Anchor |
|---|---|---|
| 1 | Thread gutter/cap/scrollbar-gutter tiers fire at `@[40rem]/main` & `@[64rem]/main` — matches ChatGPT's `@w-sm`/`@w-lg` (breakpoint scale) instead of our old `@sm`/`@lg` (container 24/32rem) | `thread-bounds.ts`, `layout-app.tsx:23` |
| 2 | Body-level `aria-live` regions (polite + assertive), persistent across routes via a portal bridge; text derived from chat status (no effect) | `chat-announcer.tsx` (new), `layout.tsx`, `chat.tsx` |
| 3 | One `<article>` per turn — inner `Message` is `as="div"` on the chat path (+ `data-message-author-role`); share page keeps `<article>` | `message.tsx`, `message-user.tsx`, `message-assistant.tsx` |
| 5 | `--sticky-padding-top` indirection; scroll-pt + per-turn scroll-mt collapse to 0 at `@7xl/main` (transparent header) | `layout-app.tsx:23`, `conversation.tsx` |
| 6 | `data-scroll-root=""` on the scroll port | `scroll-root.tsx` |
| 7 | `data-turn-id` on each turn article | `conversation.tsx` |
| 8 | Collapsed rail → `<nav aria-label="Sidebar">`; quick-actions → `<aside>` | `app-sidebar.tsx` |
| 9 | `<main>` → `min-h-0 flex-1` (column axis lives on `#thread`) | `layout-app.tsx:25` |
| 10 | Static `data-fixed-header="less-than-xl"` + gated 80rem/96rem transparency tiers (inert two-tier plumbing) | `header.tsx` |

Verified: typecheck, lint, vitest (only the unrelated pre-existing `lib/mcp/load-tools` failures remain), and Tailwind compiles the new `@[40rem|64rem|96rem]/main` container queries.

## Outstanding

### Rank 4 (deferred) — Unify the sidebar onto an in-flow `shrink-0` shell
**Effort M · confidence strong · primitive-level risk.**
- **ChatGPT:** sidebar is an in-flow flex sibling that is itself the width carrier — `#stage-slideover-sidebar relative z-21 h-full shrink-0 border-e` with `style="width:var(--sidebar-width)"`. No phantom spacer.
- **We:** a `fixed inset-y-0 z-10 w-(--sidebar-width)` shell (`components/ui/sidebar.tsx:254-257`, `data-slot="sidebar-container"`) paired with a separate in-flow `data-slot="sidebar-gap"` spacer (`:242`) whose width animates to push the main column.
- **Why bother:** (a) gap and fixed-shell widths must stay in lockstep — a latent desync class; (b) the activity dock already uses the in-flow `shrink-0` sibling-shrink pattern (`layout-app.tsx:34`), so the sidebar is the odd one out.
- **Change:** replace the fixed shell + `sidebar-gap` with a single `relative shrink-0 w-(--sidebar-width)` shell (dock-slot pattern); keep `id=SIDEBAR_CONTAINER_ID`; re-derive the `offcanvas`/`icon`/`offcanvas:left-…` variants onto the one node (offcanvas animates its own width to 0).
- **Blast radius:** `sidebar.tsx:242` (drop gap), `:254-257` (fixed→relative shrink-0), `SIDEBAR_CONTAINER_ID` consumers (`:34,209,254,295,763`, `header-sidebar-trigger.tsx`, `app-sidebar.tsx:30,230` aria-controls). Re-verify collapsed/icon/offcanvas + mobile-sheet and the `absolute z-10` collapsed rail (`app-sidebar.tsx:117`).

### Follow-ups on shipped work
- **Rank 1 — RESOLVED (mid-sweep re-cap removed).** Kept the ChatGPT-faithful 40/64rem tier VALUES (byte-accurate static widths) but eliminated the mid-sweep re-cap: `layout-app` now scopes `@container/main` to span the scroll column AND the dock slot, so opening the panel redistributes width without changing the container — the cap/gutter tiers cannot fire during the sweep and the column reflows continuously at every width. Confirmed live (deterministic per-frame sweep, both sides of the 64rem boundary: container constant, zero cap/gutter flips, max single-frame step 1px). ChatGPT itself does re-cap −128px in the ~1300–1700px band (its tiers key off the panel-dependent column); we keep its static widths but take the smoother close.
- **Rank 2 — completion announcement.** Current MVP announces generation **start** (polite) + **errors** (assertive). Completion is omitted because distinguishing "just finished" from "opened an existing chat" needs transition state (an effect), which we avoided. Add if/when an effect is acceptable.
- **Rank 5 — narrow payoff.** Only corrects scroll anchoring at ≥80rem container (header transparent), a regime rarely hit while the panel is open. Cheap and correct, just low-impact.

## Do-not-regress guardrails (intentional, better-than-ChatGPT divergences)

1. **Flat app-root** — single flex-ROW (`layout-app.tsx:20`) vs ChatGPT's flex-COL → z-0 ROW A → ROW B. We have no in-flow high-z peer and `<body>` already has `isolate` (`layout.tsx`). Don't add the wrapper rows.
2. **Single dock-slot panel carrier** (`layout-app.tsx:34`, `activity-panel-host.tsx`) collapses ChatGPT's host wrapper + in-flow rail + ROW-A flyout into one always-mounted `shrink-0` carrier. Don't reintroduce the three-node form.
3. **Composer-overlap on `ScrollRootContent`** (`conversation.tsx:133`) — one fewer wrapper than ChatGPT's dedicated turns-wrapper; it doubles as the stick-to-bottom contentRef (editing `-mb`/`pb` changes measured height; no test guards it).
4. **Composer gutter/cap flattening** (`chat.tsx`) preserves the **`THREAD_*_VARS` byte-identical invariant** (`thread-bounds.ts` — vars appended LAST so article and inner-column class strings stay byte-identical). Don't add ChatGPT's extra nesting.
5. **Viewport gates are correct** for panel docked↔sheet (`max-lg` + `matchMedia 1024`) and sidebar visibility (`md`) — a container gate would feed back on itself. Only the *thread* tiers are container-scoped.
6. **Brand-neutral semantics already in place** — skip-link to `#main`, sr-only turn headings (`message-user.tsx`/`message-assistant.tsx`), `role="presentation"` composer-parent, dynamic `data-scroll-anchor` (consumed by `globals.css`), labelled `<section>` activity panel with `aria-labelledby` (not a static label, not a dialog). Preserve all.

## Reference: ChatGPT's `@w-*` container-query family

`@w-{n}/main` = `@container main (width ≥ var(--breakpoint-{n}))` → **sm=40, lg=64, xl=80, 2xl=96 rem** — the *breakpoint* scale, distinct from Tailwind's default `@{n}/main` (*container* scale: sm=24, lg=32, 2xl=42). Proof: the only compiled `@container main` contexts are `width≥80rem`/`width≥96rem` (the header tiers) = `--breakpoint-xl`/`--breakpoint-2xl`, not the container values. Implication already shipped in Rank 1; reach for explicit `@[Nrem]/main` to match a ChatGPT `@w-*` threshold.
