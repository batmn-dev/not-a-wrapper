---
created_at: 2026-06-24T22:08:03Z
confidence_legend: exact | strong | inferred | unknown
audience: senior engineer executing the build
source_of_truth: docs/activity-panel-gap-analysis.md (decisions §6.1–6.7, residuals §7, Step A/B, original PR1→PR5 spine §5 now executed as commits 1→5 in one PR); /Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/** for ChatGPT reference/inspiration source material
---

# Activity Panel — Implementation Plan

This is the execution-ready runbook for the responsive ChatGPT-style **Activity** panel. It operationalizes
`docs/activity-panel-gap-analysis.md` (the gap analysis; cited below as **GA §**). Every concrete instruction
cites both the GA section AND the target `file:line`. When the GA and this plan disagree, the GA wins — flag it.

**Reference source material.** This plan was based on repo-local ChatGPT reference captures in the adjacent
`/Users/andresgonzalez/Github/Projects/reference-ui` workspace. Treat those files as **reference/inspiration and
evidence**, not as code to copy blindly: target implementation still follows not-a-wrapper primitives, tokens, and
product patterns. When an implementation step lacks visual/source context, load these before inventing behavior:

| Need | Load |
| --- | --- |
| ChatGPT reference index and routing notes | `/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/README.md` |
| CSS capture load order and provenance | `/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/css/README.md` |
| Activity panel CSS/tokens/breakpoints | `/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/css/conversation-with-activity-panel.md` |
| Activity panel component inventory and shell/content split | `/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/research/activity-panel-component-inventory.md` |
| Desktop docked flyout HTML capture | `/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/pages/conversation-with-activity-panel.md` |
| Tablet centered-card HTML capture | `/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/pages/conversation-with-activity-panel-tablet-820px-light.md` |
| Mobile bottom-sheet HTML capture | `/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/pages/conversation-with-activity-panel-mobile-592px-light.md` |

Use those reference-ui markdowns for source material such as stable selectors, visual recipes, token values,
breakpoint behavior, shell/content decomposition, and known gaps. Do not rely on brittle ChatGPT implementation
details (`data-silk`, generated ids, hashed classes, sprite ids) except as capture evidence already interpreted in
the markdowns.

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
> `title` slot (`:164-185`), and the `sources-list.tsx` → `Favicon` refactor all landed. **Commit 1 below is therefore
> reduced to the panel-specific remainder** — globals.css panel tokens + `show` keyframe, the `Favicon`
> `loading`/`decoding` forwarding, the `SourcesGalleryItem` row, the app-level `SourcesGallery`, `SourceChipGroup`,
> and the new `activity/*` leaf components. Do **not** re-create the Step A primitives; only extend `favicon.tsx`
> additively. Commits 2–5 are unaffected.

Final composition (location in parens):

```
ActivityPanelHostProvider              (app/components/chat/activity/activity-panel-host.tsx, "use client")
├─ LayoutApp dock slot                 (app/components/layout/layout-app.tsx)
│   └─ ActivityPanel docked shell       (registered by Chat through the host)
└─ Chat owns state + sheet shell        (app/components/chat/chat.tsx)

ActivityPanel                         (app/components/chat/activity/activity-panel.tsx, "use client")
├─ DockedFlyoutShell  (≥lg)           (app/components/chat/activity/docked-flyout-shell.tsx)
│   └─ <section aria-label> + Button(ghost,icon-sm) + ScrollArea
├─ ContentSheetShell  (<lg)           (app/components/chat/activity/content-sheet-shell.tsx)
│   └─ Sheet/SheetContent(side=bottom|card) + DragHandle + max-sm:hidden close + ScrollArea
└─ (shared body, rendered into the ACTIVE shell only)
    ├─ PanelHeader                    (app/components/chat/activity/panel-header.tsx)
    │   ├─ TitleDurationCluster       (plain cluster; reuse/export only formatDuration, not Reasoning shell state)
    │   └─ CloseIconButton            (button.tsx Button ghost icon-sm — no new file)
    └─ PanelScrollBody
        ├─ ActivityTimeline           (app/components/chat/activity/activity-timeline.tsx)
        │   └─ ActivityStep…          (StepLeadingIndicator + StepTitle + SourceChipGroup|Markdown)
        │       └─ SourceChipGroup     (app/components/chat/activity/source-chip-group.tsx)
        └─ SourcesGallery             (app/components/chat/activity/sources-gallery.tsx)
            └─ SourcesGalleryItem      (components/ui/source.tsx)
            └─ PanelSectionHeading    (app/components/chat/activity/panel-section-heading.tsx)
```

Data flow: `Chat` calls `useActivityPanel({ messages, status, isSubmitting })` **once** after `useChatCore` returns the
already-projected message array. The hook derives `activeTurnId` from the last assistant message in that projected
array, calls `useReasoningPhase` for that active turn only, and returns `{ activeTurnId, panelProps }`. `Conversation`
receives `activeTurnId` only so memoized messages/trigger affordances re-render on branch switches; individual
`MessageAssistant` instances do **not** own the panel hook.

**The one-PR / five-commit sequence** (GA §5, §7 R-rollback) — one branch and one final PR, with each commit
kept locally green and independently understandable. Cutover stays last:

| Commit | Objective | If it breaks before merge |
|----|-----------|-----------|
| **1** | Additive leaves + tokens (dormant). **Step A leaves already shipped (commit `9040090`);** commit 1 remainder = globals.css panel tokens/keyframe, `Favicon` loading/decoding forwarding, `SourcesGalleryItem`, app-level `SourcesGallery`, `SourceChipGroup`, new `activity/*` leaf components. | amend/revert this commit; dead code only |
| **2** | Compose `content-sheet-shell.tsx` over the **unchanged** Sheet; sole sheet edit = additive `overlayClassName?`. | amend/revert this commit; shell + optional prop removed, 2 sidebars untouched |
| **3** | Hoist panel state behind one chat-level `use-activity-panel.ts` (active-turn selector) + flip `message.tsx` memo contract. Inline body still renders. | amend/revert this commit; restores `:107`/`:111`, removes hook |
| **4** | Add the LayoutApp dock slot + host registration seam; render panel shell/content with the track collapsed below lg. | amend/revert this commit; removes host/track, full-width conversation |
| **5** | **Cutover** — remove inline reasoning/sources from the body; add the explicit Activity trigger as the only reopen path. | amend/revert this commit; commits 1–4 remain green |

---

## 2. Global guardrails (hold on EVERY commit)

1. **NO feature flags / NO dual-path toggle / NO runtime kill switch / NO prod diffing.** The cutover is clean
   (GA §5 risk preamble, §6 intro). Confidence comes only from pre-merge proof (typecheck/lint/test) and the
   small independently-revertable commit sequence inside one PR.
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
   are server-safe today — keep them that way. `activity-panel-host.tsx`, `activity-panel.tsx`,
   `use-activity-panel.ts`, `content-sheet-shell.tsx`, and `activity-panel-trigger.tsx` are client (context, Sheet,
   open/reopen interaction, and the timer).
6. **CVA + cn idiom** mirroring `components/ui/button.tsx:7-41` (cva base + `variants` + `defaultVariants`,
   merged via `cn(...)`). New variants MUST leave existing `defaultVariants` byte-identical so current call sites
   are unchanged (GA Step A; badge.tsx already follows this).
7. **Every new animation utility carries a `motion-reduce:` variant** (GA §7 R7; tw-animate-css imported at
   globals.css:5). No `prefers-reduced-motion` precedent exists in the repo — this is a new, required pattern.
8. **Verification gate per commit:** run the commit-specific targeted tests with `bun run test -- <file...>`, then
   `bun run typecheck` and `bun run lint` before moving to the next commit. Run the full local `bun run test` before
   opening the PR, because CI currently enforces lint/typecheck and the schema contract test but not the full Vitest
   suite. The final PR description should summarize the commit-by-commit proof bundle rather than describing separate
   PRs.

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
| Panel title/duration formatting | Export `formatDuration` additively if the panel header needs duration text. Do **not** render `Reasoning` / `ReasoningLabel` inside the panel header; those own disclosure/auto-open state for inline reasoning. | reasoning.tsx:55-60 / 183-206 |
| React-19 render-sync auto-open | preserve verbatim — do NOT revert to useEffect (@upgradeNotes) | reasoning.tsx:92-105 |
| `getSources(parts)` | pure; REUSE as-is to populate `sources` | get-sources.ts:23 ; called message-assistant.tsx:102 |
| `useReasoningPhase` call | move into use-activity-panel.ts (preferred) | message-assistant.tsx:127-138 |
| toolInvocationParts (steps) | `parts.filter(isStaticToolUIPart)` | message-assistant.tsx:108-110 |
| persistedDurationMs read | `metadata.reasoningDurationMs` (ms) | message-assistant.tsx:122-126 |
| Inline reasoning JSX (cutover removes) | commit 5 | message-assistant.tsx:237-249 |
| Inline sources JSX (cutover removes) | commit 5 | message-assistant.tsx:301 |
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

**One panel, one owner, keyed off the rendered selected path.** This is the linchpin of the flag-free cutover.

- **(A) Ownership.** Owner = the **last assistant message in the already-projected selected path**. `useChatCore`
  already calls `projectSelectedPath(live, serverPath)` while idle (use-chat-core.ts:451-496), so `Chat` should pass the
  rendered `messages` array into `useActivityPanel` rather than recomputing projection in a second place. Key off that
  assistant message's `id` (`activeTurnId`), NOT per-message positional `isLast` (GA §6.7A). There is no explicit tail
  accessor — scan from the end for `role === 'assistant'`:
  ```ts
  let tail
  for (let i = messages.length - 1; i >= 0; i--) { if (messages[i].role === "assistant") { tail = messages[i]; break } }
  const activeTurnId = tail?.id
  ```
  Cross-key with `getServerMessageId(tail.metadata)` when the optimistic id hasn't anchored (mirror
  selected-path.ts:110-119).
- **(B) active-turn-aware `isLast`.** `useActivityPanel` runs once for `tail`, computes
  `isActiveTurn = activeTurnId !== undefined && (tail.id === activeTurnId || getServerMessageId(tail.metadata) === activeTurnId)`,
  and passes that as `useReasoningPhase`'s `isLast`. The live timer runs only for the selected tail while it is thinking
  (GA §6.7B, use-reasoning-phase.ts:75). Individual `MessageAssistant` instances never call `useActivityPanel`; they
  receive only the optional `activeTurnId` prop so memoization and the cutover trigger update on branch changes.
- **(C) Duration freeze.** Active streaming turn → live wall-clock (`setInterval`→`tickedSeconds`); on `phase`
  leaving `"thinking"` cleanup freezes the final value (use-reasoning-phase.ts:96-106). Completed/non-active turn →
  persisted `metadata.reasoningDurationMs` rounded to seconds via the existing ladder (:110-124). No re-keying of
  `tickedSeconds`, no memoizing the derivation (GA §7 R1).
- **(D) Regenerate.** New assistant sibling becomes the path tail; `activeTurnId` moves to the new id, its timer
  resets to 0 (render-sync reset :78-83) and runs live; the superseded sibling freezes to persisted (GA §6.7D).
- **(E) Branch switch.** `selectMessageBranch → useChatCore → projectSelectedPath` re-projects; `activeTurnId`
  recomputes from the new rendered tail; panel instantly shows that turn's persisted state (no live timer unless that
  tail still streams) (GA §6.7E).
- **(F) C2 count-drift tolerance.** `activeTurnId` is computed against the **server-selected path** via
  `projectSelectedPath`, never the optimistic count. On divergence `projectSelectedPath` returns the server path
  (selected-path.ts:171-180), so the panel may momentarily show the server's last-selected turn. **Correct and
  tolerated** — it self-heals at convergence (GA §6.7F).

**R1 residual fix (must land in commit 3):** a same-id `isLast` `true→false→true` bounce during regenerate could zero the
counter mid-stream. Gate the render-sync reset (use-reasoning-phase.ts:80) on `prevPhase !== "thinking"` so a bounce
that stays in `thinking` does not reset (GA §7 R1).

---

## 5. Commit-by-commit runbook

> New component prop/CVA APIs are given in full **the first time the component appears**; §6 is the consolidated
> appendix. Tests are house-style: vitest, manual `createRoot`+`act` (no testing-library), jsdom via the
> `/** @vitest-environment jsdom */` line-1 pragma, or `renderToStaticMarkup` for string-markup leaves.

### Commit 1 — Additive leaf primitives + tokens (dormant)

**Objective.** Land the **remaining** additive, default-preserving primitives + tokens with **zero** behavioral
change, nothing wired into the conversation. (GA §5 PR1, now commit 1.) **Step A already shipped (commit `9040090`):**
`favicon.tsx`, the badge `source` variant + sizes, the chain-of-thought `leading` markers, the `reasoning.tsx`
`title` slot, and the `sources-list.tsx` → `Favicon` refactor — **do not redo these.** What remains in commit 1 is below.

**Files touched (exact).**
- `app/globals.css` (panel tokens + `show` keyframe)
- `components/ui/favicon.tsx` (additive `loading`/`decoding` forward — the file already exists from Step A)
- `components/ui/source.tsx` (new `SourcesGalleryItem` export only; keep `Source*` byte-identical)
- `app/components/chat/activity/activity-timeline.tsx` *(new)*
- `app/components/chat/activity/panel-section-heading.tsx` *(new)*
- `app/components/chat/activity/source-chip-group.tsx` *(new)*
- `app/components/chat/activity/sources-gallery.tsx` *(new)*

**Already shipped in Step A (commit `9040090`) — do NOT touch/re-add:** `components/ui/favicon.tsx` (the component),
`badge.tsx` `source` variant + sizes (`:21`), `chain-of-thought.tsx` `leading` markers (`:18-30`), `reasoning.tsx`
`title` slot (`:164-185`), `sources-list.tsx` → `Favicon` refactor.

**Current-state findings.** badge.tsx:21-22 already has the `source` variant and badge.tsx:24-33 the `default/sm/md`
size axis with unchanged `defaultVariants` — **no edit needed** (GA §2 D8 / evidence). favicon.tsx AvatarImage
forwards only src/alt/className (favicon.tsx:72), FaviconProps lacks loading/decoding (favicon.tsx:44-49).
chain-of-thought.tsx isLast/connector pattern lives at :148-166 (mapper) and :187-189 (Step connector) — **mirror,
do not edit** that file.

**Reference-ui context to load if source detail is needed.** For tokens, chip metrics, favicon sizing, `show`
animation, and the `Sources · N` gallery, start with
`/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/css/conversation-with-activity-panel.md` and
`/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/research/activity-panel-component-inventory.md`.

**Change recipe per file.**

1. **`app/globals.css`** (GA §5 PR1 / commit 1, GA token map rows 9/26/33, evidence "tokensToAdd"):
   - Add layout width token inside the FIRST `@theme {…}` block, immediately after globals.css:52:
     `--activity-panel-width: 25rem;` (GA §6.4 — 25rem = 400px; consume as
     `width: var(--activity-panel-width, 400px)`).
   - Add `--spacing-panel-header: 56px;` in the same `@theme` spacing cluster (GA §4 row 25; the flyout pins 56px
     for byte-fidelity rather than reusing `--spacing-app-header`'s 52px).
   - Add scrim color tokens to BOTH blocks (GA §4 rows 9/23/24): in `:root` near :422-425
     `--overlay-scrim-mobile: oklch(0 0 0 / 0.30);` and
     `--overlay-scrim-tablet: oklch(0.92 0.004 286 / 0.50);`; in `.dark` near :507-510
     `--overlay-scrim-mobile: oklch(0 0 0 / 0.30);` and
     `--overlay-scrim-tablet: oklch(0 0 0 / 0.50);`. Use arbitrary-value utilities
     `bg-[var(--overlay-scrim-mobile)] sm:bg-[var(--overlay-scrim-tablet)]`; do not add a single ambiguous
     `bg-overlay-scrim` token.
   - Add the `show` keyframe consistent with existing keyframes. Prefer token-driven (matches
     `--animate-collapsible-*` at :53-54): inside the first `@theme` block add
     `@keyframes show { from { opacity: 0; transform: translateX(0.5rem); } to { opacity: 1; transform: translateX(0); } }`
     and `--animate-show: show 200ms ease-out;`.
   - NOTE: `--thread-bottom-offset` is NOT a globals.css token — it is a LOCAL CSS var set inline on `ScrollRootContent` (`conversation.tsx:94`: `[--thread-bottom-offset:calc(var(--spacing-input-area)+2rem+env(safe-area-inset-bottom,0px))]`). Do NOT add it to globals.css; the commit 4 layout test asserts it stays unchanged.

2. **`components/ui/favicon.tsx`** (GA §7 R8, evidence changeRecipe): purely additive forward of native img attrs.
   - Extend FaviconProps (:44-49) with optional `loading?: "lazy" | "eager"` and
     `decoding?: "async" | "sync" | "auto"`.
   - Destructure them in the Favicon signature (:58-64).
   - Pass through: `<AvatarImage src={src} alt={alt} loading={loading} decoding={decoding} className={radius} />`
     (:72). Defaults stay undefined; call sites pass `loading="lazy" decoding="async"`. `defaultVariants` untouched.

3. **`components/ui/source.tsx`** — add `SourcesGalleryItem` only (GA §6.1, evidence galleryRowSpec).
   KEEP `Source`/`SourceTrigger`/`SourceContent` (:44-160) **byte-identical**. New siblings in the file's idiom
   (Tailwind + cn, no testids, preserve the `eslint-disable` for raw `<img>` from :101).
   - `SourcesGalleryItem` — a single full-bleed anchor, **no HoverCard**. Export a companion
     `SourcesGalleryItemProps` type for app-level gallery data:
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
   - DO NOT add `SourcesGallery` here. The gallery needs `PanelSectionHeading`, so it lives in
     `app/components/chat/activity/sources-gallery.tsx` to preserve the `components/ui` → app dependency boundary.

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

6. **`app/components/chat/activity/source-chip-group.tsx`** *(new)* — source chips + overflow chip (GA §6.3, D7-D9):
   - `SourceChip` wraps the already-shipped `<Badge variant="source" size="md" render={<a ... />}>` pattern, uses
     `rel="noopener noreferrer"`, a leading `<Favicon loading="lazy" decoding="async">`, `max-w-full overflow-hidden`,
     and the existing hover-invert token utilities. Do not introduce another badge variant.
   - `OverflowChip` is a real `<button type="button">` with accessible name `{n} more`; it shares the chip skin and
     renders up to 3 overlapping decorative favicons. The click can be a no-op until commit 5 wires expansion behavior,
     but keyboard activation and focus styling must be correct now.
   - `SourceChipGroup` renders ONE flex-wrap row. Keep the reserved-empty first row dropped per GA §6.3.

7. **`app/components/chat/activity/sources-gallery.tsx`** *(new)* — app-level gallery composition (GA §6.1):
   props `sources: SourcesGalleryItemProps[]`, `count?: number` (default `sources.length`). Render ONE `ul` with
   `PanelSectionHeading title="Sources" trailing={<>· {count}</>}` and `<SourcesGalleryItem>` rows. Do not add `groups`
   until real grouped source data exists. DO NOT route rows through `Source`/`SourceTrigger`/`SourceContent`.

**New files created.** `app/components/chat/activity/activity-timeline.tsx`,
`app/components/chat/activity/panel-section-heading.tsx`, `app/components/chat/activity/source-chip-group.tsx`,
`app/components/chat/activity/sources-gallery.tsx`. (`SourcesGalleryItem` is in source.tsx.)

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
- `app/components/chat/activity/sources-gallery.test.tsx` — **the 141-source R8 test**
  (GA §7 R8, evidence galleryRowSpec):
  ```tsx
  /** @vitest-environment jsdom */
  import React, { act } from "react"
  import { createRoot, type Root } from "react-dom/client"
  import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
  import { SourcesGallery } from "./sources-gallery"

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

**Verification gate.** `bun run test -- app/components/chat/activity/activity-timeline.test.tsx app/components/chat/activity/sources-gallery.test.tsx`
plus `bun run typecheck` and `bun run lint`. Existing `message.test.tsx` / `conversation.test.tsx` /
`tool-invocation.test.tsx` should remain unaffected. Visual: inline thread is pixel-identical to `main` in light AND
dark (new exports are unreferenced).

**Revert.** Drops dead code + additive tokens only; existing `Source*`/`Favicon` exports byte-identical.

---

### Commit 2 — Compose `content-sheet-shell.tsx` over the unchanged Sheet

**Objective.** Build the `<lg` shell entirely through the existing Sheet public API; the ONLY sheet edit is the
additive `overlayClassName?`. (GA §5 PR2, now commit 2; §7 R2.)

**Files touched.** `components/ui/sheet.tsx` (one additive prop), `app/components/chat/activity/content-sheet-shell.tsx`
*(new)*.

**Current-state findings.** `sheet.tsx` has NO cva and NO `defaultVariants` — every part is `cn(base, className)`
(GA §7 R2; sheet.tsx:48-89). `SheetContent` renders `<SheetOverlay />` with no className passthrough (sheet.tsx:60);
`SheetOverlay` is internal-only (not in the export block sheet.tsx:134-143). The overlay base class to preserve is
sheet.tsx:40. Sheet IS Base UI Dialog (sheet.tsx:6) — provides focus trap/scroll-lock/ESC. Drag-handle styling
precedent: drawer.tsx:83. `showCloseButton={false}` precedent: `app/components/layout/sidebar/app-sidebar.tsx:233`; `[&>button]:hidden` className
gate precedent: `components/ui/sidebar.tsx:213`.

**Reference-ui context to load if source detail is needed.** For the ChatGPT card-vs-sheet shell, backdrop, drag
handle, radius, and close-button visibility, load
`/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/css/conversation-with-activity-panel.md`, then compare
against the tablet and mobile captures:
`/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/pages/conversation-with-activity-panel-tablet-820px-light.md`
and `/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/pages/conversation-with-activity-panel-mobile-592px-light.md`.

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
     `overlayClassName="bg-[var(--overlay-scrim-mobile)] sm:bg-[var(--overlay-scrim-tablet)] sm:backdrop-blur-[1px] sm:transition-opacity sm:duration-[250ms] sm:data-starting-style:opacity-0 motion-reduce:transition-none"`
     (mobile black/30 instant, tablet gray/50 fade in light mode, tablet black/50 fade in dark mode; GA §C3, §6.2, §7 R7).
   - `SheetTitle` = the `aria-labelledby` accessible name (GA §C7, §B1).
   - Enter/exit timing (GA §6.2): `data-starting-style`/`data-ending-style` on `SheetContent className` →
     enter 250ms `cubic-bezier(0.32,0.72,0,1)`, exit 200ms, all `motion-reduce`-gated.

**New files created.** `app/components/chat/activity/content-sheet-shell.tsx`.

**Tests to add.**
- `components/ui/sheet.test.tsx` *(new)* — **default-equivalence snapshot** (GA §5 PR2 / commit 2): render `SheetContent`
  WITHOUT `overlayClassName`, assert the `[data-slot="sheet-overlay"]` element's `className` is byte-identical to the
  sheet.tsx:40 base string. (createRoot+act, jsdom.)
- Per-consumer green tests for the **exactly two** consumers (`components/ui/sidebar.tsx:207-227`, `app/components/layout/sidebar/app-sidebar.tsx:227-247`):
  assert unchanged content/backdrop/focus-trap/ESC. (May be light — assert the overlay class is unchanged and the
  Sheet still mounts.)
- **Grep gate** (CI or a test asserting): `content-sheet-shell.tsx` is the ONLY caller passing `overlayClassName`:
  `grep -rn "overlayClassName" app components | grep -v "sheet.tsx" | grep -v "content-sheet-shell.tsx"` returns empty.

**Verification gate.** `bun run test -- components/ui/sheet.test.tsx` plus the narrow sidebar consumer tests added or
extended for this commit, then `bun run typecheck` and `bun run lint`. Default-equivalence snapshot passes; both sidebars
green; grep gate empty. Per GA §7 R2 residual, apply `fix-overlay-bleedthrough` discipline — keep the flyout/card
surface opaque (`bg-card`/`bg-popover`), do NOT retint the primitive.

**Revert.** Remove the shell + the optional prop; the two sidebars are untouched by construction.

---

### Commit 3 — Panel state hoist + body-memo contract

**Objective.** Add one chat-level `use-activity-panel.ts` deriving `activeTurnId` from the already-rendered selected
path and feeding `{phase, steps, sources, durationSeconds}`; flip the `message.tsx` memo so reasoning/source deltas no
longer churn the body. Panel state exists **alongside** the still-inline body (dormant until commit 5). (GA §5 PR3, now
commit 3; §6.7, §7 R1/R3.)

**Files touched.** `app/components/chat/use-activity-panel.ts` *(new)*, `app/components/chat/chat.tsx`,
`app/components/chat/conversation.tsx`, `app/components/chat/message.tsx`, `app/components/chat/message-assistant.tsx`,
`app/components/chat/use-reasoning-phase.ts` (R1 reset gate).

**Current-state findings.** See §3. Key: message.tsx:107 short-circuit is the dominant streaming driver (NOT :111);
`getReasoningContent` :58-65 / :111 to delete; `getTextContent`/`getToolSignature` :54-56/:67-76 keep;
use-reasoning-phase.ts:75-124 timer/ladder; selected-path.ts:171-180 tail; conversation.tsx:101-102 positional
fallback.

**Reference-ui context to load if source detail is needed.** The hoist/memo work is target-app behavior first, but
the panel ownership model should preserve the reference's single active Activity surface. For source context on that
single-shell-plus-shared-body model, use
`/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/research/activity-panel-component-inventory.md`.

**Change recipe per file.**

1. **`app/components/chat/use-activity-panel.ts`** *(new, "use client")* — chat-owned state selector:
   ```ts
   export function useActivityPanel({ messages, status, isSubmitting }: {
     messages: UIMessage[]
     status: "streaming" | "ready" | "submitted" | "error"
     isSubmitting: boolean
   }): {
     activeTurnId: string | undefined
     isGenerationActive: boolean
     panelProps: {
       phase: ReasoningPhase["phase"]; steps: ToolUIPart[]; sources: SourceUrlUIPart[]
       durationSeconds: number | undefined
       reasoningText: string; isReasoningStreaming: boolean; isOpaqueReasoning: boolean
     }
   }
   ```
   Body: (1) scan `messages` from the end for the last `role === "assistant"` message; do not recompute
   `projectSelectedPath` here. (2) `activeTurnId = tail?.id`; use `getServerMessageId(tail.metadata as
   ChatMessageMetadata | undefined)` only as a cross-key when comparing optimistic/server ids. (3)
   `persistedDurationMs` exactly as message-assistant.tsx:122-126. (4)
   `useReasoningPhase({ parts: tail?.parts, status, isLast: Boolean(tail), persistedDurationMs })`; the hook is called
   once for the selected tail, so `isLast` now means "panel-active turn", not positional per-message rendering. (5)
   `sources = getSources(tail?.parts || [])` (get-sources.ts). (6)
   `steps = tail?.parts?.filter((p): p is ToolUIPart => isStaticToolUIPart(p)) ?? []` (from `ai`, like
   message-assistant.tsx:108-110). (7) return `isGenerationActive = isSubmitting || status === "submitted" ||
   status === "streaming"`. **Keep the hook derivations un-memoized by `parts` — AI SDK can mutate part objects in
   place** (GA §7 R1).

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

4. **Thread `activeTurnId` (additive, backward-compatible).** `chat.tsx` calls
   `useActivityPanel({ messages, status, isSubmitting })` once after `useChatCore`, stores `panelProps` for commit 4/5,
   and passes only `activeTurnId` to `Conversation`. `Conversation` forwards it to `Message`; `Message` forwards it to
   `MessageAssistant` so memoized assistant rows can re-render on branch-switch/reopen-affordance changes. When
   undefined, existing positional `isLast` remains the inline-render fallback (conversation.tsx:101-102). Individual
   `MessageAssistant` instances do **not** call `useActivityPanel`.

**New files created.** `app/components/chat/use-activity-panel.ts`.

**Tests to add.**
- `app/components/chat/message.test.tsx` (extend) — render-count suite (skeleton a; GA §7 R3): mock
  `./message-assistant` with a `vi.fn()` body spy. Test 1: adding reasoning + `source-url` parts with identical
  text during `streaming+isLast` does NOT re-render the body (fails today on :107/:111, passes after). Test 2: a real
  text delta DOES. Test 3: a tool state transition (`submitted→output-available`) DOES. Test 4: changing only
  `activeTurnId` DOES re-render/forward the new value so branch switches and active-turn handoffs cannot leave stale
  panel state. Plus an explicit assertion that no in-body element reads tool output/args without a state change (R3
  residual on getToolSignature :67-76).
- `app/components/chat/use-activity-panel.test.tsx` *(new)* — chat-level ownership suite: (a) derives `activeTurnId`
  from the last assistant in the rendered `messages` array; (b) after a simulated branch switch (same conversation,
  different rendered assistant tail) the hook returns the new tail id and that tail's persisted duration/sources; (c)
  regenerate handoff moves from old assistant sibling to new sibling and keeps the superseded sibling out of live timer
  ownership; (d) `status==="submitted"` with a user tail returns `activeTurnId: undefined` and `isGenerationActive:
  true` so commit 5 can keep `ThinkingBar` instead of inventing a synthetic assistant owner.
- `app/components/chat/use-reasoning-phase.test.tsx` *(new)* — fake-timer suite (skeleton b; GA §7 R1): (a) freeze at
  5s on cleanup (:99-102); (b) persisted fallback when `isLast && complete && tickedSeconds===0` (:115-116);
  (c) historical `!isLast` fallback (:120-121); (d) in-place mutation: same `parts` array ref with a mutated
  reasoning part `.text`/`.state` updates the derivation (:29-31); (e) **`isLast` `true→false→true` handoff** asserting
  `tickedSeconds` never regresses below its frozen value (proves the :80 gate fix).

**Verification gate.** `bun run test -- app/components/chat/message.test.tsx app/components/chat/use-activity-panel.test.tsx app/components/chat/use-reasoning-phase.test.tsx`
plus `bun run typecheck` and `bun run lint`. Panel is dormant (rendered nowhere yet) — no visual change.

**Revert.** Restore :107/:111 + `getReasoningContent`, remove the hook + chat-level `activeTurnId` threading; inline
rendering still drives the body.

---

### Commit 4 — Layout sibling track at `width:0`

**Objective.** Add the flyout as a flex sibling of the scroll column at the layout seam, width
`--activity-panel-width`, `max-lg:w-0`, closed by default. Scroll machinery does NOT move. (GA §5 PR4, now commit 4; §7 R4/R5/R6/R9,
evidence layoutSeam.)

**Files touched.** `app/components/layout/layout-app.tsx` (sibling track + provider), `app/components/chat/chat.tsx`
(registers the docked panel), `app/components/chat/activity/activity-panel-host.tsx` *(new)*,
`app/components/chat/activity/activity-panel.tsx` *(new)*,
`app/components/chat/activity/docked-flyout-shell.tsx` *(new)*,
`app/components/chat/activity/panel-header.tsx` *(new)*. Panel **data** comes from `use-activity-panel.ts`; panel
**open state** lives in `chat.tsx`.

**Current-state findings.** The flex row is `div.flex.h-svh.w-full.overflow-hidden` (layout-app.tsx:15); its current
children are optional `<AppSidebar />` (:16) and the `@container/main` scroll column (:17-24) containing ScrollRoot
(:18) → Header (:19) + `<main>` (:20-22). Insert the panel track AFTER the column's closing `</div>` (after :24) and
BEFORE the row's closing `</div>` (:25). chat.tsx's responsive rules are container-queries on `@container/main`
(chat.tsx:324, :339) — narrowing that column when the panel docks recomputes composer margins/width automatically.

**Reference-ui context to load if source detail is needed.** For desktop flyout width/collapse, the fact that the
docked shell pushes the thread and has no backdrop, and the CSS-gated coexistence with the sheet, load
`/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/pages/conversation-with-activity-panel.md` plus
`/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/research/activity-panel-component-inventory.md`.

**Change recipe per file.**

1. **`app/components/chat/activity/activity-panel-host.tsx`** *(new, "use client")* — bridge Chat-owned panel state to
   the `LayoutApp` sibling slot without moving the scroll column. Export:
   - `ActivityPanelHostProvider({ children })`
   - `useActivityPanelHost()` returning `{ setDockContent(node: ReactNode): void }`
   - `ActivityPanelDockSlot()` rendering the current dock content
   The setter must clear content on unmount so navigating away from a chat cannot leave stale panel DOM in the layout.

2. **`app/components/layout/layout-app.tsx`** (GA §7 R4, evidence layoutSeam): wrap the existing flex row in
   `ActivityPanelHostProvider`, then insert the NEW track as a sibling AFTER layout-app.tsx:24:
   ```tsx
   <div className="shrink-0 w-0 overflow-hidden border-l border-border bg-card transition-[width] lg:w-[var(--activity-panel-width)]">
     <ActivityPanelDockSlot />
   </div>
   ```
   Because ScrollRoot (:18) and the sticky composer (chat.tsx:321-354) stay inside `@container/main`, NO scroll
   machinery moves (GA §7 R4). Opening changes only the conversation column **width**, never `ScrollRootContent`
   height / `--thread-bottom-offset` / `--spacing-input-area`.

3. **`app/components/chat/chat.tsx`** — call `useActivityPanel({ messages, status, isSubmitting })` once (commit 3),
   own `activityPanelOpen`, and render `<ActivityPanel open={activityPanelOpen} onOpenChange={setActivityPanelOpen}
   {...panelProps} />`. The `ActivityPanel` registers its docked subtree with the host and renders its sheet subtree
   locally so the Sheet portal/focus trap remains rooted in Chat. Do not alter the sticky composer (:321-354) or
   `Conversation` placement (:317).

4. **`app/components/chat/activity/activity-panel.tsx`** *(new, "use client")* — composition root (GA §B):
   Props: `{ open: boolean; onOpenChange: (o: boolean) => void; title?: string; phase: ReasoningPhase["phase"];
   durationSeconds?: number; steps: ToolUIPart[]; sources: SourceUrlUIPart[]; reasoningText: string;
   isReasoningStreaming: boolean; isOpaqueReasoning: boolean }`. Use CSS/Tailwind for visual shell styling and the
   existing `app/hooks/use-breakpoint.ts` with breakpoint `1024` only to gate Base UI Sheet `open`/portal/focus-lock:
   `const isBelowLg = useBreakpoint(1024); const sheetOpen = open && isBelowLg`. The docked subtree is registered in
   the host slot and remains visually collapsed below lg; the Sheet subtree is only open below lg. Render the shared
   body (PanelHeader + PanelScrollBody → ActivityTimeline + SourcesGallery) into the **active** shell only (GA §7 R6 —
   favicons load once, `<img>` count == N not 2N).

5. **`app/components/chat/activity/docked-flyout-shell.tsx`** *(new)* — in-flow `<section aria-label="Reasoning
   details">` (landmark, NOT dialog — GA §7 R9), `bg-card border-s border-border`, pinned to
   `--spacing-panel-header`, `width: var(--activity-panel-width, 400px)`, collapses to `w-0` below lg. **No
   backdrop, no focus trap, no scroll-lock, ESC inert** (GA §7 R9). Reuses `Button(ghost,icon-sm)` close
   (always visible) + `ScrollArea` body (`px-2 py-3` + trailing scroll spacer; evidence scroll-area changeRecipe —
   pass `viewportRef` for auto-scroll).

6. **`app/components/chat/activity/panel-header.tsx`** *(new)* — `PanelHeader` renders `TitleDurationCluster` +
   `CloseIconButton`.
   - `TitleDurationCluster` is a plain flex text cluster: title text plus `formatDuration(durationSeconds)` when present.
     Export `formatDuration` additively from `components/ai-elements/reasoning.tsx` if needed, but do **not** render
     `Reasoning` or `ReasoningLabel` inside the panel header. Those components own inline disclosure state and
     React-19 auto-open behavior that the panel header must not inherit.
   - `CloseIconButton` = `<Button variant="ghost" size="icon-sm" aria-label="Close"><Icon icon={RiCloseLine}
     slotSize={16} /></Button>` (button.tsx:17/31-32; icon via icon.tsx, currentColor — GA §4 row 22). No new file
     for the button itself.

**New files created.** `activity-panel-host.tsx`, `activity-panel.tsx`, `docked-flyout-shell.tsx`, `panel-header.tsx`.

**Tests to add.**
- **Layout test** (GA §7 R4): toggling the width var leaves `ScrollRootContent` height / `--thread-bottom-offset` /
  `--spacing-input-area` unchanged (computed-style assertions).
- **Host registration test:** rendering a Chat-like child registers dock content into `ActivityPanelDockSlot`; unmounting
  clears it. This proves the layout slot cannot retain stale panel content across navigation.
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
- Existing `useBreakpoint(1024)` behavior is covered through the resize-crossing-lg test; do not introduce a second
  breakpoint helper.

**Verification gate.** `bun run test -- app/components/chat/activity/activity-panel-host.test.tsx app/components/chat/activity/activity-panel.test.tsx`
plus the layout/resize integration tests added for this commit, then `bun run typecheck` and `bun run lint`.
Visual/snapshot regression at 1024/768/375. Panel still dormant content-wise (inline body still renders) — only the
docked track, host registration, and breakpoint coexistence are exercised.

**Revert.** Remove the host/provider registration and sibling track; conversation reverts to full width with inline body
intact.

---

### Commit 5 — The cutover (last commit before opening the PR)

**Objective.** Remove inline reasoning + sources from the assistant body; wire the panel plus an explicit Activity trigger
as the only reasoning/source path and reopen affordance.
(GA §5 PR5, now commit 5.)

**Files touched.** `app/components/chat/message-assistant.tsx`, `app/components/chat/conversation.tsx`,
`app/components/chat/message.tsx`, `app/components/chat/chat.tsx`,
`app/components/chat/activity/activity-panel-trigger.tsx` *(new)*, `app/components/chat/sources-list.tsx` (retire if now
unused).

**Current-state findings.** message-assistant.tsx inline reasoning JSX :237-249, inline sources JSX :301; imports
Reasoning/ReasoningContent/ReasoningLabel :14-18, SourcesList :32. ThinkingBar pre-stream branch
conversation.tsx:156-171.

**Reference-ui context to load if source detail is needed.** Before final cutover visual QA, re-open the source
captures for all three shells:
`/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/pages/conversation-with-activity-panel.md`,
`/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/pages/conversation-with-activity-panel-tablet-820px-light.md`,
and `/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/pages/conversation-with-activity-panel-mobile-592px-light.md`.
Use `/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/css/conversation-with-activity-panel.md` to settle
token, breakpoint, and selector questions during the final pass.

**Change recipe per file.**
1. **`app/components/chat/activity/activity-panel-trigger.tsx`** *(new)*: small client button/link styled in the existing
   message-action idiom, accessible name `"Open activity"`, optional compact summary (`Thinking`, `{n} sources`, or
   `Activity`). It calls `onOpenActivityPanel` and must be focusable/reopen the panel after close. This replaces the
   old inline `ReasoningLabel` affordance; it does **not** render reasoning content.
2. **`message-assistant.tsx`**: REMOVE the reasoning JSX (:237-249) and the sources JSX (:301). Render
   `ActivityPanelTrigger` only for the active assistant turn when the panel has reasoning, steps, or sources. Keep
   `getSources`/toolInvocationParts/persistedDurationMs computations only if needed to decide trigger visibility;
   otherwise move them fully into `use-activity-panel.ts`. Drop now-unused imports
   `Reasoning`/`ReasoningContent`/`ReasoningLabel` (:14-18) and `SourcesList` (:32) IF no longer referenced.
3. **`message.tsx` / `conversation.tsx`**: thread `onOpenActivityPanel` and active-turn availability to
   `MessageAssistant`. Keep the pre-stream `ThinkingBar` branch (:156-171) for `status==="submitted"` and last message
   role `"user"` by default; there is no assistant message yet to own `activeTurnId`, so folding it into the panel would
   require a synthetic owner. Add that only if a product decision explicitly requires the submitted state to live in the
   panel.
4. **`chat.tsx`**: keep owning `activityPanelOpen`; pass `onOpenActivityPanel={() => setActivityPanelOpen(true)}` to
   `Conversation`; render `<ActivityPanel open={activityPanelOpen} onOpenChange={setActivityPanelOpen}
   {...panelProps} />`. No structural change to the sticky composer (:321-354) or `Conversation` placement (:317).
5. **`sources-list.tsx`**: retire if message-assistant.tsx was its only consumer (it was, per evidence). Otherwise
   leave and mark.

**New files created.** `app/components/chat/activity/activity-panel-trigger.tsx`.

**Tests to add.** Streaming integration check: panel populates live reasoning/sources and duration parity vs the
(pre-cutover) inline impl; trigger opens, closes, and reopens the panel with focus returning to the trigger; branch
switch updates the trigger/panel to the newly selected tail; submitted/no-assistant state still renders `ThinkingBar`;
coexistence holds on resize across lg. Grep gates: no inline `ReasoningContent`/`SourcesList` in
`message-assistant.tsx`, and no feature-flag/runtime-toggle usage in the integration diff.

**Verification gate.** `bun run test -- app/components/chat/conversation.test.tsx app/components/chat/message.test.tsx app/components/chat/activity/activity-panel.test.tsx`
plus `bun run typecheck` and `bun run lint`; then run full local `bun run test` before opening the PR because CI does
not run the full Vitest suite. Visual at all 3 breakpoints + dark-mode pass + a11y audit (GA §5 Step B Verification).
After this commit, open one PR containing commits 1–5 and include the proof from each commit gate.

**Revert before merge.** Revert or amend commit 5 alone to restore inline rendering; commits 1–4 remain green and
harmless. After merge, prefer reverting the single merge commit unless the branch was squash-merged; in that case,
revert the squashed PR commit.

---

## 6. New component API appendix

| Component | Location | Props / CVA | Satisfies |
|-----------|----------|-------------|-----------|
| **ActivityPanelHostProvider / ActivityPanelDockSlot** | app/components/chat/activity/activity-panel-host.tsx ("use client") | Context bridge from Chat to LayoutApp. `setDockContent(node)` registers docked content; clears on unmount. No app state beyond the current dock node. | GA §7 R4/R6 |
| **ActivityPanel** | app/components/chat/activity/activity-panel.tsx ("use client") | `{ open; onOpenChange; title?="Activity"; phase; durationSeconds?; steps; sources; reasoningText; isReasoningStreaming; isOpaqueReasoning }`. Registers docked content into host; renders Sheet locally. CSS handles visual shell styling; existing `useBreakpoint(1024)` gates Sheet `open`/portal/focus. No cva. | GA §B, §C1-2, §6.7, §7 R5/R6 |
| **DockedFlyoutShell** | app/components/chat/activity/docked-flyout-shell.tsx | `{ open; onClose; children }`. `<section aria-label="Reasoning details">`, `bg-card border-s border-border`, `width: var(--activity-panel-width,400px)`, `max-lg:w-0`. No backdrop/trap/lock. | GA §A2, §7 R4/R9 |
| **ContentSheetShell** | app/components/chat/activity/content-sheet-shell.tsx ("use client") | `{ open; onOpenChange; title; children }`. Wraps `SheetContent` (side=bottom mobile / sm card), `rounded-t-2xl`/`sm:rounded-2xl sm:shadow-border-xl`, `overlayClassName` scrim, `[&>button]:max-sm:hidden`, aria-hidden handle `h-1 w-12`. | GA §A3-5, §6.2, §7 R2/R7 |
| **PanelHeader** | app/components/chat/activity/panel-header.tsx | `{ title; phase; durationSeconds?; onClose; isReasoningStreaming; isOpaqueReasoning }`. Renders TitleDurationCluster + CloseIconButton. | GA §B1 |
| **TitleDurationCluster** | inside panel-header.tsx | Plain title + duration text cluster. May import/export `formatDuration` from reasoning.tsx, but must not render `Reasoning` / `ReasoningLabel` because those own inline disclosure state. | GA §B2, §C7-8 |
| **CloseIconButton** | reuses button.tsx (no new file) | `<Button variant="ghost" size="icon-sm" aria-label="Close"><Icon RiCloseLine slotSize={16}/></Button>` | GA §B3 (exact), §4 row 22 |
| **PanelScrollBody** | inside each shell | flyout `ScrollArea px-2 py-3` + spacer; sheet `ScrollArea px-6 pb-4`, `aria-controls` target. `viewportRef` for auto-scroll. | GA §C1, §C6 |
| **ActivityPanelTrigger** | app/components/chat/activity/activity-panel-trigger.tsx ("use client") | Focusable button/link, accessible name `"Open activity"`, optional compact summary. Opens/reopens the Chat-owned panel; does not render reasoning/source content. | GA §5 PR5, §6.7 |
| **ActivityTimeline** | app/components/chat/activity/activity-timeline.tsx ("use client") | `{ children; className? }`. Maps children injecting `isLast` (mirror chain-of-thought.tsx:148-166). `relative isolate`, ascending z-index. | GA §D2, §7 R6 |
| **ActivityStep** | activity-timeline.tsx | `{ children; isLast?; leading?; body?; className? }` & cva. Non-collapsible. `group data-last`. | GA §D3 |
| **StepLeadingIndicator** | activity-timeline.tsx | `stepVariants` cva `{ leading: {globe,bullet,done}, body: {chips,description} }`, `defaultVariants {leading:"bullet", body:"description"}`. Icon via icon.tsx slotSize=16, currentColor. Connector `bg-primary/20 ml-1.75 w-px` hidden on `group-data-[last=true]`. | GA §D4, §6.6, §4 rows 19-21 |
| **SourceChip** | reuses badge.tsx `source` variant (already present) | `<Badge variant="source" size="md" render={<a target="_blank" rel="noopener noreferrer">}>` + leading `<Favicon>`. `rounded-full h-[25px] px-3 text-xs`, hover-invert 150ms. s2 `sz=64`. | GA §D8, §C13, §4 rows 10-14 |
| **OverflowChip** | app/components/chat/activity/source-chip-group.tsx | `<button>` (keyboard, name `{n} more`), chip skin, up to 3 `Favicon overlap` (`-ms-3/first:-ms-1`, `ring-2 ring-card`, `group-hover:border-foreground`). | GA §D9, §C11-12 |
| **SourceChipGroup** | app/components/chat/activity/source-chip-group.tsx *(new)* | ONE flex-wrap row (chips + OverflowChip). Reserved-empty first row DROPPED (GA §6.3). | GA §D7, §6.3 |
| **Favicon (extended)** | components/ui/favicon.tsx | additive `loading?` / `decoding?` forwarded through AvatarImage (:72). `overlap` ring variant exists. | GA §D10, §7 R8 |
| **PanelSectionHeading** | app/components/chat/activity/panel-section-heading.tsx *(new)* | `{ title; trailing?; className? }`. Plain div, `text-muted-foreground font-medium`, truncating title + trailing `· N`. | GA §D1, §4 row 32 |
| **SourcesGallery** | app/components/chat/activity/sources-gallery.tsx | App-level gallery composition: `{ sources: SourcesGalleryItemProps[]; count? }` → ONE `ul` + `PanelSectionHeading "Sources"`. No `groups` until real grouped source data exists. | GA §6.1, §7 R8 |
| **SourcesGalleryItem** | components/ui/source.tsx (additive sibling) | Export `SourcesGalleryItemProps`: `{ href; title; siteName?; description?; faviconDomain? }`; render a full-bleed `<a rel="noopener">` with internal `<img>` `sz=32` ORIGIN `loading=lazy decoding=async`. Keeps `Source*` byte-identical and app dependencies out of `components/ui`. | GA §6.1, §7 R8 |

---

## 7. Token additions (exact globals.css edits)

All additive; preserve the dual light/dark discipline. **Literal values follow GA (the source of truth): `--activity-panel-width: 25rem` (§6.4, ≈400px observed), `--spacing-panel-header: 56px` (§4 row 25), scrim `0.30`/`0.50` (§4 rows 23–24)** — these supersede the evidence reader's placeholder numbers (22rem, 0.10/0.40). Note `--thread-bottom-offset` is a LOCAL var on `ScrollRootContent` (`conversation.tsx:94`), not a globals.css token — do not add it here.

1. **`--activity-panel-width: 25rem;`** — inside the FIRST `@theme {…}` block immediately after globals.css:52
   (next to `--spacing-app-header`/`--spacing-input-area`). Consume as `width: var(--activity-panel-width, 400px)`.
   (GA §6.4, §4 row 26)
2. **`--spacing-panel-header: 56px;`** — same `@theme` spacing cluster. Flyout pins 56px for byte-fidelity
   (GA §4 row 25).
3. **Scrim tokens** (separate mobile/tablet tokens, GA §4 rows 9/23/24): in `:root` near :422-425 add
   `--overlay-scrim-mobile: oklch(0 0 0 / 0.30);` and
   `--overlay-scrim-tablet: oklch(0.92 0.004 286 / 0.50);`; in `.dark` near :507-510 add
   `--overlay-scrim-mobile: oklch(0 0 0 / 0.30);` and
   `--overlay-scrim-tablet: oklch(0 0 0 / 0.50);`. Consume with
   `bg-[var(--overlay-scrim-mobile)] sm:bg-[var(--overlay-scrim-tablet)]`; do not add a single `bg-overlay-scrim`
   bridge because it cannot represent the mobile/tablet split.
4. **`show` keyframe** (token-driven, matches `--animate-collapsible-*` at :53-54): inside the first `@theme` block
   add `@keyframes show { from { opacity: 0; transform: translateX(0.5rem); } to { opacity: 1; transform: translateX(0); } }`
   and `--animate-show: show 200ms ease-out;`. Every consumer carries a `motion-reduce:` variant (GA §7 R7).

NO existing token is edited. Per GA §6.5/§6.6: do NOT add `--muted-foreground-subtle` or `--border-strong`.

---

## 8. Test → residual matrix

| Residual / case | Test that proves it pre-merge | Commit | file:line anchor |
|-----------------|-------------------------------|----|------------------|
| **R1** isLast bounce zeros counter | use-reasoning-phase.test.tsx case (e): `true→false→true`, `tickedSeconds` never regresses; fix gates :80 on `prevPhase!=="thinking"` | 3 | use-reasoning-phase.ts:78-83 |
| **R2** sheet mutation / overlay bleed | sheet.test.tsx default-equivalence snapshot (overlay class byte-identical w/o `overlayClassName`); 2-consumer green tests; single-caller grep gate; fix-overlay-bleedthrough opaque surface | 2 | sheet.tsx:40, :60 |
| **R3** memo body churn | message.test.tsx Test1 (reasoning+source delta → no body re-render), Test2 (text delta → re-render), Test3 (tool-state → re-render), Test4 (`activeTurnId` change → re-render/forward) + no-output-read-without-state assertion | 3 | message.tsx:107, :111, :67-76 |
| **R4** layout/scroll move | layout computed-style test (width var toggle leaves height/`--thread-bottom-offset`/`--spacing-input-area` unchanged); stick-to-bottom anchor-in-view at ≥lg | 4 | layout-app.tsx:18, chat.tsx:324 |
| **R5** focus/scroll-lock across lg swap | resize-crossing-lg matchMedia test: activeElement never in display:none; trap only active path; ≤1 scroll-lock owner; Sheet `open` gated by existing `useBreakpoint(1024)` | 4 | chat.tsx, app/hooks/use-breakpoint.ts |
| **R6** SSR duplicate DOM | SSR test: no hydration warning; exactly 1 Activity landmark; favicon `<img>` count == N | 4 / 1 | globals.css:17-25 |
| **R6 host stale content** | activity-panel-host.test.tsx: Chat-like child registers dock content into `ActivityPanelDockSlot`; unmount clears it | 4 | layout-app.tsx:17-24 |
| **R7** reduced-motion | reduced-motion matchMedia snapshot: new animations suppressed, instant final state | 4 | globals.css:5, --animate-show |
| **R8** 141-favicon perf | SourcesGallery test: `loading=lazy`+`decoding=async` on every `<img>`, count == N | 1 | source.tsx, favicon.tsx:72 |
| **R9** trap vs non-trap divergence | two-path interaction test: flyout focus returns/no-lock/ESC-inert; sheet traps/locks/ESC-closes | 4 | sheet.tsx:6 |
| **§6.7C** duration freeze | use-reasoning-phase.test.tsx case (a): freeze at 5s on cleanup | 3 | use-reasoning-phase.ts:96-106 |
| **§6.7C** persisted fallback (complete, no ticks) | case (b): `isLast && complete && tickedSeconds===0` → persisted | 3 | use-reasoning-phase.ts:115-116 |
| **§6.7C** historical fallback | case (c): `!isLast` → persisted | 3 | use-reasoning-phase.ts:120-121 |
| **§6.7 / R1** in-place mutation derivation | case (d): same parts ref, mutated `.text`/`.state` updates | 3 | use-reasoning-phase.ts:28-31 |
| **§6.7D** regenerate handoff | case (e) (shared with R1): timer resets new turn, freezes old | 3 | use-reasoning-phase.ts:78-83 |
| **§6.7E** branch switch | use-activity-panel.test.tsx: simulated branch switch changes rendered assistant tail → new `activeTurnId`, persisted duration/sources shown, no stale live timer | 3 | selected-path.ts:171-180 |
| **Commit 5 trigger reopen** | trigger interaction test: close panel, focus returns to trigger, trigger reopens correct active turn on desktop and sheet breakpoints | 5 | message-assistant.tsx:237-249 |
| **Submitted/no-assistant boundary** | conversation test: `status==="submitted"` + user tail still renders `ThinkingBar`; `useActivityPanel` returns no synthetic `activeTurnId` | 3 / 5 | conversation.tsx:156-171 |
| **R-rollback** | Local proof bundle green at each commit boundary (targeted tests + typecheck + lint); full local `bun run test` before PR; grep over integration diff returns no flag/runtime-toggle usage | all | — |

---

## 9. Open risks / sequencing notes

1. **Branch-switch (§6.7E) must be tested in commit 3** *(inferred)*. The fake-timer suite covers regenerate (D) and
   the C2 divergence path is structurally guarded by `projectSelectedPath` returning serverPath on divergence
   (selected-path.ts:171-180), but the panel owner is derived from rendered messages. Add the cheap
   `use-activity-panel.test.tsx` branch-switch case; do not accept only the structural guarantee.

2. **ThinkingBar boundary (§C9, commit 5)** *(inferred)*. Default to keeping the existing `ThinkingBar` for
   `status==='submitted'`/last-is-user pre-stream state (conversation.tsx:156-171). Folding that into the panel requires
   inventing a synthetic assistant owner before an assistant message exists; do it only after an explicit product
   decision, and then test the synthetic owner separately.

3. **Coexistence vs portal duplication (§7 R6)** *(inferred)*. The selected fix is not a CSS-only
   `display:contents` fallback. Use CSS for visual shell styling, but gate the Base UI Sheet `open` prop with existing
   `useBreakpoint(1024)` so the portal/focus-lock path is inactive at desktop. If the R6 test still reports duplicate
   landmarks or favicon counts, fix the active-body rendering/registration logic before adding more CSS.
