# ChatGPT Activity source-chip overflow — corrected reference (2026-07-13)

Re-measured in the logged-in reference conversation
(`https://chatgpt.com/c/6a543d4d-cda4-83ea-b03e-2cc08bb344f0`), light mode,
~1681×1200. Supersedes the 2026-07-12 observation that activation replaced the
overflow button one-shot — that capture missed the expanded state's trailing
control.

## Measured contract

- The overflow control is a free TOGGLE keyed per search row.
- Collapsed: three source chips plus an `N more` button chip. Its leading
  content is a stacked favicon preview of the FIRST THREE HIDDEN sources:
  each favicon is 12px (`h-3 w-3` box-content) in a `rounded-full
  overflow-hidden` wrapper with a 1px ring in the chip-surface color
  (`group-hover` flips the ring to text-primary), backdrop page-surface;
  wrappers overlap via `-ms-3` with `first:-ms-1` as direct children of the
  button's `inline-flex items-center gap-1` content (net 8px overlap per
  14px wrapper). Label div: `max-w-[8rem] truncate`. Favicons come from
  `google.com/s2/favicons?sz=32` rendered at 12px.
- Expanded: ALL chips inline plus a text-only `Show less` button chip using
  the identical chip recipe (`h-[25px] px-3 text-xs rounded-full`, secondary
  text, hover inverts like the source chips).
- `Show less` collapses back to three-plus-`N more`; the round trip repeats
  freely (verified 23 → 3 → 23 chips on the reference row).
- Neither state carries `aria-expanded`/`aria-controls` on the reference; the
  local implementation deliberately keeps disclosure ARIA on the toggle.

## Local mapping

`SearchSourceChips` (`app/components/chat/activity/activity-panel.tsx`):
tokens map as chip surface `bg-muted`, favicon backdrop `bg-background`, ring
`border-muted` → `group-hover:border-foreground` (the chip inverts to
`bg-foreground` on hover, matching the reference's blended ring). Panel
close/reopen still resets to collapsed (session-keyed state, unchanged).
