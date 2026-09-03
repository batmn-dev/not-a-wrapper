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
| Streamed-text pacing | none | **unverified** |
| Markdown and highlighting stack | none | **unverified** |
| Thread virtualization | none | **unverified** |
| Sync-engine update batching | none | **unverified** |

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
and the number of DOM updates per delta; a gap that grows with a fixed
cadence proves pacing, a 1:1 mapping disproves it.

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

To be filled by the verification run. Keep the four headings.

### Pacing

Unverified.

### Markdown and highlighting

Unverified.

### Virtualization

Unverified.

### Sync batching

Unverified.

## Related

- `docs/performance/2026-09-02-ttft-tps-vs-t3-chat.md` and the runs TSV
- ADR-0016 (streaming renderer), ADR-0030 (run timing receipt)
- `docs/chatgpt-scroll-architecture-audit.md` for the equivalent ChatGPT read
- TODO.md "Investigate … (replicate T3 Chat)" items
