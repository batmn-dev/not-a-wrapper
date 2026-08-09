# 19. `"use client"` marks behavior, not location

- Status: accepted
- Date: 2026-08-07
- Related: ADR-0018 (the design-system registry whose server-rendered pager
  surfaced the problem), `components/ui/button.tsx` (the motivating case).

## Context

`components/ui/button.tsx` carried a `"use client"` directive it did not need:
Base UI ships `'use client'` inside its own compiled files (first line of
`@base-ui/react/button/Button.mjs`), so a hook-free wrapper that composes a
Base UI primitive needs no directive of its own. The unnecessary directive had
a real cost. Server components cannot call plain functions imported from a
client module, so when the design-system registry's server-rendered pager
needed `buttonVariants()` to style a link, the variants had to be split into a
separate `button-variants.ts` file — a workaround for a directive that should
not have existed.

Upstream shadcn made and reverted the same mistake (shadcn-ui/ui#9207 added
the directive in Jan 2026; issue #9428 reported the exact
`buttonVariants`-from-server error; commit `4f421ab` removed it in Mar 2026).
But shadcn's registry still carries the directive on ~39 of 64 Base UI
wrappers, including hook-free ones — they remove it only when an issue is
filed. A survey of comparable libraries showed three distinct postures:
shadcn's issue-driven pragmatism; prompt-kit keeping its response-*display*
path (markdown, message) directive-free while inputs and containers are
client; and fluid-functionalism where even a static badge is a client
component because design tokens flow through React context, dragging the whole
tree client-side.

## Decision

1. **The directive marks in-file client behavior, not render location.** A
   file in `components/ui/` carries `"use client"` if and only if it calls
   hooks (including library hooks such as Base UI's `useRender`, whose chain
   reaches `useMergedRefs`), defines its own event handlers or refs, or
   touches browser globals. Forwarding caller-supplied props is not behavior.
   Composing primitives from libraries that declare their own banner is not
   behavior.
2. **Shared surfaces stay shared.** Styling primitives whose helpers are
   called at render time (`buttonVariants` and every cva export) and pure
   display components live in shared modules. This is why the 2026-08-07 sweep
   removed the directive from ~25 hook-free wrappers and folded
   `buttonVariants` back into `button.tsx`, deleting `button-variants.ts`.
3. **Design tokens live in CSS, never context.** CSS-variable tokens are what
   make rule 2 achievable; context-based theming would force every consumer
   client-side (the fluid-functionalism failure mode).
4. **Scope: the invariant binds the primitives layer** (`components/ui/`).
   Product components under `app/components/` are interaction-first and may
   keep an intent-documenting directive even when hook-free
   (`sidebar-menu-item.tsx` is the canonical example).
5. **When vendoring, re-evaluate the banner instead of copying it.** Upstream
   directives encode upstream's constraints and history, not ours.

## Consequences

- We deliberately go further than shadcn: their remaining banners are inertia,
  not philosophy. Do not "fix" a missing directive by matching upstream files.
- Verification is `bun run build:next` — the production build is what enforces
  RSC boundaries. Dev-mode rendering and `tsc` do not catch violations.
  (`bun run build` is the Convex production deploy preflight, not a local
  build.)
- The invariant fails safe: adding a hook to a directive-free file breaks the
  build loudly with an actionable error, which is the enforcement working.
- Known kept directives with reasons: `input-group.tsx` (in-file `onClick`),
  `breadcrumb.tsx` (Base UI `useRender` hook chain), `markdown.tsx` (streaming
  renderer hooks — a deliberate divergence from prompt-kit's directive-free
  display path, trading server-renderability for streaming performance).
