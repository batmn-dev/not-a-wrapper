# Activity Panel + Chat Integration — Cleanup Notes

Structural / type / duplication cleanup pass over the activity-panel + chat code
that landed on `darknight/clock-king`. **Behavior-, DOM-, and ChatGPT-fidelity
preserving** — no rendered markup, class strings, scrims, animations, or a11y
attributes changed. Validation at the bottom.

## Scope correction from the original brief

Mid-pass the owner redirected: **skip the "remove apparently-unused surface"
findings (T3, T13, and similar)** — several props/variants are *intentional
ChatGPT-replication scaffolding* for an upcoming live-timeline pass, not dead
code. Those were instead **annotated in place + logged in `TODO.md`**, and
**verified against the real reference** (`reference-ui/ChatGPT`) so the
annotations state the truth, not a guess:

| Scaffolding | Reference verdict |
| --- | --- |
| `steps` + timeline `globe`/`bullet`/`done` markers + `chips` body | **SUPPORTED** (capture shows 40 steps, all 3 markers, chip bodies on globe steps) |
| `isReasoningStreaming` | **PARTIAL** (`animate-show` + reserved empty chip-row slot present; live typing not captured) |
| `viewportRef` auto-scroll | **PARTIAL** (scroll container + `scroll-mb-4` spacer present; programmatic scroll not observable) |
| `phase` (`thinking`/`complete`) | **NOT-FOUND** (only the settled end-state is captured) — speculative; re-verify against a live "still thinking" capture before wiring |

Annotated files: `activity/activity-panel.tsx`, `use-activity-panel.ts`,
`activity/activity-timeline.tsx`, `activity/docked-flyout-shell.tsx`,
`components/ui/badge.tsx`. The remaining genuine cleanups (dedup, refactors,
renames) were all completed.

## Abstractions introduced

- **`useDockedPanelCollapse(...)`** (`activity/use-docked-panel-collapse.ts`) —
  the deferred-unmount / close-collapse lifecycle (the subtlest logic in
  `ActivityPanel`) relocated **verbatim**: lazy reduced-motion read, the
  `closing`/`wasExpanded` state, the adjust-state-**during-render** derivation,
  the imperative `data-expanded` effect, and the `transitionend` + 400 ms
  fallback. The `!reducedMotion` short-circuit and the during-render shape are
  preserved exactly (motion guardrails). Returns `{ dockedPresent }`.
- **`usePrefersReducedMotion()`** (`app/hooks/use-prefers-reduced-motion.ts`) —
  the lazy `matchMedia` snapshot, extracted as a tiny reusable hook.
- **`PanelCloseButton`** (`activity/panel-header.tsx`) — the shared ghost-icon
  close affordance (glyph + slotSize + translucent hover tint) used by both
  shells. The tint is appended **after** the caller `className`
  (`cn(className, TINT)`) so both call sites' class order stays byte-identical
  (the tint sits at the tail in both originals).
- **`TurnRow`** (`conversation.tsx`, local) — the shared turn wrapper (outer
  gutter container `as` article/div + the byte-identical `group/turn-messages`
  max-width column) rendered by both the mapped rows and the pending placeholder.
- **`ActivityPanelControls`** (`use-activity-panel.ts`) — the one read-only
  controls object that replaces the 3 individually-drilled panel props.
- **`THREAD_GUTTER_VARS` / `THREAD_MAXWIDTH_VARS`** (`thread-bounds.ts`) — the
  thread container-query CSS-var declaration clusters, shared by `conversation`,
  `chat`, and the thinking-states test page.
- **`isGenerationActive(status, isSubmitting)`** (`use-activity-panel.ts`) — the
  generation-active predicate, shared by the hook and `Conversation`.
- **`parseSafeExternalUrl`** (`lib/url-safety.ts`) — promoted next to
  `toSafeWebHref`.
- **`formatDuration`** (`lib/format-duration.ts`) — relocated out of the
  `reasoning` UI primitive into a neutral util (re-exported for back-compat).

## Before → after prop surfaces

**Panel-controls prop drill (Chat → Conversation → Message → MessageAssistant):**

| Before (each component) | After |
| --- | --- |
| `activityPanelOpen?: boolean` | bundled |
| `activityPanelId?: string` | bundled |
| `onActivityPanelOpenChange?: (open) => void` | bundled |
| — | `activityPanel?: ActivityPanelControls` `{ open, onOpenChange, panelId? }` |
| `activeTurnId?: string` | `activeTurnId?: string` (**unchanged — kept separate**) |

- 3 forwarded props → 1 at every hop; the `isAssistant ? x : undefined` ternary
  collapsed **3 → 1** (`conversation.tsx`); the rename-wrapper arrow in
  `MessageAssistant` dropped (`onOpenChange={activityPanel.onOpenChange}`).
- `ActivityPanel`'s own prop surface is **unchanged** (T3 was annotated, not
  narrowed — see scope correction).

## Duplication / dead code removed (line deltas)

- **Dead `source-chip-group` subsystem deleted:** `source-chip-group.tsx`
  (−147) + `source-chip-group.test.tsx` (−60) = **−207**. It was imported only
  by its own test (production renders `SourcesGallery`). Stale comment in
  `badge.tsx:20` fixed (the claimed stale ref in the test page did **not**
  exist — brief was slightly off).
- **`isGenerationActive`** byte-identical boolean was computed in 2 in-scope
  places (`use-activity-panel.ts`, `conversation.tsx`) → 1 shared helper. (A 3rd,
  private copy lives in `chat-turn.ts`, out of scope; noted in a comment.) The
  stale `chat.tsx` JSDoc was corrected.
- **Thread-bounds var clusters** were copy-pasted across 10 sites (×3 source
  files) → 2 shared constants.
- **Close-button chrome** re-implemented in 2 shells → `PanelCloseButton`.
- **Turn wrapper** scaffolding restated in the mapped + pending branches → one
  `TurnRow`.
- **`parseSafeExternalUrl`** moved out of `source.tsx` to co-locate with
  `toSafeWebHref`.

## Judgment calls

- **J1 (prop-drill):** grouped **object**, not context. Context would bypass the
  `Message` memo and complicate the §6.7E re-render-on-handoff guarantee; the
  object keeps the comparator trivial — it compares the bundle's **inner fields**
  (`open`, `panelId`), not its identity, so Chat recreating the object each
  render doesn't churn. **`activeTurnId` deliberately excluded from the bundle:**
  it's passed to *every* row (incl. user rows) and is memo-load-bearing, so
  bundling it under the assistant-gate would change user-row behavior.
- **J2 (header chrome depth):** stop at `PanelCloseButton` (+ the existing shared
  `TitleDurationCluster`). A shared `PanelChrome` bar would add more
  conditional-soup (grid-vs-flex + `border-b` deltas, the SheetClose `render`
  idiom) than it removes.
- **J3 (scaffolding):** delete `source-chip-group` (owner-approved); **keep +
  annotate** the timeline variants and `viewportRef` (owner decision), grounded
  in the reference verification above.
- **J4 (`LG_BREAKPOINT`):** keep the named literal + an explanatory comment — **no
  shared `BREAKPOINTS` constant.** The JS gate is a *viewport* media query while
  `@[64rem]/main` is a *container* query (different axes); a shared constant would
  imply a false equivalence. Coupling is intentionally prose-only.
- **J5 (`formatDuration`):** relocated to `lib/format-duration.ts` with a
  back-compat re-export from `reasoning.tsx`; both Activity importers repointed to
  the neutral util.

## Notable deviations (for byte-safety)

- **T4** extracts only the contiguous, byte-identical var-**declaration** tails;
  the `px-[var…]` / `max-w-[var…]` consumers stay inline because they aren't
  adjacent to the declarations in every string (folding them would reorder
  classes). Verified byte-identical via `cn` over all 7 distinct compositions.
- **T5** groups `OVERLAY_CLASSNAME` into `cn()` segments in the **same token
  order** (cascade-order-sensitive); verified byte-identical.
- **T6** collapsed the accidental 3-name chain (`panelId → id → controlsId`) to a
  single `panelId` across the shell boundary; the standalone `ActivityPanelTrigger`
  keeps its own tested `controlsId`. Emitted `id` / `aria-controls` unchanged; the
  two distinct a11y-name paths (`SheetTitle` vs `<span id={titleId}>`) preserved.

## Deliberately deferred

- **T3 narrowing / T13 variant trim / `viewportRef` removal** — kept as
  intentional ChatGPT scaffolding (owner decision; annotated + in `TODO.md`).
- **T12 `favicon.tsx` / `markdown-link.tsx`** — *not* routed through the new
  helper. They use raw `new URL` with **different** safety semantics (no
  `toSafeWebHref` gating) and **divergent** fallbacks/www-strip variants
  (`replace("www.", "")` vs `replace(/^www\./)`); consolidating would change
  their visible labels. `safeHostname` was likewise **not** added — no call site
  can consume a single www-strip without a visible-output change.

## Incidental fix

`message-assistant.test.tsx` relied on `markdown` being eagerly pulled into the
import graph via `reasoning.tsx` (its `formatDuration` import). Decoupling
`formatDuration` (J5) removed that incidental eager-load and exposed the latent
fragility: `MessageContent` loads `Markdown` via `next/dynamic`, and the test's
single-microtask flush only worked when `markdown` was already loaded. Fixed by
having the test **preload its own async dependency** (`await import(...)` in
`beforeAll`) — hermetic, no production change.

## Validation

- `bunx tsc --noEmit` — clean.
- `bunx eslint <23 touched files>` — clean.
- `bunx vitest run` — **114 files / 916 tests pass** (incl. the `Message` memo
  contract, the new `useDockedPanelCollapse` hook test, and the activity suite);
  re-run to confirm non-flaky.
- `git diff --check` — clean.
- Byte-identity spot-checks (`cn` over the real compositions): `OVERLAY_CLASSNAME`,
  both `PanelCloseButton` class strings, and all 7 thread-bounds interpolations
  are byte-identical to the originals.
