/**
 * Thread-bounds container-query class fragments — the CSS-variable *declaration*
 * clusters that drive the conversation thread's responsive gutter and max-width
 * (mirrored from the ChatGPT `@container/main` thread tiers).
 *
 * Only the contiguous, byte-identical var-declaration tails are extracted here.
 * The `px-[var(--thread-content-margin,1rem)]` / `max-w-[var(--thread-content-max-width,40rem)]`
 * CONSUMERS stay inline at each call site: they are NOT adjacent to these
 * declarations in every string (interleaved with `text-base` / `pb-*` /
 * `min-w-0 flex-1 flex-col` …), so folding them in would reorder the emitted
 * class string. Always append these LAST (via `cn()` or a trailing template
 * interpolation) so the rendered `class` attribute stays byte-identical.
 *
 * Consumed by `conversation.tsx`, `chat.tsx`, and
 * `app/test/thinking-states/page.tsx`.
 *
 * ── Tier thresholds (40rem / 64rem) ────────────────────────────────────────
 * The step VALUES match ChatGPT byte-for-byte (1 → 1.5 → 4rem gutter; 40 → 48rem
 * cap). The step THRESHOLDS use arbitrary container queries `@[40rem]/main` and
 * `@[64rem]/main` to match ChatGPT's firing widths.
 *
 * ChatGPT spells these tiers `@w-sm/main` / `@w-lg/main`. Its `@w-*` family is a
 * custom container-query variant bound to the *breakpoint* scale, NOT Tailwind's
 * default `@*` family (which is the *container* scale): proof — ChatGPT's only
 * compiled `@container main` contexts are `width>=80rem` (`@w-xl`) and
 * `width>=96rem` (`@w-2xl`), equal to `--breakpoint-xl`/`--breakpoint-2xl`, not
 * `--container-xl`(36rem)/`--container-2xl`(42rem). Hence `@w-sm/main`=40rem and
 * `@w-lg/main`=64rem. Tailwind's `@sm/main`/`@lg/main` would be 24rem/32rem —
 * ~1.6× too early — so we use the explicit `@[40rem]/main` / `@[64rem]/main`.
 *
 * These tiers stay byte-accurate to ChatGPT for STATIC (non-panel) reflow at
 * every width. During the docked Activity-panel sweep they no longer re-fire:
 * `layout-app` scopes `@container/main` to span BOTH the scroll column and the
 * dock slot, so opening the panel redistributes width WITHOUT changing the
 * container width — the column reflows continuously and never re-caps mid-close.
 * (ChatGPT keys these tiers off the panel-dependent column, so it DOES re-cap
 * −128px in the ~1300–1700px band; we keep its static widths but take the
 * smoother close. See docs/chatgpt-structural-audit.md Rank 1.)
 */

/**
 * `--thread-content-margin` tiers: 1rem → 1.5rem (`@[40rem]/main`) → 4rem (`@[64rem]/main`).
 */
export const THREAD_GUTTER_VARS =
  "[--thread-content-margin:1rem] @[40rem]/main:[--thread-content-margin:1.5rem] @[64rem]/main:[--thread-content-margin:4rem]"

/**
 * `--thread-content-max-width` tiers: 40rem → 48rem at `@[64rem]/main`.
 *
 * The cap flips on the SAME container tier as the gutter's top step
 * (`@[64rem]/main` = ChatGPT's `@w-lg/main`), so article and inner-column stay
 * in lockstep.
 */
export const THREAD_MAXWIDTH_VARS =
  "[--thread-content-max-width:40rem] @[64rem]/main:[--thread-content-max-width:48rem]"

/**
 * Per-turn scroll-margin-bottom contract (ChatGPT parity — see
 * docs/chatgpt-scroll-architecture-audit.md §2/§3). `.threadScrollVars`
 * (globals.css) derives `--thread-response-height` from the scroll root's
 * safe-area variables; with this margin, `scrollIntoView({ block: "end" })`
 * on a just-sent user turn lands it with exactly
 * `--thread-stream-context-height` of prior conversation visible above and
 * the full response space reserved below. Applied to EVERY turn (ChatGPT does
 * the same) so any programmatic scroll-to-turn inherits the policy.
 */
export const TURN_SCROLL_MARGIN_BOTTOM =
  "threadScrollVars scroll-mb-[calc(var(--scroll-root-safe-area-inset-bottom,0px)+var(--thread-response-height))]"
