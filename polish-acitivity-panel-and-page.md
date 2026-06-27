# Polish Activity Panel And Page

Working document for the "conversation with activity panel" page fidelity pass.
Filename intentionally preserves the requested spelling: `polish-acitivity-panel-and-page.md`.

Status: 2026-06-27, branch `darknight/clock-king`.

## Goal

Match the ChatGPT reference page as closely as the project tokens and primitives allow, across the whole page:

- conversation header
- conversation/thread column
- composer
- activity panel shell and body
- relationships between those regions: header heights, seams, surfaces, scroll scaffolding, column push, borders, and alignment

This is polish, not re-architecture. Do not add feature flags, duplicate paths, or move ownership of the scroll root, composer, or active-turn panel state.

## Ground Truth

Reference files under `/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/`:

- `pages/conversation-with-activity-panel.md`
- `pages/conversation-with-activity-panel-tablet-820px-light.md`
- `pages/conversation-with-activity-panel-mobile-592px-light.md`
- `css/conversation-with-activity-panel.md`
- `css/component-computed-styles.json`
- `css/chatgpt-component-styles.md`
- `css/chatgpt-design-tokens.md`
- `css/raw-css-variable-inventory.json`
- `css/matched-rules.json`
- `research/activity-panel-component-inventory.md`

Local decisions of record:

- `docs/activity-panel-gap-analysis.md`
- `docs/activity-panel-implementation-plan.md`

Relevant implementation files:

- `app/components/chat/activity/activity-panel.tsx`
- `app/components/chat/activity/activity-panel-host.tsx`
- `app/components/chat/activity/activity-panel-trigger.tsx`
- `app/components/chat/activity/activity-timeline.tsx`
- `app/components/chat/activity/content-sheet-shell.tsx`
- `app/components/chat/activity/docked-flyout-shell.tsx`
- `app/components/chat/activity/panel-header.tsx`
- `app/components/chat/activity/panel-section-heading.tsx`
- `app/components/chat/activity/source-chip-group.tsx`
- `app/components/chat/activity/sources-gallery.tsx`
- `app/components/chat/chat.tsx`
- `app/components/chat/conversation.tsx`
- `app/components/chat/message.tsx`
- `app/components/chat/message-assistant.tsx`
- `app/components/layout/layout-app.tsx`
- `app/components/layout/header.tsx`
- `components/ui/sheet.tsx`
- `components/ui/source.tsx`
- `components/ui/button.tsx`
- `components/ui/icon.tsx`
- `components/ui/favicon.tsx`
- `components/ui/scroll-area.tsx`
- `components/ui/scroll-root.tsx`
- `app/globals.css`

## Current Render Evidence

Rerendered a seeded local-only chat with the activity panel open at:

- `1024px` desktop, light and dark: `/tmp/naw-activity-visual/1024-light.png`, `/tmp/naw-activity-visual/1024-dark.png`
- `768px` tablet, light and dark: `/tmp/naw-activity-visual/768-light.png`, `/tmp/naw-activity-visual/768-dark.png`
- `375px` mobile, light and dark: `/tmp/naw-activity-visual/375-light.png`, `/tmp/naw-activity-visual/375-dark.png`
- `768px` tablet long-content scroll fixture: `/tmp/naw-activity-visual/768-light-long.png`

The render harness is local-only and generated under
`output/playwright/activity-panel-harness/`; screenshots were written to `/tmp`
and are intentionally not committed.

Key computed values from the 2026-06-27 rerender:

- Desktop dock slot: `400px` wide, `1px` border-left, `transition-property: width`, `transition-duration: 0.3s`.
- Desktop docked shell: `border-radius: 0px`, `box-shadow: none`, light surface `oklch(1 0 0)`, dark surface `oklch(0.2134 0 0)`.
- Desktop activity header: `56px` tall, `1px` bottom border, close button `36x36`, `8px` radius, `20px` icon, `-10px` end margin.
- Desktop trailing spacer: `height: 0px`, `scroll-margin-bottom: 16px`.
- Tablet card: `448px` wide, content-sized at `734px` tall for the normal fixture, `762px` tall at the max-height cap for the long fixture, centered at `x=160`.
- Tablet card scaffold: `display: grid`, `overflow: hidden`, `border-radius: 16px`, `padding-bottom: 16px`, `box-shadow` from `shadow-border-xl`.
- Tablet sheet header: grid columns `360px 36px`, padding `16px 16px 8px 24px`, no bottom border, close button visible at `36x36`.
- Tablet long fixture scroll region: `clientHeight: 686`, `scrollHeight: 2222`, `canScroll: true`.
- Tablet overlay: light `oklch(0.92 0.004 286 / 0.5)`, dark `oklch(0 0 0 / 0.5)`, `backdrop-filter: blur(1px)`, opacity transition `0.25s`.
- Mobile sheet: bottom anchored, `375px` wide, `top: 6px`, top radii `16px`, bottom radii `0px`, no shadow.
- Mobile sheet header: close column collapses to `0px`; close button display is `none`.
- Mobile handle: visible at `48x4`, `margin-top: 6px`, using the `bg-muted` token.
- Mobile overlay: `oklch(0 0 0 / 0.3)`, no blur, no transition.
- Timeline markers: globe/done glyphs `15px`, bullet dot `6px`, connector `1px`.

## Reference Specs To Preserve

### Page Header

Reference `css/chatgpt-component-styles.md`:

- `#page-header` is `52px` tall.
- Padding is `8px`.
- Background is primary page surface.
- Border is `0px`; the bottom line is a shadow slot, transparent when unscrolled and `rgba(0,0,0,0.05) 0px 1px 0px` when scrolled.
- Transition is none.

Our `app/components/layout/header.tsx` matches the important relationship: `h-app-header` resolves to `52px`, and the bottom line is shadow-based, not a border.

Important: do not silently make the activity panel header `52px` to line it up with the page header. ChatGPT uses a real mismatch: page header `52px`, panel header `56px`.

### Activity Panel Shells

Reference `css/conversation-with-activity-panel.md`:

- Desktop `>=1024px`: docked right flyout, in-flow column, width `400px`, no overlay, no radius, no elevation, surface `#fcfcfc`.
- Tablet `640-1023px`: centered card, max width `448px`, `16px` radius, `shadow-long`, gray/50 backdrop with 1px blur in light, black/50 backdrop in dark.
- Mobile `<640px`: bottom sheet, edge-to-edge, top radius `16px 16px 0 0`, no elevation, black/30 backdrop, no blur, drag handle visible, close hidden.

Our shell split remains directionally right. The tablet card height/scaffolding
gap was fixed and verified in the 2026-06-27 pass below.

### Activity Panel Header

Reference `research/activity-panel-component-inventory.md`:

- Desktop flyout header is a border-bottom bar with `px-4 py-3`, `height calc(var(--header-height, 3.5rem) + 1px)`, and a visible bottom border.
- Sheet header is structurally different: native header grid `grid-cols-[1fr_min-content]`, `gap-3`, `ps-6 pe-4 pt-4 pb-2`, no bottom border.
- Title cluster is `Activity · 5m 42s`, `text-lg` (`18px / 28px`), gap `10px`.
- Flyout title weight is about `400`; sheet title inherits `500`.
- Close button is `36x36`, radius `8px`, `20x20` icon, hover surface tint, hidden on mobile sheet.

### Body Scaffolding

Reference:

- Desktop body: `overflow-y-auto`, inner `px-2 py-3`, trailing scroll spacer.
- Sheet body: scroll region with role/region semantics from Silk, inner `px-6 pb-4`.
- Section heading wrapper: `text-[1.05rem]`, weight `500`, `mb-3`.
- Timeline column: `relative isolate mt-3 flex flex-col`.
- Step marker rail: `w-4`, marker box `h-5`, gap between marker column and text `8px`.
- Connector is a `1px` vertical hairline and should follow the page border strategy in our implementation.
- Sources gallery rows: anchor `rounded-xl px-3 py-2.5`, site row `h-6`, gap `8px`, text `12px / 16px`, title `14px`, description `14px leading-snug`.

## Already Polished In This Working Tree

These are low-risk visual fixes already applied. Future agents should verify they remain, not redo them.

- `app/components/chat/activity/panel-header.tsx`
  - Title cluster uses `items-center`, matching the reference cluster alignment.
  - Docked close button uses `size="icon"`, `className="-me-2.5 rounded-md"`, and `slotSize={20}`.
- `app/components/chat/activity/content-sheet-shell.tsx`
  - Mobile sheet shadow is suppressed with `max-sm:shadow-none`.
  - Sheet/card max-height now uses `calc(100% - max(env(safe-area-inset-top), 6px))` instead of `85svh`.
  - Tablet sheet/card now uses a local grid scaffold and activity-specific header.
  - Mobile handle top margin is `mt-1.5`.
- `app/components/chat/activity/sources-gallery.tsx`
  - Sources heading/list gap is `space-y-3`.
- `app/components/chat/activity/activity-timeline.tsx`
  - Timeline connector uses `bg-border`, not `bg-primary/20`.

Validation for the 2026-06-27 pass:

- `bun run typecheck`
- `bun run lint`
- `bun run test -- app/components/chat/activity/`
- `git diff --check`
- Render pass at `1024`, `768`, `375`, light and dark, via Playwright temp harness.

## Fidelity Findings

### P0 - Tablet Card Height And Scaffolding

Status: `fixed` on 2026-06-27, branch `darknight/clock-king`.

Reference spec:

- `css/conversation-with-activity-panel.md`: tablet card max width `448px`, `16px` all-corner radius, `shadow-long`, max-height `calc(100% - max(env(safe-area-inset-top), 6px))`, overflow hidden.
- `research/activity-panel-component-inventory.md`: sheet body is the scroll region and has inner `px-6 pb-4` body padding.

Current implementation value before fix:

- `ContentSheetShell` composed over the default flex/gap `SheetContent` scaffold, with an `85svh`-style slab risk already called out in this doc.
- `ActivityPanel` sheet body had a flex scroll area but no explicit region semantics.

Exact delta:

- `app/components/chat/activity/content-sheet-shell.tsx:81` now makes the sheet root a `grid h-fit` surface with `grid-rows-[min-content_minmax(0,1fr)]`, `gap-0`, `overflow-hidden`, `pb-4`, and the reference max-height expression.
- `app/components/chat/activity/content-sheet-shell.tsx:83` now forces the tablet card to `sm:w-[28rem] sm:max-w-md`, centered with side/inset overrides, and keeps it `sm:h-fit` until max-height is needed.
- `app/components/chat/activity/content-sheet-shell.tsx:95` caps the interior section with the same viewport math minus the `16px` bottom padding so long content scrolls inside the card.
- `app/components/chat/activity/activity-panel.tsx:129` adds the explicit sheet body region: `role="region"` and `aria-label="Activity details"`.

Intended code change:

- Compose the activity sheet/card as a local grid scaffold at the `ContentSheetShell` call site, without changing the shared `Sheet` primitive or active-turn panel ownership.

Verification:

- Visual: `/tmp/naw-activity-visual/768-light.png`, `/tmp/naw-activity-visual/768-dark.png`, `/tmp/naw-activity-visual/768-light-long.png`.
- Computed style: normal tablet card is `448x734`, centered at `x=160`, `display: grid`, `overflow: hidden`, `border-radius: 16px`, `padding-bottom: 16px`.
- Computed style: long tablet fixture reaches the cap at `448x762`; scroll region reports `clientHeight: 686`, `scrollHeight: 2222`, `canScroll: true`.
- Regression checks: mobile remains bottom anchored at `375px` with `top: 6px`; desktop dock remains an in-flow `400px` rail.

### P1 - Sheet Header Structure And Close Placement

Status: `fixed` on 2026-06-27, branch `darknight/clock-king`.

Reference spec:

- `research/activity-panel-component-inventory.md`: sheet header uses a native grid `grid-cols-[1fr_min-content]`, `gap-3`, `ps-6 pe-4 pt-4 pb-2`, no bottom border, with an in-flow close button hidden below `640px`.

Current implementation value before fix:

- The sheet path relied on `SheetTitle` plus the primitive's absolute close button.

Exact delta:

- `app/components/chat/activity/content-sheet-shell.tsx:65` passes `showCloseButton={false}` to disable only this sheet instance's primitive absolute close button.
- `app/components/chat/activity/content-sheet-shell.tsx:98` renders the activity-specific sheet header as `grid min-h-[var(--spacing-panel-header)] grid-cols-[minmax(0,1fr)_min-content] items-center gap-3 ps-6 pe-4 pt-4 pb-2`.
- `app/components/chat/activity/content-sheet-shell.tsx:99` keeps `SheetTitle` as the dialog name container.
- `app/components/chat/activity/content-sheet-shell.tsx:105` renders an in-flow `SheetClose` control with the project `Button` and `Icon` primitives, hidden on mobile by `max-sm:hidden`.

Intended code change:

- Keep shared `components/ui/sheet.tsx` untouched and compose a sheet-specific header inside `ContentSheetShell`.

Verification:

- Visual: close button is in the sheet header row on `/tmp/naw-activity-visual/768-light.png` and `/tmp/naw-activity-visual/768-dark.png`; close is absent on `/tmp/naw-activity-visual/375-light.png` and `/tmp/naw-activity-visual/375-dark.png`.
- Computed style: tablet header grid columns are `360px 36px`, padding is `16px 16px 8px 24px`, border-bottom width is `0px`, close button is `36x36`, radius `8px`, padding `4px`.
- Computed style: mobile header grid collapses the close column to `0px`, and the close control reports `display: none`.
- Accessibility: dialog title remains provided by `SheetTitle` and the body scroll area is named `Activity details`.

### P1 - Tablet Radius And Elevation

Status: `fixed` for radius and existing-token elevation on 2026-06-27, branch `darknight/clock-king`.

Reference spec:

- `css/conversation-with-activity-panel.md`: tablet card radius `16px`; tablet card uses `shadow-long`.

Current implementation value before fix:

- The tablet sheet inherited `rounded-2xl` (`18px`) and `shadow-border-lg` from the composed sheet path.

Exact delta:

- `app/components/chat/activity/content-sheet-shell.tsx:81` uses `rounded-t-[16px]` for the mobile top corners.
- `app/components/chat/activity/content-sheet-shell.tsx:83` uses `sm:rounded-[16px]` and the closest existing elevated shadow token, `sm:shadow-border-xl`, for tablet.

Intended code change:

- Match the exact reference radius locally while using an existing project shadow token. No new shadow/color token was introduced.

Verification:

- Visual: tablet card corners and elevation verified on `/tmp/naw-activity-visual/768-light.png` and `/tmp/naw-activity-visual/768-dark.png`.
- Computed style: tablet card radius is `16px`; tablet card has a non-empty `box-shadow` from `shadow-border-xl`.
- Regression check: mobile sheet top radii are `16px`, bottom radii are `0px`, and mobile `box-shadow` is fully transparent/none.

Note:

- Exact ChatGPT `shadow-long` is intentionally not copied as a new token. That would exceed the scope and conflicts with the "no new border tokens / OKLCH semantic token only" discipline for this polish pass.

### P1 - Desktop Panel Surface Exactness

Status: `rejected` on 2026-06-27, branch `darknight/clock-king`.

Reference spec:

- `css/conversation-with-activity-panel.md`: desktop flyout surface resolves to `#fcfcfc`.

Current implementation value:

- `app/components/chat/activity/docked-flyout-shell.tsx:40` uses `bg-card text-foreground`.
- Computed light surface is `oklch(1 0 0)`; computed dark surface is `oklch(0.2134 0 0)`.

Exact delta:

- The light-mode delta remains the slight `#fcfcfc` versus project `bg-card` white/off-white token mapping.

Intended code change:

- No code change. The local decisions of record map the desktop dock surface through semantic project tokens, and this pass must not add new surface tokens or hardcoded hex in app code.

Verification:

- Visual: desktop dock was rechecked after the higher-priority sheet fixes on `/tmp/naw-activity-visual/1024-light.png` and `/tmp/naw-activity-visual/1024-dark.png`; the panel remains coherent with the page surface and seam.
- Computed style: docked shell remains `border-radius: 0px`, `box-shadow: none`, `width: 400px`, with a `1px` border seam.

### P2 - Dock Width Transition Timing

Status: `fixed` on 2026-06-27, branch `darknight/clock-king`.

Reference spec:

- `css/conversation-with-activity-panel.md`: desktop flyout rail uses a `duration-300` width transition in the captured class list.

Current implementation value before fix:

- `ActivityPanelDockSlot` used `duration-200` on its `transition-[width]` class.

Exact delta:

- `app/components/chat/activity/activity-panel-host.tsx:76` changes the dock slot transition to `duration-300` and keeps `motion-reduce:transition-none`.

Intended code change:

- Tune only the dock slot width transition timing; do not change panel state, ownership, or desktop layout.

Verification:

- Computed style at `1024px`: dock slot `transition-property: width`, `transition-duration: 0.3s`, width `400px`.
- Class inspection: `motion-reduce:transition-none` remains on the same class string.

### P2 - Timeline Marker Fine Details

Status: `fixed` on 2026-06-27, branch `darknight/clock-king`.

Reference spec:

- `research/activity-panel-component-inventory.md`: bullet dot `6px`, globe/done glyphs `15px`, connector `1px`.

Current implementation value before fix:

- Activity timeline markers mirrored the local chain-of-thought primitive more closely: bullet slot `8px`; globe/done slot `16px`.

Exact delta:

- `app/components/chat/activity/activity-timeline.tsx:25` and `app/components/chat/activity/activity-timeline.tsx:26` set bullet slot/glyph sizes to `6`.
- `app/components/chat/activity/activity-timeline.tsx:31` and `app/components/chat/activity/activity-timeline.tsx:32` set globe slot/glyph sizes to `15`.
- `app/components/chat/activity/activity-timeline.tsx:37` and `app/components/chat/activity/activity-timeline.tsx:38` set done slot/glyph sizes to `15`.
- `app/components/chat/activity/activity-timeline.tsx:152` keeps the connector as `w-px` using `bg-border`.

Intended code change:

- Scope marker tuning to the activity timeline only; do not mutate shared `Icon` defaults or chain-of-thought primitives.

Verification:

- Computed style in the rendered panel: globe/done icons measure `15x15`, bullet dot measures `6x6`, connector width is `1px`.
- Visual: marker scale rechecked on `/tmp/naw-activity-visual/1024-light.png`, `/tmp/naw-activity-visual/768-light.png`, and `/tmp/naw-activity-visual/375-light.png`.

### P2 - Desktop Trailing Scroll Spacer

Status: `fixed` on 2026-06-27, branch `darknight/clock-king`.

Reference spec:

- `css/conversation-with-activity-panel.md`: desktop scroll tail uses `scroll-mb-4` behavior rather than a visible spacer block.

Current implementation value before fix:

- `DockedFlyoutShell` rendered a visible `h-8` trailing spacer in the scroll body.

Exact delta:

- `app/components/chat/activity/docked-flyout-shell.tsx:52` replaces the visible spacer with a zero-height `scroll-mb-4` spacer.

Intended code change:

- Remove visible trailing height while preserving the scroll tail affordance.

Verification:

- Computed style at `1024px`: trailing spacer `height: 0px`, `scroll-margin-bottom: 16px`.
- Visual: docked panel tail was inspected in `/tmp/naw-activity-visual/1024-light.png` and the long-content fixture.

## Mechanical Verification - 2026-06-27

- `bun run typecheck`: passed.
- `bun run test -- app/components/chat/activity/`: passed, 5 files and 8 tests.
- `bunx eslint app/components/chat/activity/activity-panel.tsx app/components/chat/activity/activity-panel-host.tsx app/components/chat/activity/activity-timeline.tsx app/components/chat/activity/content-sheet-shell.tsx app/components/chat/activity/docked-flyout-shell.tsx`: passed for the touched app files.
- `bun run lint`: failed only because the generated Playwright bundle `output/playwright/activity-panel-harness/harness.js` is under the repo tree and ESLint walks `.`; the errors are React hook/compiler rules inside bundled third-party code. The generated artifact was left in place per the dirty-worktree/generated-file rule.
- `git diff --check`: passed.
- `git diff -- app/components/chat/activity/activity-panel.tsx app/components/chat/activity/activity-panel-host.tsx app/components/chat/activity/activity-timeline.tsx app/components/chat/activity/content-sheet-shell.tsx app/components/chat/activity/docked-flyout-shell.tsx polish-acitivity-panel-and-page.md`: reviewed. The tracked code diff is scoped to the activity-panel files; this markdown file is untracked, so Git does not include it in a normal path diff.
- `git status --short`: reviewed. Pre-existing dirty tracked files remain, and the visual harness is a new generated untracked side effect under `output/`.

## Faithful Reproduction Completed In This Pass

- Tablet card content-sized height and scroll behavior.
- Sheet header grid and close alignment.
- Accurate header relationship: page header `52px`, panel header `56px`, no forced equalization.
- Border token strategy: dock seam, header bottom border, dividers, and timeline connector all use `border-border` or shadow slots consistently.
- Mobile bottom sheet handle top offset and no-shadow surface.
- Sources gallery section gap and row typography.

## Incidental Details Not Worth Copying

Do not spend time copying these unless new evidence changes the decision:

- Silk `data-silk` internals or exact Silk timing.
- Sprite fragment hashes.
- Reserved empty source-chip row.
- New tertiary color token. Use muted foreground plus opacity as already decided.
- New `border-strong`/`border-heavy` token. The resolved strategy collapsed strong borders onto `border-border`.
- Exact thread source-chip internals when working on the panel source gallery. The panel chip and thread citation pill are different components.

## Guardrails For Future Agents

- Read the full reference files before changing page-level layout. Prior distilled summaries missed the header/conversation/composer relationship.
- Do not change `components/ui/sheet.tsx` except for the already-existing additive `overlayClassName` API.
- Compose, do not mutate shared primitives. This is especially important for `Button`, `Icon`, `Favicon`, `Sheet`, and `Source`.
- Keep `components/ui/icon.tsx` server-safe and do not change shared icon defaults for a single parity issue.
- OKLCH semantic tokens only for new color work. No hardcoded hex in app code.
- Do not add border tokens for the panel.
- Every new/changed animation utility must have an effective `motion-reduce:` guard. Compile the exact class string with the project's `@tailwindcss/postcss` if cascade order matters.
- No cosmetic snapshot/class-string tests. Use rendered screenshots, computed styles, and narrow component tests only when behavior changes.
- Respect dirty worktree state. Do not stage, delete, normalize, or rewrite unrelated files.

## Verification Recipe

Before edits:

1. `git status --short`
2. Read the relevant reference capture and computed-style evidence.
3. Inspect the current implementation file and any shared primitive it composes over.

For visual changes:

1. Render a seeded local chat with the panel open at `1024`, `768`, and `375`.
2. Check both light and dark.
3. Capture screenshots and computed style for:
   - page header
   - dock slot
   - panel/sheet content
   - activity header
   - close button
   - overlay
   - mobile handle
   - sources gallery rows
4. If Tailwind cascade is involved, compile the exact class string with `@tailwindcss/postcss`.

After edits:

1. `bun run typecheck`
2. `bun run lint`
3. `bun run test -- app/components/chat/activity/`
4. `git diff --check`
5. `git diff -- <intended paths>`
6. `git status --short`, with requested edits separated from unrelated dirty files.

## Completed Work Order

1. Fixed tablet sheet/card scaffold so it is content-sized and scrolls correctly.
2. Replaced the sheet path's implicit/absolute header close with an activity-specific grid header, while preserving dialog naming.
3. Matched tablet radius exactly and used the closest existing project shadow token.
4. Re-evaluated desktop surface exactness after the higher-impact layout fixes and rejected a new surface token.
5. Tuned timeline marker sizing locally in the activity timeline.

## Agent Update Format

When updating this document, append findings under the relevant priority section with:

- date and branch
- exact reference file and line or computed-style value
- current local file and line
- delta and why it matters
- proposed change
- validation performed
- status: `open`, `fixed`, `deferred`, or `rejected`
