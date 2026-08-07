# 18. One canonical sidebar component system

- Status: accepted
- Date: 2026-08-07
- Related: `app/components/layout/sidebar/sidebar-geometry.test.ts` (the token
  contract this decision makes canonical),
  `docs/sidebar-chat-grouping-reference.md` (the live parity evidence for row
  anatomy and geometry), ADR-0005 (chat list window — the data the rows render).

## Context

The repository contained two unrelated "sidebar item" systems that both
claimed the name. The production system — `SidebarMenuItem`, `SidebarRow`,
`SidebarLeadingIcon`, `SidebarRowActions` in `app/components/layout/sidebar/`,
styled by the `--sidebar-*` token + `.sidebar-row*` utility contract in
`app/globals.css` and pinned by `sidebar-geometry.test.ts` — is the
ChatGPT-parity implementation every app surface renders. The second was a
vendored shadcn/ui sidebar kit in `components/ui/sidebar.tsx` (~20 menu
components) with zero production consumers, different hover/active color
tokens, and its own dead mobile Sheet branch.

Because `components/ui/` looks like the canonical layer, new surfaces reached
for the abandoned kit: the design-system registry's own sidebar was built from
it, so the registry documented rows the product doesn't ship and looked
different from the app. Both files exported a component literally named
`SidebarMenuItem` — an `<li>` wrapper in one, a full navigation row in the
other — one autocomplete away from a wrong import. Widths were duplicated
across languages: TS constants (`SIDEBAR_WIDTH`, `SIDEBAR_WIDTH_ICON`)
injected as inline styles had to stay equal to CSS tokens
(`--sidebar-width`, `--sidebar-rail-width`) that the geometry test only
half-guarded.

## Decision

The app's CSS-contract row system is THE sidebar component system.

- `components/ui/sidebar.tsx` is the state/shell layer only: `SidebarProvider`
  (collapse state, cookie persistence, ⌘⇧S), `useSidebar`, the `Sidebar` frame
  (`collapsible="icon" | "none"`), `SidebarTrigger`, `SIDEBAR_CONTAINER_ID`.
  The shadcn menu vocabulary, mobile Sheet branch, and floating/inset/offcanvas
  variants are deleted. Do not reintroduce a parallel menu system there.
- Sidebar rows are composed from `app/components/layout/sidebar/`
  (`SidebarMenuItem` for static nav rows — `icon` optional; `SidebarRow` +
  adapters for editable list rows). Section headers ("Pinned", "Recents",
  "Components") are part of the same vocabulary and render through
  `CollapsibleSection variant="sidebar"` — never a hand-styled label. Mobile
  presentation is consumer-owned (the app's own Sheet drawer).
- Widths are CSS-owned: `--sidebar-width` and
  `--sidebar-width-icon: var(--sidebar-rail-width)` live in `app/globals.css`
  `:root`; the collapsed frame equals the rail by construction, pinned in
  `sidebar-geometry.test.ts`. No TS width constants.
- The design-system registry is a consumer and verification surface for
  production components: its chrome composes `SidebarMenuItem`, and its
  catalog pages document the production row components — never a parallel
  implementation.

## Consequences

- One vocabulary: `SidebarMenuItem` has a single meaning; the sidebar's look
  is defined once, in tokens with tests, and the registry shows the real thing.
- Unused sidebar color tokens from the shadcn kit
  (`--sidebar-accent`, `--sidebar-primary`, `--sidebar-ring` families) were
  deleted with it; `--sidebar`, `--sidebar-foreground`, `--sidebar-border`
  remain the shell's color surface.
- The ⌘⇧S shortcut is registered per-surface (the app sidebar registers a
  shortcut scope; routes without a collapsible sidebar leave it inert), so
  toggling can no longer silently rewrite the persisted collapse state from
  a route that doesn't render it.
- A future generic sidebar consumer starts from the state/shell layer plus the
  production row components; if it needs vocabulary they don't provide, extend
  them — resurrecting a vendored kit is the rejected alternative.
