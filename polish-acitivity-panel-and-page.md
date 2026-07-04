# Polish Activity Panel And Page

Working document for the "conversation with activity panel" page fidelity pass.
Filename intentionally preserves the requested spelling:
`polish-acitivity-panel-and-page.md`.

Note for future agents: keep completed and verified items summarized. This
document should stay focused on outstanding activity-panel/page polish work that
still needs implementation or verification.

## Current Audit Snapshot

Date: 2026-06-27

Branch: `darknight/clock-king`

Task scope: corrective verification and implementation pass for recently
completed activity-panel/page polish work, with the ChatGPT reference captures
as source of truth.

Worktree note: the prior activity-panel polish pass is committed (HEAD
`7167e0d` "Polish activity panel pending state"); the working tree is clean
apart from this corrective `polish-acitivity-panel-and-page.md` update. Treat
all committed activity-panel/chat code as user-owned unless the user explicitly
scopes it into a future implementation pass.

## Reference Evidence

Use durable checked-in reference captures and source files as the evidence base
for this working spec.

Primary ChatGPT reference files:

- `/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/pages/conversation-with-activity-panel.md`
- `/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/pages/conversation-with-activity-panel-tablet-820px-light.md`
- `/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/pages/conversation-with-activity-panel-mobile-592px-light.md`
- `/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/css/conversation-with-activity-panel.md`
- `/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/css/component-computed-styles.json`
- `/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/css/chatgpt-component-styles.md`
- `/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/css/chatgpt-design-tokens.md`
- `/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/research/activity-panel-component-inventory.md`

Key reference values:

- Page header: `52px` high, `8px` padding, z-index `20`, shadow separator.
- Composer: desktop/tablet `52px` high, mobile `84px` high, `28px` radius,
  `5px 8px 5px 7px` padding, prompt text `16px / 26px`.
- Visible thinking trigger: normal page text scale around `16px / 24px`, normal
  weight, tight icon/text spacing. The trailing disclosure chevron's `<svg>`
  carries `width="20" height="20"` attributes, but `class="icon-xs"`
  (`height: calc(var(--spacing) * 3)` = `12px`) overrides them, so the reference
  glyph renders at roughly `12px`, not `20px`. The `20` in the markup is a dead
  presentation attribute. Source: reference svg at
  `pages/conversation-with-activity-panel.md:3706-3718`; the `.icon-xs` rule in
  `css/raw-css-variable-inventory.json` (`.icon-xs` → `height: calc(var(--spacing) * 3)`,
  `--spacing` = `.25rem`). See the `Trigger Disclosure Icon Scale` finding below.
- Trigger placement: desktop/tablet/mobile `conversation-turn-2` shows two
  assistant preamble blocks, then the `Thought for 5m 42s` disclosure button,
  then the main assistant answer beginning with `Bottom line`. The disclosure is
  not a post-answer footer action.
- Desktop activity panel: `400px` class width, scoped `56px` header, `1px`
  seam, no overlay, no radius, no shadow.
- Tablet card: `448px` wide, centered, `16px` radius, capped by
  `calc(100dvh - 58px)`, with internal body scrolling.
- Mobile sheet: full width, `calc(100dvh - 6px)` max-height, top radius `16px`,
  hidden close button, `48x4` handle, no shadow, black/30 backdrop.

Current implementation values are recorded in each finding from source paths
and Tailwind utility mappings.

## Outstanding Work At A Glance

1. P1 - Sheet root grid omits the reference footer row.
2. Reference verification - live ChatGPT trigger toggle behavior.
3. Breakpoint verification - responsive shell coexistence at `lg`.
4. Design verification - exact tablet shadow.
5. Icon-scale verification - trigger disclosure chevron `20px` slot vs reference
   `icon-xs` `~12px` glyph.
6. Reference divergences from deep diff (Tier 1-3) - reasoning description type,
   `done` marker color, sheet reasoning-block indent, tablet shadow, close-button
   hover, plus minor timeline/handle/seam items. See
   `Reference Divergences From Deep Diff`.
7. Open/close motion (M1-M4) - IMPLEMENTED options b + c (2026-06-27): fixed-width
   clipped inner (M1), deferred-unmount populated collapse (M2), seam slides not
   pops (M4.5). Remaining: live-render check of the animation; M3 (`@container`
   snap) intentionally untouched (shared with reference); option (a) always-mounted
   held as the fidelity ceiling. See
   `Activity Panel Open/Close Motion & Layout Animation`.

## Completed And Verified Summary

- Header parity accepted/resolved - completed 2026-06-27; no code change; proof:
  desktop light/dark measured page header `52px`, panel header `56px`, `1px`
  seam, no overlay, no radius, and no shadow.
- Activity trigger typography - verified 2026-06-27; files:
  `app/components/chat/activity/activity-panel-trigger.tsx` plus chat/message
  trigger plumbing. Matches the reference button: `text-base` (`16px / 24px`),
  `font-normal`, `gap-0.5`, `text-start`, label-then-trailing-chevron with no
  leading icon. Proof: targeted trigger/message tests, narrow ESLint, and
  `git diff --check`. NOTE: the icon SCALE half of the earlier "typography and
  icon scale" claim was a misread (it cited `20x20`); the reference glyph is
  `~12px` via `icon-xs`, so icon scale is reopened as a verification finding
  below.
- Desktop trigger toggle and expanded semantics - completed 2026-06-27; files:
  `app/components/chat/chat.tsx`, `conversation.tsx`, message call sites, and
  activity shell/trigger files; proof: targeted trigger/message/panel tests,
  narrow ESLint, and preserved sheet close/backdrop/Escape ownership.
- Activity trigger placement corrected - completed 2026-06-27; files:
  `app/components/chat/message-assistant.tsx` and test. Reference ordering is
  assistant preamble, `Thought for 5m 42s`, then main answer content. Because
  our local `MessageAssistant` receives one content string and cannot split
  ChatGPT's preamble/disclosure/main-answer blocks, the closest faithful
  approximation renders the trigger after progress rows and before assistant
  content, not below the answer or adjacent to footer actions.
- `Pro thinking` panel scaffold - completed 2026-06-27; files:
  `app/components/chat/activity/activity-panel.tsx`,
  `panel-section-heading.tsx`, and panel test; proof: targeted panel test
  asserts the section heading.
- Submitted/pre-stream thinking routed through the activity row - completed
  2026-06-27; files: `app/components/chat/conversation.tsx`,
  `message-assistant.tsx`, `use-activity-panel.ts`, and tests; proof: targeted
  conversation/message/use-activity-panel/activity-panel tests, narrow ESLint,
  and `git diff --check`.
- Section heading reference scale - completed 2026-06-27; files:
  `app/components/chat/activity/panel-section-heading.tsx` and
  `activity-panel.tsx`; proof: targeted panel/source/trigger/message tests,
  narrow ESLint, and `git diff --check`.
- Timeline top rhythm - completed 2026-06-27; file:
  `app/components/chat/activity/activity-panel.tsx`; proof: targeted panel test,
  narrow ESLint, and `git diff --check`.
- Panel source-chip metrics - completed 2026-06-27; file:
  `app/components/chat/activity/source-chip-group.tsx`; proof: targeted
  source-chip test, narrow ESLint, and `git diff --check`.

## Open Findings

### P1 - Sheet Root Grid Omits The Reference Footer Row

Status: `open`

Dimension: layout / scroll

Breakpoints: tablet/mobile, light/dark

Confidence: exact structural delta; inferred visual impact

Risk/Effort: low

Reference:

- `/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/css/conversation-with-activity-panel.md:47-48` - sheet/card layout is `grid-rows-[min-content_1fr_min-content]`.
- `/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/css/conversation-with-activity-panel.md:98-98` - container box repeats `grid-template-rows: min-content 1fr min-content`.
- `/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/pages/conversation-with-activity-panel-tablet-820px-light.md:7686-7686` - tablet root class includes `grid grid-rows-[min-content_1fr_min-content]`.
- `/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/pages/conversation-with-activity-panel-mobile-592px-light.md:4459-4459` - mobile root uses the same class.

Our Current Value:

- `app/components/chat/activity/content-sheet-shell.tsx:81` - root class uses `grid-rows-[min-content_minmax(0,1fr)]`.
- This class defines two explicit rows instead of the reference three-row
  sheet/card scaffold.

Delta:

- The explicit third `min-content` footer row is missing.

Why It Matters:

- The current visual is mostly acceptable because the footer row is empty in
  the capture, but the missing row is a structural divergence from the reference
  sheet scaffold and may affect future footer/handle/content spacing.
- Deep-diff note (2026-06-27): the reference dialog has exactly TWO direct
  children (handle wrapper + section), so its third `min-content` track is
  unpopulated and collapses to `0` - meaning the reference renders identically to
  our two-row grid TODAY. This is structural-parity / future-proofing only, with
  NO current visual delta. Keep `minmax(0,1fr)` for the body track (overflow-safe
  equivalent of bare `1fr`) if adding the third track.

Proposed Fix:

- Evaluate `grid-rows-[min-content_minmax(0,1fr)_min-content]` with an empty
  footer slot, preserving current `pb-4`.
- Do not change `components/ui/sheet.tsx`; keep this scoped to
  `ContentSheetShell`.

Verification Needed After Fix:

- Computed grid rows show three tracks.
- Tablet long-content fixture still scrolls inside the body and retains the
  `762px` max-height cap.
- Mobile bottom sheet remains top-gap `6px` and no-shadow.

## Open Verification Findings

### Live ChatGPT Trigger Toggle Behavior

Status: `needs reference verification`

Dimension: interaction / accessibility

Breakpoints: desktop primary; tablet/mobile dismissal semantics secondary

Confidence: exact for local target behavior; unknown for live ChatGPT behavior

Risk/Effort: low verification, no implementation until reference behavior is
confirmed

Reference:

- `/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/pages/conversation-with-activity-panel.md:7569-7585` - desktop panel has a `Close` control.
- `/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/pages/conversation-with-activity-panel-tablet-820px-light.md:7734-7740` - sheet close button carries `aria-expanded="true"` and `aria-controls`.
- Static captures do not prove a second click on the original thinking trigger
  while the panel is already open.

Our Current Value:

- Local desktop target toggles the docked panel from the trigger.
- Tablet/mobile dismissal remains owned by close button, backdrop, and Escape
  because the sheet blocks access to the underlying trigger while open.

Delta:

- Local behavior may be a product-target choice rather than exact ChatGPT
  behavior.

Why It Matters:

- If ChatGPT's live trigger is open-only while the panel close button owns
  dismissal, local desktop toggling is an intentional divergence that should be
  documented before future agents tune interaction semantics again.

Proposed Fix:

- Do not change code from static evidence. First perform a live authenticated
  ChatGPT interaction check and record whether trigger click, close button,
  outside/backdrop, Escape, focus return, and `aria-expanded` state match local
  behavior.

Verification Needed:

- Desktop: click trigger closed, click same trigger open, click panel close,
  press Escape, and inspect accessible state after each step.
- Tablet/mobile: verify close button, backdrop, Escape, and focus restoration.

### Trigger Disclosure Icon Scale

Status: `implemented 2026-06-27` - was a prior doc misread (logged under the
"typography and icon scale" completed item with a wrong `20x20` value). The
trigger chevron is now `slotSize={12}` (`activity-panel-trigger.tsx:87-93`),
matching the reference `icon-xs` 12px box; pending a visual eyeball since the
exact rendered svg width was never in the computed-style capture.

Dimension: typography / icon scale

Breakpoints: all, light/dark

Confidence: reference height exact (`12px`); exact rendered width inferred (no
computed-style capture of the disclosure svg)

Risk/Effort: low risk; small scoped change, but it is a visual change that
should be confirmed with render evidence before shipping

Reference:

- `/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/pages/conversation-with-activity-panel.md:3706-3718` -
  the disclosure `<svg>` carries `width="20" height="20"` AND `class="icon-xs"`.
- `.icon-xs` resolves to `height: calc(var(--spacing) * 3)` = `12px` (`--spacing`
  = `.25rem`); CSS height wins over the presentation attribute, so the reference
  glyph renders at `~12px`. `icon-xs` is the extra-small (`size-3`) icon utility,
  so the box is `12x12`. `css/component-computed-styles.json` does NOT capture
  this svg, so the exact rendered width is inferred, not measured.

Our Current Value:

- `app/components/chat/activity/activity-panel-trigger.tsx:87-93` renders the
  trailing chevron with `<Icon slotSize={12}>`. `Icon` sets the slot box to
  `12px` and the glyph to `calc(slot - --icon-glyph-inset)`, so the visible
  chevron is `~10px` inside the reference-sized `12px` box.

Delta:

- Code delta is closed: the trigger chevron slot is `12px`, matching the
  reference `icon-xs` `12px` box. Remaining uncertainty is visual evidence only:
  the exact rendered svg width was not captured in computed-style data.

Why It Matters:

- This mattered because an oversized chevron next to `16px` text read heavier
  than ChatGPT's subtle `icon-xs` disclosure caret. The current implementation
  has applied the smaller slot and still needs an eyeball check before shipping.

Applied fix:

- Set the trailing chevron to `slotSize={12}` (`activity-panel-trigger.tsx:87-93`).
  With the repo default `--icon-glyph-inset: 2px`, the rendered glyph is `~10px`
  inside a `12px` slot - a subtle disclosure caret matching the reference
  `icon-xs` box. The hover `translate-x` affordance and the verified typography
  (`text-base leading-6 font-normal`, `gap-0.5`, no leading icon) are unchanged.
- Remaining check: eyeball the chevron at desktop/tablet/mobile to confirm it
  reads proportionally next to the `16px` label; bump to `slotSize={14}` (12px
  glyph) if `10px` looks a touch small.

Verification Needed:

- Render the trigger and compare the chevron against the durable ChatGPT
  captures at desktop/tablet/mobile; confirm the glyph size and hover animation
  before committing a size change.

### Responsive Shell Coexistence At Breakpoint

Status: `needs deeper verification`

Dimension: responsive layout / mount strategy / resize behavior

Breakpoints: `1023px` to `1024px`, light/dark

Confidence: exact structural delta; unknown visual impact

Risk/Effort: low verification; medium effort only if matching dual-shell mount
behavior becomes a target

Reference:

- `/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/research/activity-panel-component-inventory.md:81-93` - inventory says the desktop flyout remains mounted below `lg` and is collapsed by CSS while the dialog also renders.

Our Current Value:

- `app/components/chat/activity/activity-panel.tsx:103-137` - exactly one shell is active; body renders into only the active shell.

Delta:

- Reference appears to keep both shell paths mounted across the breakpoint,
  while local code renders only the active shell.
- Confirmed 2026-06-27 (motion pass): the reference flyout
  (`[data-testid="stage-thread-flyout"]`) is present in ALL THREE captures —
  desktop, tablet 820px, mobile 592px — carrying `max-lg:w-0!`, so below `lg` it
  is mounted-but-CSS-collapsed to width 0 while a SEPARATE `<dialog>` overlay
  renders the visible sheet
  (`/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/pages/conversation-with-activity-panel-tablet-820px-light.md:7506`,
  `…-mobile-592px-light.md:4279`). The two shells COEXIST CSS-gated; the flyout is
  never conditionally removed. Ours swaps via `useBreakpoint(1024)`
  (`app/components/chat/activity/activity-panel.tsx:101, 115-116`), a hard JS
  unmount/mount handoff.

Why It Matters:

- This is visually subtle in normal render review and avoids duplicate favicon
  loads, but it may create a breakpoint handoff/motion difference while resizing
  across `1024px`.
- Shared root cause with the open/close motion findings (M2/M3/M4.7): the same
  in-flow `@container/main` push and CSS-gated coexistence underlie both. See
  `Activity Panel Open/Close Motion & Layout Animation`. Any change here should
  preserve the reference's CSS-gated coexistence rather than hardening the JS
  breakpoint, and should be co-designed with the M2 mount-strategy decision.

Proposed Fix:

- Do not switch to dual mounting unless resize evidence shows a visible
  handoff, animation, focus, or scroll regression. If a fix is needed, keep
  scroll ownership inside the existing shell/body components.

Verification Needed:

- Capture a resize sequence from `1023px` to `1024px` with the panel open and
  compare local handoff against live ChatGPT.
- Check focus target, scroll position, backdrop presence, and whether any
  duplicate source/icon loading is visible during the handoff.

### Exact Tablet Shadow

Status: `needs deeper verification`

Dimension: visual elevation / token discipline

Breakpoints: tablet sheet/card, light/dark

Confidence: exact token mismatch; subjective visual impact

Risk/Effort: low verification; low/medium implementation depending on whether
the project adds a semantic shadow token

Reference:

- `/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/css/conversation-with-activity-panel.md:47-48` - tablet/card root uses `sm:shadow-long`.

Our Current Value:

- Local tablet card uses the nearest existing project token
  `sm:shadow-border-xl`.

Delta:

- The token choice is visually coherent but not numerically exact to the
  reference `shadow-long` elevation.
- Deep-diff note (2026-06-27): confirmed a REAL visible mismatch, not just a
  numeric one. `shadow-border-xl` (`globals.css:427`) is a deep 7-layer floating
  shadow with a `color-mix(foreground 10%)` ring; `shadow-long` is a single soft
  `0 8px 12px rgba(0,0,0,.08)` drop + a faint `0 0 1px` hairline. The tablet card
  reads heavier/more lifted than the reference. See Tier 2 item 4 in
  `Reference Divergences From Deep Diff`.

Why It Matters:

- Tablet is the breakpoint where the panel changes from docked surface to
  floating card. Elevation differences are more visible there than on desktop or
  mobile.

Proposed Fix:

- Keep `sm:shadow-border-xl` unless a design decision explicitly values exact
  ChatGPT elevation over token discipline. If exact parity becomes required,
  add a semantic shadow token instead of hardcoding a one-off shadow class.

Verification Needed:

- Compare local tablet card elevation against the durable ChatGPT tablet
  reference in light and dark.
- If changing, verify the chosen token does not alter desktop docked or mobile
  bottom-sheet surfaces.

## Activity Panel Open/Close Motion & Layout Animation

Investigation pass 2026-06-27. Diagnoses the two reported desktop symptoms
(thread re-expands sharply on close; panel content reflows while animating) and
the additional motion divergences around them.

Implementation status (2026-06-27): the recommended fix (options **b + c**) plus
the border micro-fix (M4.5) are now IMPLEMENTED and unit-tested. M1 (fixed-width
clipped inner), M2 (deferred unmount / populated collapse) and M4.5 (seam slides,
not pops) are done; M3 (the shared `@container` snap) is intentionally left
untouched; visual/animation parity still needs a live render (see ambiguities).
Details per finding below and in the Update Log.

What the STATIC captures prove vs. what needs a LIVE render: the checked-in
ChatGPT captures are settled end-states, so they prove the panel's _structure_
and the CSS _transition intent_ (the `transition-[width] duration-300 ease-out`
declared on the reference rail; the `max-lg:w-0!` collapse; the fixed-width
clipped inner). They do NOT contain the interpolated open/close frames — the
desktop flyout's own slide and the tablet/mobile Silk sheet enter/exit are
JS-driven and were not audited
(`/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/css/conversation-with-activity-panel.md:115`;
`/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/research/activity-panel-component-inventory.md:422`).
Every value below is marked exact / strong / inferred / needs-live-render.

### Reference Motion Spec (source of truth)

Desktop = in-flow docked flyout that pushes the thread. Tablet/mobile = a
Silk-driven dialog overlay (no thread push). Reference citations use the durable
capture files.

| Surface | Action | Animated property                                                             | Duration                                                              | Timing                                                     | Mount strategy                                     | Inner reflow-avoidance                                                        | Thread push                                                | Confidence                               |
| ------- | ------ | ----------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------- |
| Desktop | open   | `width` 0→400px on the in-flow slot/rail; no transform                        | `300ms` (declared on the rail); interpolated frames needs-live-render | `ease-out` (declared on the rail)                          | Always-mounted; CSS-collapse via `max-lg:w-0!`     | Clip — content in a fixed-width `absolute` carrier inside `overflow-x-hidden` | In-flow `shrink-0` 400px sibling shrinks `@container/main` | strong                                   |
| Desktop | close  | `width` 400px→0; shell STAYS mounted (collapses, no unmount)                  | `300ms` declared; exit/asymmetry needs-live-render                    | `ease-out` declared                                        | Stays mounted, collapses to 0                      | Clip (same carrier)                                                           | Reverse in-flow expansion                                  | strong (struct) / unobtainable (timing)  |
| Tablet  | open   | Backdrop `opacity` 0→1 + `backdrop-blur` 0→1px; card slide = Silk JS          | Backdrop `250ms` (exact); card needs-live-render                      | Backdrop default `transition` ease; card needs-live-render | Sheet mounted-on-demand; flyout stays mounted-at-0 | Fixed `max-w-md` width + `overflow-hidden` → no reflow                        | None (overlay)                                             | exact (backdrop) / unobtainable (card)   |
| Tablet  | close  | needs-live-render (only a settled open frame captured)                        | needs-live-render                                                     | needs-live-render                                          | Unmount/hide (Silk)                                | Fixed width → no reflow (structural)                                          | None                                                       | unobtainable                             |
| Mobile  | open   | Backdrop instant (`sm:`-gated fade is inert <640px); sheet slide-up = Silk JS | Backdrop instant; sheet needs-live-render                             | n/a / needs-live-render                                    | Sheet mounted-on-demand; flyout stays mounted-at-0 | Fixed full-width + `overflow-hidden` → no reflow                              | None (overlay)                                             | strong (backdrop) / unobtainable (sheet) |
| Mobile  | close  | needs-live-render                                                             | needs-live-render                                                     | needs-live-render                                          | Unmount/hide (Silk)                                | Fixed width → no reflow (structural)                                          | None                                                       | unobtainable                             |

Reference anchors (verified directly from the captures):

- In-flow flyout, fixed `var(--stage-thread-flyout-preset-width, 400px)`,
  `overflow-x-hidden`, collapsed below `lg` by `max-lg:w-0!` —
  `/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/pages/conversation-with-activity-panel.md:7519`,
  and recipe `…/css/conversation-with-activity-panel.md:53` ("none (in-flow column) | none (pushes thread)").
- Fixed-width clipped inner carrier (`absolute h-full` with a width utility
  resolving to the 400px flyout preset) —
  `…/pages/conversation-with-activity-panel.md:7528`.
- The push/slide transition lives on a SEPARATE empty spacer
  (`data-side-pane-shell-rail`, `transition-[width] duration-300 ease-out
motion-reduce:transition-none`, `width:0`) —
  `…/pages/conversation-with-activity-panel.md:7509`. These are the SAME utility
  classes our dock slot uses.
- The push target is `@container/main` (`flex-1 min-w-0`), inside
  `data-side-pane-shell-host` (a `flex` row) —
  `…/pages/conversation-with-activity-panel.md:3329, 3324`.
- Thread tiers are container-query-driven on `/main`:
  `--thread-content-margin` `xs`/`sm`/`lg` (= `16`/`24`/`64px`) at
  `@w-sm/main`/`@w-lg/main`, and `--thread-content-max-width` `40rem`→`48rem` at
  `@w-lg/main` — `…/pages/conversation-with-activity-panel.md:3466, 3470`.
- `lg = 64rem/1024px` is the docked↔dialog breakpoint, enforced by a VIEWPORT
  `@media` (`max-lg:w-0!` lives under `@media (min-width: 64rem)`) —
  recipe `…/css/conversation-with-activity-panel.md:109`.
- Tablet backdrop fade `250ms`, mobile backdrop instant (no blur) —
  `…/pages/conversation-with-activity-panel-tablet-820px-light.md:7678`,
  `…/pages/conversation-with-activity-panel-mobile-592px-light.md:4451`.
- Source chips enter with `animate-[show_150ms_ease-in]` (matches our
  `animate-show` duration/easing) — recipe `…/css/conversation-with-activity-panel.md:110`.

Verification method note: derived by direct source-read of our open/close +
breakpoint paths and an independent multi-agent extraction across the
desktop/tablet/mobile captures, `matched-rules.json`, `component-computed-styles.json`,
the CSS recipe, and the component inventory, with the four load-bearing claims
adversarially re-verified against the raw files. Three claims came back
SUPPORTED (always-mounted + CSS-collapse; flyout animates width not transform;
inner content clipped not reflowed); the thread-snap claim came back
INDETERMINATE-static-only (see finding 3). `component-computed-styles.json` does
NOT capture any panel/flyout/backdrop element (only the shell, `#thread`,
composer, sidebar, messages), so it cannot settle the motion — the panel motion
lives in the page-capture DOM as Tailwind classes.

### Findings (prioritized)

#### M1 — Panel inner content reflows during the slide (no fixed-width clip)

Status: `implemented 2026-06-27` — top fidelity gap, directly caused named
symptom 2. Applied: `docked-flyout-shell.tsx` `<section>` changed `w-full` →
`w-[var(--activity-panel-width)]`; the slot keeps `overflow-hidden`, so the
fixed-width shell is clipped (not re-wrapped) as the slot animates. Visual parity
still needs a render check.

Dimension: motion / inner-content reflow

Breakpoints: desktop (≥lg), light/dark

Confidence: exact (both sides)

Risk/Effort: low risk / low effort

Reference:

- `/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/pages/conversation-with-activity-panel.md:7528`
  — inner carrier `absolute h-full [width:var(--stage-thread-flyout-override-width,var(--stage-thread-flyout-preset-width,400px))]`, absolutely
  positioned at a FIXED 400px, inside the `overflow-x-hidden` outer collapsing
  box (`…:7519`). Content lays out at 400px and is masked as the outer width
  changes — never re-wrapped (verdict `flyout-clip-not-reflow`: supported).

Our Current Value:

- `app/components/chat/activity/docked-flyout-shell.tsx:43` — the flyout
  `<section>` is `w-full` of the animating slot, portaled directly into the dock
  slot whose width transitions `0↔400px`
  (`app/components/chat/activity/activity-panel-host.tsx:76-77`,
  `--activity-panel-width: 25rem` at `app/globals.css:53`).

Delta:

- Our content is `w-full` of a `0→400px` box, so every child re-wraps/re-lays-out
  on each animation frame; the reference content is pinned at 400px and clipped.

Why It Matters:

- This is the mechanism behind symptom 2 — the text and source chips visibly
  squeeze then settle while the panel animates in/out.

Proposed Fix:

- Pin the flyout inner to a fixed `w-[var(--activity-panel-width)]` (400px) with
  the slot's existing `overflow-hidden` doing the clip, so content is laid out at
  full width once and revealed/masked by the collapsing slot. Reuses the existing
  width var — no new token, no shared-primitive change, motion-reduce already
  gated on the slot.

Open Question / Tradeoff:

- The reference animates _width_ (not transform), so the slot still incurs layout
  per frame — that is acceptable and reference-faithful. Do NOT switch to a
  transform/clip slide to "GPU-composite" it: a transform does not reclaim flex
  space, so it would decouple the thread push from the visual slide. Keep the
  width animation; only the inner needs pinning.

Verification Needed:

- Frame-step our desktop open/close and confirm zero re-wrap of the title
  cluster, timeline text, and source chips.

#### M2 — Instant unmount on close (no populated slide-out)

Status: `implemented 2026-06-27` (option c) — primary cause of named symptom 1.
Applied: the dock slot width is now driven by an imperative `data-expanded`
attribute reflecting the OPEN state (`activity-panel-host.tsx`,
`activity-panel.tsx`) instead of `:not(:empty)` content presence, and the docked
shell is kept mounted through the close collapse and unmounted on the slot's
width `transitionend` (`activity-panel.tsx`, motion-reduce / sub-lg short-circuit
to immediate unmount). The panel now slides shut populated. Option (a)
always-mounted remains the held fidelity ceiling. Visual parity needs a render
check.

Dimension: motion / mount strategy / close animation

Breakpoints: desktop (≥lg), light/dark

Confidence: strong

Risk/Effort: medium risk / medium effort

Reference:

- `/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/pages/conversation-with-activity-panel.md:7519`
  — the flyout shell is ALWAYS mounted and CSS-collapsed via `max-lg:w-0!` (never
  unmounted; present in the DOM at desktop, tablet 820px, and mobile 592px), and
  the collapsing slot is the empty rail with the declared `transition-[width]
duration-300` (`…:7509`). So on close the width interpolates from a still-populated
  400px shell to 0 — a continuous slide.

Our Current Value:

- `app/components/chat/activity/activity-panel.tsx:115, 120-132` — `dockedActive =
open && !isBelowLg`; on close it flips false, so `createPortal(<DockedFlyoutShell/>,
slotElement)` returns null and the flyout content unmounts in ONE FRAME; the
  slot becomes `:empty` immediately.

Delta:

- The dock slot's width still transitions `400px→0` over `300ms` (the column edge
  glides), but the CONTENT vanishes at frame 0, the start `border-s` drops at frame
  0 (`activity-panel-host.tsx:77`), and the thread tiers snap mid-collapse (M3) —
  three discrete events ride the otherwise-smooth width animation, so the
  re-expansion reads as abrupt. The reference slides a still-populated, fixed-width
  shell shut, so nothing pops.

Why It Matters:

- This is the root cause of symptom 1 — the thread re-expansion feels sharp
  because there is no populated content sliding out, only an empty gap collapsing
  plus discrete snaps.

Proposed Fix (respecting the mount-strategy guardrail; see Mount-Strategy
Recommendation below):

- Preferred first move — option (c): defer the portal unmount until the slot's
  width `transitionend`, so the shell collapses while still populated, then
  unmount. Keeps the "exactly one shell active" invariant and avoids favicon
  double-mount. MUST be motion-reduce gated: no `transitionend` fires under
  `transition-none`, so the reduced-motion path unmounts immediately.
- Fidelity ceiling — option (a): keep the docked shell mounted-collapsed below/at
  the boundary like the reference (see tension section).

Open Question / Tradeoff:

- Always-mounted (a) risks the favicon double-mount the existing "Responsive Shell
  Coexistence" finding guards against; deferred-unmount (c) avoids it but adds
  component-local lifecycle state plus open→close→open re-entrancy handling.

Verification Needed:

- Live ChatGPT desktop close — confirm a continuous, populated collapse; capture
  the actual close duration/easing (needs-live-render; the reference exit timing
  is not in the static captures).

#### M3 — Un-transitioned `@container` snap of thread margin & max-width (shared with reference — do NOT "fix" blindly)

Status: `needs reference verification` — contributes to symptom 1 but is NOT the
clean differentiator

Dimension: layout / responsive thread tiers

Breakpoints: desktop (≥lg), at the `/main` container threshold crossing

Confidence: exact (ours) / inferred (reference) / indeterminate (whether it is
the differentiator)

Risk/Effort: medium risk / medium effort

Reference:

- `/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/pages/conversation-with-activity-panel.md:3466, 3470`
  — thread `--thread-content-margin` (`@w-sm/main`/`@w-lg/main`) and
  `--thread-content-max-width` (`@w-lg/main`, `40rem`→`48rem`) carry NO transition;
  the reference uses the SAME in-flow push that shrinks `@container/main`. Adversarial
  verdict `chatgpt_activity_panel_thread_snap`: indeterminate-static-only — the
  reference snaps too; whether its 300ms width slide masks the snap cannot be
  proven statically.

Our Current Value:

- `app/components/chat/conversation.tsx:136, 143` and
  `app/components/chat/chat.tsx:362, 377` — `--thread-content-margin`
  (`1rem`/`1.5rem`/`4rem`) at `@sm/main`/`@lg/main`, and
  `--thread-content-max-width` (`40rem`→`48rem`) at `@[64rem]/main`, all
  `@container(/main)` tiers with no transition. Plus the in-flow dock slot is a
  flex sibling of `@container/main` (`app/components/layout/layout-app.tsx:22, 34`),
  so opening/closing it shrinks/grows the container and re-evaluates these tiers.

Delta:

- Both builds snap discretely mid-animation. Two nuances: (a) our `--thread-content-max-width`
  bump is at `@[64rem]/main` = `1024px` container width, which the `/main` column
  straddles during a 400px open/close on typical desktops — so OUR max-width snap
  (`48rem↔40rem`) does fire at the 1024px crossing; (b) our MARGIN tiers use the
  Tailwind _container_ scale (`@sm/main` = `384px`, `@lg/main` = `512px`), so on a
  wide viewport our margin stays pinned at `4rem` and does NOT snap — whereas the
  reference's `@w-sm/main`/`@w-lg/main` appear to be the Tailwind _screens_ scale
  (`≈640px`/`1024px`, inferred — see ambiguity), which would snap the margin too.
  Net: our margin tier thresholds are likely ported on the wrong breakpoint scale
  (container vs screens), but our build actually snaps _less_ than the reference,
  not more.

Why It Matters:

- The max-width snap adds a real hard edge to symptom 1, but because the reference
  shares the snap, adding a transition here would DIVERGE from ChatGPT, not
  converge. The scale-mismatch on the margin tiers is a separate latent fidelity
  bug (our thread margins widen at narrower container widths than ChatGPT's).

Proposed Fix:

- Hold on transitioning the snap. First fix M1 + M2 (which the captures prove are
  real divergences), then judge symptom 1 on a live A/B. Separately, confirm the
  exact `@w-sm/main`/`@w-lg/main` thresholds and re-map our margin tiers to the
  same scale the reference uses (likely `@[40rem]`/`@[64rem]` i.e. screens
  `sm`/`lg`) so the thread margins bump at the same container widths as ChatGPT.

Open Question / Tradeoff:

- CSS-var-driven `margin`/`max-width` are not always cleanly interpolatable, so a
  naive transition risks a half-measure. And the exact reference threshold is
  unobtainable from the captures (see ambiguity below).

Verification Needed:

- Live render at ~1440px with the sidebar expanded, frame-stepping the live
  computed `--thread-content-margin`/`--thread-content-max-width` across the
  transition to see whether ChatGPT's snap is masked by the slide or visibly jumps;
  `getComputedStyle` the live `@w-sm/main`/`@w-lg/main` container thresholds.

#### M4 — Additional motion divergences (lower priority)

Status: `mixed` — some divergent, some confirmed parity

Dimension: micro-motion / enter-exit timing / secondary snaps

Breakpoints: as noted per item

Confidence: per item below

Risk/Effort: low each

Items (Reference → Ours):

1. Sheet enter-vs-exit asymmetry + curve (tablet/mobile). Ours:
   `app/components/chat/activity/content-sheet-shell.tsx:89` — enter
   `data-starting-style:duration-[250ms]`, exit `data-ending-style:duration-200`,
   `ease-[cubic-bezier(0.32,0.72,0,1)]`. Reference: backdrop enter `250ms`
   (`…/pages/conversation-with-activity-panel-tablet-820px-light.md:7678`); the
   card/sheet curve is Silk-JS and its exit is unobtainable
   (`…/research/activity-panel-component-inventory.md:422`). Our enter `250ms`
   matches the reference backdrop; our `200ms` exit and committed cubic-bezier are
   unconfirmed — needs-live-render. No change pending evidence.
2. Desktop slot easing vs sheet easing. Ours: dock slot `ease-out`
   (`activity-panel-host.tsx:76`) vs sheet `cubic-bezier(0.32,0.72,0,1)`
   (`content-sheet-shell.tsx:89`). Reference: desktop rail `ease-out duration-300`
   (`…/pages/conversation-with-activity-panel.md:7509`) — our desktop easing
   MATCHES exactly; the sheet curve parity is unprovable (Silk). Confidence: strong.
3. `scrollbar-gutter` snap at `@sm/main`. Ours:
   `app/components/layout/layout-app.tsx:23` — `[scrollbar-gutter:stable]
@sm/main:[scrollbar-gutter:stable_both-edges]` snaps when `/main` crosses
   `640px` during the push (the reference also keys gutter off `@w-sm/main`, so
   structurally similar). Narrow-viewport only; cosmetic. Reference exact behavior
   not audited.
4. Header bg/shadow snap at `@7xl/main`. Ours:
   `app/components/layout/header.tsx:39` — `@7xl/main:bg-transparent
@7xl/main:[box-shadow:none]!` snaps when `/main` crosses `1280px` (wide
   viewports only). Same in-flow-push family; reference not audited.
5. `border-s` toggles instantly — IMPLEMENTED 2026-06-27. The seam moved off the
   slot onto the always-present shell (`docked-flyout-shell.tsx` `<section>` now
   carries `border-s border-border`; the slot no longer toggles a border), so the
   `overflow-hidden` slot clips it and it slides in/out with the content instead
   of popping at frame 0. Reference flyout has no toggling start border
   (`…/pages/conversation-with-activity-panel.md:7519`). Confidence: strong.
6. `animate-show` replay on every open. Ours:
   `app/components/chat/activity/activity-panel.tsx:58, 75` — `animate-show` (`show
150ms ease-in`, opacity `0→1` + `translateX 0.5rem→0`, `app/globals.css:57-68`),
   motion-reduce gated. Reference: chips `animate-[show_150ms_ease-in]`
   (recipe `…/css/conversation-with-activity-panel.md:110`) — duration/easing
   MATCH. The divergence is cadence: our content unmounts on close so the keyframe
   REPLAYS per open; the reference's always-mounted carrier likely runs it once.
   Resolved as a side effect of M2 (keep-mounted/deferred-unmount). The reference
   `@keyframes show` from-state (does it include the `translateX`?) is unobtainable.
7. Hard `lg` shell-swap handoff. Ours: `useBreakpoint(1024)` (JS
   `matchMedia(max-width:1023)`) unmounts/mounts docked↔sheet at `1024`
   (`app/components/chat/activity/activity-panel.tsx:101, 115-116`). Reference:
   both shells COEXIST CSS-gated (flyout mounted-at-0 via `max-lg:w-0!` + a separate
   `<dialog>` overlay) — see the "Responsive Shell Coexistence" finding. Confidence:
   exact. Shared root cause; cross-linked below.
8. Backdrop presence — confirmed PARITY (do not change). Desktop docked: no
   backdrop (in-flow push) both sides
   (`…/research/activity-panel-component-inventory.md:96`). Sheet: tablet
   `gray-200/50 + blur-[1px] 250ms` fade, mobile `black/30` flat instant — ours
   (`content-sheet-shell.tsx:31-32`) mirrors this via the `--overlay-scrim-*`
   tokens. Confidence: exact.
9. `will-change` / GPU hints — confirmed PARITY. Neither side promotes the flyout
   to a compositing layer (none on our slot/flyout; absent on the reference
   flyout/rail/stage). If a transform/clip is ever added it must stay
   motion-reduce gated and avoid gratuitous `will-change`. Confidence: exact.

### Mount-Strategy Recommendation (resolving the tension)

The reference is ALWAYS-MOUNTED + CSS-collapse + fixed-width clipped inner
(verdicts `always-mounted-css-collapsed` and `flyout-clip-not-reflow` both
supported). Ours is mounted-on-demand + instant unmount + `w-full` reflowing
inner. Both named symptoms trace to that gap. The tension: our "exactly one shell
active" invariant (favicon-load-once, GA §7 R6) discourages keeping the docked
shell mounted alongside the sheet.

Three options, with tradeoffs:

- (a) Keep-mounted + CSS-collapse + fixed-width clipped inner — closest to the
  reference; fixes BOTH symptoms. Cost: contradicts "exactly one shell active";
  risks a favicon double-mount if the docked shell and the sheet both mount below
  `lg`. Mitigation: keep the shared BODY conditional (favicon-once preserved) while
  mounting the empty docked CHROME always — the double-mount only matters `<lg`,
  where the docked shell is collapsed to 0 anyway.
- (b) Pin the inner to `var(--activity-panel-width)` + `overflow-hidden` so it
  never reflows — fixes symptom 2 with the smallest blast radius (no mount change).
  Does NOT fix symptom 1 alone.
- (c) Defer unmount until the slot's width `transitionend` — fixes symptom 1's
  instant unmount without touching the invariant. Adds local lifecycle state +
  re-entrancy handling; must be motion-reduce gated (immediate unmount when
  `transition-none`).

Recommendation: ship **(b) + (c)** first — (b) pins the inner (symptom 2), (c)
keeps the shell populated through the collapse (symptom 1) — both guardrail-safe
(reuse `--activity-panel-width`, no Sheet/primitive mutation, ScrollArea ownership
unchanged, motion-reduce gated, no new tokens). Hold **(a)** as the fidelity
ceiling: adopt it only if a live A/B shows (b)+(c) still leave a residual seam at
the `lg` boundary, keeping the body conditional. Do NOT add a transition to the M3
thread snap until a live render shows whether the reference masks it — the
reference does not transition those tokens, so smoothing them would diverge.

### Cross-link: shared root cause with "Responsive Shell Coexistence At Breakpoint"

M2, M3, M4.7 and the existing "Responsive Shell Coexistence At Breakpoint" finding
are ONE system: the Activity panel is an in-flow `shrink-0` flex sibling of the
`@container/main` column, so opening/closing it shrinks the container and drives
the `@container(/main)` tiers (`--thread-content-margin`,
`--thread-content-max-width`, `scrollbar-gutter`, header bg) to snap at
`640`/`1024`/`1280px`. The reference uses the SAME in-flow push and the SAME
un-transitioned token snap — where we diverge is the inner reflow (no fixed-width
clipped carrier) and the mount strategy (instant unmount + JS shell-swap vs
always-mounted CSS-gated coexistence). Any change to the shell-swap handoff
(`useBreakpoint(1024)`) should preserve the reference's CSS-gated coexistence
rather than hardening the JS breakpoint. See the updated note in that finding.

### Reference ambiguities (need a live ChatGPT render/video to settle)

1. Desktop flyout open/close interpolated duration + easing: the rail declares
   `transition-[width] duration-300 ease-out`, but the rail is captured at
   `width:0` in every static frame, so its role as the visible collapsing slot and
   the real perceived timing are unproven. Needs a frame-stepped video at ≥1024px.
2. Enter-vs-exit asymmetry on the desktop flyout (no closing state captured).
3. Whether the M3 thread margin/max-width snap visibly jumps or is masked by the
   300ms width slide (geometry-dependent on sidebar width + viewport).
4. Exact `@w-sm/main` (≈`40rem`) and `@w-lg/main` (≈`64rem`) container thresholds —
   only `@w-xl`=`80rem` and `@w-2xl`=`96rem` appear literally; the rest are inferred
   from the standard Tailwind scale. Confirm via `getComputedStyle`.
5. Silk tablet/mobile sheet slide/scale enter AND exit (translate / duration /
   easing) — JS-interpolated via inline `--silk-*` vars, no static CSS.
6. Sheet close-time lifecycle (full unmount vs hide) — only an open snapshot exists.
7. Reference `@keyframes show` from-state (opacity-only vs `translateX` like ours).
8. Whether the reference content enter runs once (always-mounted) or replays per
   open.

## Reference Divergences From Deep Diff (2026-06-27)

A component-by-component code-vs-reference diff (inventory A1-D10 + the distilled
CSS reference + the desktop/tablet/mobile page captures) surfaced the ACTUAL
remaining divergences below, grouped by priority. Each is scoped to
`app/components/chat/activity/*` (or a scoped class on a shipped primitive) and
respects the token/guardrail rules.

Implementation status (2026-06-27): IMPLEMENTED the guardrail-safe, token-mapped
items - Tier 1 #1 (reasoning description `text-sm leading-5` + `text-muted-foreground`),
Tier 1 #2 (`done` marker `text-muted-foreground`), Tier 2 #5 (close-button
translucent hover, both shells), Tier 3 #7 (connector `mt-1` removed), #8 (bullet
dot muted tint), #11 (step-title `leading-[21px]`) - plus the trigger chevron
icon scale (`slotSize={12}`; see `Trigger Disclosure Icon Scale`). HELD (need a
new token, design approval, or render verification): Tier 1 #3 (sheet
reasoning-block indent - the reference offsets the `Pro thinking` vs `Sources`
headings; the naive fix would change alignment, so it needs render verification),
Tier 2 #4 (tablet `shadow-long` - new shadow token + provisional value + render
evidence), Tier 3 #6 / #10 (connector + flyout-seam colors - both need new border
tokens, which the guardrails forbid), Tier 3 #9 (drag-handle fill - no clean
token at `L 0.931`, sub-perceptual).

### Tier 1 - Clear, scoped, visible fidelity wins

1. Reasoning step description type + color.
   - Reference (`css/conversation-with-activity-panel.md:91`; inventory D6 at
     `research/activity-panel-component-inventory.md:289-299`): the step
     description is `text-[14px] leading-5` (`14px / 20px`) in `--text-secondary`
     (`#5d5d5d`).
   - Ours (`app/components/chat/activity/activity-panel.tsx:64`):
     `<Markdown>{reasoningText}</Markdown>` carries no size/color class, so it
     inherits the panel base (~`16px / 24px`) in `--foreground` (primary
     near-black) - bigger and darker than the reference.
   - Change: pass `className="text-muted-foreground text-sm leading-5"` to that
     `Markdown`. Token-mapped, scoped, no primitive change.

2. Terminal/"done" timeline marker color.
   - Reference (inventory D4 at `:265-276`): the done glyph inherits the row's
     `--text-secondary` (`#5d5d5d`) context - a muted check, not full black.
   - Ours (`activity-timeline.tsx:39`): `STEP_MARKERS.done` uses `text-foreground`
     (primary), so the rendered check is darker than the reference. This marker
     DOES render today (the single `Reasoning` step uses `leading="done"`).
   - Change: `text-foreground` -> `text-muted-foreground` in `STEP_MARKERS.done`.

3. Sheet reasoning-block horizontal over-indent.
   - Reference: on the sheet/card the reasoning block has NO own `px` and
     inherits the body `px-6` (`24px`) gutter
     (`pages/conversation-with-activity-panel-tablet-820px-light.md:7775-7777`);
     on desktop it adds `px-3` over the body `px-2` (`= 20px`,
     `pages/conversation-with-activity-panel.md:7600`).
   - Ours (`activity-panel.tsx:58`): the shared reasoning block always adds
     `px-3`, so on the sheet it stacks `px-6 + px-3` = `36px` (`12px` too deep);
     desktop is correct at `20px`.
   - Change: stop adding `px-3` on the sheet. Because `PanelBody` is shared,
     either gate the block's `px-3` to `lg+`, or drop it from the block and add
     `px-3` to the desktop (`docked`) body wrapper only.

### Tier 2 - Notable, but needs a token/design decision or render evidence

4. Tablet card elevation (this is the existing `Exact Tablet Shadow` finding,
   now confirmed as a real visible mismatch).
   - Reference `sm:shadow-long` = a single soft `0 8px 12px rgba(0,0,0,.08)` drop
     - a faint `0 0 1px` hairline.
   - Ours `sm:shadow-border-xl` (`content-sheet-shell.tsx:86`; `globals.css:427`)
     = a deep 7-layer floating shadow with a visible `color-mix(foreground 10%)`
     ring - the tablet card reads heavier/more lifted than the reference.
   - Change: add a scoped soft-drop shadow approximating `shadow-long` (new
     semantic token, design approval - do not hardcode a one-off shadow).
     Confirm with render evidence.

5. Close-button hover surface.
   - Reference (`css/conversation-with-activity-panel.md:77,96`): hover =
     `--surface-hover` `#00000012` (translucent black ~7%) - a subtle darkening.
   - Ours (ghost `Button` in `panel-header.tsx:92-102` and the sheet close in
     `content-sheet-shell.tsx:113-121`): hover is opaque `bg-muted` (near-white),
     almost invisible over the `#fcfcfc / #fff` panel surface.
   - Change: add a scoped `hover:bg-foreground/[0.07]` (translucent neutral) on
     the close buttons. Scoped class, no primitive mutation. Visual - confirm
     with render evidence.

### Tier 3 - Minor / multi-step-only / needs a new token

6. Timeline connector color (`activity-timeline.tsx:152`): `bg-border` (opaque
   ~8% gray) vs reference `bg-token-border-heavy` (`#00000026`, ~15% translucent
   black). Needs a new `--border-heavy`-style token. Only renders when the
   timeline has >1 step (today it shows one `done` step, which is also the last,
   so the connector is hidden).
7. Connector top gap (`activity-timeline.tsx:152`): drop `mt-1` - the reference
   rail sits flush under the marker box (no gap). Multi-step-only.
8. Bullet dot color (`activity-timeline.tsx:24-27`): `fill-current` (foreground)
   -> `text-muted-foreground fill-current` to match the reference's tertiary-icon
   dot. Multi-step-only (current single step uses `done`, not `bullet`).
9. Drag-handle fill (`content-sheet-shell.tsx:96`): `bg-muted` (`L 0.967`,
   ~`#f3f3f3`) is ~`0.036 L` lighter than reference `--bg-secondary` `#e8e8e8`
   (`L 0.931`). Closest existing token is `--border` (`L 0.92`); an exact match
   needs a new token.
10. Docked flyout start seam (`activity-panel-host.tsx:77`): `border-border`
    (opaque gray) vs reference `--border-sharp` `#0000000d` (translucent black
    5%). Needs a translucent seam token.
11. Step title line-height (`activity-timeline.tsx:115`): `text-sm` yields
    `14px / 20px` vs reference `14px / 21px`. Sub-perceptual; optional
    `leading-[21px]`.

### Confirmed Matches / Non-Issues (do NOT change)

- Close-button radius: `rounded-md` resolves to `8px` in our `--radius` scale,
  equal to the reference `rounded-lg` `8px`. Switching to `rounded-lg` would make
  it `10px` (worse) - leave `rounded-md`.
- Body padding: desktop `px-2 py-3` and sheet `px-6 pb-4` match the reference
  exactly.
- Backdrop scrim: mobile `black/30`, tablet `gray/50 + backdrop-blur-[1px]`, dark
  `black/50` all match via the `--overlay-scrim-*` tokens.
- Close-button box `36x36` (`size-9`), drag handle `48x4` (`w-12 h-1`), source
  chip metrics, `56px` header + `1px` seam, `Sources · N` heading, title cluster
  `text-lg` (`18 / 28`), `gap-2` timeline columns, and connector-omitted-on-
  terminal all confirmed matching.
- Chip hover `transition-colors duration-150` (vs reference instant) and the
  `#fcfcfc` flyout surface (vs `#ffffff`) are intentional / sub-perceptual.
- Page-header padding and composer metrics match the reference direction; the
  header's wide-layout transparency breakpoint differs only because it is tied to
  the reference's `data-fixed-header` layout-mode system we do not replicate.

## Rejected Or Acceptable Divergences

### Page Header And Activity Header Equal Height

Status: `rejected`

The reference does not use equal exact heights. Page header is `52px`; activity
panel uses the scoped `56px` header. Preserve the visual alignment relationship
instead of equalizing the CSS height.

### Desktop Surface `#fcfcfc` Versus Project Token

Status: `acceptable divergence`

Reference desktop flyout surface is `#fcfcfc`. Our docked shell uses `bg-card`
and measured light `oklch(1 0 0)`. This is a subtle surface delta but should
remain token-mapped unless an implementation pass introduces a semantic surface
token. Do not hardcode `#fcfcfc` in app code.

### Mobile Backdrop Behavior

Status: `acceptable`

Mobile close is hidden and backdrop/Escape dismissal works. The first probe at
`(8, 8)` hit the sheet surface because the sheet starts at `top: 6px`; a
corrected backdrop click at `(2, 2)` closed the sheet. The tiny top gap follows
the reference max-height expression.

### Composer Metrics

Status: `acceptable`

Real-route composer measurements match the reference direction:

- desktop/tablet surface `52px` high
- mobile surface `84px` high
- radius `28px`
- padding `5px 8px 5px 7px`
- textarea `16px / 26px`

No composer fix is currently open from this audit.

### Sources Gallery Rows

Status: `acceptable`

`components/ui/source.tsx:218-241` matches the reference gallery row structure:
`rounded-xl px-3 py-2.5`, `h-6` site row, `gap-2`, text `12px`, title `14px`
semibold, description `14px leading-snug`.

## Update Log

- 2026-06-27: Implemented the recommended open/close motion fix (options b + c)
  to align the desktop docked flyout with the ChatGPT reference. Code changed:
  (1) `docked-flyout-shell.tsx` — the shell `<section>` is pinned to a fixed
  `w-[var(--activity-panel-width)]` (was `w-full`) and carries the start seam
  (`border-s border-border`), so the `overflow-hidden` slot CLIPS it instead of
  re-wrapping it as the slot animates, and the seam slides rather than pops (M1 +
  M4.5). (2) `activity-panel-host.tsx` — the dock slot width is driven by a
  `data-[expanded]` attribute (was `:not(:empty)` content presence) and no longer
  toggles its own border. (3) `activity-panel.tsx` — `ActivityPanel` toggles
  `data-expanded` on the slot imperatively (no provider/Chat re-render) and keeps
  the docked shell mounted through the close collapse, unmounting on the slot's
  width `transitionend`; motion-reduce and sub-lg short-circuit to immediate
  unmount (never enter the closing window), via an adjust-state-during-render
  pattern (no setState-in-effect). The panel now slides shut populated (M2). M3
  (the `@container` thread snap) and the favicon-eager-load of option (a) were
  deliberately NOT touched — the snap is shared with the reference, and (c)
  preserves lazy favicon load + the "exactly one shell active" invariant.
  Guardrails honored: reused `--activity-panel-width`, no new tokens, no hex, no
  shared-primitive (Sheet) mutation, ScrollArea/scroll ownership unchanged,
  motion stays motion-reduce gated. Validation: `bunx tsc --noEmit` clean, ESLint
  clean on the 4 touched files, 69 chat tests pass incl. a new
  `activity-panel.test.tsx` case asserting the populated-collapse contract (slot
  drops `data-expanded` on close but the shell stays mounted until a `width`
  `transitionend`, then unmounts). Still OPEN: a live-render check of the actual
  open/close animation (the exact interpolated frames were always a
  needs-live-render item).
- 2026-06-27: Motion & layout-animation investigation pass (documentation only,
  no code changed). Added the `Activity Panel Open/Close Motion & Layout
Animation` section: a reference motion-spec table (desktop/tablet/mobile ×
  open/close), four prioritized findings (M1 inner-content reflow, M2 instant
  unmount on close, M3 shared `@container` thread snap, M4 secondary micro-motion),
  a mount-strategy recommendation (ship b+c: pin the flyout inner to a fixed width
  - defer unmount; hold a as the fidelity ceiling), and eight live-render
    ambiguities. Method: direct source-read of our open/close + breakpoint paths
    (`activity-panel.tsx`, `activity-panel-host.tsx`, `docked-flyout-shell.tsx`,
    `content-sheet-shell.tsx`, `conversation.tsx`, `chat.tsx`, `layout-app.tsx`,
    `header.tsx`, `globals.css`, `use-breakpoint.ts`) plus an independent
    multi-agent extraction across the desktop/tablet/mobile captures, `matched-rules`,
    `component-computed-styles`, the CSS recipe, and the inventory, with four
    load-bearing claims adversarially re-verified against the raw files. VERIFIED
    from static captures: reference flyout is always-mounted + CSS-collapsed
    (`max-lg:w-0!`, present in all three captures), animates WIDTH not transform via
    the `data-side-pane-shell-rail` spacer (`transition-[width] duration-300
ease-out` — same classes as our dock slot), and pins inner content in a
    fixed-width `absolute` carrier inside `overflow-x-hidden` so it CLIPS not
    reflows. CORRECTED a mid-pass hypothesis: the thread margin/max-width
    `@container` snap is SHARED with the reference (its tokens are un-transitioned
    too), so it is NOT the clean differentiator for the sharp re-expansion — the
    primary causes are our instant content unmount on close (M2) and `w-full`
    reflowing inner (M1). LEFT AS NEEDS-LIVE-RENDER: desktop flyout interpolated
    open/close timing, enter/exit asymmetry, whether the snap is masked by the
    slide, the exact `@w-*/main` thresholds, and all Silk sheet enter/exit. Updated
    `Outstanding Work At A Glance` (item 7) and cross-linked the `Responsive Shell
Coexistence At Breakpoint` finding (shared in-flow-push root cause; reference
    coexistence now confirmed). Validation: `git diff --check` clean;
    `git diff -- polish-acitivity-panel-and-page.md` is the only change;
    `git status --short` shows no unexpected files.
- 2026-06-27: Implemented the guardrail-safe deep-diff fixes. Code changed:
  `activity-panel.tsx` (reasoning description `text-muted-foreground text-sm
leading-5`), `activity-timeline.tsx` (`done` marker + `bullet` dot ->
  `text-muted-foreground`, connector `mt-1` removed, `StepTitle` `leading-[21px]`),
  `panel-header.tsx` + `content-sheet-shell.tsx` (close-button translucent
  `hover:bg-foreground/[0.07]`), and `activity-panel-trigger.tsx` (chevron
  `slotSize={20}` -> `{12}`). All token-mapped/scoped; no shared primitive,
  border token, or shadow token added. Held: sheet reasoning-block indent
  (alignment needs render verification), tablet `shadow-long` (needs a shadow
  token + render evidence), connector/flyout-seam colors (would need new border
  tokens, guardrail-forbidden), drag-handle fill (no clean token). Validation:
  16 targeted activity-panel/message tests passed, `bunx eslint` on the 5 touched
  files clean, `git diff --check` clean.
- 2026-06-27: Deep component-by-component diff of the whole activity panel + page
  vs the ChatGPT reference (inventory A1-D10 + CSS reference + desktop/tablet/
  mobile page captures + computed styles), cross-checked against direct source
  reads. Added the `Reference Divergences From Deep Diff` section with 11
  prioritized actionable items (Tier 1: reasoning description `text-sm
leading-5` + secondary color, `done` marker secondary tint, sheet
  reasoning-block `px-3` over-indent; Tier 2: tablet `shadow-long` elevation,
  close-button translucent hover; Tier 3: connector color/`mt-1`/bullet tint,
  drag-handle fill, flyout seam, step-title line-height) plus a "Confirmed
  Matches / Non-Issues" list. Notable correction: close-button `rounded-md`
  resolves to `8px` in our `--radius` scale (= reference `rounded-lg`), so it is
  NOT a divergence. Downgraded the P1 sheet-grid finding to structural-parity-
  only (reference third row is unpopulated, no current visual delta) and
  confirmed the tablet shadow as a real visible elevation mismatch. No code
  changed - this pass is documentation of what to change, per the working-doc
  guardrail to not implement open findings without a new request.
- 2026-06-27: Corrective RE-VERIFICATION pass. Re-read the raw desktop/tablet/
  mobile ChatGPT captures and audited every completed item in parallel against
  the source-of-truth reference. Confirmed the trigger placement was already
  corrected and committed (HEAD `7167e0d`): `MessageAssistant` renders the
  activity trigger BEFORE assistant content (verified via the rendered DOM and
  `message-assistant.test.tsx`), matching the reference ordering preamble ->
  `Thought for 5m 42s` disclosure -> main answer. Also re-confirmed against the
  reference: trigger toggle + aria semantics (faithful; the static capture
  cannot prove live toggle, and the doc is honest about that), submitted/
  pre-stream routing (no duplicate "Generating" loader), panel source-chip
  metrics (`h-[25px]` / `rounded-full` / `px-3` / `text-xs` / `12x12` favicon),
  header parity (`56px` panel header + `1px` seam, no overlay/radius/shadow vs
  `52px` page header), timeline top rhythm (`12px` via the timeline's `mt-3`,
  rendered-equivalent to the reference `mb-3` on the heading), and the
  `Pro thinking` heading scale (`1.05rem` / `1.5` line-height / `font-medium`).
  Caught and corrected ONE residual doc misread: the "20x20 reference icon" key
  value read the dead `width/height="20"` svg attributes and missed
  `class="icon-xs"` (`height: calc(var(--spacing) * 3)` = `12px`); corrected the
  value, retitled the "typography and icon scale" completed item to typography
  only, and reopened the icon scale as the `Trigger Disclosure Icon Scale`
  verification finding. No code changed: the disclosure svg's exact rendered
  size is absent from `component-computed-styles.json`, and a chevron resize is a
  visual change that needs render evidence first. Validation: targeted
  `message-assistant` + activity-panel/trigger/source-chip/conversation/
  use-activity-panel tests (14 passed) and `git diff --check` (clean).
- 2026-06-27: Corrective verification pass re-read the raw desktop, tablet, and
  mobile ChatGPT captures around `conversation-turn-2` and corrected the prior
  misread that placed the activity trigger below the full assistant answer. Code
  now renders the local trigger before assistant content as the closest
  approximation to ChatGPT's preamble/disclosure/main-answer split.
- 2026-06-27: Documentation cleanup consolidated completed/resolved work into
  `Completed And Verified Summary`; remaining implementation and verification
  findings stay detailed below.
- 2026-06-27: Submitted/pre-stream thinking was routed through the activity row;
  targeted conversation/message/use-activity-panel/activity-panel tests, narrow
  ESLint, and `git diff --check` passed.
- 2026-06-27: Header parity was verified as an acceptable divergence: page
  header `52px`, panel header `56px`, perceived alignment preserved; no code
  change required.
- 2026-06-27: Initial implementation pass completed trigger scale/semantics,
  trigger placement, `Pro thinking` scaffold, section/timeline rhythm, and
  source-chip metrics; targeted tests, narrow ESLint, and `git diff --check`
  passed.
- 2026-06-27: Initial audit created the working spec from durable ChatGPT
  reference captures, computed-style references, component inventory, local
  source inspection, and prior docs.

## Implementation Guardrails

- Do not implement remaining open findings without a new user request.
- Do not mutate shared primitives by default. Prefer scoped changes in
  `app/components/chat/activity/*` and the assistant-message call site.
- Do not move scroll/composer/panel ownership.
- Do not add new border tokens.
- Do not hardcode hex colors in app code; map through existing semantic OKLCH
  tokens or explicitly add a semantic token only with design approval.
- Do not add cosmetic class-string tests. Use browser render evidence, computed
  styles, and interaction proof.
