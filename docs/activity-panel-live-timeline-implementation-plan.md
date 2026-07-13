---
created_at: 2026-07-13
revised_at: 2026-07-13 — post-review corrections + read-only live-reference DOM verification
audience: senior design engineer
scope: remaining live multi-step Activity timeline behavior
status: implementation-ready
reference_confidence: observed | repository-supported | product-decision | deferred
---

# Activity Panel Live Multi-Step Timeline — Implementation Plan

## 1. Purpose

Complete the remaining Activity-panel TODO without redesigning the panel or
creating a second activity state machine:

> Chat side panel: finish the live multi-step timeline. Preserve the
> intentional `ActivityPanel`, `ActivityTimeline`, and
> `DockedFlyoutShell.viewportRef` scaffolding; re-verify live thinking behavior
> against a current reference before wiring speculative phase behavior.

This document supersedes only the unfinished **live timeline and viewport
following** portion of `docs/activity-panel-implementation-plan.md`. The older
document remains historical provenance for the original panel build.

The intended result is deliberately narrow:

1. Live disclosure/status copy comes from the latest active chronological
   Activity entry whenever inspectable evidence exists.
2. `AssistantTurnPhase` remains a fallback for the pre-evidence interval and a
   canonical turn-liveness signal; it does not become a parallel copy machine.
3. An open panel follows new content only while the user is pinned near the
   bottom.
4. Scrolling upward suspends following; returning to the bottom resumes it.
5. Desktop and mobile use the same Activity-owned policy against their own
   `ScrollArea` viewport.
6. Explicit historical selection remains authoritative while a newer turn
   streams.

Do not add dependencies, provider branches, a generic scrolling framework, new
timeline geometry, speculative running markers, or an unverified
"jump to latest" control.

## 2. Definition of done

The TODO is complete when all of the following are true:

- Live status derivation is evidence-first and phase-fallback-only.
- The same normalized Activity entries drive both the timeline and its live
  disclosure label.
- A tool call keeps one stable row keyed by `toolCallId`; incremental parts
  enrich that row without moving it.
- New chronological evidence appends after existing entries.
- Completed entries remain visible while later entries run.
- The terminal completion row remains structurally separate and can appear
  during `responding`, as it does today.
- `ActivityPanel` supplies a viewport ref to both the desktop dock and mobile
  sheet `ScrollArea`.
- Content growth follows the bottom only while the viewport is pinned.
- User scrolling is never overridden while reviewing earlier entries.
- Opening the default live turn midway positions the viewport at the bottom.
- Explicit historical selection never auto-switches to the live turn.
- Turn changes and responsive shell replacement clean up all listeners,
  observers, and scheduled animation frames.
- Focus is not moved by following and repeated smooth scrolling is not used.
- Narrow derivation, selector, panel, and scroll-controller tests pass.
- Desktop and mobile browser verification covers the acceptance matrix in
  section 11.

## 3. Non-negotiable architectural boundaries

Preserve these owners:

- `lib/chat-messages/assistant-turn.ts`
  - `AssistantTurnView.orderedParts` is the original AI SDK part-order seam.
  - `AssistantTurnPhase` answers whether the turn is submitted, thinking,
    tooling, awaiting approval, responding, or settled.
- `lib/chat-messages/turn-evidence.ts`
  - The only raw AI SDK part interpreter for Activity behavior.
  - First appearance establishes chronological identity.
  - Later parts for the same call update facts in place.
  - `resolveEntryStatus(...)` remains the one liveness/lifecycle seam.
- `lib/chat-messages/assistant-activity.ts`
  - Provider-neutral Activity entry and presentation algebra.
  - The correct place for evidence-first live-label derivation.
- `app/components/chat/use-activity-panel.ts`
  - The only selector for default live versus explicitly selected historical
    turns.
  - The correct place to derive `turnKey` and whether the panel is following
    the default live generation.
- `app/components/chat/activity/activity-panel.tsx`
  - The shared responsive Activity composition root.
  - The correct owner of Activity-specific scroll-follow policy.
- `app/components/chat/activity/activity-timeline.tsx`
  - Shared timeline-row, marker, and connector geometry.
  - Do not replace it and do not move scroll policy into it.
- `app/components/chat/activity/docked-flyout-shell.tsx`
  - Desktop shell and intentional `viewportRef` transport.
  - Do not make it decide whether the panel follows.
- `components/ui/scroll-area.tsx`
  - Low-level Base UI viewport transport.
  - Keep it policy-free.

Do not reuse `components/ui/scroll-root.tsx` or
`app/components/chat/thread-scroll.tsx`. Those components own conversation
answer-start pinning, sentinel distance, safe-area gutters, and restoration.
Their mechanics are useful reference material, but their product contract is
different.

## 4. Verified baseline

Repository versions verified on 2026-07-13:

| Package               | Declared  | Locked   |
| --------------------- | --------- | -------- |
| `ai`                  | `^7.0.22` | `7.0.22` |
| `@ai-sdk/react`       | `^4.0.23` | `4.0.23` |
| `@base-ui/react`      | `^1.6.0`  | `1.6.0`  |
| `react` / `react-dom` | `^19.2.7` | `19.2.7` |

Current data path:

```text
AI SDK UIMessage.parts
  -> deriveAssistantTurnView(message, status)
       -> orderedParts retained in original order
  -> deriveTurnEvidence(orderedParts)
       -> normalized chronological evidence
       -> stable tool-call identity
       -> provider-neutral source attribution
  -> deriveAssistantActivityModel(view, phase)
       -> closed ActivityEntry union
       -> separate completion entry
  -> deriveAssistantActivityPresentation(view, phase)
       -> disclosure/status label
  -> useActivityPanel(...)
       -> default live or explicit historical target
  -> ActivityPanel
       -> shared PanelBody + ActivityTimeline
       -> DockedFlyoutShell or ContentSheetShell
       -> Base UI ScrollArea viewport
```

Important current facts:

- `resolveLiveStatus(...)` in `assistant-activity.ts` is phase-first and emits
  generic labels such as `Thinking`, `Searching the web`, `Generating image`,
  and `Running tools`.
- `deriveAssistantActivityPresentation(...)` already derives the Activity
  model before choosing its live label. No second evidence walk is needed.
- Completion is derived when the phase is `responding` or `settled`.
- `useActivityPanel(...)` already prevents a selected historical turn from
  inheriting the newer turn's live status.
- `ActivityPanel` renders one shared body into exactly one active responsive
  shell.
- Desktop `DockedFlyoutShell` accepts `viewportRef`; `ActivityPanel` does not
  pass it.
- The mobile `ScrollArea` also does not receive a viewport ref.
- `PanelBody` already uses the repository's browser-layout-effect helper for a
  one-shot Sources section target. Preserve that behavior and define its
  priority relative to live following.
- Running and complete search/tool/image rows intentionally use the same
  current marker. Do not invent a visual difference in this change.
- Chat force-closes the panel whenever `panelCanOpen` is false
  (`app/components/chat/chat.tsx`), and a pending turn always reports
  `panelCanOpen: false` — an open default-following panel therefore closes on
  every new send. Open-mid-stream is the dominant live entry path;
  turn-handoff-while-open applies mainly to the approval-pause continuation.
- `vitest.config.ts` sets `environment: "node"`. Every DOM test opts into
  jsdom with a `/** @vitest-environment jsdom */` pragma; new `.test.tsx`
  files must carry it.
- `useEffectEvent` is available (React 19.2.7; exported by the installed
  `@types/react@19.2.17`) — the sanctioned primitive for handlers that read
  latest props without effect choreography or render-phase ref writes.

## 5. Current-reference evidence

### Capture metadata

- Date: 2026-07-13
- Time: 14:36:35–14:36:56 EDT / 18:36:35–18:36:56 UTC
- Conversation:
  <https://chatgpt.com/c/6a54040d-a4b8-83ea-95bf-232d02db71c3>
- Viewport: 1279 x 1200 CSS px; device-pixel ratio 2
- Model/mode control: `Medium` under the current `Intelligence` selector. The
  exact underlying model identifier was not exposed.
- Prompt:

  > Research today's weather in New York, London, Tokyo, and Sydney; compare
  > them in a table, cite sources, and briefly explain one notable difference.
  > Show your work using web search.

### Observed transitions

| EDT          | Elapsed | Visible state                                                                                             |
| ------------ | ------: | --------------------------------------------------------------------------------------------------------- |
| 14:36:35.929 |    3.3s | `Thinking`                                                                                                |
| 14:36:38.063 |    5.4s | `Searching official weather sources for multiple cities`                                                  |
| 14:36:39.140 |    6.5s | `Searching www.theguardian.com`                                                                           |
| 14:36:40.743 |    8.1s | `Searching timesofindia.indiatimes.com`                                                                   |
| 14:36:42.363 |    9.7s | `Searching www.reuters.com`                                                                               |
| 14:36:43.689 |   11.1s | `Searching www.thesun.co.uk`                                                                              |
| 14:36:45.293 |   12.7s | `Searching m.economictimes.com`                                                                           |
| 14:36:46.888 |   14.3s | `Searching nypost.com`                                                                                    |
| 14:36:48.250 |   15.6s | `Searching www.accuweather.com`                                                                           |
| 14:36:48.515 |   15.9s | `Searched multiple sources for weather and related information`                                           |
| 14:36:50.695 |   18.1s | Completed `Searched ...` remained while `Searching web for global weather forecasts and sources` appeared |
| 14:36:51.511 |   18.9s | `Searching forecast.weather.gov`                                                                          |
| 14:36:52.867 |   20.2s | `Searching www.metoffice.gov.uk`                                                                          |
| 14:36:54.504 |   21.9s | `Searching www.jma.go.jp`                                                                                 |
| 14:36:55.854 |   23.2s | `Searching www.bom.gov.au`                                                                                |
| 14:36:56.141 |   23.5s | `Worked for 22s` appeared while `Stop answering` remained visible                                         |

### Directly supported behavior

- Live copy progresses from a generic pre-evidence `Thinking` state to
  specific query/domain work.
- A completed search summary and the next active search can coexist.
- Terminal `Worked for ...` may appear before the response stream fully ends.
- A previously selected historical Activity panel remains selected while a
  newer turn streams.
- The selected historical panel's rows, order, and viewport remain unchanged.
- Settled Activity rows remain chronological and the terminal row is last.

### Settled-panel DOM verification (2026-07-13, read-only)

A second, read-only inspection of the same conversation's DOM through the
logged-in browser (no messages sent), with both turns' Activity flyouts opened
via the Sources affordance:

- **The live label IS the entry title, byte-for-byte.** The 5.4s live label
  ("Searching official weather sources for multiple cities") is the settled
  search row's title verbatim. Decision A is directly reference-confirmed.
- **Per-domain live labels are sub-steps, not rows.** "Searching
  www.theguardian.com" etc. never persist as timeline rows; those domains
  settle into the search row's source chips ("19 more"). The finer-grained
  live sub-steps never cross our wire, so row-title reuse is the correct
  achievable parity.
- **A settled/historical panel opens at the top** — `scrollTop ≈ 0` (12px, the
  top padding) against 4,138px and 12,528px of content on the two turns.
- **No stick-to-bottom scaffolding.** The panel scroller is a plain
  `slot="content"` `overflow-y-auto` div with `overflow-anchor: auto`,
  `scroll-behavior: auto`, no `column-reverse`, and no jump-to-latest button
  in the settled DOM.
- **Zero `aria-live` nodes** inside the flyout stage.
- **Terminal row confirmed**: "Worked for 22s" title with "Done" detail.
  Tool rows title as input action descriptions ("Checking for yt-dlp or
  youtube-dl installation") over a named code card ("Python", code, Copy) —
  matching `toolActionTitle`'s action-first rule and the tool card.
- One panel instance swaps turns; header reads `Activity · 22s`; timeline →
  terminal row → `Sources · N` gallery ordering is unchanged.
- Settled row titles stay present-progressive ("Searching…", "Addressing…").
  The thread-inline condensed summary (a separate current-ChatGPT surface we
  deliberately do not replicate) uses past tense ("Searched…", "Addressed…").

### Still unobserved; do not claim parity

- The exact running-versus-completed marker treatment inside an open live side
  panel.
- Whether a live side-panel row animates, collapses, or is replaced.
- User-scroll interruption and resumption in an open live side panel.
- Whether the live panel auto-follows at all, and a live jump-to-latest
  affordance (the settled DOM has none).
- Opening the live panel midway through the stream.
- Current narrow/mobile live streaming behavior.
- Current image-generation, approval, explicit-stop, or failure variants.

The scroll policy below is therefore an intentional product decision based on
standard user-intent preservation, not a claim of reference parity. It is,
however, verified to be **uncontradicted**: the reference panel carries no
competing scroll mechanism (no CSS stick-to-bottom, no anchoring override),
and settled panels open at the top exactly as specified here.

## 6. Design decisions

### Decision A: Activity entries are the live-copy source of truth

Do not add another phase or component state machine.

Use this priority:

1. Find the latest chronological Activity entry with status `running` or
   `approval`.
2. Use that entry's existing title and semantic kind for live disclosure copy.
3. If no active entry exists, fall back to the current
   `AssistantTurnPhase` mapping.

This yields specific labels after evidence arrives while retaining a universal
pre-stream fallback.

Examples:

| Activity evidence                       | Visible live label                                  |
| --------------------------------------- | --------------------------------------------------- |
| No entry yet; phase `submitted`         | `Thinking`                                          |
| Opaque reasoning running                | existing reasoning title or `Thinking`              |
| Search input has query                  | `Searching for {query}`                             |
| Search/browser call has domain          | existing entry title, such as `Reading example.com` |
| Image generation running                | existing image entry title                          |
| Tool awaiting approval                  | approval entry title                                |
| Multiple active tools                   | latest active chronological entry title             |
| No active entry but phase still tooling | current phase fallback                              |

The last row wins because the timeline is chronological. Do not sort by tool
kind or phase priority after entries exist.

Corrections applied after review:

1. **Map `semanticKind`/`motion` from entry status first, kind second.** An
   entry with status `approval` maps to `semanticKind: "approval"` and
   `motion: "none"` regardless of kind — a search- or image-classified tool
   awaiting approval must not shimmer. Otherwise map kind
   (reasoning → thinking, search → search, image → image, tool → tool) with
   `motion: "shimmer"`.
2. **Keep the resolver private.** Extend the existing `resolveLiveStatus`
   with an `activity` parameter; do not export a new function, an
   `AssistantActivityLiveStatus` type, or a `source` debug field. Test
   through `deriveAssistantActivityPresentation`, as the module's existing
   tests do — the module's seam stays closed.
3. **Fix the image copy upstream, not in the resolver.** The
   `generating-image` phase structurally implies a running image entry (both
   derive from the same evidence walk), so the entry always wins and the
   phase's "Generating image" label would silently regress to
   "Using {tool}". Give the image entry's running title a
   `"Generating image"` fallback when the input carries no action
   description, so the timeline row and the live label agree.
4. An early `implied-search` entry reads `running` until the turn settles and
   can become the latest active entry after later real work completes,
   surfacing "Searching the web". Accept it, and pin the behavior with a
   test so the choice is explicit.

### Decision B: preserve terminal completion semantics

Keep completion separate from `activity.entries` and keep the current
`responding || settled` derivation. The current reference directly supports
terminal `Worked for ...` appearing while answer streaming is still active.

Do not infer that `Worked for ...` means the entire assistant response is
settled. It means the inspectable work timeline is terminal.

### Decision C: ActivityPanel owns viewport-follow policy

Create an Activity-specific hook/controller adjacent to `ActivityPanel`.

Why:

- `ScrollArea` should expose the viewport but remain policy-free.
- `DockedFlyoutShell` is desktop-only and cannot own mobile behavior.
- `ActivityTimeline` owns geometry, not scrolling.
- Conversation scroll primitives contain unrelated thread-level rules.
- Historical selection and Sources targeting are Activity-specific policy.

### Decision D: geometry changes drive following

Use `ResizeObserver` on the complete `PanelBody` wrapper.

Do not use `MutationObserver`. The viewport must respond to actual layout
growth, including:

- streamed text wrapping;
- source chips wrapping or expanding;
- tool-card output growth;
- image intrinsic-size settlement;
- font and responsive layout changes;
- terminal-row insertion.

Coalesce DOM writes through one `requestAnimationFrame` callback.

### Decision E: pinned state is imperative DOM state

Do not place `isPinned` in React state. It does not affect rendering in the
proposed UI and would cause unnecessary renders during high-frequency scroll
events.

Store these in refs/controller fields:

```ts
type ActivityScrollFollowState = {
  viewport: HTMLDivElement | null
  content: HTMLElement | null
  pinned: boolean
  /** Overflow guard: the viewport overflowed before the latest growth. */
  wasOverflowing: boolean
  frameId: number | null
}
```

**Pinned is the only follow gate (review simplification).** The earlier
draft gated growth-following on `enabled = open && followLatest` and then
needed `followedLiveThisTurn`/`finalResizeConsumed` to permit "one final
pinned resize" at stop/failure settlement. That machinery is deleted:

- While a viewport is attached, a resize aligns to the end exactly when the
  user is pinned AND the viewport was already overflowing before the growth.
- `followLatest` is consumed only as the initial-position signal
  (`startAtEnd`), never as a growth gate.
- Terminal rows inserted at stop/failure settlement follow naturally
  (the user is pinned), with no special-case state and no same-commit race.
- A late image load moves the viewport only if the user is sitting at the
  exact bottom, where "keep me at the bottom" is the consistent reading of
  pinned. The `wasOverflowing` guard prevents a short, trivially-pinned
  panel from yanking to the end the moment it first overflows.
- Explicit historical selections still never move in practice: their content
  is settled and does not resize, and they mount at the top.

Recommended threshold:

```ts
const DEFAULT_BOTTOM_THRESHOLD_PX = 24

function distanceFromEnd(viewport: HTMLElement): number {
  return viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop
}
```

Treat `distanceFromEnd <= 24` as pinned. Clamp or tolerate sub-pixel and
negative values.

### Decision F: no dependency-driven useEffect synchronization

Follow the repository's no-effect convention:

- Derive live labels inline through pure functions.
- Use passive DOM event handlers for user scrolling.
- Attach the `ResizeObserver` through callback-ref lifecycle.
- Use React 19 callback-ref cleanup to remove listeners, disconnect observers,
  and cancel scheduled frames. Caveat: once a callback ref returns a cleanup
  function, React **no longer calls the ref with `null`** on detach — put all
  detach logic in the cleanup, not in an `if (node === null)` branch.
- Guard cleanup against shell replacement: clear controller fields only if
  they still point at the detaching node (`if (state.viewport === node)`),
  so a newer shell's already-attached viewport is never nulled by an older
  shell's late cleanup.
- Wrap the scroll/resize handlers' policy reads in `useEffectEvent`
  (available in the installed React 19.2 / `@types/react` 19.2.17) instead of
  assigning an options ref during render. Render-phase ref writes are
  subtly wrong under concurrent rendering (a discarded render can leave
  options no committed UI ever had); `useEffectEvent` gives committed-value
  semantics with zero effect choreography.
- Create a fresh inert controller when `turnKey` changes; changing callback-ref
  identity causes React to detach the old controller and attach the new one.
  Construction must be side-effect-free (inert until attach) so StrictMode's
  attach → cleanup → attach cycle and discarded renders are safe.
- Key/reset panel content by `turnKey` and open state rather than using an
  effect to reset local state.
- Retain the existing `useBrowserLayoutEffect` only for the already-established
  one-shot Sources target unless implementation can cleanly move that action
  into the target event itself.

Do not introduce `useEffect(() => setX(deriveFromY(...)))` or an effect whose
only purpose is to reset pinned state when a turn id changes.

## 7. Proposed contracts

Names may be adjusted to match local conventions, but keep the information
flow and ownership intact.

### Live-status resolver (private — no new exports)

In `lib/chat-messages/assistant-activity.ts`, extend the existing private
`resolveLiveStatus` in place; its return shape (the `live-status`
presentation arm minus `kind`) already carries `semanticKind`, `label`, and
`motion`. Do not export a new function, an `AssistantActivityLiveStatus`
type, or a `source` debug field.

```ts
function resolveLiveStatus(
  view: AssistantTurnView,
  phase: AssistantTurnPhase,
  activity: AssistantActivityModel | undefined
): Omit<Extract<AssistantActivityPresentation, { kind: "live-status" }>, "kind"> {
  const active = activity?.entries.findLast(
    (entry) => entry.status === "running" || entry.status === "approval"
  )
  if (active) {
    if (active.status === "approval") {
      return { semanticKind: "approval", label: active.title, motion: "none" }
    }
    return {
      semanticKind: active.kind === "reasoning" ? "thinking" : active.kind,
      label: active.title,
      motion: "shimmer",
    }
  }
  // existing phase switch, unchanged
}
```

`findLast` is available (`lib: ["esnext"]`, modern-browser runtime). Do not
reverse or mutate `activity.entries`.

`deriveAssistantActivityPresentation(...)` already derives `activity` before
choosing the label; pass it into the resolver and use the returned label for
both `live-status` and live `disclosure` arms. Test through
`deriveAssistantActivityPresentation` only.

### Selector-to-panel viewport context

In `app/components/chat/use-activity-panel.ts`:

```ts
export type ActivityPanelDataProps = {
  activity: AssistantActivityModel | undefined
  durationSeconds: number | undefined
  turnKey: string | undefined
  followLatest: boolean
}
```

Do not rename the existing selector-local `ActivityPanelProps` — add the two
fields to it; `Chat` already spreads `panelProps` into `<ActivityPanel>`, so
no `chat.tsx` change is needed. The important formulas are:

```ts
turnKey: panelActivityTurnId

followLatest: isPanelDefaultTurn && generationActive && !isPendingActivityTurn
```

The explicit historical arm must always receive `followLatest: false`, even
while another turn streams. Note `followLatest` is consumed by the panel only
as the initial-position signal (`startAtEnd`); growth-following is gated by
pinned state alone (Decision E).

### Component props

In `app/components/chat/activity/activity-panel.tsx`:

```ts
export type ActivityPanelProps = {
  // existing props unchanged
  turnKey?: string
  followLatest?: boolean
}
```

### Scroll-follow hook

Create:

`app/components/chat/activity/use-activity-panel-scroll-follow.ts`

```ts
export type ActivityPanelScrollFollowOptions = {
  turnKey?: string
  /** Align to the end on attach (live default turn without a section target). */
  startAtEnd: boolean
  bottomThresholdPx?: number
}

export type ActivityPanelScrollFollow = {
  viewportRef: React.RefCallback<HTMLDivElement>
  contentRef: React.RefCallback<HTMLElement>
}

export function useActivityPanelScrollFollow(
  options: ActivityPanelScrollFollowOptions
): ActivityPanelScrollFollow
```

There is no `enabled` and no `initialPosition: "start" | "end"` pair: growth
alignment is gated by pinned state alone (Decision E), and `startAtEnd` is
the only attach-time policy. `ActivityPanel` computes it:

```ts
const { section } = useActivityPanelSectionTarget()
const startAtEnd = followLatest && section === undefined
```

Gating on the pending Sources target here makes the Sources-vs-initial-end
priority explicit and deterministic instead of relying on scroll-event /
rAF ordering within one frame.

Internally, read current options from `useEffectEvent`-wrapped handlers —
not from a ref assigned during render (see Decision F).

### Ref transport

In `components/ui/scroll-area.tsx` and
`app/components/chat/activity/docked-flyout-shell.tsx`:

```ts
viewportRef?: React.Ref<HTMLDivElement>
```

This additive widening preserves object refs and permits callback refs. Do not
add follow-related props to either primitive.

## 8. Scroll-controller algorithm

Implement the following behavior explicitly; avoid a library-like abstraction
with configurable policy that the product does not need.

### Attach viewport

When `viewportRef(node)` receives a node:

1. Save the node; record `wasOverflowing` from current geometry.
2. Set initial pinned state: `startAtEnd` forces `pinned = true` (opening the
   live panel IS the intent to follow — a long timeline mounts at the top, so
   computing pinned from geometry here would leave the initial alignment's
   pinned re-check permanently false and the alignment would never fire);
   otherwise compute it from `distanceFromEnd`.
3. Register a passive `scroll` listener.
4. If `startAtEnd`, schedule an instant end alignment.
5. Otherwise leave `scrollTop` unchanged. A newly mounted historical viewport
   naturally begins at the top — reference-confirmed (settled panels open at
   `scrollTop ≈ 0`).
6. Return cleanup that removes the listener, cancels any frame owned by this
   attachment, and clears the node **only if it is still the current one**
   (`if (state.viewport === node)`). Remember React never calls the ref with
   `null` once a cleanup function is returned.

Scroll handler:

```ts
const pinned = distanceFromEnd(viewport) <= threshold
state.pinned = pinned
```

This handler is the user-intent signal. Do not infer intent from the presence
of new Activity entries.

### Attach content

When `contentRef(node)` receives the complete body wrapper:

1. Save the node.
2. Create one `ResizeObserver` for that node.
3. On resize: if `state.pinned && state.wasOverflowing`, schedule an instant
   end alignment; then update `state.wasOverflowing` from current geometry.
4. If not pinned, do nothing. There is no other gate — no `enabled`, no
   final-resize counter (Decision E). Terminal rows at stop/failure follow
   because the user is pinned; a short panel's first overflow does not yank
   because `wasOverflowing` was false.
5. Return guarded cleanup that disconnects the observer and clears the
   content node only if still current.

Reset per-turn state by constructing a fresh controller for a new `turnKey`,
not with an effect.

### Schedule an end alignment

```ts
function scheduleEndAlignment(state: ActivityScrollFollowState) {
  if (state.frameId !== null) return

  state.frameId = requestAnimationFrame(() => {
    state.frameId = null
    const viewport = state.viewport
    if (!viewport || !state.pinned) return

    viewport.scroll({
      top: viewport.scrollHeight,
      behavior: "instant",
    })
  })
}
```

The frame re-checks the stored pinned state: a queued resize must not
override a scroll-up that happened later in the same frame (scroll events
fire before rAF callbacks in the same rendering update). `"instant"` is in
the installed `ScrollBehavior` type (lib.dom), so no fallback is needed.

### Sources target priority

The Sources target wins by construction, not by event ordering: `startAtEnd`
is false whenever a section target is pending (§7), so opening via the
sources badge never schedules an initial end alignment. After the target's
`scrollIntoView({ block: "start" })`:

1. The viewport's scroll event recomputes pinned state.
2. If the target leaves the viewport away from the end, live following
   suspends until the user returns to the bottom.
3. Do not immediately force the user back to the bottom.

### Responsive ownership

Use the same `viewportRef` for whichever shell is active:

```tsx
<DockedFlyoutShell viewportRef={viewportRef} ... />
```

```tsx
<ScrollArea viewportRef={viewportRef} ...>
```

Only one responsive shell is active at a time. Callback-ref cleanup must detach
the prior viewport during breakpoint changes before the new viewport attaches.

## 9. File-by-file implementation sequence

Keep each step narrowly green. A single PR is appropriate; separate commits
are optional unless requested.

### Step 1: evidence-first live presentation

Files:

- `lib/chat-messages/assistant-activity.ts`
- `lib/chat-messages/assistant-turn.test.ts`

Actions:

1. Extend the private `resolveLiveStatus` in place with an `activity`
   parameter (no new exports; test through
   `deriveAssistantActivityPresentation`).
2. Select the last `running`/`approval` entry from the already-derived Activity
   model.
3. Map semantic kind and motion from entry **status first** (`approval` →
   `approval`/`none`, regardless of kind), then kind (reasoning → thinking).
4. Reuse its title as the label — reference-confirmed: the live label is the
   settled row title byte-for-byte (§5).
5. Fall back to the existing phase switch only when no active entry exists
   (structurally, only pre-evidence states reach it).
6. Give the image entry's running title a `"Generating image"` fallback when
   the input carries no action description, so the entry-first label does not
   regress the current phase copy.
7. Leave `AssistantTurnPhase`, `deriveAssistantTurnPhase(...)`, completion
   derivation, entry ordering, and source attribution unchanged.

Required tests (all via `deriveAssistantActivityPresentation`):

- bare submitted stream -> phase fallback `Thinking`;
- opaque reasoning -> `Thinking` fallback or active reasoning title;
- active search query -> specific entry title;
- completed search plus next running search -> next search title;
- one active ordinary tool -> tool entry title;
- multiple active tools -> last chronological active entry;
- active image generation -> `Generating image` (no-action input);
- awaiting approval -> approval entry title and no shimmer;
- search-classified tool awaiting approval -> no shimmer (status beats kind);
- stale running implied-search behind completed work -> pinned expected label;
- settled presentation copy unchanged;
- completion still exists during `responding`.

### Step 2: expose panel follow context

Files:

- `app/components/chat/use-activity-panel.ts`
- `app/components/chat/use-activity-panel.test.tsx`

Actions:

1. Add `turnKey` and `followLatest` to `panelProps`.
2. Use `panelActivityTurnId` as the key.
3. Set following only for the generation-following default turn.
4. Keep explicit selection resolution and stale-selection behavior unchanged.
5. Keep the live reasoning timer attached to the default generation even when
   the panel shows a historical turn.

Required tests:

- default streaming turn -> `followLatest: true`;
- pending placeholder -> cannot open and does not create a body follower;
- explicit historical turn while newer turn streams -> `followLatest: false`;
- historical stopped/failed/approval turns -> `followLatest: false`;
- selected turn disappears after branch switch -> existing stale-selection
  result remains correct;
- new default turn changes `turnKey`;
- server/client id alias matching remains unchanged.

### Step 3: add Activity-owned scroll-follow controller

Files:

- `app/components/chat/activity/use-activity-panel-scroll-follow.ts` (new)
- `app/components/chat/activity/use-activity-panel-scroll-follow.test.tsx`

Actions:

1. Implement a small Activity-specific hook/controller using refs, callback
   refs, passive scroll events, `ResizeObserver`, rAF coalescing, and
   `useEffectEvent` for policy reads.
2. Keep pinned state outside React state; pinned (plus the `wasOverflowing`
   guard) is the only growth-follow gate.
3. `startAtEnd` forces `pinned = true` at attach and schedules the initial
   alignment (§8) — geometry-computed pinned would leave it dead.
4. Re-check pinned state inside the scheduled frame.
5. Ensure a new `turnKey` produces a clean controller lifecycle without a
   dependency-driven effect; construction stays side-effect-free.
6. Ensure every attach path returns complete, node-guarded cleanup (React
   does not call the ref with `null` when a cleanup is returned).

Test setup:

- jsdom via the repository convention: the file starts with
  `/** @vitest-environment jsdom */` (the global vitest environment is
  `node`).
- Mock `ResizeObserver` with explicit `observe`, `disconnect`, and trigger
  helpers.
- Mock `requestAnimationFrame`/`cancelAnimationFrame` or use the repository's
  existing test pattern if one exists.
- Define `scrollTop`, `scrollHeight`, and `clientHeight` explicitly on the
  viewport element, and stub `Element.prototype.scroll` (jsdom does not
  implement it).

Required tests:

- live open midway (`startAtEnd`) -> initial end alignment;
- pinned + content growth -> follows;
- two resize notifications in one frame -> one write;
- user scrolls beyond threshold before queued frame -> no write;
- user-scrolled + content growth -> no movement;
- user returns within threshold -> following resumes;
- exactly-on-threshold behavior is deterministic;
- sub-pixel/negative end distance counts as pinned;
- live -> settled terminal-row growth while pinned -> follows (no
  special-case state);
- settled growth while user is scrolled up -> no movement;
- short non-overflowing panel that first overflows -> no yank
  (`wasOverflowing` guard);
- turn switch disconnects observer and listener;
- responsive viewport replacement detaches old and attaches new, and a late
  old-shell cleanup does not clear the new shell's viewport;
- unmount cancels pending frame;
- historical initial mount (`startAtEnd: false`) remains at top.

### Step 4: wire both responsive viewports

Files:

- `components/ui/scroll-area.tsx`
- `app/components/chat/activity/docked-flyout-shell.tsx`
- `app/components/chat/activity/activity-panel.tsx`
- `app/components/chat/activity/activity-panel.test.tsx`

Actions:

1. Widen `viewportRef` from `RefObject` to `React.Ref` in the low-level
   transport components (verified compatible: Base UI's `ScrollAreaViewport`
   accepts `RefAttributes<HTMLDivElement>`, and `React.Ref` still admits the
   existing object refs).
2. Add `turnKey` and `followLatest` to `ActivityPanel` props.
3. Instantiate the Activity scroll-follow hook once in `ActivityPanel`.
4. Compute `startAtEnd = followLatest && section === undefined` from the
   panel's own `useActivityPanelSectionTarget()` read (§7) — the explicit
   Sources-priority gate.
5. Pass `viewportRef` into `DockedFlyoutShell`.
6. Pass the same `viewportRef` into the mobile `ScrollArea`.
7. Attach `contentRef` to a wrapper encompassing timeline, images, and Sources.
8. Include `turnKey` alongside the existing open/closed identity in the body
   reset key. This is load-bearing, not cosmetic: reasoning row ids
   (`reasoning-{partIndex}-{stepIndex}`) and implied-search ids
   (`search-sources-{partIndex}`) can collide across different turns, so a
   default-turn handoff without a remount could leak per-row state (e.g.
   chip expansion) between turns. Preserve the current open reset used by
   Sources.
9. Do not alter `ActivityTimeline`, marker mapping, connector geometry,
   desktop collapse ownership, Sheet focus management, or approval handling.

Required component tests:

- desktop shell receives the external viewport ref;
- mobile `ScrollArea` receives the same ref contract;
- only the active shell owns the viewport attachment;
- panel close detaches the viewport (no scheduled write can land after close);
- reopen live positions at end;
- reopen historical starts at top;
- Sources targeting still scrolls to the Sources section;
- explicit historical selection is not replaced during a live update;
- approval buttons remain single-submit and accessible;
- existing panel landmark/dialog semantics are unchanged.

### Step 5: integration and browser verification

No new production files should be required.

Run the narrow automated checks first:

```bash
bun run test -- \
  lib/chat-messages/turn-evidence.test.ts \
  lib/chat-messages/assistant-turn.test.ts \
  app/components/chat/use-activity-panel.test.tsx \
  app/components/chat/activity/use-activity-panel-scroll-follow.test.tsx \
  app/components/chat/activity/activity-panel.test.tsx \
  app/components/chat/activity/activity-timeline.test.tsx \
  app/components/chat/activity/content-sheet-shell.test.tsx
```

(The command form is verified: `bun run test -- <files>` forwards the file
filters to `vitest run`. `docked-flyout-shell.test.tsx` does not exist — the
shell's behavior is owned by `activity-panel.test.tsx`; put shell-ref
assertions there rather than creating a shell-only test.)

Then run:

```bash
bun run typecheck
```

The `lint` script is `eslint .` with the target baked in, so
`bun run lint -- <files>` still lints the whole repository. For a narrow
pass use `bunx eslint <changed files>`; otherwise run the full repository
lint after the targeted tests and typecheck are green.

Before handoff:

```bash
git diff --check
git diff -- \
  lib/chat-messages/assistant-activity.ts \
  lib/chat-messages/assistant-turn.test.ts \
  app/components/chat/use-activity-panel.ts \
  app/components/chat/use-activity-panel.test.tsx \
  app/components/chat/activity/use-activity-panel-scroll-follow.ts \
  app/components/chat/activity/use-activity-panel-scroll-follow.test.tsx \
  app/components/chat/activity/activity-panel.tsx \
  app/components/chat/activity/activity-panel.test.tsx \
  app/components/chat/activity/docked-flyout-shell.tsx \
  components/ui/scroll-area.tsx
git status --short
```

Do not stage, delete, or normalize unrelated files.

## 10. Derivation transition matrix

Use this matrix for pure tests and browser fixtures.

| Sequence                           | Expected timeline behavior            | Expected live label                          |
| ---------------------------------- | ------------------------------------- | -------------------------------------------- |
| submitted, no parts                | no panel body yet                     | `Thinking` fallback                          |
| reasoning starts                   | reasoning row appears/runs            | reasoning title                              |
| reasoning completes, search starts | reasoning remains; search appends     | search title                                 |
| search input enriches              | same search id and position           | enriched search title                        |
| search completes, page read starts | search remains complete; read appends | read title                                   |
| tool A and tool B start            | both retain chronology                | latest active title                          |
| tool A completes while B runs      | A remains complete; B stays active    | tool B title                                 |
| image generation starts            | image row appends/runs                | image title                                  |
| approval requested                 | same tool row becomes approval        | approval title                               |
| approval granted                   | row returns to running/in-flight      | tool title                                   |
| approval denied                    | row becomes denied; no running entry  | phase fallback/terminal presentation         |
| text begins while work ends        | completion may appear                 | disclosure becomes terminal when appropriate |
| stop during tool                   | frozen raw part resolves stopped; terminal row follows when pinned | settled "Generation stopped" completion copy |
| tool/stream failure                | error row and failed completion; terminal row follows when pinned  | settled "Run failed" completion copy         |
| ready/settled                      | no active entries                     | settled `Worked for`/`Activity` copy         |

Every transition must preserve prior chronological entries and stable row ids.

## 11. Manual browser acceptance matrix

Use a harmless prompt that reliably produces multiple search steps. Record the
date, conversation URL, viewport, model/mode, and exact transitions for the
local implementation verification.

### Desktop dock

1. Start a multi-search response and open Activity as soon as the control is
   available.
2. Confirm the viewport begins at the newest content.
3. Confirm previous completed rows remain visible above the active row.
4. Confirm the status label matches the latest active row after evidence exists.
5. Leave the viewport pinned and verify new rows/source chips/tool-card growth
   remain visible.
6. Scroll at least one viewport upward.
7. Verify subsequent growth does not move the viewport.
8. Scroll back to the bottom.
9. Verify following resumes.
10. Verify terminal completion becomes visible when pinned.
11. Close and reopen while still live; verify it opens at the end.
12. Open an older turn, start a new response, and confirm the older panel stays
    selected and does not move.

### Mobile/narrow sheet

Repeat the pinned, user-scrolled, resume, close/reopen, and historical-selection
checks at approximately 390 x 844.

Also verify:

- touch scrolling remains native;
- the Sheet's focus trap and accessible name are unchanged;
- the keyboard does not cause a stale desktop viewport to receive writes;
- safe-area padding and drag/close behavior remain unchanged;
- changing between narrow and desktop cleans up the old viewport attachment.

### State variants

Verify with available fixtures or supported local tools:

- reasoning -> search -> page read -> second search;
- multiple ordinary tools;
- image generation and image result sizing;
- approval requested, approved, and denied;
- explicit Stop during reasoning and during a tool;
- tool failure and stream failure;
- terminal settlement after a response that never emitted visible reasoning;
- historical stopped/failed turns while a new turn streams.

Do not send destructive tool requests solely for visual verification.

## 12. Accessibility and reduced motion

- Programmatic following must never call `focus()`.
- Preserve native `ScrollArea` keyboard and touch scrolling.
- Preserve the desktop `section` landmark and mobile Sheet dialog semantics.
- Do not add a token-level `aria-live` region. Repeated streaming announcements
  would be noisy and could expose excessive internal activity.
  Reference-confirmed: the live ChatGPT flyout stage contains zero
  `aria-live` nodes (2026-07-13 DOM inspection).
- Keep approval controls keyboard-accessible and preserve their pending
  duplicate-submission guard.
- Use instant scrolling for automatic streaming follow.
- Do not use repeated smooth scrolling; this is distracting even when reduced
  motion is not requested.
- Preserve existing `motion-reduce` row-animation and Sheet-transition rules.
- If a future explicit jump control is added, it must have an accessible name
  and honor `prefers-reduced-motion`, but that control is outside this scope.

## 13. Failure modes and review traps

Reviewers should reject the change if it introduces any of these:

- `useEffect` that copies phase or Activity data into component state.
- A new `livePhase`, `currentStep`, or `activeTool` state machine in the panel.
- Reading raw AI SDK parts directly from `ActivityPanel`.
- Provider-name checks in Activity derivation or rendering.
- Sorting Activity entries after `deriveTurnEvidence(...)` establishes order.
- New row ids derived from array indexes or mutable labels.
- `MutationObserver` used as the primary layout-growth signal.
- Following whenever content changes without checking user-pinned state.
- A smooth scroll for every streamed delta.
- Scroll policy added to `ScrollArea` or `DockedFlyoutShell`.
- Conversation `ScrollRoot` behavior copied wholesale into the panel.
- A jump-to-latest control added without an explicit product decision.
- Running/complete marker redesign justified only by inference.
- Auto-switching an explicitly selected historical panel to the latest turn.
- Observer/listener cleanup that depends on a later render occurring.
- Memoizing `UIMessage.parts` derivation by array identity. AI SDK updates may
  enrich parts without a useful new container identity.
- A newly exported live-status resolver or `AssistantActivityLiveStatus`
  type — the resolver stays private; the module seam stays closed.
- Options refs assigned during render as a substitute for `useEffectEvent`.
- Detach logic in an `if (node === null)` ref branch — with a returned
  cleanup, React never calls the ref with `null`.
- A `followedLiveThisTurn`/`finalResizeConsumed`-style final-resize counter —
  the pinned-only gate (Decision E) makes it unnecessary.
- A new DOM test file without the `/** @vitest-environment jsdom */` pragma
  (the global vitest environment is `node`).

Likely implementation races:

- Content resize queues a frame, then the user scrolls upward. Re-check pinned
  state inside the frame (scroll events fire before rAF callbacks in the same
  rendering update).
- Desktop unmounts while a frame is queued and mobile attaches. Cancel the old
  frame, and guard cleanup by node identity so the old shell's cleanup never
  clears the new shell's viewport.
- Sources navigation while `followLatest` is true. Solved structurally:
  `startAtEnd` is false while a section target is pending, so no initial
  alignment is ever queued against the target.
- A short panel's first overflow. The `wasOverflowing` guard prevents a
  trivially-pinned, non-overflowing viewport from yanking to the end.

## 14. Non-goals

- Replacing `ActivityPanel`, `ActivityTimeline`, or `DockedFlyoutShell`.
- Redesigning row markers, connectors, section headings, source chips, or tool
  cards.
- Exposing raw chain-of-thought.
- Persisting viewport position across application reloads.
- Sharing viewport position between desktop and mobile shells.
- A generic `useFollowScroll` package-level abstraction.
- New dependencies.
- Provider-specific presentation behavior.
- Changing the AI SDK stream wire contract.
- Changing historical-turn selection ownership.
- Claiming reference parity for unobserved live-panel or mobile behaviors.
- Replicating current ChatGPT's thread-inline condensed activity summary
  (the past-tense rows that expand under "Worked for Ns" in the thread) —
  a separate surface; this repository deliberately keeps the panel as the
  single activity surface.
- Re-tensing settled row titles (reference keeps present-progressive titles
  in the panel; our settled past-tense fallbacks are pre-existing copy
  outside this TODO).

## 15. Primary sources

Repository sources of truth:

- `AGENTS.md`
- `CONTEXT.md`
- `docs/activity-panel-multistep-research.md`
- `research/chatgpt-activity-source-chips-2026-07-13.md`
- `lib/chat-messages/assistant-turn.ts`
- `lib/chat-messages/turn-evidence.ts`
- `lib/chat-messages/assistant-activity.ts`
- `app/components/chat/use-activity-panel.ts`
- `app/components/chat/activity/activity-panel.tsx`
- `app/components/chat/activity/activity-timeline.tsx`
- `app/components/chat/activity/docked-flyout-shell.tsx`
- `components/ui/scroll-area.tsx`
- `components/ui/scroll-root.tsx`
- `app/components/chat/thread-scroll.tsx`

Reference evidence gathered for this plan:

- Live-transition capture, §5 (2026-07-13, logged-in conversation).
- Read-only settled-panel DOM inspection, §5 (2026-07-13, same conversation;
  no messages sent). Confirms label-equals-row-title, top-opening settled
  panels, plain `overflow-y-auto` + `overflow-anchor: auto` scroller, zero
  `aria-live` nodes, no settled jump-to-latest control, and the
  `Worked for Ns` / `Done` terminal row.
- Sibling captures: `/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/`
  (`research/activity-panel-component-inventory.md`,
  `research/activity-panel-open-close-animation.md`).

Official external references:

- AI SDK `UIMessage` parts:
  <https://ai-sdk.dev/docs/reference/ai-sdk-core/ui-message>
- AI SDK UI stream protocol:
  <https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol>
- AI SDK `useChat` statuses:
  <https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat>
- AI SDK tool calling:
  <https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling>
- AI SDK tool approvals:
  <https://ai-sdk.dev/docs/agents/tool-approvals>
- AI SDK stopping streams:
  <https://ai-sdk.dev/docs/advanced/stopping-streams>
- React: manipulating the DOM with refs:
  <https://react.dev/learn/manipulating-the-dom-with-refs>
- React 19 callback-ref cleanup:
  <https://react.dev/blog/2024/12/05/react-19#cleanup-functions-for-refs>
- React `useEffectEvent` (shipped in React 19.2; present in the installed
  `@types/react@19.2.17`):
  <https://react.dev/reference/react/useEffectEvent>
- React: You Might Not Need an Effect:
  <https://react.dev/learn/you-might-not-need-an-effect>
- React `useLayoutEffect`:
  <https://react.dev/reference/react/useLayoutEffect>
- MDN `ResizeObserver`:
  <https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver>
- MDN element scrolling:
  <https://developer.mozilla.org/en-US/docs/Web/API/Element/scroll>
- MDN scroll events:
  <https://developer.mozilla.org/en-US/docs/Web/API/Element/scroll_event>
- MDN CSS scroll anchoring:
  <https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll_anchoring>
- MDN `prefers-reduced-motion`:
  <https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion>
- Base UI Scroll Area:
  <https://base-ui.com/react/components/scroll-area>
- Radix Scroll Area, consulted for native-scroll ownership comparison:
  <https://www.radix-ui.com/primitives/docs/components/scroll-area>

## 16. Final implementation checklist

- [ ] Read `AGENTS.md`, `CONTEXT.md`, this plan, and current relevant code before editing.
- [ ] Confirm the working tree and preserve unrelated changes.
- [ ] Keep `orderedParts` and Turn evidence as the chronology seam.
- [ ] Implement evidence-first, phase-fallback live status derivation by
      extending the private `resolveLiveStatus` (no new exports); map
      semantic kind/motion from entry status first.
- [ ] Add the image entry's `"Generating image"` running-title fallback.
- [ ] Do not alter terminal `responding || settled` semantics.
- [ ] Expose `turnKey` and `followLatest` from `useActivityPanel`.
- [ ] Add the Activity-specific scroll-follow hook (pinned-only gate,
      `startAtEnd`, `wasOverflowing` guard, `useEffectEvent` policy reads,
      node-guarded cleanup) and focused tests with the jsdom pragma.
- [ ] Widen viewport-ref transport without adding policy to primitives.
- [ ] Wire the same policy to desktop and mobile viewports.
- [ ] Preserve Sources targeting, explicit historical selection, approval behavior, and timeline geometry.
- [ ] Verify pinned, user-scrolled, resumed, open-mid-stream, turn-switch, and final-settlement behavior.
- [ ] Verify stop, failure, approval, image, and multi-tool transitions.
- [ ] Verify desktop, mobile, reduced motion, keyboard, touch, and focus behavior.
- [ ] Run targeted tests, typecheck, `git diff --check`, scoped diff review, and final status review.
- [ ] Report reference-supported behavior separately from product decisions.

**Implementation directive: preserve the current architecture and add only an
evidence-first live-label extension of the private `resolveLiveStatus` plus an
ActivityPanel-owned, pinned-only-gated viewport follower. The live-label
source (entry titles) is reference-confirmed; the follow policy remains an
uncontradicted product decision.**
