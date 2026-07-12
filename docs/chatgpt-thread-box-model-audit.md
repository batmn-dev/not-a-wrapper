# ChatGPT thread box model — live capture and byte-level replication

Captured live from chatgpt.com (Pro, desktop 1276×952 and narrow ~606px, dark)
on 2026-07-11 by driving a signed-in session against a markdown-showcase
conversation: authored class strings, the compiled `.markdown` /
`markdown-new-styling` CSS ruleset (CSSOM dump), resolved design tokens, and
per-element computed styles. Methodology follows
`docs/chatgpt-scroll-architecture-audit.md` §10 (in-page extraction; DLP-safe
`=`/`;` sanitization; DOM-injected dump channel for large payloads).

Everything below is implemented in this repo. Spacing, typography, and radius
values are ChatGPT's verbatim; **colors map onto our tokens** (mandate).

---

## 1. Turn anatomy (verified by box-chain measurement, not just class reading)

```text
list wrapper                flex w-full flex-col text-sm
├─ per-turn container div [data-turn-id-container]
│  ├─ timestamp (optional)  my-4 flex h-5 justify-center > span.text-sm.leading-5 (tertiary)
│  └─ section/article [data-turn]        (scroll-mt/mb contract only, no padding)
│     └─ gutter div         text-base px-(--thread-content-margin)
│        │                  FIRST turn of the thread only: pt-3
│        │                  LAST turn only: pb-10
│        └─ column          max-w-(--thread-content-max-width) mx-auto flex-col  (NO gap)
│           ├─ content wrapper   flex max-w-full grow flex-col gap-4
│           │  └─ text-message   min-h-8 relative flex w-full flex-col gap-2
│           │     │              text-start break-words whitespace-normal
│           │     │              (+ items-end on user)  [.text-message+&]:mt-1
│           │     └─ parts col   flex w-full flex-col gap-1 empty:hidden (+ items-end user)
│           │        └─ bubble / markdown / tool blocks / attachments
│           └─ action row        z-0 flex justify-end            (user)
│                                z-0 flex min-h-[46px] justify-start  (assistant)
│              └─ actions        -ms-2.5 -me-1 flex flex-wrap items-center
│                                gap-y-4 p-1 select-none
│                                (+ assistant: -mt-1 w-[calc(100%+10px)])
```

**The critical geometry facts** (these were the two bugs in the first
implementation pass — both verified against live box chains):

1. **The action row is a column-level sibling of the gap-4 content wrapper,
   with ZERO gap above it.** The `gap-4` groups multiple text-message blocks
   inside the content wrapper; it does NOT separate message from actions.
   Net: user copy button top = bubble bottom + 4px (`p-1`); assistant
   button ≈ prose bottom + 7px (`p-1` − `-mt-1` + last-child margin).
2. **`pt-3` exists only on the thread's FIRST turn.** Later user turns get
   their spacing from the preceding assistant action row (46px) and the
   timestamp block (`my-4` + `h-5` = 52px). Measured inter-turn rhythm
   (assistant prose bottom → next user bubble top, timestamp between):
   ChatGPT 100px == ours 100px.

Other turn-level values: assistant action row `min-h-[46px]`; standard action
buttons 32×32 radius 8px; branch-pager steppers 24×30 radius 6px with
`px-0.5 text-sm font-semibold tabular-nums` counter; user bubble
`px-4 py-2.5 rounded-[22px] leading-6 max-w-(--user-chat-width,70%)`
(`--user-chat-width: 70%`) with an inner
`max-w-full min-w-0 [overflow-wrap:anywhere] whitespace-pre-wrap` div.

## 2. Assistant prose — their effective `.markdown` ruleset

Their markdown container: `markdown prose dark:prose-invert wrap-break-word
w-full markdown-new-styling`. Base font 16px, **line-height
`--text-body-regular--line-height` = 1.625rem (26px)** — a fixed-length token,
not a ratio. We adopted the token name (globals.css `@theme`).

Ported into `app/globals.css` under `.markdown` (applied on top of `.prose`
exactly as they do; container: `markdown prose` in `message-assistant.tsx`,
`article.tsx`, thinking-states page):

| element | ChatGPT (computed, dark desktop) |
|---|---|
| p | mt 8 (0 first / after h4 / after hr), mb 4; **p+p: mt 16 mb 16** (also inside li — their `:where` li trims lose to it by source order) |
| h1 | 24/32 w600, m 0 0 8, letter-spacing normal |
| h2 | 20/28 w600, m 16 0 4 |
| h3 | 18/28 w600, m 16 0 4 |
| h4 | 16/24 w600, m 16 0 0; `h4 + p` mt 0 |
| headings | first-child mt 0; `ul/ol + h*` mt 16 |
| ul/ol | margin 0, padding-inline-start 1.625em; `p + ul/ol` mt 0 |
| li | margin 0, padding-inline-start 0.375em; `li > :first-child` m 0, `li > :last-child` mb 0; marker bold currentcolor |
| inline code | 0.875em w500, radius 4px, padding 0.15rem 0.3rem, bg gray-700/gray-100 → our `bg-secondary` |
| blockquote | m 0 0 8, padding-block 8, pis 24, lh 24, font-style normal w500 (`> p` w400 m 0); no border — 4px×r2 `::after` bar (border-medium), inset-y 8 |
| hr | margin-block 28px, border-medium |
| strong | w600 |
| last child | mb 4 (`.markdown.markdown > :last-child`) |
| table | fs 0.875em lh 1.71429; border-collapse separate/0; th py-8 lh-16 w600 border-b border-medium, pe-24 (last th pe-40); td py-10, pe-24, border-b border-light (except last row); last row td pb-24 |

Border hierarchy mapping: their `--border-light`(#fff 5%)/`--border-medium`
(#fff 15%) → `--markdown-border-light: var(--border)` /
`--markdown-border-medium: color-mix(in oklab, var(--foreground) 15%, transparent)`.

## 3. Table full-bleed breakout (their `TyagGW_tableContainer`, formula verbatim)

```css
.markdown-table-container {
  --thread-content-width: min(calc(100cqw - 2*var(--thread-content-margin,0px)), var(--thread-content-max-width,40rem));
  --thread-gutter-size: calc((100cqw - var(--thread-content-width)) / 2);
  width: 100cqw; margin-inline: calc(-1 * var(--thread-gutter-size));
  scrollbar-width: thin; overflow-x: auto;
}
.markdown-table-wrapper { margin-inline: var(--thread-gutter-size) var(--thread-content-margin,0px); }
```

Rendered by `markdown.tsx`'s `table` component (container > wrapper
`flex w-fit flex-col-reverse` > `table.w-fit.min-w-[var(--thread-content-width)]`).
The cqw container is **`@container/thread` on `#thread`** (chat.tsx) — the
scroll column — because our `@container/main` deliberately spans the activity
dock (thread-bounds.ts): tables must bleed to the thread edge, never under
the panel. Named `/main` tier queries pass through it untouched. Verified:
margin-inline −327.5px at 1276px desktop (identical to ChatGPT's computed) and
−16px at 606px narrow (identical); sticky header/composer unaffected by the
containment.

## 4. Code blocks

ChatGPT: `pre` (mt-2) > wrapper (mt-4 mb-1, collapses to 16px above) > 24px-
radius superellipse box, 1px border-light, surface `--code-block-surface`
(= `--bg-elevated-secondary`, equals the page background in dark) > sticky
48px header (`py-1.5 ps-4 pe-1.5 md:ps-5`, label `text-sm font-medium`
primary, buttons right `gap-0.5`) > 1px border-light divider (sticky) >
CodeMirror viewer at 14px/24px with 20px inline / 12px block padding.

Ours (code-block.tsx + markdown.tsx): container
`mt-4 mb-1 rounded-[24px] border border-border bg-card overflow-clip`
(radius pinned — our `--radius`-derived 3xl is 22px); sticky
`top-[var(--sticky-padding-top,0px)] z-[2]` header `h-12 py-1.5 ps-4 pe-1.5
md:ps-5` with `text-sm font-medium` label + ButtonCopy, `h-px bg-border`
divider; code `text-sm leading-6 [&>pre]:px-5 [&>pre]:py-3
[&>pre]:!bg-transparent`.

## 5. Computed-style diff (theirs / ours-before / ours-after)

Verified live on localhost:3000 (probe scripts, same properties both sides).

| element × property | ChatGPT | ours before | ours after |
|---|---|---|---|
| markdown font/lh | 16/26 | 16/28 (prose 1.75) | **16/26** |
| p margins | 8 / 4 (p+p 16/16) | ~20/20 (prose 1.25em) | **8 / 4 (p+p 16/16)** |
| h1 | 24/32 600, mb 8 | 24/32 600, mb ~19 | **=CGPT** |
| h2 | 20/28 600, 16/4 | 20/28 500, 32/12 | **=CGPT (600)** |
| h3 | 18/28 600, 16/4 | 16/24 500 (text-base!) | **=CGPT** |
| h4 | 16/24 600, 16/0 | plugin default | **=CGPT** |
| ul/ol / li | m0 pis26 / m0 pis6 | 1.25em margins, li my 0.5em | **=CGPT** |
| inline code | 14 w500 r4 p2.4/4.8 | 14 w400 r? px-4px bg-primary-foreground | **=CGPT (bg-secondary)** |
| blockquote | 8/24 pad, lh24, normal w500, 4px bar | plugin italic + border | **=CGPT** |
| hr | 28/28 border-medium | plugin 3em | **=CGPT** |
| table | full-bleed −327.5, th py8 pe24 w600, td py10 | `block overflow-y-auto`, plugin pads | **=CGPT (−327.5 verified)** |
| code block | r24 border, hdr 48, code 14/24 px20 | r12(xl), hdr 36, code 13 px16 | **=CGPT (r24 pinned)** |
| bubble | 10px/16px pad, r22, lh24, 70% | same (already matched) | = |
| bubble→copy btn | 4px | 0px (pre-existing divergence) → 20px (first pass bug) | **4px** |
| prose→copy btn | 7px | ~8px → 21px (first pass bug) | **5px** (±2 content lh slack) |
| inter-turn (ts between) | 100px | 112px | **100px** |
| user turn pt | first turn only 12px | every user turn 12px | **first turn only** |
| assistant turn pb | last turn only 40px | every assistant turn 40px (+pb-8 inner) | **last turn only, inner pb-8 removed** |
| action row slot | min-h 46 (assistant) | min-h 32 | **46** |
| action buttons | 32×32 r8 | 32×32 r10 (rounded-md→10? lg) | **32×32 r8 (pinned)** |
| branch steppers | 24×30 r6 | 24×32 r8 | **24×30 r6 (pinned)** |
| message→parts gaps | root 0, wrapper 16, text-message 8, parts 4 | 8/8 | **0/16/8/4** |
| list wrapper | text-sm | (none) | **text-sm** |

Remaining deltas, all deliberate:

- **Colors** stay our tokens (mandate): bubble `bg-accent`, code surface
  `bg-card`, inline code `bg-secondary`, borders `--border` +
  foreground-15% mix.
- **`corner-superellipse/*`** (their squircle corner shader) not adopted;
  plain radii carry the byte values.
- **CodeMirror internals** not adopted — we keep Shiki; box metrics (radius,
  header, font, padding) match. ±2px in the assistant prose→button metric is
  line-box slack, structural inputs identical.
- **Narrow-viewport user bubble**: their mobile layout renders `w-full`
  instead of `max-w-70%` (JS-driven breakpoint variant); we keep 70% at all
  widths (matches their desktop contract).
- **Assistant action reveal**: theirs is a `mask-position` transition wired to
  hover classes whose hidden-state utility isn't even compiled in their build
  (rows compute permanently revealed, opacity 1 at rest); our shipped
  one-shot `mask-reveal` animation reproduces the observed behavior.

## 6. Verification (2026-07-11, localhost:3000 vs live chatgpt.com)

- 24-property computed probe on the markdown showcase: all OK after fixes.
- Box-chain measurements: bubble→button 4==4; inter-turn 100==100; turn
  paddings per-index identical; footer 46px; parts gaps 0/16/8/4.
- `bun run typecheck && bun run lint && bun run test` — 149 files / 1303
  tests green (branch-stepper metric tests updated to the measured contract).
- Behavior QA: user hover reveal (opacity 0→1, pointer-events none→auto),
  edit-mode in-place swap (editor width == bubble width, focus, cancel
  restore), sticky composer + app header under `@container/thread`
  (scroll test), load-at-bottom restore, narrow 606px (gutter 16px, table
  bleed −16px), light mode (token mapping holds).
- Gotcha for future edits: the `Message` primitive's base class injects
  `gap-3` — any turn root that stops declaring an explicit gap inherits a
  phantom 12px gap between message and action row (this was the visible
  regression during implementation; roots now pin `gap-0`).
