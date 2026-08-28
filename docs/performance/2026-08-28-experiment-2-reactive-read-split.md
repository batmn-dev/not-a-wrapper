# Experiment 2 — split the selected-conversation subscription

Date: 2026-08-28 · Before: `8ebaa7ae` (`2026-08-28T00-02-51-durable.json`) ·
After: this change with `NEXT_PUBLIC_SPLIT_SELECTED_QUERY=true`
(`2026-08-28T00-44-32-durable.json`), same machine/build-class/fixtures/
suite. All scenarios green on the blocking correctness checks in both runs.

## Change

Design dossier first (agent-explored, condensed into this report's
invariants): the naive `selected=true` index is unsafe for four structural
reasons (legacy chats with no branch fields, `selected: undefined`
eligibility, role-scoped deselection leaving true flags off-path, and
sibling ordering/descriptors needing the whole group), so the split keeps
the derivation byte-identical instead:

1. **§6.1 projection slimming** — `SelectedRunProjection` drops
   `lastSnapshotSequence`, `lastProgressAt`, `activeToolNames` (zero
   production consumers; the first two forced a full re-delivery on every
   beat) and `pendingApproval` shrinks to `{expiresAt}` (presence + expiry
   is all the client reads — approval UI is driven from message parts).
   This also deletes a `toolInvocations.collect()` per execution.
2. **§6.2 two-query split** behind `NEXT_PUBLIC_SPLIT_SELECTED_QUERY`
   (default OFF; the atomic query is the rollback path):
   - `getSelectedPath` — the selected visible path, derived by the SAME
     collect + `createBranchContext` code, plus a derived `pathVersion`
     fingerprint. Read set: chats/projects/users/messages only.
   - `getSelectedRunState` — the tiny run facts. Owner-only; the §7
     gauntlet's run↔chat ownership and points-back checks stay server-side
     (one linked-message get); the on-selected-path half moves to the
     client provider, which nulls the run unless its assistant message is
     in the DELIVERED path.
   - No-tearing basis: a Convex client applies all subscribed queries'
     updates from one transition atomically; both queries are keyed on
     `chatId` only. Recorded on the `getSelectedConversation` doc comment;
     an ADR is warranted if the split becomes the default.

Parity tests pin: split halves reproduce the atomic projection exactly for
owners; non-owner denial identical; points-back nulling server-side;
off-path nulling client-side (each half's responsibility made explicit).

## Results

**Server profile (Convex logs, dense mid-stream window, split mode):**

| Function | Rate | Return bytes | DB read/exec |
|---|---|---|---|
| `getSelectedRunState` | ~131/min | **177 B** (was 23 KB via the atomic query for the same events) | ~13 KB (see finding below) |
| `getSelectedPath` | ~114/min in this window | ~12 KB growing with the answer | ~13 KB |
| `updateAssistantSnapshot` | ~91/min | 34 B | ~28 KB |

**Honest scoping:** the deterministic scenario changes content on every
750 ms beat, so content-dedupe never fires and `getSelectedPath` still
re-executes per applied beat — in this worst-case window, execution counts
match the before-picture by construction. The structural win is the event
class the deterministic scenario cannot produce: run-doc-only writes
(heartbeats 6/min, tool-step bookkeeping, deduped beats during thinking/
tool pauses, approval writes) now cost one 177 B delivery instead of a full
~23 KB path re-collect per subscriber. Real conversations are full of those
events; a follow-up measurement with a pause-heavy scenario (slab shape or
a tool-wait script) would quantify it.

**Client (durable suite, before → after, p50):** no regressions —
send→first-visible 732→748 ms (noise), stop→terminal 7.7→7.7 ms,
terminal→settlement receipt −15→−14 ms, snapshot→second-tab median
44→38 ms, reload→authoritative 216→211 ms, TBT unchanged. Adoption-loss
runs 1 vs 1 across the two runs (pre-existing, split-independent).

## New findings surfaced by this run

1. **`getSelectedRunState`'s points-back check reads the whole live message
   doc** (~13 KB DB read per beat for a 177 B return). Follow-up trim:
   check `run.activeStreamId` alone server-side, or move points-back fully
   client-side alongside the on-path check.
2. **Stopped turns settle at the full reserved estimate**
   (`settlementBasis: "estimated_after_unknown_usage"`, 18,622 credits for
   a ~5 s stopped deterministic turn — a user Stop with no captured step
   usage charges the whole reservation). This exhausted the harness user's
   1 M-credit allowance mid-suite (admission then correctly refused with
   ALLOWANCE_EXHAUSTED; topped up via `recordAdjustment`, +50 M, dev only).
   Worth a product decision: conservative-charging aborts is defensible,
   but a first-beat Stop charging ~19 k credits is a surprising bill.
3. Harness: a crashed run no longer aborts the suite (failed-run metrics
   recorded, scenario marked failed, results file always written).

## Decision needed before adoption

The flag default is OFF. Flipping it to default-on needs: (a) a
pause-heavy scenario measurement to quantify the real-conversation win,
(b) the ADR for the same-transition no-tearing basis, and (c) a decision
on finding 1's trim. Experiment 2b (range-bounded settled-history
pagination — the only lever that reduces per-execution DB reads) stays
gated on prefix-derivability property tests per the dossier.

## Addendum 2026-08-28 — adoption evidence (a)+(b)+(c) closed

All three prerequisites above are now done: the pause-heavy measurement
below, ADR-0027 (`docs/adr/0027-split-selected-conversation-subscription.md`,
the no-tearing basis and its scope), and finding 1's trim (points-back
short-circuits on `run.activeStreamId === run.assistantMessageId` — stamped
at stream start, cleared at terminal — so a LIVE run's run-state execution
never reads the message doc; a spy test pins the read set).

**Setup.** New delivery shape `paused` (deterministic provider): four
fixed-cadence segments split by three 20 s zero-delta gaps — the run stays
live with no content flowing, so a gap's only durable writes are heartbeats
(the tracker is content-versioned and writes nothing during silence). Suite
scenario `durable-text-30-paused`; Convex side captured via
`convex logs --success --jsonl` around ONLY-runs (1 warmup + 3 runs) on two
builds differing only in `NEXT_PUBLIC_SPLIT_SELECTED_QUERY`. Writer traffic
was identical in both captures (72 snapshot writes, 24 heartbeats), so the
subscription-side numbers are directly comparable.

**Pause windows (12 windows, 243 s of live-run silence in each capture):**

| | atomic | split |
|---|---|---|
| pause-caused re-executions | 24 full path re-collects (heartbeat-driven) | 24 run-state only |
| bytes delivered for them | ~305 KB (12.7 KB each) | 4.2 KB (177 B each) — **−98.6%** |
| path-query executions | n/a (atomic is the path query) | **0** |

(Both captures also show 12 in-window executions ≤40 ms after the
window-opening snapshot write — the delivery of the final pre-pause content
beat, a window-boundary artifact, excluded above.)

**Whole scenario (~315 s window):** atomic delivered 1.64 MB across 124
executions; split delivered 1.25 MB (92 path × ~13.4 KB + 124 run-state ×
166 B mean) — −24% even in a content-dominated scenario. Real conversations
skew much further toward the pause class (tool waits and approval waits run
minutes, not 20 s), and every additional tab multiplies the atomic cost but
adds only 177 B deliveries under the split.

**Trim effect.** Live run-state executions now read ~2.0 KB (chat + run +
approval index) instead of ~13 KB+ — 116 of 124 executions in the capture.
The 8 remaining large reads (~25.7 KB: the settled message doc carries
content AND parts) are the post-terminal fallback, which runs only until the
subscription goes quiet — expected and bounded. Execution COUNT is
unchanged by the trim: applied content beats patch the run doc too
(`lastSnapshotSequence`), so run-state re-executes per beat either way; the
trim changes what each execution costs, not how often it runs.

**Client side:** correctness green in both modes; rendering metrics
(TBT, projection, long tasks, publication counts) identical; pre-stream
metrics at n=3 are variance-dominated (see the regression suite below for
the n=10 read). Adoption-loss runs: 1 in each mode (pre-existing,
split-independent).

**Regression suite (four original durable scenarios, RUNS=10, split+trim
build, vs the pre-trim split baseline `2026-08-28T00-44-32`):** all
correctness gates green; every p50 within noise — send→first-visible
748→755 ms, snapshot→second-tab median 38→37 ms, reload→authoritative
211→217 ms, stop→terminal 7.7→7.1 ms, terminal→settlement receipt
unchanged, TBT unchanged, snapshot write mean unchanged. Result file
`2026-08-28T01-43-30-durable.json`; paused-scenario files
`2026-08-28T01-27-22` (atomic) and `2026-08-28T01-33-14` (split).

**Recommendation:** flip `NEXT_PUBLIC_SPLIT_SELECTED_QUERY` to default-on.
The prerequisites this report listed are met, the win in the pause class is
~50× per event per subscriber, and the rollback (atomic query, flag off)
stays registered per ADR-0027.

**Adopted 2026-08-28:** user approved; the default is now ON
(`NEXT_PUBLIC_SPLIT_SELECTED_QUERY=false` at build time restores the atomic
query).
