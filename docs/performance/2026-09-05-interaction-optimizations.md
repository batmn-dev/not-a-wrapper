# Interaction optimizations, 2026-09-05

This series extends ADR-0016's rendering path and ADR-0024's shared browser
modules. No new dependencies or provider/runtime policy changes were needed.

## Changes

- Message, Activity, and reasoning Markdown share one Next dynamic boundary.
  Previously Activity and reasoning imported the parser eagerly, defeating the
  message renderer's lazy boundary on an empty chat. Composer focus, pointer,
  touch, and coarse-pointer visibility warm the renderer using the existing
  deduplicated intent preloader. Send also starts warming without awaiting it.
  Next's SSR-aware dynamic import stays intact for already-rendered content.
- Streaming fade range construction walks backward from the answer's end and
  stops at the oldest live cohort. It still obtains current `textContent.length`
  natively, which preserves offset correctness after DOM shrink. This removes
  JavaScript iteration over settled paragraphs, not all whole-message work.
- Reduced-motion users take the shared synchronous update path, avoiding browser
  View Transition snapshots before the first-turn handoff.

## Evidence

Same worktree/environment, instrumented production builds, localhost homepage
HTML without an authenticated browser. Unique script URLs declared in that HTML
were fetched successfully and recompressed with Node's default Brotli settings:

| Initial HTML script assets | Before | After |
| --- | ---: | ---: |
| Count | 34 | 33 |
| Decoded bytes | 3,974,960 | 3,512,691 |
| Locally Brotli-compressed bytes | 1,000,962 | 887,168 |

The initial declared set is 113,794 compressed bytes smaller (11.4%). These are
not deployed transfer sizes or total bytes after hydration/intent: warming may
fetch the deferred renderer soon afterward. Captures remain in ignored
`benchmarks/chat-performance/browser/results/asset-smoke-{before,after}.json`.

The 1,000-paragraph fade fixture requires 1,004 TreeWalker steps with the previous
implementation and fewer than eight with the new one, with identical highlighted
tail text. The test was run against both implementations. Markdown streaming and
rendered-equivalence checks, Activity, Composer, prefetch, and transition checks
pass; an independent review found no actionable correctness issues.

Browser interaction checks were blocked by the locked Mac. Before release,
validate cold entry, first text, long-answer typing/scrolling, and reduced-motion
Send in authenticated Chrome, then collect the reviewed runner-matched baseline.
Neither these asset counts nor unit tests establish a user-facing latency win.
