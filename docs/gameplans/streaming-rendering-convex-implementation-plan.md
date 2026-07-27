# Streaming Responsiveness and Convex Recovery Implementation Plan

**Repository:** `darknightdesigner/not-a-wrapper`  
**Prepared:** 2026-07-27  
**Audience:** Senior design engineer or senior frontend/platform engineer  
**Primary goals:** response speed, smooth text streaming, and appropriate use of Convex realtime

## 1. Mission

Implement a streaming architecture that makes assistant responses appear immediately, remain smooth as messages grow, and recover durably across navigation, reloads, tabs, and devices.

Optimize the underlying rendering path before adding presentation effects. The finished system should be fast enough to present provider deltas directly. Convex should remain the durable, reactive coordination plane, not become an extra hop in the initiating tab's foreground token path.

This is an implementation assignment. Do not stop after research or a revised plan. Make the changes, add the required tests and benchmarks, run production-browser verification, and document measured results.

## 2. Repository state and required starting point

Verify these facts again before editing because repository state may have changed:

- PR [#129](https://github.com/darknightdesigner/not-a-wrapper/pull/129) merged into `main` as the durable-run and approval-recovery baseline.
- PR [#130](https://github.com/darknightdesigner/not-a-wrapper/pull/130) is currently open and unmerged.
- At the time this plan was written, PR #130 contained 4,293 additions across 22 files and six unresolved review threads.
- `main` parses the complete accumulated Markdown string on every displayed-text update in `components/ui/markdown.tsx`.
- `main` applies an AI SDK message notification throttle of 50 ms in `lib/chat-performance/message-throttle.ts`.
- `main` statically imports `createHighlighter` from `shiki` and initializes 35 languages in `components/ui/code-block.tsx`.
- `main` uses a 300 ms growing-code highlight throttle in `lib/chat-performance/streaming-code-render.ts`.
- The active initiating tab receives the response through the direct `/api/chat` HTTP stream.
- The durable turn runtime periodically snapshots progress into Convex and performs final settlement.

Before changing code:

1. Read every applicable `AGENTS.md`, `CONTEXT.md`, ADR, performance report, and package script.
2. Fetch the latest `main`.
3. Record the exact baseline commit SHA in the new measurement report.
4. Confirm whether PR #130 is still open. If it merged, stop and reassess this plan against its merge commit before proceeding.
5. If PR #130 remains open, do not merge or stack the new work on its branch. Create a clean branch from the latest `main`.
6. Preserve PR #129 behavior. Do not weaken durable snapshots, execution grants, approvals, detached streams, terminal settlement, reapers, or cross-tab projection.
7. Treat PR #130 as an experiment and source of test ideas, not as the target architecture.

### Decision on PR #130

Do not merge PR #130 as written. Close it or leave it unmerged according to the repository owner's preference. Do not delete its branch until any useful fixtures and measurements have been preserved.

Reusable ideas that may be copied selectively:

- Terminal-state and reduced-motion test cases.
- Hidden-tab and non-prefix correction scenarios.
- Content-free performance mark patterns.
- Settle-drain and canonical-equality assertions.
- The finding that perceived cadence must be measured separately from canonical transport cadence.

Do not copy by default:

- The second prefix-reveal scheduler.
- Displayed-text state that intentionally trails canonical text.
- Render-phase ref mutation.
- Per-word DOM wrapping across the full response.
- Claims based only on synthetic CSS start times.
- Any benchmark that excludes Markdown parsing while making whole-pipeline claims.

## 3. Architectural decision

Implement and preserve this ownership model:

```text
Initiating visible tab
Provider → direct HTTP stream → AI SDK local message state
         → incremental Markdown projection
         → stable memoized blocks + one bounded mutable region
         → lazy/throttled syntax highlighting

Durability and shared observation
Provider stream → durable snapshot writer → Convex
Convex → reactive run/message projection
       → navigation recovery, reload recovery, other tabs/devices, terminal truth
```

### State authority

| Situation | Presentation authority | Durable/shared authority |
|---|---|---|
| Initiating tab while HTTP stream is attached | AI SDK local message state | Convex records run status and periodic snapshots |
| Initiating tab after stream settles | Selected-path projection | Convex final message and run settlement |
| User navigates away while generation continues | Detached server/stream runtime | Convex snapshots and run lifecycle |
| User returns during generation | Convex snapshot initially, then attached local stream only if one exists for that surface | Convex |
| Other tab or device | Convex reactive projection | Convex |
| Stop, error, approval pause, failure, or reaper settlement | Local status may provide immediate feedback | Convex is final durable truth |

### Non-negotiable invariants

- The initiating tab must not route foreground token paint through Convex.
- There must be one canonical in-memory message state for the active stream, not a second text store.
- Presentation state must never be persisted.
- Displayed settled content must exactly equal canonical content.
- Durable snapshot frequency and Convex subscription behavior must not control active-tab frame cadence.
- Completed Markdown blocks must perform no parsing or rendering work during ordinary append-only growth.
- Only the mutable terminal region may change during ordinary append-only growth.
- Stop, error, approval, retry, regeneration, branching, detached streams, and navigation must retain current semantics.
- Telemetry must never contain assistant text, reasoning text, prompts, code, URLs, or tool payloads.

## 4. Delivery strategy

Deliver the work as focused, independently reviewable pull requests. Do not combine all phases into one large PR.

Recommended sequence:

1. PR A: baseline harness and honest measurement
2. PR B: incremental Markdown projection
3. PR C: lazy, demand-loaded syntax highlighting
4. PR D: streaming cadence selection
5. PR E: Convex recovery validation and evidence-based tuning
6. PR F: optional presentation polish, only if raw streaming still fails the visual gate

Each PR must include:

- A narrow scope and explicit non-goals.
- Before-and-after measurements relevant to that PR.
- Focused tests plus the repository's full validation suite.
- A rollback note.
- No unrelated UI cleanup.

## 5. PR A: establish the evidence baseline

### Purpose

Create a trustworthy baseline before production behavior changes. The baseline must measure the entire visible path, not only isolated scheduler logic.

### Work

Add a measurement report:

`docs/measurements/YYYY-MM-DD-streaming-renderer-baseline.md`

Record:

- Baseline commit SHA.
- Browser and device profile.
- Production build command.
- Model/provider or deterministic replay source.
- Message throttle value.
- Snapshot cadence.
- Shiki configuration.
- Each test payload and its size.
- Median, p95, and worst-case results when repetition is possible.

Use or extend existing chat performance infrastructure. If no browser automation dependency exists, first determine whether the existing browser tooling can produce repeatable production traces. Add Playwright only if it is the smallest reliable way to automate these gates. Keep any new browser harness isolated under a performance or end-to-end directory.

### Required deterministic payloads

Commit content-safe synthetic fixtures:

1. Short prose, approximately 500 characters.
2. Mixed Markdown, approximately 12 KB.
3. Long prose/Markdown, approximately 100 KB, with a short growing terminal paragraph.
4. A 400-line TypeScript code block.
5. A code stress case large enough to reproduce the historical tab pressure without crashing CI.
6. GFM tables, nested lists, blockquotes, links, inline code, fenced code, and math.
7. Multiple reasoning headings and steps.
8. A response with many completed blocks and a small mutable tail.

Fixtures must be deterministic and must not contain real user content.

### Required metrics

Instrument or collect:

- Time from send intent to request dispatch.
- Time to first server byte when measurable.
- Time to first received text delta.
- Time to first visible assistant text.
- Delta count, chunk-size distribution, and inter-arrival distribution.
- AI SDK message notifications per second.
- React commits per second for the active assistant row.
- `parseMarkdownIntoBlocks` invocations.
- Total characters parsed by the splitter per visible update.
- Stable block render count.
- Mutable-region render duration.
- Shiki module-load duration.
- Shiki initialization duration.
- Highlight duration.
- Long tasks over 50 ms.
- Animation-frame gaps and delayed frames.
- Composer input latency while a response streams.
- Autoscroll responsiveness.
- Convex snapshot writes per run.
- Convex snapshot age observed after navigation, reload, and second-tab entry.

Performance instrumentation must be disabled or sampled in normal production and must record numbers and identifiers only.

### Baseline browser scenarios

Run in a production build:

- Normal desktop profile.
- 4× CPU slowdown or a representative mid-tier profile.
- Visible tab.
- Hidden tab, then return.
- Navigate away and return during generation.
- Reload during generation.
- Second tab during generation.
- Stop during prose.
- Stop during code.
- Error during generation.
- Approval pause and continuation.
- Natural completion.
- Regeneration and branch switch.
- Composer typing while 12 KB, 100 KB, and code responses stream.
- Text selection and copying while text continues to arrive.

### PR A exit gate

Do not begin cadence tuning from subjective observation alone. The baseline report and repeatable harness must land first. This PR must not change streaming behavior.

## 6. PR B: incremental Markdown projection

### Purpose

Remove the core scaling problem in `components/ui/markdown.tsx`: reparsing the complete accumulated response every time `children` changes.

This is the highest-value production change.

### Proposed files

Exact names may be adjusted to repository conventions, but keep the pure projection logic separate from React:

- `lib/markdown/incremental-block-projection.ts`
- `lib/markdown/incremental-block-projection.test.ts`
- `lib/markdown/markdown-equivalence-corpus.ts`
- `components/ui/markdown.tsx`
- `components/ui/markdown.streaming.test.tsx`
- `benchmarks/chat-performance/markdown-projection.bench.ts`

### Pure API

Implement a pure, deterministic state transition with an API equivalent to:

```ts
export type MarkdownProjectionState = {
  source: string
  blocks: MarkdownBlockRecord[]
  stableCount: number
  mutableStartOffset: number
  nextBlockIdentity: number
  parserVersion: string
}

export type MarkdownProjectionResult = {
  state: MarkdownProjectionState
  reset: boolean
  parsedCharacters: number
  reusedBlockCount: number
  changedBlockCount: number
}

export function advanceMarkdownProjection(args: {
  previous: MarkdownProjectionState | null
  source: string
  streaming: boolean
  identity: string
}): MarkdownProjectionResult
```

The React component should consume this state transition through a small hook or memoized reducer. Do not mutate projection refs during render in a way that can survive an abandoned concurrent render. State that affects committed output must advance in a commit-safe React state/reducer path or be derived purely from committed inputs.

### Projection algorithm

Use the current remark/unified parser as the semantic authority. Do not switch to `marked` solely because T3 Chat uses it.

Implement this behavior:

1. **Initial render or reset**
   - Parse the complete source.
   - Assign monotonic block identities.
   - Mark a conservative terminal ambiguity region as mutable.

2. **Append-only streaming update**
   - Verify `source.startsWith(previous.source)`.
   - Preserve every block before `mutableStartOffset`.
   - Reparse only `source.slice(mutableStartOffset)`.
   - Offset the reparsed block positions back into full-source coordinates.
   - Reconcile reparsed blocks with the previous mutable blocks.
   - Reuse identities for blocks whose source range and content remain semantically unchanged.
   - Keep a conservative ambiguity window mutable. At minimum, keep the terminal block and its immediately preceding context block mutable until testing proves a narrower boundary is safe.

3. **Settlement**
   - Run one authoritative full parse.
   - Reconcile unchanged block identities.
   - Verify the settled incremental projection is equivalent to the authoritative projection.
   - Mark all blocks stable.

4. **Non-prefix update**
   - Full reset on shrinkage, regeneration, edit, branch switch, durable correction, message identity change, parser configuration change, or any other non-prefix source update.
   - Record a content-free reset reason.

5. **Ambiguity fallback**
   - Fall back to a full parse when the incremental parser cannot prove the restart boundary is safe.
   - Prefer correctness over incremental work in uncommon grammar cases.
   - Count fallbacks by reason so the team can see whether the fast path covers real traffic.

### Safe-boundary requirements

Do not assume without proof that every AST node except the last is permanently stable. The equivalence corpus must cover constructs capable of reclassifying nearby source:

- Paragraph continuation.
- ATX and Setext headings.
- Ordered, unordered, task, and nested lists.
- Lazy list continuation.
- Blockquotes.
- GFM tables whose delimiter row arrives later.
- Fenced code split at every possible boundary.
- Backticks inside inline and fenced code.
- Emphasis, strikethrough, and links with late closers.
- Autolinks.
- Reference link definitions and uses.
- Math delimiters.
- HTML blocks if supported by current behavior.
- Blank-line boundaries split across chunks.
- CRLF and LF input.
- Unicode surrogate pairs, grapheme clusters, and combining marks.
- Custom remark transforms:
  - `remarkCodeBlockAnnotation`
  - `remarkLinkPresentation`
  - `remarkUnwrapLinkParens`

If a construct has document-wide semantics that cannot be preserved by isolated tail parsing, explicitly classify it as a full-parse fallback or redesign the block seam. Do not silently change settled output.

### Identity and rendering rules

- Replace index-derived identity as the sole identity source.
- A finalized block must retain its key during every later append.
- A mutable block may retain its identity when its start and semantic role remain continuous.
- A block that genuinely splits or changes type may receive a new identity.
- `MemoizedMarkdownBlock` must continue comparing content and stability.
- Completed blocks must not rerender because the array object or callback identities changed.
- Custom `components` must continue to merge with `INITIAL_COMPONENTS` without defeating memoization.
- The terminal block becomes stable exactly once on settlement or when a later block makes it safely final.

### Equivalence corpus

For each fixture:

1. Stream every meaningful prefix.
2. Also stream at randomized chunk boundaries.
3. Advance the incremental projection for every prefix.
4. Compare it with the current full-parser reference.
5. At settlement, compare normalized block records.
6. Render both paths and compare normalized DOM.
7. Compare visible text, links and URL transforms, table copy output, code copy output, math output, and custom component calls.
8. Verify stable identities and zero stable-block rerenders.
9. Verify explicit reset behavior for non-prefix corrections.

Use deterministic seeds for randomized tests and print the seed on failure. Include hundreds of chunk sequences in normal CI and a larger corpus in a dedicated stress command if full CI time becomes excessive.

### Benchmarks and acceptance gates

Benchmark both the old full splitter and the new projector.

Required cases:

- 12 KB source with 1–8 character appends.
- 100 KB source with a terminal mutable region comparable to the 12 KB case.
- One very long paragraph.
- Many short completed blocks with a small mutable tail.
- Table construction.
- Growing fenced code.

Pass criteria:

- Settled output is equivalent across the complete corpus.
- Ordinary append-only updates parse work proportional to the mutable region plus appended text, not total historical source.
- A 100 KB response with the same-sized mutable tail has approximately the same incremental projection cost as a much shorter response. Use a ratio gate derived from the baseline; target no worse than 2× p95 unless the report justifies another bound.
- Stable completed blocks have zero render count during later ordinary appends.
- No regression in time to first visible text beyond one animation frame.
- No new long tasks in the production stress trace.

### Rollback

Keep the old full-parser function as the reference implementation and emergency fallback during rollout. Do not maintain two user-visible modes indefinitely. Once production evidence is satisfactory, retain the full parser only as the reset/settlement authority and test oracle.

## 7. PR C: lazy, demand-loaded Shiki

### Purpose

Prevent non-code conversations from paying Shiki's client-loading and initialization cost, reduce startup work for code, and keep the growing terminal code block responsive.

Current `components/ui/code-block.tsx` uses:

```ts
import { createHighlighter } from "shiki"
```

It then initializes two themes and 35 languages. Replace this with a true asynchronous boundary.

### Proposed design

Create a client-only highlighter service, for example:

- `lib/markdown/shiki-client.ts`
- `lib/markdown/shiki-client.test.ts`

Requirements:

- `components/ui/code-block.tsx` must contain no runtime import from `shiki`.
- Type-only imports are allowed only if the emitted browser module graph confirms they disappear.
- Dynamically import a fine-grained Shiki entry when the first code block needs highlighting.
- Prefer `shiki/core` with the JavaScript regex engine for the browser if compatibility testing passes.
- Import only the two required themes.
- Load the requested language grammar on demand from an explicit, typed allowlist.
- Add direct package dependencies for any `@shikijs/*` modules imported by source code. Do not rely on undeclared transitive resolution.
- Cache one highlighter instance.
- Deduplicate concurrent initialization and language-load requests.
- Keep an alias map for `js`, `ts`, `sh`, and other supported aliases.
- Unknown or unsupported languages must use escaped plain text.

Official Shiki guidance favors fine-grained bundles and cached highlighter instances for browser performance:

- https://shiki.style/guide/bundles
- https://shiki.style/guide/best-performance

### Rendering behavior

- Render escaped plain code immediately on the server and on first client paint.
- Never display stale highlighted HTML for a different code string, language, or theme.
- Associate each async request with a generation key containing code identity, normalized language, theme, and request generation.
- Ignore any completion whose generation key is no longer current.
- Preserve selection, scrolling, and copy behavior while the plain fallback is visible.
- When a block settles, run one authoritative final highlight immediately.
- Only the terminal growing code block may use throttled re-highlighting.
- Stable code blocks must never re-highlight because later prose or blocks stream.

### Throttle experiment

Compare at least:

- 150 ms
- 200 ms
- 300 ms current baseline

Measure:

- Main-thread highlight duration.
- Delayed frames.
- Visible tail staleness.
- Composer input responsiveness.
- Settle-to-final-highlight duration.

Select the fastest interval that stays within the main-thread budget. Do not copy T3's approximate 150 ms value without evidence.

If large code highlighting still produces long tasks after fine-grained loading, evaluate a Web Worker in a separate follow-up. Do not add worker complexity preemptively.

### Acceptance gates

- A no-code conversation's initial client chunks contain no Shiki runtime, language, theme, or WASM payload.
- Plain code appears immediately.
- Supported languages highlight after their grammar loads.
- Unknown languages never throw.
- Stable code blocks do zero later highlight work.
- The final settled code and theme are correct.
- No stale async result can overwrite newer code, language, or theme.
- The production build shows a real split chunk rather than only a source-level dynamic import.

## 8. PR D: select the foreground streaming cadence

### Purpose

Choose the simplest cadence after Markdown and code rendering are intrinsically cheap.

Do not tune cadence before PR B and PR C land.

### Candidate matrix

Test:

- Unthrottled AI SDK message notifications.
- 16 ms.
- 32 ms.
- 50 ms current baseline.

For each candidate, run:

- Raw provider deltas with no presentation scheduler.
- Short prose.
- 12 KB mixed Markdown.
- 100 KB with a short mutable tail.
- Growing code.
- 4× CPU slowdown.
- Composer typing and autoscroll.

Collect actual provider traces from representative OpenAI, Anthropic, Google, and OpenRouter models without recording text. Store only:

- Provider and model identifier.
- Delta count.
- Delta byte/character size buckets.
- Inter-arrival time buckets.
- Burst length.
- First-delta latency.
- Completion duration.

### Selection rule

Choose the lowest-complexity option that satisfies:

- First visible text is not artificially delayed.
- No new long tasks.
- Composer typing remains responsive.
- Autoscroll remains responsive.
- Actual painted cadence looks continuous in the production browser trace.
- React commits remain within the browser's useful frame budget.

Expected outcome: 16–32 ms or immediate updates may become viable after the renderer improvements. Keep 50 ms if evidence shows it remains the best balance.

Do not make the value remotely configurable unless there is a concrete operational need. A code constant plus documented benchmark is preferable to a permanent flag.

### `smoothStream` policy

Do not introduce global `smoothStream()` by default.

The AI SDK utility intentionally transforms delivery cadence and can add delay:

- https://ai-sdk.dev/docs/reference/ai-sdk-core/smooth-stream

Use it only if provider-specific traces prove that a provider emits visually unacceptable bursts after the client path is optimized.

If introduced:

- Scope it to explicit providers/models.
- Start with word chunking and a measured delay.
- Confirm text, reasoning, tool-call, abort, and final-word behavior.
- Regression-test a final word immediately before a tool call or reasoning transition.
- Record added canonical latency.
- Never use it to conceal renderer slowness.

### Acceptance gates

- The selected cadence is supported by production-browser traces.
- The measurement report distinguishes received deltas, React notifications, DOM commits, and browser-painted frames.
- No synthetic CSS timestamp is described as a painted frame.
- Final displayed content always equals canonical content.

## 9. PR E: validate and tune Convex recovery

### Purpose

Confirm that Convex is providing excellent durable and cross-surface recovery without burdening the foreground token path.

### Preserve

- Direct HTTP streaming in the initiating tab.
- Durable turn runtime.
- Execution grants.
- Periodic assistant snapshots.
- Final full-parts snapshot.
- Run lifecycle and settlement receipts.
- Detached-stream behavior.
- Approval recovery and reapers from PR #129.
- Reactive selected-path and run projection.

### Required recovery scenarios

Automate where feasible and manually verify the remainder:

1. Navigate away and return during prose.
2. Navigate away and return during code.
3. Reload during generation.
4. Open the same chat in a second tab.
5. Open the same chat on another authenticated device/session.
6. Disconnect the client and reconnect.
7. Hide the tab for an extended period.
8. Stop while attached.
9. Stop after navigation if the current product surface supports durable Stop.
10. Fail while detached.
11. Pause for approval, resolve in another tab, and continue.
12. Natural completion while no client is viewing the chat.
13. Degraded settlement followed by reaper convergence.

Verify:

- No text rewind when switching from a Convex snapshot to a live local source.
- No duplicate text or messages.
- No branch contamination.
- Correct terminal status.
- Correct Stop ownership.
- Snapshot content never overwrites newer local canonical content.
- A second tab sees bounded-staleness progress without consuming the first tab's HTTP stream.
- Final settlement converges every observer to identical content.

### Snapshot cadence experiment

Keep the existing approximately 750 ms cadence initially.

Measure:

- Snapshot age at return/reload/second-tab entry.
- Mutations per generated minute.
- Bytes written per generated minute.
- Reactive query invalidations and payload bytes.
- Database and function cost.
- User-visible recovery staleness.

Only test a shorter cadence, such as 500 ms, if 750 ms creates a visible recovery problem. Only test a longer cadence if Convex write or invalidation cost is material.

Do not route every token through a Convex mutation or subscription. Convex documentation confirms reactive queries are pushed over WebSockets, which is ideal for shared durable state, while Convex's own streaming guidance recommends combining direct foreground streaming with periodic synchronized persistence to control bandwidth:

- https://docs.convex.dev/client/react/overview
- https://stack.convex.dev/streaming-vs-syncing-why-your-chat-app-is-burning-bandwidth

### Optional persistence optimization

Do not redesign snapshot storage in this project unless measurement shows it is necessary.

If full accumulated snapshot writes create material write amplification:

1. Document current write bytes and invalidation behavior.
2. Compare compacted checkpoints or append deltas.
3. Preserve atomic recovery and final full-parts settlement.
4. Avoid adding a complex event log merely to reduce an unproven cost.

### Acceptance gates

- Foreground first-visible-text and paint cadence are unaffected by Convex latency.
- Recovery snapshot age stays within the documented cadence plus reasonable network propagation.
- Other tabs/devices reactively observe progress.
- All observers converge to the same final message and terminal state.
- Convex mutation frequency and bytes are measured and acceptable.

## 10. PR F: optional presentation polish

Do not start this PR unless PR B through PR E are complete and the raw optimized path still fails a documented visual-quality gate.

Evaluate in this order:

1. Raw deltas at the selected client throttle.
2. Provider-specific server smoothing for proven bursty providers.
3. A lightweight mutable-tail-only CSS fade that does not create a second displayed-text scheduler.

Reject any approach that:

- Holds canonical text behind a second timer without a proven need.
- Creates a second canonical or quasi-canonical text state.
- Wraps every historical word indefinitely.
- Depends on animation frames to reach terminal truth.
- Replays animations after navigation or reload.
- breaks reduced motion.
- Introduces concurrent-rendering hazards.
- Adds more main-thread work than it removes.

If a fade is implemented:

- Apply it only to newly introduced nodes in the mutable terminal region.
- Bound and remove wrappers after animation.
- Disable it completely under `prefers-reduced-motion`.
- Snap immediately on Stop, error, approval, hidden-tab transition, non-prefix correction, and terminal settlement.
- Verify actual browser paint cadence with `requestAnimationFrame` or filmstrip evidence.
- Keep canonical text in the DOM or ensure assistive technology receives canonical text immediately.

The default decision is to omit this PR if the optimized raw stream already looks smooth.

## 11. Cross-cutting testing matrix

### Correctness

- Byte-identical final visible text.
- Correct whitespace and line breaks.
- No missing trailing word.
- No duplicate text.
- Stable Markdown block keys.
- Correct link safety and `tel:` handling.
- Correct table rendering and copy output.
- Correct code copy output.
- Correct math.
- Correct inline code.
- Correct code language labels.
- Correct light/dark theme highlight.
- Correct reduced-motion behavior.
- Correct Stop, error, approval, retry, edit, regeneration, and branch behavior.
- No historical animation on mount.

### React concurrency

- Strict Mode.
- Interrupted `startTransition`.
- Suspense retry if the component can participate in one.
- Rapid message identity changes.
- Branch switch during streaming.
- Theme change while a highlight is in flight.
- Unmount/remount while a highlight is in flight.

No render-phase mutation may consume a one-shot state transition or alter committed output after an abandoned render.

### Accessibility

- Reduced motion.
- Screen-reader output does not lag canonical content.
- Code and prose remain selectable.
- Copy controls work during and after streaming.
- Focus does not move because a block settles.
- Live-region behavior, if any, does not announce the same text repeatedly.

### Security

- React-escaped plain-code fallback.
- Existing URL transform retained.
- No unsafe raw HTML introduced.
- No assistant content in logs, marks, spans, analytics, or errors.
- No provider key or tool payload exposure.

## 12. Validation commands

Discover and run all current CI commands. At minimum, the current repository exposes:

```bash
bun run typecheck
bun run lint
bun run test
bun run bench:chat
bun run build:next
```

Also run:

- Focused incremental parser tests.
- Randomized equivalence corpus.
- Markdown streaming component tests.
- Code-block/highlighter tests.
- AI SDK/use-chat seam tests.
- Durable runtime and selected-path tests if any shared code changes.
- Production browser performance suite.
- `git diff --check`.

Do not claim the full suite passed if only focused tests ran. Do not run Convex schema deployment commands when no schema changed merely to inflate validation. If a schema changes, run the repository's schema guard and preflight flow.

## 13. Success criteria

The project is complete only when all of these are true:

1. First visible assistant text is not delayed by a presentation buffer.
2. Ordinary append-only Markdown work scales with the mutable tail, not the full response.
3. A 100 KB response with a short tail has per-update cost comparable to a shorter response with the same tail.
4. Completed Markdown blocks do zero parse, render, and highlight work during later ordinary appends.
5. No-code chats do not load Shiki.
6. Plain code appears immediately and final highlighted code is correct.
7. Composer typing and autoscroll remain responsive during long prose and code.
8. Production traces show no new long tasks and materially fewer delayed frames than baseline.
9. Displayed settled content is exactly canonical content.
10. Stop, errors, approvals, navigation, reload, branching, and reduced motion are correct.
11. Convex provides bounded-staleness recovery and cross-tab/device convergence.
12. Convex is not inserted into the initiating tab's foreground token-to-paint path.
13. The chosen throttle and any provider smoothing are justified by measured traces.
14. Documentation clearly separates transport, notification, render, paint, and durability cadence.

## 14. Rollout and rollback

The app is pre-launch or low-scale, so prefer simple code-level rollout over elaborate percentage flags unless production risk requires otherwise.

For each behavioral PR:

- Retain a narrow rollback commit or previous implementation reference.
- Capture the baseline and new production trace before merge.
- Merge one architectural change at a time.
- Observe error rate, long tasks, first-visible latency, reset rate, and fallback rate.
- Revert the individual PR if correctness or responsiveness regresses.

Temporary diagnostics and fallback counters may be guarded by an existing build-time performance flag. Remove experimental modes after a decision. Do not leave permanent combinations of legacy, incremental, reveal, and smoothing modes.

## 15. Documentation updates

Add or update an ADR describing:

- Direct HTTP as the foreground streaming plane.
- Local AI SDK state as active-tab authority.
- Incremental Markdown projection.
- Lazy Shiki.
- Convex as durable/shared coordination.
- The selected notification cadence.
- When provider smoothing is allowed.
- Why PR #130's second reveal scheduler was rejected.

Update measurement documentation to use these terms precisely:

- **Provider delta cadence:** chunks emitted by the provider/AI SDK server stream.
- **HTTP delivery cadence:** chunks received by the browser.
- **AI SDK notification cadence:** message subscriber notifications after throttle.
- **React commit cadence:** committed DOM updates.
- **Animation scheduling cadence:** CSS start times, if any.
- **Browser paint cadence:** frames actually presented.
- **Convex durability cadence:** periodic persisted snapshots.
- **Recovery staleness:** age of the newest durable snapshot when another surface observes it.

## 16. Required final report from the coding agent

When implementation is complete, report:

1. Baseline and final commit SHAs.
2. Resulting architecture.
3. Pull requests and exact files changed.
4. Which parts of PR #130 were reused.
5. Which parts were rejected and why.
6. Incremental parser algorithm and fallback rules.
7. Parser and DOM equivalence results.
8. Shiki bundle and runtime changes.
9. Selected AI SDK throttle and evidence.
10. Any provider-specific smoothing and its added latency.
11. Convex snapshot cadence decision and measured cost.
12. Before-and-after browser results.
13. Tests and scenarios run.
14. Known limitations and follow-ups.

Do not declare completion if:

- The settled equivalence corpus fails.
- Production browser traces are missing.
- Long prose and code scenarios were not tested.
- Shiki still loads in no-code chats.
- Stable completed blocks still reparse or rerender.
- Convex recovery scenarios were not verified.
- Any terminal, approval, navigation, or branch behavior regresses.

## 17. Reference material

Repository:

- https://github.com/darknightdesigner/not-a-wrapper
- https://github.com/darknightdesigner/not-a-wrapper/pull/129
- https://github.com/darknightdesigner/not-a-wrapper/pull/130
- https://github.com/darknightdesigner/not-a-wrapper/blob/main/components/ui/markdown.tsx
- https://github.com/darknightdesigner/not-a-wrapper/blob/main/components/ui/code-block.tsx
- https://github.com/darknightdesigner/not-a-wrapper/blob/main/lib/chat-performance/message-throttle.ts
- https://github.com/darknightdesigner/not-a-wrapper/blob/main/lib/chat-performance/streaming-code-render.ts
- https://github.com/darknightdesigner/not-a-wrapper/blob/main/app/components/chat/use-chat-core.ts
- https://github.com/darknightdesigner/not-a-wrapper/blob/main/app/api/chat/durable-turn-runtime.ts

Verified/inspirational streaming references:

- T3 Chat shipped client bundles previously inspected:
  - https://t3.chat/assets/main-n91lvsG_.js
  - https://t3.chat/assets/chat-BSZ8inqJ.js
  - https://t3.chat/assets/shiki-BPwV81F-.js
- https://mikekey.com/blog/can-you-build-a-faster-chatgpt-in-nextjs/
- https://github.com/1337hero/faster-chat
- https://github.com/nuxflare/chat

Official technical references:

- https://ai-sdk.dev/docs/reference/ai-sdk-core/smooth-stream
- https://shiki.style/guide/bundles
- https://shiki.style/guide/best-performance
- https://docs.convex.dev/client/react/overview
- https://stack.convex.dev/streaming-vs-syncing-why-your-chat-app-is-burning-bandwidth

Treat T3's public client behavior as a rendering reference, not proof of its private server implementation. Treat clone repositories as examples, not authorities. The current repository's correctness requirements and measured browser behavior decide the final design.
