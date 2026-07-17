# ChatGPT Conversation Scroll Restoration — Production Source Research

**Research date:** 2026-07-17<br>
**Independent re-audit:** 2026-07-17 — the current deployment was re-inventoried from a fresh background tab; all four asset hashes were unchanged, and every confirmed claim was re-verified against freshly downloaded bundles.<br>
**Target:** ChatGPT web application at `https://chatgpt.com/`<br>
**Evidence basis:** First-party JavaScript shipped by ChatGPT in the production web client<br>
**Scope:** Source research only. This document does not prescribe an implementation for Not A Wrapper.<br>
**Account safety:** No cookies, credentials, authentication tokens, local storage, session storage, Chrome profile data, or pre-existing conversation content were inspected.

## Evidence labels

- **Confirmed:** Directly present in the inspected production JavaScript.
- **Strongly inferred:** The source structure supports the conclusion, but a private unminified source tree or framework-level lifecycle trace was unavailable.
- **Unresolved:** The shipped code did not distinguish the remaining explanations, or the relevant code was outside the inspected module.

## Executive conclusion

**Confirmed:** ChatGPT's per-conversation restoration module does not save a raw `scrollTop` value. It saves a semantic turn anchor and the turn's pixel offset from the top of the conversation scroll root:

```ts
type SavedConversationScrollAnchor = {
  turnId: string
  offsetFromTopPx: number
}

const savedConversationScrollAnchors = new Map<
  ConversationId,
  SavedConversationScrollAnchor
>()
```

After scrolling settles, the module identifies the topmost relevant turn, then stores:

```ts
{
  turnId: turn.dataset.turnIdContainer,
  offsetFromTopPx:
    scrollRoot.getBoundingClientRect().top -
    turn.getBoundingClientRect().top,
}
```

When the conversation is mounted again, it locates the same turn and adjusts the scroll root so the turn returns to the same visual offset:

```ts
const desiredTurnTop =
  scrollRoot.getBoundingClientRect().top - saved.offsetFromTopPx

scrollRoot.scrollTop +=
  turn.getBoundingClientRect().top - desiredTurnTop
```

This is message-anchor restoration with a pixel offset, not absolute document-position restoration.

The saved anchors live in a module-scoped `Map`, keyed by `conversation.id`. The inspected module does not write them to browser storage or a backend. It contains one `set`, one `get`, and no `delete` or `clear` operation.

If no usable saved anchor exists, ChatGPT scrolls to the bottom synchronously and repeats that assignment on two consecutive animation frames. The restoration module has no distance-from-bottom threshold. Separate streaming and automatic-follow logic may still treat the bottom specially, but that is not part of the per-conversation saved-position mechanism documented here.

## Production artifacts inspected

The asset names below are content-hashed and will change when ChatGPT deploys a new build.

| Artifact | Role in this investigation |
| --- | --- |
| [`_conversation._index-du1lqd18.js`](https://chatgpt.com/cdn/assets/_conversation._index-du1lqd18.js) | Conversation route entry observed in the test tab; imports the production conversation bundle. |
| [`conversation-small-jpc3hgdqf7pudiwn.js`](https://chatgpt.com/cdn/assets/conversation-small-jpc3hgdqf7pudiwn.js) | Contains the scroll-anchor map, save/restore functions, restoration lifecycle, scroll-root markup, pagination compensation, and related conversation behavior. |
| [`4813494d-lvnecc7bk2dm0ybt.js`](https://chatgpt.com/cdn/assets/4813494d-lvnecc7bk2dm0ybt.js) | Contains shared helpers used by the conversation bundle, including locating the nearest `[data-scroll-root]` and attaching/removing event listeners. |
| [`f025431a-iptl9rhcr4o1e8ss.js`](https://chatgpt.com/cdn/assets/f025431a-iptl9rhcr4o1e8ss.js) | Contains the bundler's lazy module-initialization helper; useful when tracing minified imports and exports. |

The source-map URLs advertised by the inspected bundles returned `404`. Original symbol names and TypeScript source were therefore unavailable. Minified aliases in this document are included only as trace aids for this specific build and must not be treated as stable API names.

## 1. Conversation scroll root

### 1.1 The conversation does not use document scrolling

**Confirmed:** The production conversation layout renders a nested element with:

- a `data-scroll-root` attribute;
- an `overflow-y-auto` class;
- a ref callback that registers the element as the active scroll root;
- a passive `scroll` listener that toggles `data-scroll-from-top` according to whether `scrollTop > 0`.

The relevant rendered shape is equivalent to:

```tsx
<div
  data-scroll-root={...}
  className="... overflow-y-auto ..."
  ref={registerScrollRoot}
>
  ...
</div>
```

The helper imported into the restoration module resolves the usable scroll root from the thread root as:

```ts
function findScrollRoot(element: Element | null) {
  return element?.closest('[data-scroll-root]') ?? null
}
```

The minified production helper was `Ehr`; the conversation bundle imported its exported alias and used it against `threadRootRef.current`.

### 1.2 The effect waits for the scroll root

**Confirmed:** On mount, the restoration effect checks the thread ref for its nearest scroll root. If the element does not yet exist, it retries on the next animation frame until it does.

The effect hook itself is `React.useLayoutEffect`, established by tracing the conversation bundle's minified hook import through the shared chunk's export table to a direct `useLayoutEffect` re-export. Initial positioning therefore runs before paint once the scroll root exists.

Equivalent control flow:

```ts
let waitForRootFrame: number | null = null

function initializeWhenReady() {
  const scrollRoot = findScrollRoot(threadRootRef.current)

  if (!scrollRoot) {
    waitForRootFrame = requestAnimationFrame(initializeWhenReady)
    return
  }

  waitForRootFrame = null
  restoreInitialPosition(scrollRoot)
  attachScrollEndListener(scrollRoot)
}
```

This is important: restoration is intentionally delayed until the conversation DOM exposes its nested scroll container. It is not delegated to `window`, `document.scrollingElement`, or browser-native history restoration.

## 2. Exact saved representation

### 2.1 Module-scoped map

**Confirmed:** The current bundle initializes exactly one module-local map for this mechanism:

```ts
const savedAnchors = new Map()
```

The map is accessed only through:

```ts
savedAnchors.set(conversation.id, {
  offsetFromTopPx,
  turnId,
})

const saved = savedAnchors.get(conversation.id)
```

The inspected bundle contains:

| Operation | Occurrences |
| --- | ---: |
| `set` | 1 |
| `get` | 1 |
| `delete` | 0 |
| `clear` | 0 |
| `has` | 0 |

**Confirmed:** The key is the client conversation object's `id` property used by the mounted conversation component. The code does not use the URL string itself as the map key.

### 2.2 The saved object

**Confirmed:** Each value has exactly two fields:

```ts
{
  offsetFromTopPx: number
  turnId: string
}
```

No raw `scrollTop`, `scrollHeight`, `clientHeight`, percentage, distance from bottom, timestamp, or message index is stored by this module.

## 3. How ChatGPT selects the anchor turn

### 3.1 Candidate selector

**Confirmed:** Anchor candidates are elements matching:

```css
[data-turn-id-container]
```

### 3.2 Nested duplicate filtering

**Confirmed:** The module filters nested elements that repeat the same turn identifier. In equivalent readable code:

```ts
function getTopLevelTurnContainers(scrollRoot: Element) {
  return Array.from(
    scrollRoot.querySelectorAll<HTMLElement>('[data-turn-id-container]'),
  ).filter((turn) => {
    const turnId = turn.dataset.turnIdContainer
    if (!turnId) return false

    const ancestorTurnId = turn.parentElement
      ?.closest<HTMLElement>('[data-turn-id-container]')
      ?.dataset.turnIdContainer

    return ancestorTurnId !== turnId
  })
}
```

This avoids selecting an inner wrapper that represents the same logical turn as an outer container.

### 3.3 Selection order

**Confirmed:** The algorithm computes the scroll-root rectangle and searches candidate turns in DOM order.

First choice: the first turn that crosses the scroll root's top edge:

```ts
turnRect.top <= rootRect.top && turnRect.bottom > rootRect.top
```

Fallback choice: the first turn whose top is at or below the root top and still inside the root viewport:

```ts
turnRect.top >= rootRect.top && turnRect.top < rootRect.bottom
```

If neither search finds a turn, no new anchor is stored.

The save function also guards the measured offset before writing to the map:

```ts
if (Number.isFinite(offsetFromTopPx)) {
  savedAnchors.set(conversation.id, { offsetFromTopPx, turnId })
}
```

A candidate turn can therefore be found and still not stored if the measured offset is non-finite. "No candidate turn" is not the only no-store path.

### 3.4 Offset sign and meaning

The saved calculation is:

```ts
offsetFromTopPx = rootRect.top - turnRect.top
```

Therefore:

- if the turn begins above the visible top edge, `offsetFromTopPx` is positive;
- if the selected fallback turn begins below the visible top edge, `offsetFromTopPx` is negative;
- if the turn begins exactly at the top edge, the offset is zero.

This signed value records the turn's visual relationship to the scroll root, including partial-turn positions.

## 4. When the position is saved

### 4.1 Native `scrollend`, not every `scroll`

**Confirmed:** The restoration lifecycle attaches a passive listener for the `scrollend` event. It does not update the map on every `scroll` event.

The shared event helper is equivalent to:

```ts
function addEventListeners(
  element: EventTarget,
  handlers: Record<string, EventListener>,
  options?: AddEventListenerOptions,
) {
  for (const [name, handler] of Object.entries(handlers)) {
    element.addEventListener(name, handler, options)
  }

  return () => {
    for (const [name, handler] of Object.entries(handlers)) {
      element.removeEventListener(name, handler)
    }
  }
}
```

The restoration module invokes it with:

```ts
addEventListeners(
  scrollRoot,
  {
    scrollend: () => {
      // schedule anchor capture
    },
  },
  { passive: true },
)
```

Two qualifications on the helper:

- The production helper additionally treats handler names ending in `Capture` as capture-phase listeners. The `scrollend` registration does not use that branch, so the simplified version above is behaviorally equivalent here.
- The shared chunk lazily loads a `scrollend` polyfill when `'onscrollend' in window` is false, so the save path also works in browsers without native `scrollend`.

### 4.2 One animation frame after `scrollend`

**Confirmed:** When `scrollend` fires, the code cancels any pending save frame and schedules a new `requestAnimationFrame`. The anchor measurement and `Map.set` happen in that frame.

Equivalent code:

```ts
let saveFrame: number | null = null

function handleScrollEnd() {
  if (saveFrame !== null) {
    cancelAnimationFrame(saveFrame)
  }

  saveFrame = requestAnimationFrame(() => {
    saveFrame = null
    saveConversationAnchor(conversation, scrollRoot)
  })
}
```

This lets the final scroll layout settle for one rendering frame before measuring turn rectangles.

### 4.3 No final save in effect cleanup

**Confirmed:** Cleanup:

- removes the `scrollend` listener;
- invokes the initial-position cleanup, if any;
- cancels a frame waiting for the scroll root;
- cancels a pending save frame.

It does **not** call the save function before unmounting.

**Strongly inferred consequence:** If navigation removes the conversation before the most recent movement produces `scrollend` and its following animation frame, the map retains the previous settled anchor. This should be tested as an explicit edge case if exact rapid-navigation parity is required.

## 5. Exact restoration math

### 5.1 Locating the saved turn

**Confirmed:** Restoration reads the map by `conversation.id` and locates the anchor inside the current scroll root with:

```ts
scrollRoot.querySelector(
  `[data-turn-id-container="${CSS.escape(saved.turnId)}"]`,
)
```

`CSS.escape` prevents turn identifiers from being interpreted as selector syntax.

### 5.2 Repositioning the scroll root

**Confirmed:** If the turn exists, ChatGPT calculates:

```ts
const rootTop = scrollRoot.getBoundingClientRect().top
const currentTurnTop = turn.getBoundingClientRect().top
const desiredTurnTop = rootTop - saved.offsetFromTopPx

scrollRoot.scrollTop += currentTurnTop - desiredTurnTop
```

The function then reports success.

This is a relative correction. It does not assign the previously observed `scrollTop` value. If content above the anchor grows or shrinks, the current turn's measured position drives the correction.

### 5.3 Restore success and failure

**Confirmed:** Restoration succeeds only when:

1. the scroll root exists;
2. the map contains an entry for `conversation.id`;
3. an element with the saved `data-turn-id-container` exists inside that root.

If any of those requirements fail, the restoration function returns `false` and the initial-position fallback runs.

## 6. Initial-position fallback

### 6.1 Bottom assignment occurs three times

**Confirmed:** When there is no usable saved anchor, the module sets:

```ts
scrollRoot.scrollTop = scrollRoot.scrollHeight
```

It repeats the same assignment on two nested animation frames:

```ts
scrollRoot.scrollTop = scrollRoot.scrollHeight

let frame = requestAnimationFrame(() => {
  scrollRoot.scrollTop = scrollRoot.scrollHeight

  frame = requestAnimationFrame(() => {
    frame = null
    scrollRoot.scrollTop = scrollRoot.scrollHeight
  })
})
```

Assigning `scrollHeight` is intentionally beyond the maximum legal `scrollTop`; the browser clamps it to the bottom.

**Strongly inferred intent:** The repeated assignments keep a newly mounted conversation at its latest content while DOM height changes across the first two rendering frames.

### 6.2 Deep-link bypass

**Confirmed:** The module skips both anchor restoration and the bottom fallback when either condition is true:

```ts
Boolean(searchParams.get('message'))
```

or:

```ts
searchParams.get('messageId') === 'finalAgentTurnStart'
```

The source contains separate message-target scrolling behavior. This bypass prevents the generic conversation-position initializer from competing with those paths.

The bypass skips only the initial positioning (anchor restoration and the bottom fallback). The passive `scrollend` listener is attached unconditionally after the scroll root is found, so anchor saves still occur on message-target routes once the user scrolls.

## 7. Effect lifetime and conversation changes

**Confirmed:** The restoration effect is keyed by an array containing `conversation.id`.

When that ID changes:

1. the previous listener and pending frames are cleaned up;
2. the new conversation waits for its scroll root;
3. the new conversation attempts anchor restoration from the map;
4. if no anchor can be restored, it performs the three-stage bottom fallback;
5. it installs a new passive `scrollend` listener for future saves.

The map itself is defined outside the component lifecycle, so changing conversations does not recreate it while the JavaScript module remains alive.

## 8. Persistence boundary

### Confirmed from source

- Saved anchors live in a module-scoped JavaScript `Map`.
- The map is keyed by `conversation.id`.
- This module does not serialize anchors.
- This module does not call local storage, session storage, IndexedDB, cookies, or a backend for scroll restoration.
- This module has no map eviction or reset operation.

### Strongly inferred from the storage type

- Normal SPA navigation within the same JavaScript realm can reuse saved anchors.
- A separate tab has a separate module realm and therefore a separate map.
- A genuine full document reload creates a new module instance and an empty map.
- Closing a tab destroys its map.

### Important browser caveat

**Unresolved:** Browser Back/Forward Cache can preserve an entire page realm rather than create a new document. A Back/Forward result that appears to survive navigation is not, by itself, proof of persistent application storage. Future behavioral testing must record `PerformanceNavigationTiming.type`, document identity, and `pageshow.persisted` before classifying a Back/Forward result.

## 9. Near-bottom semantics

### Saved-position module

**Confirmed:** The anchor save/restore code contains no calculation involving:

- `scrollHeight - scrollTop - clientHeight`;
- distance from bottom;
- an epsilon or threshold;
- a pinned-to-bottom boolean;
- a special exact-bottom map value.

Every settled position uses the same `{ turnId, offsetFromTopPx }` representation.

### What this does not prove

ChatGPT contains other scroll systems for:

- following a streaming response;
- jumping to a message or turn;
- scroll-to-bottom controls;
- preserving position when older messages are prepended;
- panels and flyouts with their own scroll state.

Those systems may implement bottom-aware behavior. Their existence must not be conflated with the per-conversation restoration map.

**Unresolved:** Whether a separate streaming/autofollow subsystem applies a bottom threshold before or after this module runs was not established by the source path documented here.

## 10. Other scroll code that must remain separate

### 10.1 Prepending older messages

**Confirmed:** The conversation bundle separately preserves viewport position when older messages are prepended. It records the previous `scrollHeight` and `scrollTop`, performs the synchronous prepend, then compensates by the height delta:

```ts
const previousHeight = scrollRoot.scrollHeight
const previousTop = scrollRoot.scrollTop

flushSync(prependOlderMessages)

const nextTop =
  previousTop + scrollRoot.scrollHeight - previousHeight

const maximumTop = Math.max(
  0,
  scrollRoot.scrollHeight - scrollRoot.clientHeight,
)

scrollRoot.scrollTop = Math.min(
  Math.max(0, nextTop),
  maximumTop,
)
```

This is not conversation-switch restoration. It is an in-place compensation for content inserted above the current viewport.

### 10.2 Generic flyout restoration

**Confirmed:** The same large bundle contains a generic flyout/panel component with `onScroll` and `restoreScrollTop` props. That component reports raw `scrollTop` values and restores them in an animation frame.

It is a separate nested panel abstraction. Its presence is not evidence that the main conversation uses raw `scrollTop` restoration.

### 10.3 Message-target scrolling

**Confirmed:** The bundle contains utilities that locate a specific message or turn and call `scrollTo` with placement and scroll-padding calculations. These are deep-link/jump operations and are separate from the saved conversation anchor.

## 11. Behavioral model derived from source

```text
Conversation mounts or conversation.id changes
  |
  v
Wait by requestAnimationFrame until threadRootRef has [data-scroll-root]
  |
  v
Is a message-target route active?
  | yes                         | no
  v                             v
Skip initial positioning   savedAnchors.get(conversation.id)
(no restore, no fallback)       |
  |                    +--------+---------+
  |                    |                  |
  |               usable anchor      missing/unusable
  |                    |                  |
  |                    v                  v
  |          restore turn + offset   set bottom now
  |                                   set bottom RAF 1
  |                                   set bottom RAF 2
  |                    \                  /
  +--------------------+--------+-------+
                                |
                                v
                Attach passive scrollend (always)
                                |
                                v
                scrollend -> next animation frame
                                |
                                v
              choose top visible turn and Map.set(...)
```

## 12. Source-level confidence summary

### Confirmed

1. The conversation scroll root is a nested `[data-scroll-root]` element.
2. The root uses vertical overflow scrolling rather than document scrolling.
3. The effect waits for the root with animation-frame retries.
4. Saved state is a module-level `Map` keyed by `conversation.id`.
5. Saved values are `{ turnId, offsetFromTopPx }`.
6. The anchor is a top-level `[data-turn-id-container]` at or immediately below the scroll root's top edge.
7. Saves occur after passive `scrollend`, one animation frame later.
8. Restoration locates the turn using `CSS.escape` and adjusts `scrollTop` by a measured delta.
9. Missing anchors fall back to the bottom synchronously and on two subsequent frames.
10. Message-target routes bypass the initial positioning; the `scrollend` save listener still attaches.
11. Cleanup cancels pending frames and does not force a final save.
12. The map has no eviction logic in the inspected module.
13. This saved-position module contains no near-bottom threshold.
14. Prepend compensation, generic panel restoration, and targeted message scrolling are separate code paths.
15. Saves are guarded by `Number.isFinite` on the measured offset.
16. The restoration effect is a `React.useLayoutEffect`.
17. A `scrollend` polyfill is lazily loaded when the browser lacks native support.

### Strongly inferred

1. Turn anchoring is designed to survive height changes above the saved turn better than raw `scrollTop` restoration.
2. Repeating the bottom assignment across two frames is intended to absorb initial layout growth.
3. The map survives same-realm SPA navigation but not an ordinary new document or independent tab.
4. A navigation that wins the race against `scrollend` can leave the previous settled anchor in the map.

### Unresolved

1. Original unminified symbol names and comments, because production source maps were unavailable.
2. Whether another streaming/autofollow subsystem applies a near-bottom threshold around the same time.
3. Exact behavior when the saved turn has been removed, branch-switched, or not yet rendered because of pagination beyond the confirmed bottom fallback.
4. Whether a specific Back/Forward result uses the surviving in-memory map, BFCache, or a fresh mount without runtime instrumentation.
5. Whether the production implementation changes between account cohorts or feature-flag variants.

## 13. Verification procedure for future agents

The following procedure is intentionally source-first. Do not start from visual behavior and work backward.

### Safety requirements

1. Use the user's existing authenticated Chrome session only when authentication is necessary to load the production application shell.
2. Work in an agent-created background tab. Do not claim or navigate the user's active tab.
3. Do not open a pre-existing conversation.
4. Do not inspect cookies, request authorization headers, local storage, session storage, IndexedDB, password stores, or Chrome profile data.
5. Only download first-party static JavaScript asset URLs from `https://chatgpt.com/cdn/assets/`.
6. Store temporary artifacts outside the repository, preferably in a directory created with `mktemp -d`.
7. Do not modify application code while performing this verification.
8. Close the background tab after the source inventory is complete.

### Step 1: Load a conversation route without exposing user content

Open this invalid, disposable route in the background tab:

```text
https://chatgpt.com/c/00000000-0000-0000-0000-000000000000
```

The route may redirect to the homepage after the failed conversation request. That is acceptable if the tab's asset inventory retains the route assets it observed.

Do not use an existing real conversation ID merely to load the bundle.

### Step 2: Inventory observed assets

Using the Chrome-control runtime's `pageAssets` tab capability:

```js
const pageAssets = await tab.capabilities.get('pageAssets')
const inventory = await pageAssets.list()

inventory.assets
  .filter((asset) => asset.kind === 'script')
  .map((asset) => ({
    id: asset.id,
    name: asset.name,
    url: asset.url,
  }))
```

Find the conversation route entry. In the 2026-07-17 build it was:

```text
_conversation._index-du1lqd18.js
```

The name will change. Prefer an observed route asset over guessing a URL.

### Step 3: Trace the conversation bundle import

Read the route entry and identify its imported conversation bundle. In the inspected build the entry contained an import from:

```text
./conversation-small-jpc3hgdqf7pudiwn.js
```

The future filename may differ. Record both filenames and the verification date.

### Step 4: Download only the public static assets

Create a temporary directory:

```sh
research_tmp_dir="$(mktemp -d)"
```

Download the observed route and conversation bundle without copying browser headers or credentials:

```sh
curl -L --compressed -sS \
  "https://chatgpt.com/cdn/assets/<observed-route-entry>.js" \
  -o "$research_tmp_dir/route-entry.js"

curl -L --compressed -sS \
  "https://chatgpt.com/cdn/assets/<observed-conversation-bundle>.js" \
  -o "$research_tmp_dir/conversation.js"
```

Do not download API responses or conversation payloads.

### Step 5: Search for stable semantic markers

Minified variable names will change. Search for stable strings and object fields:

```sh
rg -n -o \
  'data-turn-id-container|offsetFromTopPx|data-scroll-root|scrollend|finalAgentTurnStart|scrollHeight' \
  "$research_tmp_dir/conversation.js"
```

The production file may be a single very long line. Use a read-only script to print bounded context around each marker rather than relying on line numbers:

```sh
node - "$research_tmp_dir/conversation.js" <<'NODE'
const fs = require('fs')
const file = process.argv[2]
const source = fs.readFileSync(file, 'utf8')
const markers = [
  'data-turn-id-container',
  'offsetFromTopPx',
  'scrollend',
  'finalAgentTurnStart',
]

for (const marker of markers) {
  let from = 0
  let occurrence = 0

  while (true) {
    const index = source.indexOf(marker, from)
    if (index === -1) break

    occurrence += 1
    console.log(`\n===== ${marker} ${occurrence} @ ${index} =====`)
    console.log(
      source.slice(
        Math.max(0, index - 1_500),
        Math.min(source.length, index + 4_000),
      ),
    )
    from = index + marker.length
  }
}
NODE
```

### Step 6: Reconstruct the anchor module

Verify all of the following in one contiguous source region:

- selector constant equal to `[data-turn-id-container]`;
- a newly created `Map`;
- a function that selects a turn relative to the root rectangle;
- `Map.set(conversation.id, { offsetFromTopPx, turnId })`;
- `Map.get(conversation.id)`;
- restoration using `CSS.escape(turnId)`;
- a relative `scrollTop += ...` correction;
- a `scrollend` listener;
- an animation frame before saving;
- the triple bottom fallback;
- the `message` and `finalAgentTurnStart` bypass conditions.

Do not infer that similarly named variables in different chunks are identical. Follow import/export aliases mechanically.

### Step 7: Trace imported helpers correctly

If the conversation bundle imports the scroll-root or event-listener helper from another hashed chunk:

1. identify the exported alias in the conversation bundle's import statement;
2. download that exact referenced chunk;
3. find the export mapping at the end of that chunk;
4. map the exported alias back to the local minified function;
5. inspect the local function definition.

In the 2026-07-17 build, this procedure established:

```ts
element?.closest('[data-scroll-root]') ?? null
```

and the ordinary `addEventListener`/`removeEventListener` helper used for `scrollend`.

This step matters because a minified import such as `LU as ia` does not mean the local function is named `LU`; `LU` is an export alias.

### Step 8: Check the persistence boundary

Count all accesses to the reconstructed map symbol:

```sh
node - "$research_tmp_dir/conversation.js" <<'NODE'
const fs = require('fs')
const source = fs.readFileSync(process.argv[2], 'utf8')

// Replace SAVED_MAP with the current build's minified local symbol.
for (const operation of ['set', 'get', 'delete', 'clear', 'has']) {
  const pattern = new RegExp(`\\bSAVED_MAP\\.${operation}\\b`, 'g')
  console.log(operation, source.match(pattern)?.length ?? 0)
}
NODE
```

Also inspect the module for any serialization call around the map. Do not inspect browser storage contents. Source search is sufficient to establish whether this module calls a storage API.

### Step 9: Attempt to disprove the anchor model

Search the same module for evidence that a raw pixel value is also stored per conversation:

```sh
rg -n -o \
  'scrollTop|scrollHeight|clientHeight|localStorage|sessionStorage|indexedDB' \
  "$research_tmp_dir/conversation.js"
```

Classify every match by subsystem. Expected unrelated matches include:

- pagination height compensation;
- direct scrolling utilities;
- generic panel/flyout restoration;
- bottom fallback;
- streaming follow behavior.

The anchor conclusion is disproved only if the same per-conversation save/restore lifecycle also persists and restores a raw position, or if a separate active lifecycle supersedes the anchor map.

### Step 10: Optional runtime corroboration

Source verification should remain primary. If runtime corroboration is needed:

1. use only disposable chats;
2. instrument the identified `[data-scroll-root]` lightly;
3. record `scrollend`, animation frames, turn rectangles, and route changes;
4. correlate measured movement with the source formula;
5. do not monkey-patch during the control run;
6. do not claim runtime API causation from one call or one observation.

The strongest corroboration is not merely that the position returns. It is that the same `data-turn-id-container` returns to the same signed offset even when content above it changes height.

## 14. Verification acceptance checklist

A future agent should not mark this research refreshed until all applicable items are checked.

- [ ] Work occurred in an agent-created background Chrome tab.
- [ ] No real pre-existing conversation was opened.
- [ ] The current route entry and conversation bundle hashes were recorded.
- [ ] The source came from first-party `chatgpt.com/cdn/assets/` URLs.
- [ ] The current `[data-scroll-root]` helper was traced.
- [ ] The current turn selector was traced.
- [ ] The saved map key was confirmed as `conversation.id` or its replacement.
- [ ] The saved value shape was recorded exactly.
- [ ] The anchor-selection inequalities were recorded exactly.
- [ ] The restoration equation was recorded exactly.
- [ ] Save timing relative to `scrollend` and animation frames was recorded.
- [ ] Cleanup behavior was inspected for a final-save call.
- [ ] Missing-anchor fallback behavior was recorded.
- [ ] Deep-link bypass conditions were recorded.
- [ ] Map eviction or clearing behavior was searched explicitly.
- [ ] Raw-pixel per-conversation persistence was actively searched for.
- [ ] Near-bottom threshold logic was searched separately from streaming follow logic.
- [ ] Pagination, flyout, and message-target scrolling were not conflated with conversation restoration.
- [ ] Source-map availability was recorded.
- [ ] Confirmed facts, inferences, and unresolved questions were kept separate.
- [ ] The background tab was closed.
- [ ] Temporary artifacts were kept outside the repository or explicitly reported.

## 15. Implications for future Not A Wrapper parity work

These are behavioral requirements implied by the source research, not an implementation recommendation.

To feel consistent with this ChatGPT build, a chat application would need to preserve the user's relationship to a logical turn, not merely an absolute scroll offset. Specifically, parity would require:

1. identifying a stable visible turn near the scroll root's top edge;
2. preserving the turn ID and signed pixel offset;
3. restoring only after the conversation scroll root and anchor turn exist;
4. correcting the scroll position from current geometry;
5. using a deterministic fallback when the anchor cannot be restored;
6. avoiding competition with explicit message-target navigation;
7. separating conversation-switch restoration from prepend compensation, streaming follow, and nested-panel scrolling;
8. deciding deliberately whether parity should include ChatGPT's in-memory-only persistence boundary and absence of map eviction.

Before implementation, the product team should separately decide whether to reproduce the observed persistence boundary exactly or intentionally improve it. That decision is outside this research document.

## Cleanup record

- One agent-controlled background ChatGPT source tab was used and closed.
- No disposable conversations were created for the source-only pass.
- No existing conversation was opened, renamed, messaged, or deleted.
- No browser storage or authentication material was inspected.
- No application code was modified as part of the investigation.
