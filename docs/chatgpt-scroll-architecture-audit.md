# ChatGPT scroll architecture — live teardown and refactor plan

Captured live from chatgpt.com (Pro, desktop, 1276×1256 viewport) on 2026-07-11 by driving a
signed-in session: computed styles, CSS module rules, inline styles, and interaction probes on
three real conversations (short non-overflowing, 1-exchange overflowing, 18k-px overflowing).
Every class string and formula below was read from the live DOM, not inferred.

The headline: **ChatGPT has no JS stick-to-bottom system.** At rest, scroll stability is 100%
native browser scroll anchoring (`overflow-anchor: auto`, the default, everywhere). All scroll
*policy* — where a new message pins, how much space a response gets — is declarative CSS
(`scroll-margin` + custom properties) consumed by single `scrollIntoView()` calls. JS touches
scroll in exactly three places: send-time pinning, load-time bottom restore, and freezing the
trailing gutter after a stream. Our jank comes from the opposite architecture: a resize-reactive
JS controller (`use-stick-to-bottom`) that treats every layout change as "content grew → follow",
which we then patch around case-by-case (`stopScroll()` on panel open, scrollTop save/restore on
edit, `data-scroll-anchor="false"` opt-outs to keep native anchoring from fighting it).

---

## 1. Their DOM (verified)

One scroll container per page. Header and composer are sticky *inside* it. The side pane is a
width-animated flex sibling *outside* it.

```text
div.group/side-pane-shell-host [data-side-pane-shell-host]          flex row
├─ div.@container/main  flex-1 min-w-0 flex-col                     thread column = container root
│  └─ div.group/scroll-root [data-scroll-root]                      ★ THE scroll container
│     │    flex min-h-0 min-w-0 flex-1 flex-col
│     │    not-print:overflow-y-auto  overflow-x-clip  [scrollbar-gutter:stable]
│     │    scroll-pt-(--header-height)
│     │    group-data-stream-active/scroll-root:[overflow-anchor:none]      ← streaming kill-switch
│     │    data-expanded-composer:overflow-y-hidden!                        ← composer takeover locks scroll
│     │    style="--sticky-padding-bottom: 88px"                            ← JS-measured composer footprint (inline)
│     ├─ header#page-header   sticky top-0 z-20 h-header-height bg-transparent pointer-events-none
│     └─ main → #thread → div.composer-parent  flex flex-1 flex-col
│        ├─ div  grow flex flex-col  -mb-(--composer-overlap-px) pb-(--composer-overlap-px)  [--composer-overlap-px:28px]
│        │  └─ div  flex flex-col text-sm                           the list; exactly 3 children:
│        │     ├─ div                                               turns wrapper
│        │     │  └─ per turn:
│        │     │     div [data-turn-id-container] [data-is-intersecting]    ← per-turn IO bookkeeping
│        │     │     └─ section [data-turn="user|assistant"] [data-turn-id]
│        │     │           .threadScrollVars
│        │     │           scroll-mt-…  scroll-mb-…                 ← the whole positioning contract, §2
│        │     ├─ div  h-px -mt-px translate-y-(--scroll-root-safe-area-inset-bottom)
│        │     │                                                    ← 1px "at bottom" IO sentinel,
│        │     │                                                      pre-shifted by composer height
│        │     └─ div  .threadScrollVars pointer-events-none        ← trailing GUTTER, §4
│        │           min-h-(--gutter-remaining-height,0px)
│        │           group-data-stream-active/scroll-root:h-[calc(var(--thread-response-height)-16*var(--spacing))]
│        │           style="--gutter-remaining-height: 850px"       (inline, JS-frozen)
│        └─ div#thread-bottom-container  sticky bottom-0 z-10 …content-fade    composer, h≈88
│           └─ [data-testid="thread-footer-overflow-spacer"] (h 0)
└─ div  side-pane slot   w-0 shrink-0 overflow-hidden transition-[width] duration-300 ease-out
```

Notes:
- `@container/main` sits on the **panel-dependent** column, so their thread tiers re-fire during
  a pane sweep. We deliberately diverged (container on the row spanning both tracks —
  `thread-bounds.ts:30`) and should keep our version; it's strictly smoother.
- When the side pane is open: `group-data-[side-pane-shell-open]…:[scrollbar-width:none]` — they
  hide the thread scrollbar rather than let two scrollbars sit side by side.
- No virtualization: off-screen turns keep full DOM (`content-visibility: visible`, `contain: none`).
- We already match: single ScrollRoot, sticky header inside, sticky in-flow composer,
  28px `--composer-overlap-px`, content-fade, `scrollbar-gutter: stable`, dock-slot panel.

## 2. The CSS variable system (the actual "scroll engine")

Defined on / inherited through the scroll root:

```css
--header-height: 3.25rem;                     /* 52px */
--sticky-padding-top: var(--header-height);   /* zeroed per fixed-header mode via has-data variants */
--sticky-padding-bottom: 88px;                /* INLINE STYLE, JS-measured resting composer footprint.
                                                 Verified: does NOT live-track composer growth —
                                                 a 5-line draft (88→188px) leaves it at 88; the taller
                                                 composer simply overlays the thread via the sticky
                                                 container + 28px overlap fade. */
--scroll-root-safe-area-inset-top:    calc(var(--sticky-padding-top) + env(safe-area-inset-top, 0px));
--scroll-root-safe-area-inset-bottom: calc(var(--sticky-padding-bottom) + var(--screen-keyboard-height, 0px) + env(safe-area-inset-bottom, 0px));
--scroll-root-safe-area-height:       calc(100lvh - inset-top - inset-bottom);
```

CSS module `.threadScrollVars` (applied to **every turn section AND the gutter**):

```css
.threadScrollVars {
  /* prior-context to keep visible above a just-sent message: ⅓ viewport, floor 5.5rem */
  --thread-stream-context-height: max(22 * var(--spacing), var(--thread-show-context-pct, 1/3) * var(--scroll-root-safe-area-height));
  /* space reserved below a just-sent message for the incoming response */
  --thread-response-height: calc(var(--scroll-root-safe-area-height) - var(--thread-stream-context-height));
}
```

Per-turn scroll-margin contract (measured: scroll-mb 866.67px, assistant scroll-mt 252px @ 1256px viewport):

```text
every turn:      scroll-mb: calc(var(--scroll-root-safe-area-inset-bottom, 0px) + var(--thread-response-height))
user turn:       scroll-mt: var(--sticky-padding-top)
assistant turn:  scroll-mt: calc(var(--header-height) + min(200px, max(70px, 20svh)))   ← we already copied this
```

## 3. Send-time "generous spacing" = one scrollIntoView

On send, JS appends the user turn and calls `scrollIntoView({ block: 'end' })` on it (smooth in
practice; exact animation is theirs — `scroll-behavior` on the root is `auto`, so it's passed
per-call). The browser then does ALL the math via the contract above: the turn's bottom edge
lands `scroll-mb` above the scrollport bottom, i.e. exactly `--thread-response-height` +
composer inset above the fold →

- prior context visible above the new message: exactly `--thread-stream-context-height` (⅓ viewport, min 88px)
- empty space below for the response: exactly `--thread-response-height` (~⅔ viewport)

No measuring, no math in JS, resilient to viewport/keyboard/composer changes. The same contract
makes any other `scrollIntoView` (jump-to-turn, search hit, regenerate) land correctly.

## 4. Streaming and the trailing gutter (the anti-jank core)

State machine on the scroll root: a `data-stream-active` attribute, present only while a response
streams. Two CSS consequences (both verified in class variants):

1. `overflow-anchor: none` on the root — native anchoring off while the stream mutates layout.
2. The trailing gutter gets `height: calc(var(--thread-response-height) - 4rem)` — the reserved
   space below the streaming response is *real layout*, so the pinned user turn cannot be pushed
   around and the scrollbar geometry is stable from the first token.

**There is no auto-follow.** The response streams downward into reserved space while the viewport
stays where send-time pinning put it. If the response outgrows the viewport, the user scrolls (or
uses the scroll-to-bottom pill); the UI never scrolls out from under them. This single decision
eliminates the entire "sticks to bottom randomly" bug class — there is no code that can do it.

**Stream end:** JS measures the leftover empty space and freezes it as an inline
`--gutter-remaining-height` on the gutter (`min-height`; observed 850px on a short thread).
Removing `data-stream-active` therefore causes zero layout shift, and short conversations keep
their post-send geometry forever (scrollHeight never collapses → no clamp jumps, ever).

**At-bottom detection** is not scroll-math: the 1px sentinel (translate-shifted down by the
composer inset so "bottom" means "bottom of the visible thread, not under the composer") feeds an
IntersectionObserver. Drives the scroll-to-bottom pill (not mounted at rest — it appears only
when relevant, mainly during streams).

## 5. At rest: native anchoring does everything

- `overflow-anchor: auto` (default) on root and every turn — no opt-outs anywhere.
- Branch switch / panel open / late image loads / edit mode: no JS scroll handling at all.
  The browser's scroll anchoring compensates for layout shifts above the fold; the frozen gutter
  absorbs height deltas below; nothing else moves.
- Conversation load: instant scroll-to-bottom, re-asserted while late content settles (observed:
  a late pass overrode a programmatic scroll several seconds after navigation).
- Side pane open/close: width redistribution only; no scroll writes observed
  (thread column reflows, anchoring holds the viewport on the visible content).

---

## 6. Gap analysis vs our implementation

| Concern | ChatGPT | Ours today |
|---|---|---|
| Rest-state stability | native `overflow-anchor: auto` everywhere | `use-stick-to-bottom` ResizeObserver reacts to every content growth; anchoring disabled on all rows except last assistant (`data-scroll-anchor`) to avoid fighting it |
| Send-time spacing | `scroll-mb` contract + gutter; response gets ~⅔ viewport | none — message appends, library scrolls to bottom |
| Streaming | no follow; reserved space; `overflow-anchor:none` scoped to stream | library auto-follows growth whenever near bottom (70px), spring-animated |
| Stream end | gutter frozen inline → zero shift | content collapse → clamp/jump risk |
| Branch switch | subtree swaps under native anchoring + frozen gutter → no motion | wholesale array swap remounts subtree; ResizeObserver reacts; documented jump path (`selected-path.ts` divergence) |
| Panel open | nothing (anchoring holds) | `stopScroll()` hack wired through `activity-panel-store.tsx:201` |
| Edit mode | nothing (anchoring holds) | manual scrollTop save/restore + `stopScroll()` in rAF (`message-user.tsx:120-189`) |
| Composer footprint | JS-measured once → inline `--sticky-padding-bottom`, feeds all formulas | flat `--spacing-input-area: 100px` constant |
| At-bottom signal | 1px IO sentinel (composer-offset built in) | library scroll math (70px threshold); our `data-edge` sentinels exist but are unread |
| Load position | instant bottom + late re-assert | library `initial: "instant"` |

## 7. Refactor plan (aggressive, ordered)

**R1 — Delete the JS scroll controller.** Remove `use-stick-to-bottom`, the
`ScrollRootContext` stick API (`scrollToBottom/stopScroll/isAtBottom/escapedFromLock`), the
`contentRef` ResizeObserver coupling in `ScrollRootContent`, and the unused
`components/ui/chat-container.tsx` legacy primitives. With it, delete both workarounds it forced:
the `stopScroll()`-on-open wiring in `activity-panel-store.tsx` and the scrollTop save/restore in
`message-user.tsx` edit mode. Remove `data-scroll-anchor` opt-outs (`globals.css:868`,
`message-user.tsx:198`, `message-assistant.tsx:193`) — anchoring becomes the mechanism, not the enemy.

**R2 — Install the CSS variable engine.** In `thread-bounds.ts` (rename fits: it already mirrors
their tiers): add the safe-area inset/height vars to ScrollRoot and a `threadScrollVars` utility
(context-height / response-height formulas above). Measure the resting composer stack once with a
ResizeObserver on `#thread-bottom-container` and write `--sticky-padding-bottom` inline on the
scroll root (replaces flat `--spacing-input-area` in `--thread-bottom-offset`).

**R3 — Turn scroll contract.** In `conversation.tsx` TurnRow: every turn gets
`scroll-mb-[calc(var(--scroll-root-safe-area-inset-bottom,0px)+var(--thread-response-height))]`;
keep existing scroll-mt (user: sticky-padding-top; assistant: already ChatGPT's formula).

**R4 — Trailing gutter element.** Replace `pb-[var(--thread-bottom-offset)]` reservation with the
3-element list tail: turns, 1px sentinel (`translate-y` by inset-bottom) feeding an
IntersectionObserver that drives ScrollButton, and the gutter div
(`min-h-[var(--gutter-remaining-height,0px)]`, streaming
`h-[calc(var(--thread-response-height)-4rem)]`).

**R5 — Stream lifecycle attribute.** `data-stream-active` on ScrollRoot while the assistant turn
streams (we have the status seams). CSS: `[data-stream-active] { overflow-anchor: none; }` +
gutter height variant. On terminal status: measure leftover viewport space below the last turn,
freeze as inline `--gutter-remaining-height`, then drop the attribute (same frame).

**R6 — Send-time pinning.** On optimistic user-message append (use-chat-core submit path):
`turnEl.scrollIntoView({ block: 'end', behavior: prefersReducedMotion ? 'auto' : 'smooth' })`.
No other scroll write during the turn.

**R7 — No follow during streaming.** Delete the concept. The scroll button (already built) is the
affordance for long responses; mount it from the sentinel IO signal instead of library state.

**R8 — Load restore.** On conversation mount: instant `scrollTop = scrollHeight`; re-assert once
after fonts/images settle (single rAF-after-load pass, or a short-lived ResizeObserver that keeps
bottom while `distanceFromBottom === 0` and disconnects on first user scroll).

**R9 — Branch switch.** After R1–R5 the documented jump path should collapse: remounts happen
under native anchoring (anchor = surviving nodes above the swap), and the frozen gutter absorbs
below-fold height deltas. Keep `projectSelectedPath`'s wholesale swap; no scroll code needed.
Verify with the divergence scenarios in `use-chat-edit.test.tsx`.

**Keep as-is (deliberate divergences):** `@container/main` on the panel-spanning row
(`thread-bounds.ts:30` — smoother than ChatGPT's re-capping tiers); the dock-slot activity panel
(matches their side-pane slot architecture, better easing); Turbopack/HMR-safe static tier vars.

Suggested order: R2→R3→R4 (pure CSS/DOM, ship dark), then R5+R6 (stream attribute + pinning),
then R1+R7 (delete the library and hacks in one cut), then R8, then R9 verification.

---

## 8. Post-implementation smoke test vs live ChatGPT (2026-07-11, same day)

R1–R9 implemented and verified. A second instrumented session then ran the SAME
scenarios on a fresh chatgpt.com conversation (with account-owner permission)
and on ours, side by side. Refinements found and applied:

- **The pin fires at ANSWER-START, not at send.** Measured on ChatGPT: after
  sending from the bottom, zero scroll activity through the entire thinking
  phase (the new message sits just above the composer — geometry works out
  because the previous settle froze the fold exactly there); the reposition
  happens when the response's first text renders. Ours now matches:
  `Conversation` withholds `pinTurnId` until the last assistant message has
  text content.
- **The pin is instant, not smooth.** Two scroll events 73ms apart, 817px —
  a single-step jump. Ours now uses `behavior: "instant"`.
- **Pin landing precision:** their turn bottom landed at 371px vs the
  formula's 378 (spb rounding); ours lands at exactly the formula value
  (372 = max(88, (viewport − spb)/3) at 1200×spb 84). Same math confirmed on
  both sides.
- **The scroll-to-bottom pill exists ONLY while a turn streams.**
  *(CORRECTED by §10: this was a measurement artifact — the pill is
  `aria-hidden` with no testid, so the selector hunts missed it. Source
  extraction shows it is visibility-driven by `data-scroll-from-end` in all
  states.)*
- **Their freeze formula is literally ours:** they write the unclamped result
  inline — observed `--gutter-remaining-height: -2474.84px` (invalid for
  min-height, so ignored ≡ our `Math.max(0, …)`).
- **Their `--sticky-padding-bottom` is lazier than ours:** measured stale at
  696px (home-hero footprint) through an entire turn, forcing a 44px
  correction nudge at settle. Our live ResizeObserver avoids the nudge.
  Deliberate divergence: superset of their intent.
- **Edit-entry:** ChatGPT shifts visible content by ~88px when the editor
  replaces the bubble; ours holds at 0px (native anchoring, no hack).
  Deliberate divergence: strictly stabler.
- Not measurable that session: ChatGPT's branch-switch scroll (their tab went
  `visibilityState: hidden`, which freezes their stream flush, settle cleanup
  — `data-stream-active` stuck for minutes — CSS transitions, and IO; ours was
  verified zero-shift in a visible tab earlier the same day). Mechanism is
  identical on both sides (native anchoring at rest + frozen gutter).

---

## 9. Live gutter maintenance (third session, 2026-07-11 — mutation-observer capture)

A MutationObserver session on live turns exposed how "the freeze" really works
— it is not a one-shot settle measurement:

- `#thread` carries an inline React-set knob `--thread-show-context-pct: 1/3`.
  It never changed across home, fresh-chat, ongoing, thinking, or settled
  states — a configuration surface, not runtime-dynamic. Ours now sets the
  same inline knob on `#thread` (chat.tsx).
- **From answer-start, ChatGPT continuously maintains
  `--gutter-remaining-height` = reserved − consumed**, decrementing it in
  lockstep with every rendered line (fresh chat: 892px initial → −26px per
  step; ongoing turn: 669.5 → −42px steps → −0.5 at completion; unclamped —
  negatives left for CSS to ignore). Reserved is viewport-fill-aware: 892 on
  the fresh chat (full remaining viewport) vs the ~717px stream class. Settle
  is then a no-op: the residual is already correct at every instant, and the
  turn permanently owns `reserved − consumed` of trailing space no matter
  where the viewport was.
- Their settled invariant: the pinned position is the thread bottom
  (distBottom ≈ 7px after a turn), and short threads never overflow the
  viewport (no phantom trailing scroll).

Ported into `ThreadScrollEdge` (same session): the pin effect records an
answer-start baseline — `reserved = gutter height + flex slack − composer
overlap − space already beyond the fold` — and a ResizeObserver on the list
keeps `--gutter-remaining-height = reserved − consumed` live; the settle calls
the same computation synchronously (`finalize`) rather than trusting the last
asynchronous write (RO callbacks freeze in hidden tabs — including ChatGPT's
own), then drops `data-stream-active`. The viewport-based formula remains only
as the fallback for turns whose answer never rendered (abort mid-thinking).
Verified in-app: fresh short turn settles at exactly one viewport (phantom 0,
residual 767px), mid-thread short turn settles with distBottom 0 and
deterministic residual (534px), long turns decay the residual to 0.
*(SUPERSEDED by §10 — the consumption bookkeeping reproduced the observations
but is not their algorithm; it was replaced with the extracted one.)*

---

## 10. Source extraction (fourth session, 2026-07-11) — the actual JS

The `conversation-small-*.js` chunk (3.65MB) was fetched from the live page
and mined for the real implementations. Everything below is now mirrored in
our code (thread-scroll.tsx, scroll-root.tsx, scroll-button.tsx).

**The gutter (their `Lur`)** — no bookkeeping at all. A permanent
IntersectionObserver installed by the gutter's ref callback:

```js
new IntersectionObserver(() => {
  let n = root.getBoundingClientRect().bottom - el.getBoundingClientRect().top
  el.style.setProperty(`--gutter-remaining-height`, `${n}px`)   // unclamped
}, { root, threshold: Array.from({length: 101}, (e, t) => t / 100) })
```

`min-height` self-regulates toward "fill the viewport below the content" in
every state — reserves while streaming (the stream-height class wins when
larger), decays live as the answer consumes it, freezes naturally at settle,
keeps short threads at one viewport, absorbs branch-switch deltas. The
negative inline values observed earlier are just this formula unclamped.

**The at-end sentinel** — IO on the 1px element,
`rootMargin: "0px 0px 72px"` (96px in an alternate mode which also adds a
36px-margin observer writing `data-show-disclaimer`), toggling
`data-scroll-from-end` on the scroll root via their `fT` helper. No React
state anywhere.

**The pill** — always mounted, `aria-hidden`, `tabIndex={-1}`; visibility is
pure CSS on the root attribute:
`group-[:not([data-scroll-from-end])]/scroll-root:{opacity-0, scale-50,
translate-y-2, pointer-events-none, duration-100, delay-0}` against a base
`motion-safe:transition-all motion-safe:delay-300 motion-safe:duration-300`
(i.e. 300ms-delayed entrance, fast exit). Streaming only morphs its
shape/icon (`squircle w-10`, icon crossfade) — §8's "streaming-only pill" was
wrong.

**The pin (their `Att`/`jtt`/`Mtt`)**:

```js
function Att(id) { requestAnimationFrame(() => { const root = dm(); root == null || Mtt(root, id) || jtt(root, id) }) }
function jtt(root, id) {           // retry until the turn mounts, capped
  const mo = new MutationObserver(() => { Mtt(root, id) && (mo.disconnect(), clearTimeout(t)) })
  mo.observe(root, { childList: true, subtree: true })
  const t = setTimeout(() => mo.disconnect(), Btt)
}
function Mtt(root, id) {
  const el = root.querySelector(`[data-turn-id="${CSS.escape(id)}"]`)
  return el == null ? false : (fT(root, false),                       // hide pill immediately
    el.scrollIntoView({ behavior: flag() ? `instant` : `smooth`, block: `end` }), true)
}
```

The behavior is feature-flagged instant-vs-smooth; the flag served `instant`
live. The retry-until-mounted explains the answer-start timing: the pin
targets a turn element that mounts with the response.

**`--sticky-padding-bottom` writer** (composer chunk `8b34dbc2-*`): a
ResizeObserver writing `container.getBoundingClientRect().height` inline on
the root; zeroed in expanded-composer/voice modes; the composer's textarea
growth is excluded because the textarea header is absolutely positioned and
compensated by the `thread-footer-overflow-spacer` element's height.

**Not adopted:** the absolute-textarea/footer-spacer composer trick (would
rearchitect our composer; our RO measures the same resting value), the
`data-show-disclaimer` observer, and the pill's streaming squircle/icon morph
(visual-only, our design tokens differ).
