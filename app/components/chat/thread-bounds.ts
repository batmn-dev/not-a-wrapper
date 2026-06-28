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

/** `--thread-content-max-width` tiers: 40rem → 48rem (@[64rem]/main). */
export const THREAD_MAXWIDTH_VARS =
  "[--thread-content-max-width:40rem] @[64rem]/main:[--thread-content-max-width:48rem]"
