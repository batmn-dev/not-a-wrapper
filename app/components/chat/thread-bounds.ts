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
 */

/** `--thread-content-margin` tiers: 1rem → 1.5rem (@sm/main) → 4rem (@lg/main). */
export const THREAD_GUTTER_VARS =
  "[--thread-content-margin:1rem] @sm/main:[--thread-content-margin:1.5rem] @lg/main:[--thread-content-margin:4rem]"

/**
 * `--thread-content-max-width` tiers: 40rem → 48rem at `@lg/main` (32rem / 512px).
 *
 * The cap flips on the SAME container tier as the gutter's top step (`@lg/main`),
 * mirroring ChatGPT byte-for-byte: its `@w-lg/main` (= `--container-lg` = 32rem)
 * gates both the 48rem cap and the 4rem gutter. Keeping the cap tier BELOW the
 * docked Activity panel's container-sweep range is what makes the open/close
 * reflow continuous — at normal desktop widths the panel never drives
 * `@container/main` across this flip, so the cap holds at 48rem for the whole
 * sweep and the column widens smoothly. Do NOT raise this back to `@[64rem]/main`
 * (1024px): that lands the flip inside the sweep, and the close tail snaps the
 * column 48rem→40rem (~128px) in its final frame — the "narrow→expanded" pop.
 */
export const THREAD_MAXWIDTH_VARS =
  "[--thread-content-max-width:40rem] @lg/main:[--thread-content-max-width:48rem]"
