# Turn-anchor scroll restoration (ChatGPT parity)

Implementation plan for saving and restoring per-conversation thread scroll positions using semantic turn anchors instead of raw `scrollTop`, replicating the audited ChatGPT production behavior.

**Reference research (read first):** `docs/chatgpt-scroll-restoration-source-research.md` — independently audited 2026-07-17 against production source; every algorithm below is confirmed there. When this plan and that document disagree, the research document wins.

---

## 0. Ground rules for the implementer

1. **Stay on the current git branch.** Do not create or switch branches. Do not push or open a PR unless asked.
2. **Use bun** for everything (`bun add`, `bunx`, `bun run`).
3. **Never kill or restart the dev server on port 3000.** The user's long-running `bun dev` owns it. Live verification happens through the user's signed-in Chrome against `localhost:3000`.
4. **Scope is exactly three files** (one new, one modified, one-or-two test files). If you believe another file must change, stop and report instead of changing it.
5. Files you must **NOT** modify:
   - `components/ui/scroll-root.tsx` — the scroll root already has everything we need (`data-scroll-root`, layout ownership).
   - `app/components/chat/conversation.tsx` — the turn markup (`data-turn-id-container={message.id}`) already exists at line ~267. `ThreadScrollEdge`'s props do not change.
   - `app/globals.css`, `app/components/chat/thread-bounds.ts` — no CSS involvement.
6. Keep tests **lean**. This repo deliberately concentrates coverage on risky logic (anchor math), not wiring. Do not add listener-plumbing tests.

---

## 1. What you are building

Today, `ThreadScrollEdge` (in `app/components/chat/thread-scroll.tsx`) restores a conversation's position with a single "jump to bottom" — effect (5), "Load restore," lines ~179–188. You will:

1. Add a small pure module holding a **module-scoped in-memory `Map`** of `chatId → { turnId, offsetFromTopPx }`.
2. **Save** into that map after each scroll settles (`scrollend` + one animation frame).
3. **Restore** from it in effect (5) before falling back to the bottom jump.
4. Upgrade the bottom fallback from one assignment to **three** (sync + two nested animation frames) to absorb late layout growth.

The saved value is *semantic*: which turn was at the top of the viewport and its signed pixel offset from the scroll root's top edge. Never a raw `scrollTop`. This survives content-height changes above the anchor (panel reflows, image loads, width changes) that raw pixel restoration cannot.

**Persistence boundary (deliberate, do not "improve"):** in-memory only. The map survives client-side navigation (same JS realm); a full page reload starts empty and falls back to bottom. No `localStorage`, no backend, no eviction, no `delete`/`clear`. This matches audited ChatGPT behavior exactly.

---

## 2. New file: `app/components/chat/thread-scroll-anchors.ts`

Create this file with exactly this content (adjust only if lint/format demands):

```ts
/**
 * Turn-anchor scroll restoration (ChatGPT parity — see
 * docs/chatgpt-scroll-restoration-source-research.md).
 *
 * A saved position is semantic: the top-visible turn's id plus its signed
 * pixel offset from the scroll root's top edge — never a raw scrollTop.
 * Restoration is a relative scrollTop correction from current geometry, so
 * height changes above the anchor (reflow, images, width changes) cannot
 * break it.
 *
 * The map is module-scoped and in-memory BY DESIGN: it survives client-side
 * navigation, and a full reload deliberately starts empty (the caller's
 * bottom fallback runs). No eviction, no serialization — matching the
 * audited ChatGPT behavior.
 */

type SavedThreadAnchor = {
  turnId: string
  offsetFromTopPx: number
}

const TURN_CONTAINER_SELECTOR = "[data-turn-id-container]"

const savedThreadAnchors = new Map<string, SavedThreadAnchor>()

/**
 * The first turn crossing the root's top edge, else the first turn starting
 * inside the viewport, else null. Uses the raw root rect top (not the sticky
 * header edge): save and restore share the same reference edge, so header
 * occlusion cancels out.
 *
 * Containers are flat siblings (conversation.tsx renders one per mapped
 * message; the pending-assistant placeholder has no container), so no
 * nested-duplicate filtering is needed.
 */
export function selectAnchorTurn(root: HTMLElement): HTMLElement | null {
  const rootRect = root.getBoundingClientRect()
  const turns = Array.from(
    root.querySelectorAll<HTMLElement>(TURN_CONTAINER_SELECTOR)
  )
  return (
    turns.find((turn) => {
      const rect = turn.getBoundingClientRect()
      return rect.top <= rootRect.top && rect.bottom > rootRect.top
    }) ??
    turns.find((turn) => {
      const rect = turn.getBoundingClientRect()
      return rect.top >= rootRect.top && rect.top < rootRect.bottom
    }) ??
    null
  )
}

export function saveThreadAnchor(chatId: string, root: HTMLElement): void {
  const turn = selectAnchorTurn(root)
  const turnId = turn?.dataset.turnIdContainer
  if (!turn || !turnId) return
  const offsetFromTopPx =
    root.getBoundingClientRect().top - turn.getBoundingClientRect().top
  if (!Number.isFinite(offsetFromTopPx)) return
  savedThreadAnchors.set(chatId, { turnId, offsetFromTopPx })
}

/** Relative correction — never assigns a stored raw scrollTop. */
export function restoreThreadAnchor(
  chatId: string,
  root: HTMLElement
): boolean {
  const saved = savedThreadAnchors.get(chatId)
  if (!saved) return false
  const turn = root.querySelector<HTMLElement>(
    `[data-turn-id-container="${CSS.escape(saved.turnId)}"]`
  )
  if (!turn) return false
  const rootTop = root.getBoundingClientRect().top
  const desiredTurnTop = rootTop - saved.offsetFromTopPx
  root.scrollTop += turn.getBoundingClientRect().top - desiredTurnTop
  return true
}

/** Test-only reset — the map is module state shared across tests. */
export function resetThreadAnchorsForTest(): void {
  savedThreadAnchors.clear()
}
```

Semantics to preserve exactly (these are the audited ChatGPT inequalities — off-by-one changes are bugs):

- Primary pick: `turn.top <= root.top && turn.bottom > root.top` (turn *crosses* the top edge; a turn ending exactly at the top edge does not count).
- Fallback pick: `turn.top >= root.top && turn.top < root.bottom` (turn *starts* inside the viewport).
- Offset sign: `root.top − turn.top` — positive when the turn starts above the visible edge, negative when the fallback turn starts below it, zero at exact alignment.
- `Number.isFinite` guard before `set` — a found turn with a non-finite measurement is dropped.
- Restore math: `scrollTop += turnTop − (rootTop − saved.offsetFromTopPx)`.

---

## 3. Modify: `app/components/chat/thread-scroll.tsx`

Four changes. Read the whole file first — it is ~205 lines and every effect is numbered in comments.

### 3.1 Imports and constants

Add to the imports:

```ts
import {
  restoreThreadAnchor,
  saveThreadAnchor,
} from "./thread-scroll-anchors"
```

Add near the existing constants (`SCROLL_FROM_END_ROOT_MARGIN`, etc.):

```ts
/** Trailing-idle fallback for browsers without native `scrollend`. */
const SCROLL_IDLE_FALLBACK_MS = 150
```

### 3.2 Update the file header comment

The header (lines 3–8) says "once-per-conversation scroll restoration." Extend it to mention that restoration is anchor-based with a bottom fallback, e.g. append: `Restoration prefers a saved turn anchor (thread-scroll-anchors.ts) and falls back to the bottom.`

### 3.3 Rewrite effect (5) "Load restore"

Replace the current effect (5) (lines ~179–188) with:

```tsx
// (5) Load restore — once per conversation, instant, before paint. A saved
// turn anchor wins; otherwise fall back to the bottom, repeated across two
// frames to absorb late layout growth (images, markdown measurement).
useBrowserLayoutEffect(() => {
  if (!hydrated) return
  if (restoredChatRef.current === chatId) return
  restoredChatRef.current = chatId
  if (freshChat || streamActive || pinnedTurnRef.current !== null) return
  const rootEl = rootRef.current
  if (!rootEl) return
  if (chatId !== null && restoreThreadAnchor(chatId, rootEl)) return
  const toBottom = () =>
    rootEl.scrollTo({ top: rootEl.scrollHeight, behavior: "instant" })
  toBottom()
  let frame: number | null = requestAnimationFrame(() => {
    toBottom()
    frame = requestAnimationFrame(() => {
      frame = null
      toBottom()
    })
  })
  return () => {
    if (frame !== null) cancelAnimationFrame(frame)
  }
}, [hydrated, chatId, freshChat, streamActive])
```

What must NOT change here:

- The guard order. `hydrated` gate first, then the once-per-chat `restoredChatRef` latch, then the `freshChat || streamActive || pinnedTurnRef` bypass. These guards are this codebase's equivalent of ChatGPT's `?message=` deep-link bypass — the pin system owns positioning for fresh/streaming chats.
- The hook: `useBrowserLayoutEffect` (pre-paint — matches ChatGPT's `useLayoutEffect`, confirmed in the research doc).
- The dependency array.

Notes:

- The effect now returns a cleanup (it previously returned nothing). The cleanup only cancels pending fallback frames; it must never scroll or save. Dep changes within two frames of a restore (rare) cancel the repeat assignments — harmless, and it mirrors ChatGPT's own cleanup.
- `chatId !== null` guard before `restoreThreadAnchor`: a brand-new chat has `chatId === null` before its route handoff; there is nothing to restore under a null key.

### 3.4 Add effect (6) — anchor save

Add this effect directly after effect (5):

```tsx
// (6) Anchor save — when the scroll settles, wait one frame for layout to
// settle, then capture the top-visible turn into the module anchor map. A
// later settle cancels and replaces a pending save. Cleanup never performs
// a final save: navigating away before the scroll settles keeps the
// previous settled anchor (ChatGPT-parity, accepted edge).
useEffect(() => {
  const rootEl = rootRef.current
  if (!rootEl || chatId === null) return
  let frame: number | null = null
  let idleTimer: number | null = null
  const scheduleSave = () => {
    if (frame !== null) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      frame = null
      saveThreadAnchor(chatId, rootEl)
    })
  }
  const supportsScrollEnd = "onscrollend" in window
  const onScroll = () => {
    if (idleTimer !== null) window.clearTimeout(idleTimer)
    idleTimer = window.setTimeout(scheduleSave, SCROLL_IDLE_FALLBACK_MS)
  }
  if (supportsScrollEnd) {
    rootEl.addEventListener("scrollend", scheduleSave, { passive: true })
  } else {
    rootEl.addEventListener("scroll", onScroll, { passive: true })
  }
  return () => {
    if (supportsScrollEnd) {
      rootEl.removeEventListener("scrollend", scheduleSave)
    } else {
      rootEl.removeEventListener("scroll", onScroll)
    }
    if (idleTimer !== null) window.clearTimeout(idleTimer)
    if (frame !== null) cancelAnimationFrame(frame)
  }
}, [chatId])
```

Notes:

- `rootRef.current` is already set when this effect runs: it is populated by `sentinelRef` (a ref callback on a child div), and React runs ref callbacks before effects.
- The `scrollend` path mirrors ChatGPT exactly (passive listener, save one `requestAnimationFrame` later, newer settle cancels the pending frame). The `scroll` + trailing 150 ms timer path is the fallback for browsers without `scrollend` — ChatGPT ships a polyfill for the same reason.
- The listener attaches **unconditionally with respect to pin/stream state** — saves may happen during a stream. That is correct: anchors are semantic and streaming content grows *below* the anchor. Do not add `streamActive` to the deps or guards.
- Do not save when `chatId` is null.

### 3.5 What NOT to touch in this file

- The per-conversation chat-key reset effect (lines ~82–87) must remain the **first** effect declared — its comment says so and the pin/restore effects depend on that ordering.
- Effects (1)–(4) (sentinel, gutter, stream attribute, pinning) are untouched.
- The unmount cleanup effect (lines ~150–156) is untouched — the new effects own their own cleanup.
- The `data-scroll-from-end` attribute needs no coordination: restoring `scrollTop` re-fires the sentinel's IntersectionObserver and the attribute self-corrects.

---

## 4. Tests

### 4.1 New file: `app/components/chat/thread-scroll-anchors.test.ts`

Header: `/** @vitest-environment jsdom */`. Import `beforeEach`/`afterEach` from vitest; call `resetThreadAnchorsForTest()` in `beforeEach`. Stub `CSS` the way `thread-scroll.test.tsx` does (`vi.stubGlobal("CSS", { escape: (value: string) => value })`) and `vi.unstubAllGlobals()` in `afterEach`.

Build fixtures with plain DOM + mocked geometry (jsdom has no layout):

```ts
function makeRoot(
  rootRect: { top: number; bottom: number },
  turns: Array<{ id: string; top: number; bottom: number }>
): HTMLElement {
  const root = document.createElement("div")
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(rootRect as DOMRect)
  for (const t of turns) {
    const el = document.createElement("div")
    el.setAttribute("data-turn-id-container", t.id)
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      top: t.top,
      bottom: t.bottom,
    } as DOMRect)
    root.appendChild(el)
  }
  return root
}
```

`root.scrollTop` is a plain settable number on a jsdom div — read it directly in assertions.

Write exactly these five tests (lean; each pins one audited semantic):

1. **Crossing turn wins over inside turn.** Root `{top: 100, bottom: 600}`; turns `a {top: 40, bottom: 140}` (crosses), `b {top: 140, bottom: 300}` (inside). `selectAnchorTurn` returns the `a` element. Also assert the boundary: a turn with `bottom === rootTop` (e.g. `{top: 0, bottom: 100}`) does **not** count as crossing.
2. **Fallback to first turn inside the viewport.** No turn crosses (all start below top edge): turns `a {top: 150, bottom: 300}`, `b {top: 300, bottom: 450}` → returns `a`. And when every turn is fully above the viewport or the list is empty → returns `null`.
3. **Save → restore round-trip with height change above the anchor.** Save with root top 100 and turn `m2` top 60 (offset `100 − 60 = 40`). Then build a *new* root for the same chatId where `m2` now sits at top 260 (content above grew), `scrollTop` starts at 500. `restoreThreadAnchor` returns true and `scrollTop` becomes `500 + (260 − (100 − 40)) = 700`. This is the test that proves anchor semantics beat raw-pixel restore — keep the arithmetic in a comment.
4. **Restore misses.** Unknown chatId → false. Known chatId but the saved turn id is absent from the DOM → false, and `scrollTop` unchanged.
5. **Non-finite offset is not stored.** Mock the turn rect top as `NaN`; `saveThreadAnchor` then `restoreThreadAnchor` → false.

### 4.2 Extend: `app/components/chat/thread-scroll.test.tsx`

Reuse the file's existing stubs (`requestAnimationFrame` frame map + `flushFrames()`, `IntersectionObserver`, `CSS`). Add:

- A `HTMLElement.prototype.scrollTo` stub alongside the existing `scrollIntoView` stub (same `Object.defineProperty` save/restore pattern) — jsdom does not implement it, and effect (5) now reaches it in these tests.
- `resetThreadAnchorsForTest()` in `beforeEach` (import from `./thread-scroll-anchors`).
- Extend the `render` helper to accept prop overrides — the current helper hardcodes `freshChat` and `hydrated`; these tests need `freshChat: false`.

Add exactly two tests:

1. **Restores a saved anchor instead of jumping to bottom.** Arrange: mock `container.getBoundingClientRect` (the test's `container` IS the `[data-scroll-root]` element), append a child with `data-turn-id-container="m1"` and a mocked rect so it crosses the top edge, call `saveThreadAnchor("chat-1", container)` directly, set `container.scrollTop = 0`. Act: render `ThreadScrollEdge` with `chatId="chat-1"`, `hydrated`, `freshChat: false`, `streamActive: false`, `pinTurnId: null`. Assert: `scrollTo` was **not** called and `container.scrollTop` changed by the expected delta.
2. **Bottom fallback runs three assignments when no anchor exists.** Same render with an empty anchor map. Assert `scrollTo` called once synchronously; `flushFrames()` → twice; `flushFrames()` → three times, each with `{top: container.scrollHeight, behavior: "instant"}`.

Do not add tests for the `scrollend` listener wiring, the idle-timer fallback, or cleanup ordering — wiring, not logic.

---

## 5. Verification

### 5.1 Automated

```sh
bunx vitest run app/components/chat/thread-scroll-anchors.test.ts app/components/chat/thread-scroll.test.tsx
bunx tsc --noEmit
```

(If the repo defines a `test`/`typecheck` script in `package.json`, prefer `bun run <script>`.)

Both must pass with zero unrelated changes.

### 5.2 Live (through the user's Chrome on :3000 — do not start or kill any server)

The acceptance criterion comes straight from the research doc: *the same `data-turn-id-container` returns to the same signed offset even when content above it changes height.*

1. Open a long existing conversation. Scroll to mid-thread. Note (via DevTools or the browser-automation `javascript_tool`) which `[data-turn-id-container]` is at the top edge and its `getBoundingClientRect().top` relative to the scroll root's top.
2. Switch to another conversation via the sidebar; switch back. **Expect:** same container id at the same offset (±1px), not the bottom.
3. Collapse or expand the sidebar (changes thread width → reflows all heights above the anchor), switch away and back. **Expect:** same container at the same offset. This is the case a raw-`scrollTop` implementation fails.
4. Open a conversation never visited this session. **Expect:** opens at the bottom.
5. Hard-reload the tab, reopen the conversation from step 1. **Expect:** bottom (the in-memory map is empty — deliberate).
6. Send a message in a chat, confirm answer-start pinning still behaves exactly as before (the pin path is untouched); scroll during the stream, switch away and back after it completes, expect the anchor to restore.
7. Check the browser console for errors throughout.

If any expectation fails, diagnose in source before touching timing or adding retries — the algorithm has no tunable constants except `SCROLL_IDLE_FALLBACK_MS`.

---

## 6. Edge-case decisions (already made — implement as stated, do not re-litigate)

| Case | Behavior | Why |
| --- | --- | --- |
| Saved turn removed (branch switch, edit) | Restore returns false → bottom fallback | Deterministic; matches ChatGPT |
| Revisit while a stream is active | Restoration skipped entirely (existing `streamActive` guard) | Our pin/gutter system owns mid-stream position; deliberate divergence from ChatGPT, documented open product decision |
| New chat before route handoff (`chatId === null`) | No save, no restore | Nothing to key by; `freshChat` skips restore anyway |
| Rapid navigation before `scrollend` fires | Previous settled anchor kept (no save-on-cleanup) | ChatGPT-parity; accepted edge |
| Map growth | Unbounded, no eviction | Entries are ~50 bytes; matches ChatGPT; do not add an LRU |
| Cross-tab / reload persistence | None | Parity; a future product decision, out of scope |

## 7. Definition of done

- [ ] `app/components/chat/thread-scroll-anchors.ts` created; exports `selectAnchorTurn`, `saveThreadAnchor`, `restoreThreadAnchor`, `resetThreadAnchorsForTest`; no other exports; no storage APIs referenced.
- [ ] `thread-scroll.tsx`: effect (5) tries the anchor then triple-bottom fallback; new effect (6) saves on settle; header comment updated; nothing else changed.
- [ ] Five pure tests + two lifecycle tests pass; no existing tests modified except the `render` helper extension and shared stubs.
- [ ] `bunx tsc --noEmit` clean.
- [ ] Live steps 1–7 verified through the user's Chrome on :3000, including the sidebar-reflow case (step 3).
- [ ] No changes outside the three (plus test) files; no new dependencies; current branch only, no pushes.
