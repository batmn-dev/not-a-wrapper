# T3 Chat front-end analysis (2026-09-02)

Companion to `2026-09-02-ttft-tps-vs-t3-chat.md`. That document compares
numbers; this one records what we know about how t3.chat's client is built,
what is still unverified, and the exact brief for verifying it. The goal is a
replicate-or-reject decision per mechanism, each backed by a chunk name and
symbol (source evidence) or a timestamped tap (runtime evidence), never by
inference from feel.

## Status

| Mechanism | Evidence today | Status |
|---|---|---|
| Optimistic thread navigation | runtime: URL flips to `/chat/<uuid>` at Send, thread chunk fetched after | established, todo filed |
| Route-level code splitting | runtime: `_chat.chat._threadId-*.js` and `read-only-bar-*.js` load on demand; 134 Vite chunks | established, todo filed |
| Client store for sidebar and threads | runtime: model picker reads "Loading…" until a sync boot completes; thread list renders from client state | mechanism inferred, todo filed |
| Visibility-gated hydration | runtime: no React props on the textarea and a disabled submit until the tab is shown | established, todo filed |
| SSR composer shell | runtime: composer visible and correctly labeled before hydration | established, todo filed |
| Stats for Nerds | bundle audit: server-written Convex fields, client has no clock | established, not replicating |
| Streamed-text pacing | source: Effect pipeline → zustand `setState` per delta; runtime: 214 deltas → 190 commits, median 2.3 ms lag | established: no client pacing, reject |
| Markdown and highlighting stack | source: react-markdown + remark-gfm/math + rehype-katex + KaTeX preloaded, `marked` lexer block memo, Shiki `React.lazy` | established: same stack as ours, reject swap |
| Thread virtualization | source: plain `messages.map`, TanStack Virtual only on sidebar; runtime: 60/60 rows in DOM at every scroll position | established: none, reject |
| Sync-engine update batching | source: convex/react `useState` subscription, no transitions; runtime: 9 non-ping frames per turn, live turn in zustand | established: same class as ours, reject |

## What is already established

Runtime observations come from the 2026-09-02 benchmark session, driven
through the Chrome extension against a signed-in Pro account. Bundle facts come
from the same day's in-browser search of all t3.chat chunks.

- **Send waterfall.** Between the click and `/api/chat` the client fires an
  event ping, `/api/server-version`, three TanStack `_serverFn` calls, and a
  tRPC subscription lookup; `/api/chat` leaves at about 1.1 s. Ours leaves at
  0.35 to 0.45 s after a single rate-limit check. Not a pattern to copy.
- **Stream transport.** `/api/chat` (plus `/resume` and `/abort`) streams the
  AI SDK UI-message protocol from Vercel iad1, the same event vocabulary we
  use. The stream is read with fetch, so an in-page fetch wrapper with
  `body.tee()` can timestamp chunks. Overriding `Response.prototype.body`
  breaks the SDK ("Cannot pipe a locked stream").
- **Stats for Nerds.** `tokensPerSecond`, `timeToFirstToken` (seconds), and
  `tokens` are optional fields on the Convex `messages` document, written
  after the stream and delivered by subscription. The UI only formats them.
  The "Time-to-First" values seen live (0.004 s, 0.05 s) confirm the anchor is
  not the user's send.
- **DOM shape.** `#chat-scroll-container` with `data-scroll-restoration-id`;
  `role="log"` list; each message a `div[data-message-id]` wrapping
  `div[role="article"][aria-label="Assistant message"]` with `prose` classes;
  `animate-fade-in` on the list. First visible assistant text appeared 3.16 s
  after the click on the one instrumented Luna P1 run.
- **Sidebar.** Every thread renders, grouped Pinned / Yesterday / Last 7 Days /
  Last 30 Days / Older; a send re-rendered 28+ rows within 100 ms. Not a
  pattern to copy.
- **Hydration gate.** In a hidden tab the composer stays a server-rendered
  shell: submit disabled, model picker "Loading…", no `__reactProps` on the
  textarea. It completes only after the tab is shown, then keeps working
  hidden as long as the page is not reloaded.

## Open questions

1. **Pacing.** Does the client release streamed text as chunks arrive, or
   hold it back on a timer, word budget, or animation frame? If it paces, what
   is the cadence and is it evidence-gated like ours (ADR-0016)?
2. **Markdown and highlighting.** Which parser and renderer, whether it is
   incremental or re-parses the whole message per delta, which code
   highlighter, whether math renders, and whether any of it is lazy-loaded.
3. **Virtualization.** Is the thread list windowed (a virtualizer library,
   `content-visibility`, or neither), and how does it handle scroll anchoring
   while streaming?
4. **Sync batching.** How subscription updates reach React: per WebSocket
   message, coalesced per animation frame, or via a transition. Whether the
   streaming turn goes through the same path or a separate in-memory channel.

## Verification prompt

Give the following to an agent with the Chrome extension and this repository.
It is self-contained.

```text
Verify four front-end mechanisms of t3.chat with evidence, then fill the
Findings section of docs/performance/2026-09-02-t3-chat-frontend-analysis.md.

Setup. Use the signed-in t3.chat tab in the user's Chrome. The client only
hydrates while the tab is visible: ask the user to show the tab once, then
never reload it; start new chats with the in-app New Chat link. Type into the
composer through its React onChange (native value setter + input event +
__reactProps onChange) and click the form submit button from page script;
extension keystrokes do not reach a hidden tab. Sanitize javascript_tool
results (strip = ; & ? and query strings) or they come back blocked.

Source evidence. Collect every chunk URL from the HTML modulepreload list,
the Vite manifest if exposed, and the dynamic imports seen in the Network
panel while sending one message. Fetch each chunk and search it. Record for
each hit the chunk filename and the identifier or string that proves it.

1. Pacing: search for setTimeout, requestAnimationFrame, or queueMicrotask
   applied to text-delta handling; strings like smooth, throttle, chunk,
   holdback, wordsPerSecond; and any transform on the UI-message stream.
2. Markdown and highlighting: search for react-markdown, marked, micromark,
   remark, rehype, streamdown, mdast, shiki, highlight.js, prism, katex,
   mathjax; note whether the renderer chunk is in the initial load or lazy.
3. Virtualization: search for react-virtual, tanstack/virtual, virtua,
   react-window, react-virtuoso, content-visibility, contain-intrinsic-size,
   overflow-anchor, scroll-margin; capture the scroll container's computed
   styles.
4. Sync batching: identify the sync client (Convex, Dexie, custom WebSocket)
   and where subscription results are applied to React state; search for
   startTransition, unstable_batchedUpdates, requestAnimationFrame, or a
   microtask queue around that apply; note whether the live turn is written
   through the same store or held in component state until finish.

Runtime evidence. On one fresh chat send prompt P2 from the benchmark doc
("Explain in about 200 words of plain English how a refrigerator keeps food
cold. No headings, no lists, no bold.") with GPT-5.6 Luna at Instant and:
- tee the /api/chat fetch body and log the arrival time of every text-delta;
- install a MutationObserver scoped to the assistant article and log every
  text change with performance.now();
- record a 5 s PerformanceObserver longtask sample during streaming;
- count WebSocket messages received during the turn (wrap
  WebSocket.prototype.addEventListener or the onmessage setter before the
  send) and the number of React commits (React DevTools hook if present,
  otherwise MutationObserver batches).
Report delta arrival versus DOM update timing as a table with the median gap
and the number of DOM updates per delta. Treat the timing shape as supporting
evidence only: a fixed cadence is consistent with client-side pacing, but
upstream batching or already-cadenced deltas produce the same shape, and a
one-to-one delta-to-update mapping argues against an added holdback without
ruling out every pacing implementation. Mark pacing verified only on source
evidence (the chunk and symbol from step 1) or a controlled delayed-stream
experiment (replay or proxy the stream with known delta timing and check
whether DOM updates track it).

Then send a 60-message thread (or open the longest existing thread) and
record how many message rows exist in the DOM versus the thread length, and
whether rows leave the DOM while scrolling.

Deliverable. For each of the four mechanisms write: what they ship (library
and version if present), evidence (chunk plus symbol, and the runtime table),
what we ship today, and a replicate-or-reject recommendation with the
before/after test that would prove it. Do not infer from feel; mark anything
not proven as unverified.
```

## Findings

Verification run 2026-09-02, signed-in Pro account, Chrome extension against
tab `t3.chat` (build `index-CrsmAoWm.js`). Source evidence comes from fetching
all 526 Vite chunks reachable from the 88 `modulepreload` entries (transitive
`name-hash.js` references, including every route chunk) and searching them in
page. Runtime evidence comes from two fresh chats sending P2 with GPT-5.6 Luna
at Instant (run 1 with a DOM tap only, run 2 with the full tap set), plus a
60-row thread built with GPT-5.4 nano for the virtualization check. Taps:
`ReadableStream.prototype.getReader` wrapper decoding every SSE line (the
client never calls `window.fetch`; Effect's HttpClient captures `fetch` at
module init, so a `window.fetch` wrapper sees nothing), a `MutationObserver`
on `document.body` filtered to `[aria-label="Assistant message"]`, a
`PerformanceObserver` for `longtask`, the Convex socket's `onmessage`
instance property wrapped via the `ConvexReactClient` found in React fiber
context (`client.sync.webSocketManager.socket.ws`), and a TanStack
`QueryCache.subscribe`. React DevTools hook absent, so "commits" below means
MutationObserver callback batches (one per task that touched the article).

### Pacing

**What they ship.** No client-side pacing. The stream is consumed by an
Effect.js pipeline, not the AI SDK's `useChat`, and every `text-delta` is
written straight into a zustand store.

Evidence (chunk + symbol):

- `index-CrsmAoWm.js`: `Ir("processChatStream")(function*(e,t,n){…})`. The
  body is `Stream.fromReadableStream(body).pipe(decodeText, splitLines,
  trim, strip /^data:\s*/, JSON.parse, Schema.decode(UIMessageChunk))` then
  `switch(e.type)`. There is no `throttle`, `debounce`, `schedule`,
  `setTimeout`, `requestAnimationFrame`, or `queueMicrotask` operator
  between the reader and the switch.
- Same chunk, `case\`text-delta\`: Y5.setState(n => { … parts[last] =
  {...part, text: part.text + e.delta}; return {messages: [...n.messages]}
  })`. Every delta produces a new `messages` array reference synchronously.
  `reasoning-delta`, `tool-input-*`, `start`, `text-start` follow the same
  shape and also flip a `waitingForNextText` flag.
- `Y5 = Cc(() => ({messages: []}))` where `Cc` is `create` from
  `react-QVb6z7FP.js` (744 bytes: zustand's vanilla store + a
  `useSyncExternalStore` hook). It is exported as `W` and consumed in
  `chat-r3ODTHTr.js` as `ni(e => e.messages.find(m => m.id === id)?.parts)`
  and `ni(e => … .waitingForNextText)`, so each delta notifies the message
  component through `useSyncExternalStore` (synchronous re-render lane).
- Zero hits in all 526 chunks for `smoothStream`, `wordsPerSecond`,
  `holdback`, `processUIMessageStream`, `useChat`. The only `throttle`
  matches are PostHog's session-replay `throttleMutations` and Tailwind's
  class tables; the only `smooth` matches are TanStack Virtual's
  "smooth scroll not supported with dynamic size" warning and CSS.

Runtime (run 2, P2, Luna Instant; times are ms after the Send click):

| Metric | Value |
|---|---|
| text-delta events | 214 (plus start, start-step, text-start, text-end, finish-step, finish) |
| DOM update batches on the assistant article | 190 |
| First delta / first DOM update | 3778 / 3789 |
| Last delta / last DOM update | 7120 / 7122 |
| Delta → next DOM update gap | median 2.3, p10 1.5, p90 4.0, max 11.5 |
| DOM updates per delta | 0: 25 deltas, 1: 188 deltas, 2: 1 delta |
| Delta arrival cadence | median 10.8, p10 0, p90 27.9 |
| Delta size (chars) | 1–3: 28, 4–7: 133, 8–15: 53 |
| Long tasks ≥ 50 ms during the stream | 0 (run 1 and run 2) |

Sample rows (delta time, delta chars, DOM updates before next delta, gap):

| t | chars | DOM updates | gap |
|---|---|---|---|
| 3777.9 | 2 | 0 | (same network read as next four) |
| 3777.9 | 13 | 0 | |
| 3777.9 | 6 | 0 | |
| 3777.9 | 5 | 0 | |
| 3784.4 | 5 | 0 | |
| 3789.0 | 3 | 2 | 0.0 |
| 3797.5 | 7 | 1 | 2.5 |
| 3807.6 | 5 | 1 | 2.6 |
| 3819.1 | 5 | 1 | 2.7 |
| 3827.3 | 7 | 1 | 4.3 |
| 5312.4 | 6 | 1 | 2.0 |
| 5337.7 | 8 | 1 | 2.6 |
| 5352.1 | 4 | 1 | 1.4 |
| 6811.6 | 6 | 1 | 4.1 |

The gap never grows with a fixed cadence; the MutationObserver batches stay
a few milliseconds (~2 ms median) behind the deltas. The run observed 190
observer batches for 214 deltas: mostly one batch per delta, with the 25
zero-update deltas being ones that arrived in the same `read()` as the
following delta (p10 cadence 0 ms) so one batch covered both, and one delta
producing two batches. That runtime result is consistent with direct
delivery; the absence of client pacing is established by the source
inspection above (no pacing operator between the stream and the store), not
by this ratio. Run 1 (DOM tap only) agrees: 181 batches, median 11.5 ms
between batches, median 6 chars per batch, first paint 3056 ms, last 6037 ms.

What is not proven: the server side. The word-sized deltas at a ~10 ms median
cadence are consistent with the AI SDK `smoothStream()` default
(`chunking: "word"`, `delayInMs: 10`) applied on their `/api/chat` route, but
that runs on Vercel and is unverifiable from the client. Treat "T3 paces on
the server" as unverified.

**What we ship.** Server-side adaptive word chunking, evidence-gated to the
one measured provider/model pair — the Anthropic `claude-haiku-4-5-20251001`
route — and off for every other stream (`isWordChunkingEligible` in
`app/api/chat/word-chunking-transform.ts`: word-boundary reassembly, 5–80 ms
per-word delay derived from observed arrival rate, 400 ms max buffered lag;
adding a target requires a trace showing coarse provider deltas), then on
the client the AI SDK `Chat` store mutated per part with
frame-aligned notification (`lib/chat-performance/message-throttle.ts`: at
most one `useSyncExternalStore` publication per paint while streaming), and
ADR-0016 incremental block projection.

**Recommendation: reject (nothing to replicate).** Their client does less
than ours: one commit per delta, no coalescing. Our frame aligner adds at
most one frame (8–16 ms) of latency over their ~2 ms and removes redundant
commits; the visible difference is not measurable by eye. Do not remove the
frame aligner to chase parity. Before/after test if anyone proposes it: same
`getReader` + MutationObserver tap on our `/c/<id>`, compare commits per
second and long-task count at equal delta rate; a change is only worth
shipping if long tasks drop or first-paint-after-first-delta improves by
more than one frame.

### Markdown and highlighting

**What they ship.** react-markdown (v9+ API) with remark-gfm, remark-math,
rehype-katex, KaTeX bundled in the initial load; a per-block memoization
layer (`marked` lexer splits blocks, react-markdown renders each, React.memo
per block) with a streaming-aware tail cache; Shiki lazy-loaded through
`React.lazy`. Versions are not embedded in the minified output.

Evidence:

- `lib-CeZPJHkx.js` (121 KB, modulepreload): react-markdown. Its deprecation
  table is intact (`allowNode → allowedElements`,
  `transformLinkUri → urlTransform`, `escapeHtml → remove-buggy-html…`), and
  it carries `hast-util-to-jsx-runtime` (`ruleId: "style"`, source string),
  which places it at react-markdown ≥ 9. Consumed as `xt` by the renderer
  chunk.
- `attachment-preview-modal-CaGM4beU.js` (515 KB, modulepreload) is the
  renderer chunk: `micromark` ×6, `gfm` ×59, remark-math (`Cw`, used as
  `[Cw, {singleDollarTextMath: false}]`), rehype-katex (`sx`, used as
  `[sx, {throwOnError: false}]`, walks `language-math` class names), and
  the KaTeX runtime itself (`KaTeX parse error`, `SETTINGS_SCHEMA`,
  `__renderToDomTree`). KaTeX CSS is inlined in `styles-B6DRfLve.css`
  (`.katex` ×500).
- Same chunk, `OM = React.memo(({content, role, additionalRemarkPlugins,
  components, isStreaming}) => <ReactMarkdown remarkPlugins rehypePlugins
  components>{content}</ReactMarkdown>, (a, b) => a.content === b.content &&
  a.isStreaming === b.isStreaming)`, `displayName "MemoizedMarkdownBlock"`,
  wrapped in error boundary `Nk` whose fallback shows the raw content.
  Plugins: user role gets `Dk` (micromark `disable: {null:
  ["codeIndented"]}`); streaming gets `mA` (rewrites a setext heading whose
  underline is a lone `-` back into a paragraph while the next line is still
  arriving) and `_A` (trims a leading text node against two regexes).
  Components override `code` (`yM`), `pre`, `a` (external target), `ul`,
  `ol`, `blockquote`, `table` (scroll container + copy/download strip),
  `img`, `iframe`.
- `kM = React.memo(…)`, `displayName "MemoizedMarkdown"`: `sM(content,
  isStreaming)` → blocks, then `blocks.map((b, i) => <OM key={`${id}-block_${i}`}
  content={b} … />)`. `sM` keeps a `useRef({content, blocks})` cache and
  `oM({content, isStreaming, cached})` re-splits only the tail: if the new
  content `startsWith` the cached content it drops the last cached block (and
  the one before it when the last is whitespace), re-splits from that offset
  with `iM`, and appends. Non-streaming content re-splits fully. `iM(e) =
  rM(Bj.lexer(Xj(e)).map(t => t.raw))`: the splitter is `marked`'s lexer
  (its defaults object `{async:false, breaks:false, gfm:true, pedantic:false,
  …}` sits in the same chunk), so `marked` is bundled purely to tokenize
  blocks; react-markdown still renders each block. `aM` normalizes a
  ```` ````markdown ```` fence to ```` ``` ```` before comparing tails.
- Shiki: `lM = React.lazy(() => import("./shiki-DxNlMiiy.js"))` in the
  renderer chunk (238 KB chunk, plus 50-odd grammar/theme deps via
  `__vite__mapDeps`). `code-body-wrapper-BNePzYa4.js` (758 B, preload) only
  applies the `.shiki` class. Mermaid is lazy (`mermaid.core-*`,
  `sequenceDiagram-*`). No `highlight.js`, `prism` (only shiki's internal
  references), or `streamdown`; `marked` is present only as the block lexer
  described above.
- Initial versus lazy: react-markdown + remark/rehype + KaTeX = ~636 KB of
  modulepreload JS; Shiki and Mermaid are lazy.

Not proven: whether code blocks re-highlight per delta or after a settle
(P2 has no code); how `iM` splits (fence-aware via `fM`'s
`/^[ \t]{0,3}([`~]{3,})/` test is visible, the rest of the splitter was not
read).

**What we ship.** react-markdown 10.1, remark-gfm 4, remark-math 6,
remark-breaks 4, rehype-katex 7, shiki 4.3 lazy (`lib/markdown/shiki-client.ts`),
ADR-0016 incremental block projection (`lib/markdown/incremental-block-projection.ts`,
context-verified tail re-parse rather than blank-line trust) and the
streaming decay overlay.

**Recommendation: reject a swap; same stack.** Their block memo is the
Vercel "memoized markdown" recipe with a tail cache; ours re-parses the tail
with stable context blocks, which is strictly safer for the cases their
`mA` plugin patches by hand. One optional experiment: their `mA`-style
setext guard is a cheap remark plugin; if we ever see a heading flash during
streaming, port that instead of widening the tail window. Before/after test:
stream a message with `Title\n-` on a delta boundary and assert no `<h2>`
appears before the following line arrives.

### Virtualization

**What they ship.** No virtualization of the message thread and no CSS
containment on rows. TanStack Virtual is bundled but its only call site is
the sidebar thread list. Messages are paginated from Convex, not windowed.

Evidence:

- `chat-r3ODTHTr.js`: the thread is `<div role="log" aria-label="Chat
  messages" aria-live="polite" class="mx-auto flex w-full max-w-3xl flex-col
  space-y-12 px-4 …">` whose children are `messages.map(m => <div
  key={m.messageId} class="flex scroll-mt-24 break-after-avoid …
  [last assistant: min-h-[calc(100vh-20rem)]]"><Rp …/></div>)`, with
  `Rp = React.memo(MarkdownContent)`. Plain map, no range extractor.
- `_chat-Ctp8H1Tq.js` contains `@tanstack/virtual-core` (`measureElement`,
  `estimateSize`, `scrollMargin`, `useAnimationFrameWithResizeObserver`) and
  one `kr({count: Y.length, getScrollElement: () =>
  oe.current?.parentElement, estimateSize: ae, overscan: 20})` where `Y` is
  the grouped sidebar list (Pinned/date groups; `estimateSize` returns
  2.25 rem for threads and 2 rem for headers) and `X.measure()` runs on group
  collapse. No `getScrollElement` in `chat-*.js` or
  `_chat.chat._threadId-*.js`.
- `styles-B6DRfLve.css`: zero `content-visibility:` declarations, zero
  `overflow-anchor`, `contain-intrinsic-size` only inside Tailwind's
  preflight `@supports` probe, `contain:` only on dialog overlays,
  `scroll-margin-top` only via `.scroll-mt-24` (6 rem) and `.docs-heading`.
- Computed styles at runtime, `#chat-scroll-container` (class `absolute
  inset-0 overflow-y-scroll pt-8 sm:pt-3.5 …`): `overflow-y: scroll`,
  `overflow-anchor: auto` (default), `scroll-behavior: auto`,
  `scroll-padding-bottom: 15px`, `contain: none`, `content-visibility:
  visible`, `overscroll-behavior: auto`. `div[role=log]`: all defaults.
- Data: `usePaginatedQuery(w.messages.getPageByThreadId, {threadId,
  sessionId}, {initialNumItems: 20})` plus a full-thread
  `useQuery(w.messages.getByThreadId)` gating `isFullThreadReady`; the
  sidebar uses `w.threads.list` with `initialNumItems: 50`.
- Scroll follow (`om()` in `chat-*.js`): a `scroll` listener, a
  `ResizeObserver` on `div[role="log"]` whose callback is coalesced with
  `requestAnimationFrame`, `scrollTo({top: scrollHeight, behavior:
  "instant"})`, a "scroll to bottom" button when `scrollHeight - scrollTop -
  clientHeight > 10`, and a 100 ms `setTimeout` after each scroll event. A
  separate keyboard scroller animates `scrollTop` over 150 ms on `rAF` for
  PageDown/Space holds.

Runtime (thread built to 60 rows with GPT-5.4 nano, "Reply with only the
word OK."):

| Measure | Value |
|---|---|
| Messages in the Convex full-thread query result | 60 |
| `div[data-message-id]` rows in the DOM | 60 |
| Assistant articles in the DOM | 30 |
| Scroll container `scrollHeight` / `clientHeight` | 6,645 px / 1,199 px (5.5 screens) |
| Rows in DOM at scrollTop 0 / 25% / 50% / 75% / 100% | 60 / 60 / 60 / 60 / 60 |
| Original row nodes retained after the scroll sweep | 60 of 60 at every position |

No rows leave the DOM while scrolling and no rows are replaced; the
paginated query held a 40-item page (`isDone: false`) plus a 20-item page,
i.e. "load more" pages of 20, all of which were rendered.

**What we ship.** Eager rows with `content-visibility: auto` and
`contain-intrinsic-size: auto 100lvh` on settled rows
(`app/components/chat/conversation.tsx`), the live row excluded. The
row-virtualization arm was removed on 2026-08-26 because its reflow
`scrollTop` writes killed touch momentum; the eager shape is the only one
that ships (see the `TurnRow` note in `conversation.tsx` and the
"removed virtualization arm" note in `app/components/chat/thread-scroll.tsx`).
ChatGPT-style scroll anchoring via `scroll-margin-bottom` and trailing gutter
(`docs/chatgpt-scroll-architecture-audit.md`).

**Recommendation: reject.** T3 does strictly less than we do: no windowing,
no containment, a JS scroll-follow loop through ResizeObserver + rAF that we
replaced with CSS anchoring. Nothing to port. Before/after test that would
change this: a 200-row thread with mixed code blocks, measure scroll frame
time and layout duration with and without our `content-visibility` rule; if
ours is not faster, delete the rule, not add theirs.

### Sync batching

**What they ship.** Convex `npm-1.44.0` over WebSocket with the stock
`convex/react` hooks (per-query `useState` + `useEffect` subscription, no
`startTransition`, no explicit batching beyond React 19's automatic
batching), `@convex-dev/react-query` mounted but only used for billing
queries, and the live turn held entirely in the zustand store described
under Pacing until the finished Convex message document arrives.

Evidence:

- `api-CwvrVB4D.js`: `var a = "1.44.0"`, `"Convex-Client": \`npm-${a}\``,
  `new this.webSocketConstructor(this.uri)`, `RemoteQuerySet.transition(e)`
  applying every `QueryUpdated | QueryFailed | QueryRemoved` modification of
  one `Transition` frame before listeners run. `setTimeout` /
  `requestAnimationFrame` occur only in reconnect/backoff, server-inactivity
  and token-refetch scheduling; no `startTransition` or
  `unstable_batchedUpdates` in the chunk.
- Same chunk, the hook path: `Dn(e)` (`useQuery`, throws "Could not find
  Convex client! \`useQuery\` must be used …") → `On(e, createWatch)` =
  `useState(() => new En(createWatch))` + `dn({getCurrentValue: () =>
  n.getLocalResults(e), subscribe: t => { n.setQueries(e); return
  n.subscribe(t) }})`. `dn` is the use-subscription pattern:
  `useState({getCurrentValue, subscribe, value})` and an effect that calls
  `setState` with `Object.is` short-circuit on every notification. Each
  Convex `Transition` frame therefore becomes one `setState` per subscribed
  hook inside the same task, which React 19 batches into one commit.
- `esm-BfnqA_Ga.js`: `ConvexQueryClient.onUpdate = () => notifyManager.batch(()
  => { for (key of subscriptions) onUpdateQueryKeyHash(key) })` →
  `queryClient.setQueryData`. TanStack `QueryCache` events during a turn: 2,
  both `["autumn","customer",{}]` (billing). Thread and message data do not
  flow through TanStack Query.
- Live turn: `Y5` zustand store (`index-CrsmAoWm.js`) is the only writer
  during the stream; `chat-r3ODTHTr.js` selects the streaming message's
  `parts` and `waitingForNextText` from it. The Convex `messages` document
  (fields `parts, status, tokens, tokensPerSecond, timeToFirstToken,
  resumableStreamId, …`) arrives by subscription after `finish`.

Runtime, Convex socket frames during run 2 (ms after click, bytes, type):

| t | bytes | type |
|---|---|---|
| 321 | 297 | Transition |
| 355 | 104 | MutationResponse |
| 564 | 28,797 | Transition |
| 654 | 104 | MutationResponse |
| 799 | 32,069 | Transition |
| 891 | 1,138 | Transition |
| 1,517 | 3,282 | Transition |
| 3,738 | 29,253 | Transition |
| 7,609 | 6,552 | Transition |
| 8,112 | 35,707 | Transition |
| 23,110 → | 15 | Ping every 15 s |

Run 1 had the same shape (9 non-ping frames: 359/297 B, 587/31.6 KB,
857/1.1 KB, 1884/3.3 KB, 4324/28.7 KB, 6501/6.4 KB, 7040/35 KB). Two
mutations (create thread + message, then a second) and about seven
transitions per turn; three of them are ~30 KB, which is the size of a
re-delivered sidebar page (`threads.list`, 50 items) or full message list,
not a delta. The 3.7 s / 4.3 s frame lands mid-stream, so some document is
patched while streaming (`generationStatus` on the thread, or a partial
message write); which query it re-delivers was not decoded and is
unverified. React commits during the stream (MutationObserver batches):
190, all attributable to the zustand path; none coincide with a Transition
frame.

**What we ship.** Convex 1.44 too. The live turn lives in the AI SDK
`Chat` store with frame-aligned publication; Convex carries durability via
750 ms snapshots (`app/api/chat/durable-turn-runtime.ts`) and the split
selected-path / run-state subscriptions (ADR-0027) so run-doc patches do not
re-deliver content.

**Recommendation: reject.** Same architecture class (in-memory live store,
Convex for durability and other surfaces). In these captures their
transition payloads were larger than ours: three ~30 KB frames per turn,
consistent with whole paginated pages being re-delivered on thread writes
with no split subscription. Which query those frames re-deliver was not
decoded, so this is an observation from these runs, not a proven property
of their construction. Nothing to port. Before/after test if we ever
suspect our Convex path is chattier: wrap `socket.ws.onmessage` on our
client during one P2 turn and compare frame count and bytes against the
table above (theirs: ~9 frames, ~140 KB per turn).

## Related

- `docs/performance/2026-09-02-ttft-tps-vs-t3-chat.md` and the runs TSV
- ADR-0016 (streaming renderer), ADR-0030 (run timing receipt)
- TODO.md "Investigate … (replicate T3 Chat)" items
