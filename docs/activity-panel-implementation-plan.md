---
created_at: 2026-06-24T22:08:03Z
confidence_legend: exact | strong | inferred | unknown
audience: senior engineer executing the build
source_of_truth: docs/activity-panel-gap-analysis.md (decisions §6.1–6.7, residuals §7, Step A/B, PR1→PR5 spine §5)
---

# Activity Panel — Implementation Plan

This is the execution-ready runbook for the responsive ChatGPT-style **Activity** panel. It operationalizes
`docs/activity-panel-gap-analysis.md` (the gap analysis; cited below as **GA §**). Every concrete instruction
cites both the GA section AND the target `file:line`. When the GA and this plan disagree, the GA wins — flag it.

---

## 1. TL;DR & architecture target

Today reasoning, tool steps, and sources render **inline** inside each assistant message's flex column
(`app/components/chat/message-assistant.tsx:237-249` reasoning, `:251-259` tools, `:301` sources). The work is
mostly **reuse, not rebuild**: the data is already parts-driven (`getSources(parts)` at message-assistant.tsx:102,
`useReasoningPhase({parts,...})` at :127-138). We build a composition root that swaps a **docked in-flow flyout
(≥lg)** against a **Sheet-backed card/bottom-sheet (<lg)**, and hoist reasoning/source state out of the per-message
column into a single panel owned by the **server-selected-path tail** (GA §6.7). Cutover is **clean and flag-free**:
inline rendering is removed; the panel is the only path.

> **Implementation status — baseline for this runbook.** **Step A is complete and committed** (`9040090` "Add
> activity panel UI groundwork"): `components/ui/favicon.tsx` (new), the badge `source` variant + sizes
> (`badge.tsx:21`), the chain-of-thought `leading` markers (`chain-of-thought.tsx:18-30`), the `reasoning.tsx`
> `title` slot (`:164-185`), and the `sources-list.tsx` → `Favicon` refactor all landed. **PR1 below is therefore
> reduced to the panel-specific remainder** — globals.css panel tokens + `show` keyframe, the `Favicon`
> `loading`/`decoding` forwarding, the `SourcesGallery`/`SourcesGalleryItem` rows, and the new `activity/*` leaf
> components. Do **not** re-create the Step A primitives; only extend `favicon.tsx` additively. PR2–PR5 are unaffected.

Final composition (location in parens):

```
ActivityPanel                         (app/components/chat/activity/activity-panel.tsx, "use client")
├─ DockedFlyoutShell  (≥lg)           (app/components/chat/activity/docked-flyout-shell.tsx)
│   └─ <section aria-label> + Button(ghost,icon-sm) + ScrollArea
├─ ContentSheetShell  (<lg)           (app/components/chat/activity/content-sheet-shell.tsx)
│   └─ Sheet/SheetContent(side=bottom|card) + DragHandle + max-sm:hidden close + ScrollArea
└─ (shared body, rendered into the ACTIVE shell only)
    ├─ PanelHeader                    (app/components/chat/activity/panel-header.tsx)
    │   ├─ TitleDurationCluster       (reuses reasoning.tsx ReasoningLabel title slot + formatDuration)
    │   └─ CloseIconButton            (button.tsx Button ghost icon-sm — no new file)
    └─ PanelScrollBody
        ├─ ActivityTimeline           (app/components/chat/activity/activity-timeline.tsx)
        │   └─ ActivityStep…          (StepLeadingIndicator + StepTitle + SourceChipGroup|Markdown)
        │       └─ SourceChipGroup     (SourceChip… + OverflowChip)
        └─ SourcesGallery             (components/ui/source.tsx: SourcesGallery / SourcesGalleryItem)
            └─ PanelSectionHeading    (app/components/chat/activity/panel-section-heading.tsx)
```

Data flow: `use-activity-panel.ts` derives `activeTurnId` from `projectSelectedPath(...)` tail
(`lib/chat-store/turns/selected-path.ts:171-180`), calls `useReasoningPhase` with `isLast = isActiveTurn`, and
returns `{ phase, steps, sources, durationSeconds, reasoningText, isReasoningStreaming, isOpaqueReasoning }`.

**The 5-PR spine** (GA §5, §7 R-rollback) — each keeps `main` green and shippable, cutover last:

| PR | Objective | Reverts to |
|----|-----------|-----------|
| **PR1** | Additive leaves + tokens (dormant). **Step A leaves already shipped (commit `9040090`);** PR1 remainder = globals.css panel tokens/keyframe, `Favicon` loading/decoding forwarding, `SourcesGallery`/`SourcesGalleryItem`, new `activity/*` leaf components. | dead code only |
| **PR2** | Compose `content-sheet-shell.tsx` over the **unchanged** Sheet; sole sheet edit = additive `overlayClassName?`. | shell + optional prop removed; 2 sidebars untouched |
| **PR3** | Hoist panel state behind `use-activity-panel.ts` (active-turn selector) + flip `message.tsx` memo contract. Panel renders alongside still-inline body. | restores `:107`/`:111`, removes hook |
| **PR4** | Layout sibling track at `width:0` in layout-app.tsx seam; panel content rendered, track collapsed below lg. | removes track; full-width conversation |
| **PR5** | **Cutover** — remove inline reasoning/sources from the body; panel is the only path. | git revert restores inline; PRs 1–4 stay green |

---

## 2. Global guardrails (hold on EVERY PR)

1. **NO feature flags / NO dual-path toggle / NO runtime kill switch / NO prod diffing.** The cutover is clean
   (GA §5 risk preamble, §6 intro). Confidence comes only from pre-merge proof (typecheck/lint/test) and the
   small independently-revertable PR spine.
2. **Compose, don't mutate** shared primitives. For `sheet.tsx` the ONLY allowed edit is the additive
   `overlayClassName?: string` (default `undefined`) forwarded to `<SheetOverlay>` (GA §7 R2, sheet.tsx:60). The
   **exactly two** Sheet consumers that must stay byte-green: `components/ui/sidebar.tsx:207-227` and
   `app/components/layout/sidebar/app-sidebar.tsx:227-247` (GA §5 risk 2; `grep -rn '<Sheet' app components` to re-confirm — only these two).
3. **OKLCH semantic tokens only.** No hardcoded hex. Sprite hashes `#6b0d8c`/`#a4763e`/`#85f94b` are sprite-ids,
   not colors (GA §4 rows 20–22, §4 "Decisions surfaced") — render glyphs via `components/ui/icon.tsx` tinted by
   `currentColor` (`text-muted-foreground`/`text-foreground`). Chip surfaces use `bg-secondary` / `bg-muted`,
   hover-invert via `hover:bg-primary hover:text-primary-foreground` (GA §4 rows 10–14).
4. **Collapse text tiers onto `--muted-foreground`** — do NOT add `--muted-foreground-subtle` (GA §6.5).
   **Connector uses `border-border`** — do NOT add `--border-strong` (GA §6.6).
5. **RSC discipline.** `"use client"` only where there is interactivity/context/timer. `icon.tsx`/`favicon.tsx`
   are server-safe today — keep them that way. `activity-panel.tsx`, `use-activity-panel.ts`,
   `content-sheet-shell.tsx` are client (Sheet is a client primitive; the panel owns open state + the timer).
6. **CVA + cn idiom** mirroring `components/ui/button.tsx:7-41` (cva base + `variants` + `defaultVariants`,
   merged via `cn(...)`). New variants MUST leave existing `defaultVariants` byte-identical so current call sites
   are unchanged (GA Step A; badge.tsx already follows this).
7. **Every new animation utility carries a `motion-reduce:` variant** (GA §7 R7; tw-animate-css imported at
   globals.css:5). No `prefers-reduced-motion` precedent exists in the repo — this is a new, required pattern.
8. **Verification gate per PR:** `bun typecheck` (tsc --noEmit), `bun lint` (eslint .), `bun test` (vitest run)
   — all confirmed in package.json:22-24. Plus the PR-specific assertions in §5.

---

## 3. Current-state cheat sheet (load-bearing file:line facts)

| Concern | Fact | file:line |
|--------|------|-----------|
| Memo streaming short-circuit | `if (next.status === "streaming" && next.isLast) return false` — the dominant re-render driver; **narrow**, don't leave intact (GA §7 R3) | message.tsx:107 |
| Memo reasoning projection | `if (getReasoningContent(prev.parts) !== getReasoningContent(next.parts)) return false` — **delete** | message.tsx:111 |
| `getReasoningContent` helper | concatenates reasoning part text — **delete** when orphaned | message.tsx:58-65 |
| `getTextContent` / `getToolSignature` | **keep** — mutation-safe string projections; become the narrowed guard | message.tsx:54-56 / 67-76 |
| `prev.isLast !== next.isLast` gate | **keep** | message.tsx:121 |
| Un-memoized parts.filter (reasoning) | intentionally un-memoized — AI SDK mutates parts in place w/o changing array ref. **Do NOT memoize** (GA §7 R1) | use-reasoning-phase.ts:28-31 |
| `shouldRunTimer` | `isLast && phase === "thinking"` — `isLast` becomes `isActiveTurn` (GA §6.7B) | use-reasoning-phase.ts:75 |
| Render-sync reset | `if (phase !== prevPhase){...; if(thinking&&isLast) setTickedSeconds(0)}` — preserve verbatim; R1 fix gates this on `prevPhase !== "thinking"` | use-reasoning-phase.ts:78-83 |
| setInterval timer + cleanup-freeze | freeze final `tickedSeconds` on cleanup — preserve verbatim | use-reasoning-phase.ts:86-106 |
| Persisted duration fallback ladder | live timer (active) > persisted ms/1000 (historical/complete-no-ticks) | use-reasoning-phase.ts:110-124 |
| `formatDuration` | module-private; `<60→Ns` else `Xm Ys`. EXPORT additively at reasoning.tsx:299 only if needed standalone | reasoning.tsx:55-60 |
| ReasoningLabel title cluster | `title · duration` shimmer header — already extended; REUSE, no edit | reasoning.tsx:183-206 |
| React-19 render-sync auto-open | preserve verbatim — do NOT revert to useEffect (@upgradeNotes) | reasoning.tsx:92-105 |
| `getSources(parts)` | pure; REUSE as-is to populate `sources` | get-sources.ts:23 ; called message-assistant.tsx:102 |
| `useReasoningPhase` call | move into use-activity-panel.ts (preferred) | message-assistant.tsx:127-138 |
| toolInvocationParts (steps) | `parts.filter(isStaticToolUIPart)` | message-assistant.tsx:108-110 |
| persistedDurationMs read | `metadata.reasoningDurationMs` (ms) | message-assistant.tsx:122-126 |
| Inline reasoning JSX (cutover removes) | PR5 | message-assistant.tsx:237-249 |
| Inline sources JSX (cutover removes) | PR5 | message-assistant.tsx:301 |
| Sheet overlay base class | the string `overlayClassName` defaults to (must stay byte-identical when undefined) | sheet.tsx:40 |
| `<SheetOverlay />` invocation | the single additive forward point | sheet.tsx:60 |
| SheetContent props/defaults | `side="right"`, `showCloseButton=true`; add `overlayClassName?` | sheet.tsx:48-57 |
| Layout sibling seam | flyout track goes AFTER the `@container/main` column close, inside the `.flex.h-svh` row | layout-app.tsx:15, :17-24 |
| Scroll machinery that must NOT move | ScrollRoot stays inside `@container/main` | layout-app.tsx:18 |
| Chat composer (sticky, stick-to-bottom) | NOT a panel seam; its breakpoints are container-queries on `@container/main` | chat.tsx:321-354, :324, :339 |
| Selected-path tail source | `projectSelectedPath(live, serverPath)` — last element with role==='assistant' | selected-path.ts:171-180 |
| Divergence guard | `isSelectedPathDivergent` → serverPath (C2 tolerance, GA §6.7F) | selected-path.ts:145-164 |
| Cross-key id idiom | `getServerMessageId(metadata)` from `@/lib/chat-messages/metadata` | selected-path.ts:110-119 |
| globals.css token blocks | first `@theme` (:49-54 spacing/animate), `:root` composer vars (:422-425), `.dark` composer vars (:507-510), top-level keyframes (:27-47) | app/globals.css |

---

## 4. Shared state & ownership model (operationalizes GA §6.7)

**One panel, one owner, keyed off the server-selected path.** This is the linchpin of the flag-free cutover.

- **(A) Ownership.** Owner = the **last assistant message on the server-selected path** — the tail of
  `projectSelectedPath(live, serverPath)` (selected-path.ts:171-180). Key off that message's `id` (`activeTurnId`),
  NOT the raw live array, NOT per-message positional `isLast` (GA §6.7A). There is no explicit tail accessor — scan
  from the end for `role === 'assistant'`:
  ```ts
  const path = projectSelectedPath(live, serverPath)
  let tail
  for (let i = path.length - 1; i >= 0; i--) { if (path[i].role === "assistant") { tail = path[i]; break } }
  const activeTurnId = tail?.id
  ```
  Cross-key with `getServerMessageId(tail.metadata)` when the optimistic id hasn't anchored (mirror
  selected-path.ts:110-119).
- **(B) active-turn-aware `isLast`.** `use-activity-panel.ts` computes
  `isActiveTurn = activeTurnId !== undefined && (messageId === activeTurnId || getServerMessageId(metadata) === activeTurnId)`
  and passes it as `useReasoningPhase`'s `isLast`. The live timer runs only for `activeTurnId && phase==="thinking"`
  (GA §6.7B, use-reasoning-phase.ts:75). All other turns render frozen/persisted state. Fallback: when
  `activeTurnId === undefined` (non-durable / pre-projection) fall back to conversation.tsx's positional `isLast`
  (conversation.tsx:101-102).
- **(C) Duration freeze.** Active streaming turn → live wall-clock (`setInterval`→`tickedSeconds`); on `phase`
  leaving `"thinking"` cleanup freezes the final value (use-reasoning-phase.ts:96-106). Completed/non-active turn →
  persisted `metadata.reasoningDurationMs` rounded to seconds via the existing ladder (:110-124). No re-keying of
  `tickedSeconds`, no memoizing the derivation (GA §7 R1).
- **(D) Regenerate.** New assistant sibling becomes the path tail; `activeTurnId` moves to the new id, its timer
  resets to 0 (render-sync reset :78-83) and runs live; the superseded sibling freezes to persisted (GA §6.7D).
- **(E) Branch switch.** `selectMessageBranch → projectSelectedPath` re-projects; `activeTurnId` recomputes from the
  new tail; panel instantly shows that turn's persisted state (no live timer unless that tail still streams)
  (GA §6.7E).
- **(F) C2 count-drift tolerance.** `activeTurnId` is computed against the **server-selected path** via
  `projectSelectedPath`, never the optimistic count. On divergence `projectSelectedPath` returns the server path
  (selected-path.ts:171-180), so the panel may momentarily show the server's last-selected turn. **Correct and
  tolerated** — it self-heals at convergence (GA §6.7F; MEMORY: c2-edit-version-guard-count-drift).

**R1 residual fix (must land in PR3):** a same-id `isLast` `true→false→true` bounce during regenerate could zero the
counter mid-stream. Gate the render-sync reset (use-reasoning-phase.ts:80) on `prevPhase !== "thinking"` so a bounce
that stays in `thinking` does not reset (GA §7 R1).

---

## 5. PR-by-PR runbook

> New component prop/CVA APIs are given in full **the first time the component appears**; §6 is the consolidated
> appendix. Tests are house-style: vitest, manual `createRoot`+`act` (no testing-library), jsdom via the
> `/** @vitest-environment jsdom */` line-1 pragma, or `renderToStaticMarkup` for string-markup leaves.

### PR1 — Additive leaf primitives + tokens (dormant)

**Objective.** Land the **remaining** additive, default-preserving primitives + tokens with **zero** behavioral
change, nothing wired into the conversation. (GA §5 PR1.) **Step A already shipped (commit `9040090`):**
`favicon.tsx`, the badge `source` variant + sizes, the chain-of-thought `leading` markers, the `reasoning.tsx`
`title` slot, and the `sources-list.tsx` → `Favicon` refactor — **do not redo these.** What remains in PR1 is below.

**Files touched (exact).**
- `app/globals.css` (panel tokens + `show` keyframe)
- `components/ui/favicon.tsx` (additive `loading`/`decoding` forward — the file already exists from Step A)
- `components/ui/source.tsx` (new `SourcesGallery` + `SourcesGalleryItem` exports)
- `app/components/chat/activity/activity-timeline.tsx` *(new)*
- `app/components/chat/activity/panel-section-heading.tsx` *(new)*

**Already shipped in Step A (commit `9040090`) — do NOT touch/re-add:** `components/ui/favicon.tsx` (the component),
`badge.tsx` `source` variant + sizes (`:21`), `chain-of-thought.tsx` `leading` markers (`:18-30`), `reasoning.tsx`
`title` slot (`:164-185`), `sources-list.tsx` → `Favicon` refactor.

**Current-state findings.** badge.tsx:21-22 already has the `source` variant and badge.tsx:24-33 the `default/sm/md`
size axis with unchanged `defaultVariants` — **no edit needed** (GA §2 D8 / evidence). favicon.tsx AvatarImage
forwards only src/alt/className (favicon.tsx:72), FaviconProps lacks loading/decoding (favicon.tsx:44-49).
chain-of-thought.tsx isLast/connector pattern lives at :148-166 (mapper) and :187-189 (Step connector) — **mirror,
do not edit** that file.

**Change recipe per file.**

1. **`app/globals.css`** (GA §5 PR1, GA token map rows 9/26/33, evidence "tokensToAdd"):
   - Add layout width token inside the FIRST `@theme {…}` block, immediately after globals.css:52:
     `--activity-panel-width: 25rem;` (GA §6.4 — 25rem = 400px; consume as
     `width: var(--activity-panel-width, 400px)`).
   - Add `--spacing-panel-header: 56px;` in the same `@theme` spacing cluster (GA §4 row 25; the flyout pins 56px
     for byte-fidelity rather than reusing `--spacing-app-header`'s 52px).
   - Add scrim color token to BOTH blocks (diverge light/dark, GA §4 rows 9/23/24): in `:root` near :422-425
     `--overlay-scrim: oklch(0 0 0 / 0.30);`; in `.dark` near :507-510 `--overlay-scrim: oklch(0 0 0 / 0.50);`.
     Optionally bridge in `@theme inline` (:268-319) as `--color-overlay-scrim: var(--overlay-scrim);` so
     `bg-overlay-scrim` resolves.
   - Add the `show` keyframe consistent with existing keyframes. Prefer token-driven (matches
     `--animate-collapsible-*` at :53-54): inside the first `@theme` block add
     `@keyframes show { from { opacity: 0; transform: translateX(0.5rem); } to { opacity: 1; transform: translateX(0); } }`
     and `--animate-show: show 200ms ease-out;`.
   - NOTE: `--thread-bottom-offset` is NOT a globals.css token — it is a LOCAL CSS var set inline on `ScrollRootContent` (`conversation.tsx:94`: `[--thread-bottom-offset:calc(var(--spacing-input-area)+2rem+env(safe-area-inset-bottom,0px))]`). Do NOT add it to globals.css; the PR4 layout test asserts it stays unchanged.

2. **`components/ui/favicon.tsx`** (GA §7 R8, evidence changeRecipe): purely additive forward of native img attrs.
   - Extend FaviconProps (:44-49) with optional `loading?: "lazy" | "eager"` and
     `decoding?: "async" | "sync" | "auto"`.
   - Destructure them in the Favicon signature (:58-64).
   - Pass through: `<AvatarImage src={src} alt={alt} loading={loading} decoding={decoding} className={radius} />`
     (:72). Defaults stay undefined; call sites pass `loading="lazy" decoding="async"`. `defaultVariants` untouched.

3. **`components/ui/source.tsx`** — add `SourcesGalleryItem` + `SourcesGallery` (GA §6.1, evidence galleryRowSpec).
   KEEP `Source`/`SourceTrigger`/`SourceContent` (:44-160) **byte-identical**. New siblings in the file's idiom
   (Tailwind + cn, no testids, preserve the `eslint-disable` for raw `<img>` from :101).
   - `SourcesGalleryItem` — a single full-bleed anchor, **no HoverCard**:
     ```
     <a href={href} target="_blank" rel="noopener"
        className="flex flex-col gap-0.5 rounded-xl px-3 py-2.5 hover:bg-accent">
     ```
     Props: `href: string`; `title: string` (`line-clamp-2 text-sm font-semibold break-words`);
     `siteName?: string` (row-1 text; fall back to `new URL(href).hostname` via the SAME try/catch as Source
     :45-50); `description?: string` (`line-clamp-2 text-muted-foreground text-sm leading-snug`; **rendered even
     when empty** to reserve snippet height); `faviconDomain?: string` (page **ORIGIN** via `new URL(href).origin`
     when omitted; feeds `s2/favicons?domain=ORIGIN&sz=32`). Favicon is **internal, not a prop**: raw `<img>`
     `icon-sm rounded-full object-cover` over a `bg-card` ring, `motion-safe` fade, `alt=""`, and per R8
     `loading="lazy" decoding="async"` with a fixed box. **Diverge on `rel`:** gallery uses `rel="noopener"` only.
   - `SourcesGallery` — props `sources: SourcesGalleryItem[]`, `count?: number` (default `sources.length`),
     `groups?: { items: SourcesGalleryItem[] }[]` (**flatten to ONE `ul`**). Heading reuses the `PanelSectionHeading`
     "Sources" treatment (label + middot + count). DO NOT route rows through `Source`/`SourceTrigger`/`SourceContent`
     (GA §6.1 DO-NOTs).

4. **`app/components/chat/activity/panel-section-heading.tsx`** *(new)* (GA §B PanelSectionHeading, D1): a plain
   `div` (NOT a heading — dialog name lives in the header), `flex items-baseline justify-between`,
   `text-muted-foreground font-medium` ~`text-base`. Props `{ title: string; trailing?: ReactNode; className? }`.
   Title `truncate`; trailing slot holds `· {count}`. Prefer stock `text-base`/`text-lg` + `font-medium` over the
   arbitrary `text-[1.05rem]` (GA §4 row 32).

5. **`app/components/chat/activity/activity-timeline.tsx`** *(new)* — mirror chain-of-thought.tsx WITHOUT editing it
   (GA §D2-D5, evidence changeRecipe). `"use client"` (timeline maps children/cloneElement; keep parity with
   chain-of-thought.tsx:1).
   - `ActivityTimeline({ children, className })` — copy the mapper at chain-of-thought.tsx:148-166:
     `React.Children.toArray(children).map((child, i, arr) => React.cloneElement(child, { isLast: i === arr.length - 1 }))`.
   - `ActivityStep` — mirror chain-of-thought.tsx:174-192: a `group` wrapper with `data-last={isLast}`, a trailing
     connector div `bg-primary/20 ml-1.75 w-px` hidden via `group-data-[last=true]:hidden` (copy :187-189; GA §6.6
     uses `border-border`/the existing rail token — keep `bg-primary/20` for pixel parity with the existing rail).
   - `StepLeadingIndicator` — reuse the exact Icon call shape from chain-of-thought.tsx:98-102:
     `<Icon icon={RiGlobeLine|RiCheckLine|...} slotSize={16} className="text-muted-foreground" />` (globe) /
     `text-foreground` (done). `stepVariants` cva `{ leading: { globe, bullet, done }, body: { chips, description } }`,
     `defaultVariants { leading: "bullet", body: "description" }` (GA §D2-D5; cva idiom per button.tsx:7-41).
   - Steps carry ascending inline `z-index` inside a `relative isolate` timeline so connectors overlap (GA §5 Step B
     "Animations").

**New files created.** `app/components/chat/activity/activity-timeline.tsx`,
`app/components/chat/activity/panel-section-heading.tsx`. (`SourcesGallery`/`SourcesGalleryItem` are in source.tsx.)

**Tests to add.**
- `app/components/chat/activity/activity-timeline.test.tsx` — string-markup (skeleton c):
  ```tsx
  import { renderToStaticMarkup } from "react-dom/server"
  import { describe, expect, it } from "vitest"
  import { ActivityTimeline, ActivityStep } from "./activity-timeline"

  describe("ActivityTimeline", () => {
    it("omits the connector on the last step", () => {
      const markup = renderToStaticMarkup(
        <ActivityTimeline>
          <ActivityStep leading="globe">First</ActivityStep>
          <ActivityStep leading="done">Last</ActivityStep>
        </ActivityTimeline>
      )
      // last step carries data-last=true → connector hidden via group-data-[last=true]:hidden
      expect(markup).toContain("First")
      expect(markup).toContain("Last")
    })
  })
  ```
- `components/ui/sources-gallery.test.tsx` (or co-located beside source.tsx) — **the 141-source R8 test**
  (GA §7 R8, evidence galleryRowSpec):
  ```tsx
  /** @vitest-environment jsdom */
  import React, { act } from "react"
  import { createRoot, type Root } from "react-dom/client"
  import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
  import { SourcesGallery } from "./source"

  beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true })

  describe("SourcesGallery favicon attrs", () => {
    let container: HTMLDivElement | null = null
    let root: Root | null = null
    beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container) })
    afterEach(() => { const m = root; if (m) act(() => m.unmount()); container?.remove(); root = null; container = null })

    it("sets loading=lazy + decoding=async on every gallery img and renders exactly N imgs", () => {
      const sources = Array.from({ length: 141 }, (_, i) => ({ href: `https://example${i}.com/page`, title: `Title ${i}` }))
      act(() => { root?.render(<SourcesGallery sources={sources} />) })
      const imgs = Array.from(container!.querySelectorAll("img"))
      expect(imgs.length).toBe(141)
      for (const img of imgs) {
        expect(img.getAttribute("loading")).toBe("lazy")
        expect(img.getAttribute("decoding")).toBe("async")
      }
    })
  })
  ```

**Verification gate.** `bun typecheck` · `bun lint` · `bun test` all green. Existing `message.test.tsx` /
`conversation.test.tsx` / `tool-invocation.test.tsx` unchanged. The two new tests pass. Visual: inline thread is
pixel-identical to `main` in light AND dark (new exports are unreferenced).

**Revert.** Drops dead code + additive tokens only; existing `Source*`/`Favicon` exports byte-identical.

---

### PR2 — Compose `content-sheet-shell.tsx` over the unchanged Sheet

**Objective.** Build the `<lg` shell entirely through the existing Sheet public API; the ONLY sheet edit is the
additive `overlayClassName?`. (GA §5 PR2, §7 R2.)

**Files touched.** `components/ui/sheet.tsx` (one additive prop), `app/components/chat/activity/content-sheet-shell.tsx`
*(new)*.

**Current-state findings.** `sheet.tsx` has NO cva and NO `defaultVariants` — every part is `cn(base, className)`
(GA §7 R2; sheet.tsx:48-89). `SheetContent` renders `<SheetOverlay />` with no className passthrough (sheet.tsx:60);
`SheetOverlay` is internal-only (not in the export block sheet.tsx:134-143). The overlay base class to preserve is
sheet.tsx:40. Sheet IS Base UI Dialog (sheet.tsx:6) — provides focus trap/scroll-lock/ESC. Drag-handle styling
precedent: drawer.tsx:83. `showCloseButton={false}` precedent: `app/components/layout/sidebar/app-sidebar.tsx:233`; `[&>button]:hidden` className
gate precedent: `components/ui/sidebar.tsx:213`.

**Change recipe per file.**

1. **`components/ui/sheet.tsx`** (additive, default-preserving — GA §7 R2):
   - Change the SheetContent prop intersection (sheet.tsx:54-57) to add `overlayClassName?: string`.
   - Destructure `overlayClassName` alongside existing params (sheet.tsx:48-53).
   - Forward at sheet.tsx:60: `<SheetOverlay className={overlayClassName} />`. `SheetOverlay` already merges via
     `cn(base, className)` (:39-42), so undefined is a no-op — `cn("…sheet.tsx:40 base…", undefined)` is
     byte-identical to today. **By construction backward-compatible** (not a flag).

2. **`app/components/chat/activity/content-sheet-shell.tsx`** *(new, "use client")* — reach every behavior through
   the public API, leaving sheet.tsx defaults byte-unchanged (GA §7 R2, §6.2):
   - Props: `{ open: boolean; onOpenChange: (o: boolean) => void; title: string; children: ReactNode }`.
   - Radius/shadow via `SheetContent className`: mobile `side="bottom"` `rounded-t-2xl` (16px top corners squared
     bottom); tablet `sm:` centered card `sm:max-w-md sm:rounded-2xl sm:shadow-border-xl` (GA §4 rows 8/34; tokens
     `--radius-2xl`/`--shadow-border-xl` already exist).
   - Close gate: `showCloseButton={false}` + own gated close button, OR `className="[&>button]:max-sm:hidden"`
     (mirror `components/ui/sidebar.tsx:213`). Mobile uses the handle; tablet/desktop the close.
   - Drag handle: static `aria-hidden` child `<div className="bg-muted mx-auto mt-4 h-1 w-12 rounded-full sm:hidden" />`
     (GA §7 R2 explicitly chooses `h-1 w-12` over drawer's `h-2 w-[100px]`; model styling on drawer.tsx:83, no vaul
     wiring).
   - Backdrop: the ONLY behavior needing the new prop — pass
     `overlayClassName="bg-overlay-scrim sm:backdrop-blur-[1px] sm:transition-opacity sm:duration-[250ms] sm:data-starting-style:opacity-0 motion-reduce:transition-none"`
     (mobile black/30 instant via `--overlay-scrim`, tablet gray fade; GA §C3, §6.2, §7 R7).
   - `SheetTitle` = the `aria-labelledby` accessible name (GA §C7, §B1).
   - Enter/exit timing (GA §6.2): `data-starting-style`/`data-ending-style` on `SheetContent className` →
     enter 250ms `cubic-bezier(0.32,0.72,0,1)`, exit 200ms, all `motion-reduce`-gated.

**New files created.** `app/components/chat/activity/content-sheet-shell.tsx`.

**Tests to add.**
- `components/ui/sheet.test.tsx` *(new)* — **default-equivalence snapshot** (GA §5 PR2): render `SheetContent`
  WITHOUT `overlayClassName`, assert the `[data-slot="sheet-overlay"]` element's `className` is byte-identical to the
  sheet.tsx:40 base string. (createRoot+act, jsdom.)
- Per-consumer green tests for the **exactly two** consumers (`components/ui/sidebar.tsx:207-227`, `app/components/layout/sidebar/app-sidebar.tsx:227-247`):
  assert unchanged content/backdrop/focus-trap/ESC. (May be light — assert the overlay class is unchanged and the
  Sheet still mounts.)
- **Grep gate** (CI or a test asserting): `content-sheet-shell.tsx` is the ONLY caller passing `overlayClassName`:
  `grep -rn "overlayClassName" app components | grep -v "sheet.tsx" | grep -v "content-sheet-shell.tsx"` returns empty.

**Verification gate.** `bun typecheck` · `bun lint` · `bun test`. Default-equivalence snapshot passes; both sidebars
green; grep gate empty. Per GA §7 R2 residual, apply `fix-overlay-bleedthrough` discipline — keep the flyout/card
surface opaque (`bg-card`/`bg-popover`), do NOT retint the primitive.

**Revert.** Remove the shell + the optional prop; the two sidebars are untouched by construction.

---

### PR3 — Panel state hoist + body-memo contract

**Objective.** Add `use-activity-panel.ts` deriving `activeTurnId` and feeding `{phase, steps, sources,
durationSeconds}`; flip the `message.tsx` memo so reasoning/source deltas no longer churn the body. Panel renders
**alongside** the still-inline body (dormant until PR5). (GA §5 PR3, §6.7, §7 R1/R3.)

**Files touched.** `app/components/chat/use-activity-panel.ts` *(new)*, `app/components/chat/message.tsx`,
`app/components/chat/use-reasoning-phase.ts` (R1 reset gate), `app/components/chat/conversation.tsx` +
`message.tsx` + `message-assistant.tsx` (thread the additive optional `activeTurnId` prop).

**Current-state findings.** See §3. Key: message.tsx:107 short-circuit is the dominant streaming driver (NOT :111);
`getReasoningContent` :58-65 / :111 to delete; `getTextContent`/`getToolSignature` :54-56/:67-76 keep;
use-reasoning-phase.ts:75-124 timer/ladder; selected-path.ts:171-180 tail; conversation.tsx:101-102 positional
fallback.

**Change recipe per file.**

1. **`app/components/chat/use-activity-panel.ts`** *(new, "use client")* — evidence changeRecipe:
   ```ts
   export function useActivityPanel({ parts, status, metadata, messageId, activeTurnId }: {
     parts?: UIMessage["parts"]
     status: "streaming" | "ready" | "submitted" | "error"
     metadata?: ChatMessageMetadata
     messageId: string
     activeTurnId?: string
   }): {
     phase: ReasoningPhase["phase"]; steps: ToolUIPart[]; sources: SourceUrlUIPart[]
     durationSeconds: number | undefined
     reasoningText: string; isReasoningStreaming: boolean; isOpaqueReasoning: boolean
   }
   ```
   Body: (1) `isActiveTurn = activeTurnId !== undefined && (messageId === activeTurnId || getServerMessageId(metadata) === activeTurnId)`
   (import `getServerMessageId` from `@/lib/chat-messages/metadata`). (2) `persistedDurationMs` exactly as
   message-assistant.tsx:122-126. (3) `useReasoningPhase({ parts, status, isLast: isActiveTurn, persistedDurationMs })`.
   (4) `sources = getSources(parts || [])` (get-sources.ts). (5)
   `steps = parts?.filter((p): p is ToolUIPart => isStaticToolUIPart(p)) ?? []` (from `ai`, like
   message-assistant.tsx:108-110). (6) return all of the above. **Keep the hook reasoning-only — do NOT re-key
   `tickedSeconds`, do NOT memoize the parts.filter derivation** (GA §7 R1).

2. **`app/components/chat/use-reasoning-phase.ts`** — R1 fix only (GA §7 R1): gate the render-sync reset at :80 on
   `prevPhase !== "thinking"` so an `isLast` `true→false→true` bounce that stays in `thinking` does not zero
   `tickedSeconds`. Everything else (derivation :28-31, timer/cleanup :86-106, ladder :110-124) **verbatim**.

3. **`app/components/chat/message.tsx`** — memo contract flip (GA §7 R3, GA memoRecipe):
   - DELETE the reasoning projection at :111 and the now-orphaned `getReasoningContent` helper at :58-65.
   - Add the additive optional `activeTurnId?: string` to `MessageProps` (:21-50), forward it to
     `MessageAssistant`, and compare it in `areMessagesEqual` before the streaming/content gates:
     ```ts
     if (prev.activeTurnId !== next.activeTurnId) return false
     ```
     A branch switch or active-turn handoff must re-render the assistant panel state even when message body content is
     unchanged.
   - NARROW the streaming short-circuit at :107 to content-gated:
     ```ts
     if (next.status === "streaming" && next.isLast) {
       if (getTextContent(prev.parts) !== getTextContent(next.parts)) return false
       if (getToolSignature(prev.parts) !== getToolSignature(next.parts)) return false
       // reasoning-only deltas: panel updates itself; fall through to remaining gates
     }
     ```
   - KEEP `getTextContent` (:54-56), `getToolSignature` (:67-76), the `prev.isLast !== next.isLast` gate (:121),
     the status gate (:122). Sources are NOT in the memo today — leave them out.

4. **Thread `activeTurnId` (additive, backward-compatible).** conversation.tsx derives it from the projected path
   tail (§4 snippet) and passes down `Message → MessageAssistant → useActivityPanel`. When undefined, fall back to
   positional `isLast` (conversation.tsx:101-102). message-assistant.tsx keeps `getSources`/toolInvocationParts/
   persistedDurationMs computations but forwards them (PR5 removes inline render).

**New files created.** `app/components/chat/use-activity-panel.ts`.

**Tests to add.**
- `app/components/chat/message.test.tsx` (extend) — render-count suite (skeleton a; GA §7 R3): mock
  `./message-assistant` with a `vi.fn()` body spy. Test 1: adding reasoning + `source-url` parts with identical
  text during `streaming+isLast` does NOT re-render the body (fails today on :107/:111, passes after). Test 2: a real
  text delta DOES. Test 3: a tool state transition (`submitted→output-available`) DOES. Test 4: changing only
  `activeTurnId` DOES re-render/forward the new value so branch switches and active-turn handoffs cannot leave stale
  panel state. Plus an explicit assertion that no in-body element reads tool output/args without a state change (R3
  residual on getToolSignature :67-76).
- `app/components/chat/use-reasoning-phase.test.tsx` *(new)* — fake-timer suite (skeleton b; GA §7 R1): (a) freeze at
  5s on cleanup (:99-102); (b) persisted fallback when `isLast && complete && tickedSeconds===0` (:115-116);
  (c) historical `!isLast` fallback (:120-121); (d) in-place mutation: same `parts` array ref with a mutated
  reasoning part `.text`/`.state` updates the derivation (:29-31); (e) **`isLast` `true→false→true` handoff** asserting
  `tickedSeconds` never regresses below its frozen value (proves the :80 gate fix).

**Verification gate.** `bun typecheck` · `bun lint` · `bun test`; the render-count suite + fake-timer suite pass;
existing tests green. Panel is dormant (rendered nowhere yet) — no visual change.

**Revert.** Restore :107/:111 + `getReasoningContent`, remove the hook + threaded prop; inline rendering still drives
the body.

---

### PR4 — Layout sibling track at `width:0`

**Objective.** Add the flyout as a flex sibling of the scroll column at the layout seam, width
`--activity-panel-width`, `max-lg:w-0`, closed by default. Scroll machinery does NOT move. (GA §5 PR4, §7 R4/R5/R6/R9,
evidence layoutSeam.)

**Files touched.** `app/components/layout/layout-app.tsx` (sibling track), `app/components/chat/activity/activity-panel.tsx`
*(new)*, `app/components/chat/activity/docked-flyout-shell.tsx` *(new)*,
`app/components/chat/activity/panel-header.tsx` *(new)*. (Panel open state lives in `use-activity-panel.ts`; chat.tsx
gets a trigger only.)

**Current-state findings.** The flex row is `div.flex.h-svh.w-full.overflow-hidden` (layout-app.tsx:15); its current
children are optional `<AppSidebar />` (:16) and the `@container/main` scroll column (:17-24) containing ScrollRoot
(:18) → Header (:19) + `<main>` (:20-22). Insert the panel track AFTER the column's closing `</div>` (after :24) and
BEFORE the row's closing `</div>` (:25). chat.tsx's responsive rules are container-queries on `@container/main`
(chat.tsx:324, :339) — narrowing that column when the panel docks recomputes composer margins/width automatically.

**Change recipe per file.**

1. **`app/components/layout/layout-app.tsx`** (GA §7 R4, evidence layoutSeam): insert the NEW track as a sibling
   AFTER layout-app.tsx:24:
   ```tsx
   <div className="shrink-0 w-0 overflow-hidden border-l border-border bg-card transition-[width] lg:w-[var(--activity-panel-width)]">
     {/* ActivityPanel docked path renders here at lg+ */}
   </div>
   ```
   Because ScrollRoot (:18) and the sticky composer (chat.tsx:321-354) stay inside `@container/main`, NO scroll
   machinery moves (GA §7 R4). Opening changes only the conversation column **width**, never `ScrollRootContent`
   height / `--thread-bottom-offset` / `--spacing-input-area`.

2. **`app/components/chat/activity/activity-panel.tsx`** *(new, "use client")* — composition root (GA §B):
   Props: `{ open: boolean; onOpenChange: (o: boolean) => void; title?: string; phase: ReasoningPhase["phase"];
   durationSeconds?: number; steps: ToolUIPart[]; sources: SourceUrlUIPart[]; reasoningText: string;
   isReasoningStreaming: boolean; isOpaqueReasoning: boolean }`. Selects shell via **CSS only** (Tailwind `lg:` +
   `pointer-coarse`/`tall` custom variants globals.css:17-25) — never JS media queries (GA §7 R6; deterministic SSR).
   Both shells mount; the docked flyout stays mounted at `max-lg:w-0!` while the sheet renders (coexistence, GA §C2).
   Render the shared body (PanelHeader + PanelScrollBody → ActivityTimeline + SourcesGallery) into the **active**
   shell only (GA §7 R6 — favicons load once, `<img>` count == N not 2N). Gate the Sheet's `open` on the `<lg`
   media query so only one Dialog is ever truly open (GA §7 R5).

3. **`app/components/chat/activity/docked-flyout-shell.tsx`** *(new)* — in-flow `<section aria-label="Reasoning
   details">` (landmark, NOT dialog — GA §7 R9), `bg-card border-s border-border`, pinned to
   `--spacing-panel-header`, `width: var(--activity-panel-width, 400px)`, collapses to `w-0` below lg. **No
   backdrop, no focus trap, no scroll-lock, ESC inert** (GA §7 R9). Reuses `Button(ghost,icon-sm)` close
   (always visible) + `ScrollArea` body (`px-2 py-3` + trailing scroll spacer; evidence scroll-area changeRecipe —
   pass `viewportRef` for auto-scroll).

4. **`app/components/chat/activity/panel-header.tsx`** *(new)* — `PanelHeader` renders `TitleDurationCluster` +
   `CloseIconButton`.
   - `TitleDurationCluster` REUSES `<ReasoningLabel title="Activity" />` inside `<Reasoning phase=… durationSeconds=…
     opaque?>` to get the `title · duration` shimmer cluster (reasoning.tsx:183-206) and React-19 auto-open
     (reasoning.tsx:92-105) for free — no edit to reasoning.tsx (evidence reasoning changeRecipe).
   - `CloseIconButton` = `<Button variant="ghost" size="icon-sm" aria-label="Close"><Icon icon={RiCloseLine}
     slotSize={16} /></Button>` (button.tsx:17/31-32; icon via icon.tsx, currentColor — GA §4 row 22). No new file
     for the button itself.

**New files created.** `activity-panel.tsx`, `docked-flyout-shell.tsx`, `panel-header.tsx`.

**Tests to add.**
- **Layout test** (GA §7 R4): toggling the width var leaves `ScrollRootContent` height / `--thread-bottom-offset` /
  `--spacing-input-area` unchanged (computed-style assertions).
- **Stick-to-bottom integration** (GA §7 R4): last `data-scroll-anchor` (message-assistant.tsx:224) stays in view
  after opening at ≥lg on a long mid-stream conversation; fix on failure = capture `isAtBottom` before the width
  change, re-call `scrollToBottom("instant")` after.
- **Resize-crossing-lg test** (matchMedia mock, skeleton d; GA §7 R5/R9): `activeElement` never inside a
  `display:none` subtree; focus trapped only on the active sheet path; open state survives; **at most one** body
  scroll-lock owner after settle.
- **SSR/coexistence test** (GA §7 R6): no hydration-mismatch warning; exactly ONE Activity landmark in the a11y
  tree (inactive shell `aria-hidden`/out of tree); favicon `<img>` count `== N` not `2N`.
- **Two-path interaction test** (GA §7 R9): flyout lets focus return to the conversation, no scroll-lock, ESC inert;
  sheet traps focus, locks scroll, closes on ESC.
- **Reduced-motion test** (matchMedia `prefers-reduced-motion: reduce`, skeleton d; GA §7 R7): new animations
  suppressed, panel reaches final state instantly.
- First-in-repo matchMedia mock + `useBreakpoint` test (skeleton d; app/hooks/use-breakpoint.ts).

**Verification gate.** `bun typecheck` · `bun lint` · `bun test`; all the above pass. Visual/snapshot regression at
1024/768/375. Panel still dormant content-wise (inline body still renders) — only the docked track and breakpoint
coexistence are exercised.

**Revert.** Remove the sibling track; conversation reverts to full width with inline body intact.

---

### PR5 — The cutover (last, no dependents)

**Objective.** Remove inline reasoning + sources from the assistant body; wire the panel as the only path.
(GA §5 PR5.)

**Files touched.** `app/components/chat/message-assistant.tsx`, `app/components/chat/conversation.tsx`,
`app/components/chat/chat.tsx`, `app/components/chat/sources-list.tsx` (retire if now unused).

**Current-state findings.** message-assistant.tsx inline reasoning JSX :237-249, inline sources JSX :301; imports
Reasoning/ReasoningContent/ReasoningLabel :14-18, SourcesList :32. ThinkingBar pre-stream branch
conversation.tsx:156-171.

**Change recipe per file.**
1. **`message-assistant.tsx`**: REMOVE the reasoning JSX (:237-249) and the sources JSX (:301). Keep
   `getSources`/toolInvocationParts/persistedDurationMs computations only if still forwarded; otherwise move them
   fully into `use-activity-panel.ts`. Drop now-unused imports Reasoning/ReasoningContent/ReasoningLabel (:14-18) and
   SourcesList (:32) IF no longer referenced (evidence message-assistant changeRecipe).
2. **`conversation.tsx`**: fold the pre-stream ThinkingBar (:156-171) into the panel header (open-while-running,
   active-turn keyed) — GA §C9. If the panel subsumes the submitted state, handle `status==='submitted'`/last-is-user
   in `use-activity-panel.ts`; otherwise leave ThinkingBar and document the boundary.
3. **`chat.tsx`**: own panel open state + the trigger; render `<ActivityPanel {...useActivityPanel(...)} />` into the
   docked track (lg+) and the sheet (<lg). No structural change to the sticky composer (:321-354) or Conversation
   (:317).
4. **`sources-list.tsx`**: retire if message-assistant.tsx was its only consumer (it was, per evidence). Otherwise
   leave and mark.

**New files created.** None.

**Tests to add.** Streaming integration check: panel populates live reasoning/sources; header Thinking pre-stream;
duration parity vs the (pre-cutover) inline impl; coexistence holds on resize across lg. A grep over the integration
diff returns **no** flag usage (GA §5 PR5).

**Verification gate.** `bun typecheck` · `bun lint` · `bun test` (full suite incl. all activity tests) green — green
ONLY because PRs 1–4 proved every seam. Visual at all 3 breakpoints + dark-mode pass + a11y audit (GA §5 Step B
Verification).

**Revert.** `git revert` of PR5 alone restores inline rendering; PRs 1–4 remain green and harmless on `main`.

---

## 6. New component API appendix

| Component | Location | Props / CVA | Satisfies |
|-----------|----------|-------------|-----------|
| **ActivityPanel** | app/components/chat/activity/activity-panel.tsx ("use client") | `{ open; onOpenChange; title?="Activity"; phase; durationSeconds?; steps; sources; reasoningText; isReasoningStreaming; isOpaqueReasoning }`. CSS-only shell select (`lg:` + pointer-coarse/tall). No cva. | GA §B, §C1-2, §6.7, §7 R6 |
| **DockedFlyoutShell** | app/components/chat/activity/docked-flyout-shell.tsx | `{ open; onClose; children }`. `<section aria-label="Reasoning details">`, `bg-card border-s border-border`, `width: var(--activity-panel-width,400px)`, `max-lg:w-0`. No backdrop/trap/lock. | GA §A2, §7 R4/R9 |
| **ContentSheetShell** | app/components/chat/activity/content-sheet-shell.tsx ("use client") | `{ open; onOpenChange; title; children }`. Wraps `SheetContent` (side=bottom mobile / sm card), `rounded-t-2xl`/`sm:rounded-2xl sm:shadow-border-xl`, `overlayClassName` scrim, `[&>button]:max-sm:hidden`, aria-hidden handle `h-1 w-12`. | GA §A3-5, §6.2, §7 R2/R7 |
| **PanelHeader** | app/components/chat/activity/panel-header.tsx | `{ title; phase; durationSeconds?; onClose; isReasoningStreaming; isOpaqueReasoning }`. Renders TitleDurationCluster + CloseIconButton. | GA §B1 |
| **TitleDurationCluster** | inside panel-header.tsx (reuses reasoning.tsx) | reuses `<ReasoningLabel title="Activity" />` + `formatDuration` shimmer (reasoning.tsx:183-206). No reasoning.tsx edit. | GA §B2, §C7-8 |
| **CloseIconButton** | reuses button.tsx (no new file) | `<Button variant="ghost" size="icon-sm" aria-label="Close"><Icon RiCloseLine slotSize={16}/></Button>` | GA §B3 (exact), §4 row 22 |
| **PanelScrollBody** | inside each shell | flyout `ScrollArea px-2 py-3` + spacer; sheet `ScrollArea px-6 pb-4`, `aria-controls` target. `viewportRef` for auto-scroll. | GA §C1, §C6 |
| **ActivityTimeline** | app/components/chat/activity/activity-timeline.tsx ("use client") | `{ children; className? }`. Maps children injecting `isLast` (mirror chain-of-thought.tsx:148-166). `relative isolate`, ascending z-index. | GA §D2, §7 R6 |
| **ActivityStep** | activity-timeline.tsx | `{ children; isLast?; leading?; body?; className? }` & cva. Non-collapsible. `group data-last`. | GA §D3 |
| **StepLeadingIndicator** | activity-timeline.tsx | `stepVariants` cva `{ leading: {globe,bullet,done}, body: {chips,description} }`, `defaultVariants {leading:"bullet", body:"description"}`. Icon via icon.tsx slotSize=16, currentColor. Connector `bg-primary/20 ml-1.75 w-px` hidden on `group-data-[last=true]`. | GA §D4, §6.6, §4 rows 19-21 |
| **SourceChip** | reuses badge.tsx `source` variant (already present) | `<Badge variant="source" size="md" render={<a target="_blank" rel="noopener noreferrer">}>` + leading `<Favicon>`. `rounded-full h-[25px] px-3 text-xs`, hover-invert 150ms. s2 `sz=64`. | GA §D8, §C13, §4 rows 10-14 |
| **OverflowChip** | app/components/chat/activity/source-chip-group.tsx | `<button>` (keyboard, name `{n} more`), chip skin, up to 3 `Favicon overlap` (`-ms-3/first:-ms-1`, `ring-2 ring-card`, `group-hover:border-foreground`). | GA §D9, §C11-12 |
| **SourceChipGroup** | app/components/chat/activity/source-chip-group.tsx *(new)* | ONE flex-wrap row (chips + OverflowChip). Reserved-empty first row DROPPED (GA §6.3). | GA §D7, §6.3 |
| **Favicon (extended)** | components/ui/favicon.tsx | additive `loading?` / `decoding?` forwarded through AvatarImage (:72). `overlap` ring variant exists. | GA §D10, §7 R8 |
| **PanelSectionHeading** | app/components/chat/activity/panel-section-heading.tsx *(new)* | `{ title; trailing?; className? }`. Plain div, `text-muted-foreground font-medium`, truncating title + trailing `· N`. | GA §D1, §4 row 32 |
| **SourcesGallery / SourcesGalleryItem** | components/ui/source.tsx (additive siblings) | Gallery: `{ sources; count?; groups? }` → ONE `ul` + PanelSectionHeading "Sources". Item: `{ href; title; siteName?; description?; faviconDomain? }`, full-bleed `<a rel="noopener">`, internal `<img>` `sz=32` ORIGIN `loading=lazy decoding=async`. | GA §6.1, §7 R8 |

---

## 7. Token additions (exact globals.css edits)

All additive; preserve the dual light/dark discipline. **Literal values follow GA (the source of truth): `--activity-panel-width: 25rem` (§6.4, ≈400px observed), `--spacing-panel-header: 56px` (§4 row 25), scrim `0.30`/`0.50` (§4 rows 23–24)** — these supersede the evidence reader's placeholder numbers (22rem, 0.10/0.40). Note `--thread-bottom-offset` is a LOCAL var on `ScrollRootContent` (`conversation.tsx:94`), not a globals.css token — do not add it here.

1. **`--activity-panel-width: 25rem;`** — inside the FIRST `@theme {…}` block immediately after globals.css:52
   (next to `--spacing-app-header`/`--spacing-input-area`). Consume as `width: var(--activity-panel-width, 400px)`.
   (GA §6.4, §4 row 26)
2. **`--spacing-panel-header: 56px;`** — same `@theme` spacing cluster. Flyout pins 56px for byte-fidelity
   (GA §4 row 25).
3. **`--overlay-scrim`** (diverge light/dark, GA §4 rows 9/23/24): in `:root` near :422-425
   `--overlay-scrim: oklch(0 0 0 / 0.30);`; in `.dark` near :507-510 `--overlay-scrim: oklch(0 0 0 / 0.50);`.
   Optional bridge in `@theme inline` (:268-319): `--color-overlay-scrim: var(--overlay-scrim);` → `bg-overlay-scrim`.
4. **`show` keyframe** (token-driven, matches `--animate-collapsible-*` at :53-54): inside the first `@theme` block
   add `@keyframes show { from { opacity: 0; transform: translateX(0.5rem); } to { opacity: 1; transform: translateX(0); } }`
   and `--animate-show: show 200ms ease-out;`. Every consumer carries a `motion-reduce:` variant (GA §7 R7).

NO existing token is edited. Per GA §6.5/§6.6: do NOT add `--muted-foreground-subtle` or `--border-strong`.

---

## 8. Test → residual matrix

| Residual / case | Test that proves it pre-merge | PR | file:line anchor |
|-----------------|-------------------------------|----|------------------|
| **R1** isLast bounce zeros counter | use-reasoning-phase.test.tsx case (e): `true→false→true`, `tickedSeconds` never regresses; fix gates :80 on `prevPhase!=="thinking"` | PR3 | use-reasoning-phase.ts:78-83 |
| **R2** sheet mutation / overlay bleed | sheet.test.tsx default-equivalence snapshot (overlay class byte-identical w/o `overlayClassName`); 2-consumer green tests; single-caller grep gate; fix-overlay-bleedthrough opaque surface | PR2 | sheet.tsx:40, :60 |
| **R3** memo body churn | message.test.tsx Test1 (reasoning+source delta → no body re-render), Test2 (text delta → re-render), Test3 (tool-state → re-render) + no-output-read-without-state assertion | PR3 | message.tsx:107, :111, :67-76 |
| **R4** layout/scroll move | layout computed-style test (width var toggle leaves height/`--thread-bottom-offset`/`--spacing-input-area` unchanged); stick-to-bottom anchor-in-view at ≥lg | PR4 | layout-app.tsx:18, chat.tsx:324 |
| **R5** focus/scroll-lock across lg swap | resize-crossing-lg matchMedia test: activeElement never in display:none; trap only active path; ≤1 scroll-lock owner | PR4 | (use-activity-panel open state) |
| **R6** SSR duplicate DOM | SSR test: no hydration warning; exactly 1 Activity landmark; favicon `<img>` count == N | PR4 / PR1 | globals.css:17-25 |
| **R7** reduced-motion | reduced-motion matchMedia snapshot: new animations suppressed, instant final state | PR4 | globals.css:5, --animate-show |
| **R8** 141-favicon perf | SourcesGallery test: `loading=lazy`+`decoding=async` on every `<img>`, count == N | PR1 | source.tsx, favicon.tsx:72 |
| **R9** trap vs non-trap divergence | two-path interaction test: flyout focus returns/no-lock/ESC-inert; sheet traps/locks/ESC-closes | PR4 | sheet.tsx:6 |
| **§6.7C** duration freeze | use-reasoning-phase.test.tsx case (a): freeze at 5s on cleanup | PR3 | use-reasoning-phase.ts:96-106 |
| **§6.7C** persisted fallback (complete, no ticks) | case (b): `isLast && complete && tickedSeconds===0` → persisted | PR3 | use-reasoning-phase.ts:115-116 |
| **§6.7C** historical fallback | case (c): `!isLast` → persisted | PR3 | use-reasoning-phase.ts:120-121 |
| **§6.7 / R1** in-place mutation derivation | case (d): same parts ref, mutated `.text`/`.state` updates | PR3 | use-reasoning-phase.ts:28-31 |
| **§6.7D** regenerate handoff | case (e) (shared with R1): timer resets new turn, freezes old | PR3 | use-reasoning-phase.ts:78-83 |
| **R-rollback** | CI green on every PR; grep over integration diff returns no flag usage | all | — |

---

## 9. Open risks / sequencing notes

1. **Branch-switch (§6.7E) has no dedicated automated test in the matrix** *(inferred)*. The fake-timer suite covers
   regenerate (D) and the C2 divergence path is structurally guaranteed by `projectSelectedPath` returning serverPath
   on divergence (selected-path.ts:171-180), but an explicit "select a different branch → `activeTurnId` recomputes
   from the new tail → panel shows that turn's persisted state, no live timer" test would need a chat-store harness
   that does not exist yet. Decide in PR3 whether to add a `projectSelectedPath` unit test asserting tail identity
   across a simulated branch switch, or accept the structural guarantee. Lean toward the unit test — it is cheap.

2. **ThinkingBar fold-in boundary (§C9, PR5)** *(inferred)*. Whether the panel fully subsumes the
   `status==='submitted'`/last-is-user pre-stream state (conversation.tsx:156-171) or ThinkingBar stays as a separate
   affordance is a genuine product/UX judgment the static reference can't settle. The plan defaults to folding it
   into the header (open-while-running); if `use-activity-panel.ts` cannot cleanly own the submitted state (no
   assistant message exists yet to key `activeTurnId`), keep ThinkingBar and document the seam rather than forcing it.

3. **Coexistence vs portal duplication (§7 R6) — the CSS-only `display:contents` fallback is unproven** *(inferred)*.
   The plan selects shells via CSS and renders content into the active shell only, but if Base UI's Sheet portal
   forces the sheet subtree to mount even at ≥lg, favicons could double. The R6 test catches it (count==N), but the
   prescribed fix (gate the inactive subtree with `@media display:contents`) interacts with Base UI's own portal/
   focus-trap and may need the dev's judgment — possibly gating the Sheet's `open` prop on the `<lg` media query
   (already required by R5) is sufficient and the `display:contents` gate is unnecessary. Validate empirically in PR4
   before adding the extra CSS.
