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

Dirty-tree note: this branch has modified tracked activity-panel/chat files and
related docs outside this cleanup. Treat every non-`polish-acitivity-panel-and-page.md`
change as user-owned unless the user explicitly scopes it into a future pass.

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
  weight, tight icon/text spacing, `20x20` reference icon.
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

## Completed And Verified Summary

- Header parity accepted/resolved - completed 2026-06-27; no code change; proof:
  desktop light/dark measured page header `52px`, panel header `56px`, `1px`
  seam, no overlay, no radius, and no shadow.
- Activity trigger typography and icon scale - completed 2026-06-27; files:
  `app/components/chat/activity/activity-panel-trigger.tsx` plus chat/message
  trigger plumbing; proof: targeted trigger/message tests, narrow ESLint, and
  `git diff --check`.
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

Why It Matters:

- This is visually subtle in normal render review and avoids duplicate favicon
  loads, but it may create a breakpoint handoff/motion difference while resizing
  across `1024px`.

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
