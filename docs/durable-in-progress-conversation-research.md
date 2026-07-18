# Durable, visible in-progress conversations across navigation, reload, tabs, and devices

**Repository under review:** [`darknightdesigner/not-a-wrapper`](https://github.com/darknightdesigner/not-a-wrapper)<br>
**Repository snapshot:** [`c65c0022aa94f225df6868a54c27530037b5a59e`](https://github.com/darknightdesigner/not-a-wrapper/commit/c65c0022aa94f225df6868a54c27530037b5a59e)<br>
**Research date:** 2026-07-14<br>
**Scope:** Research and architecture recommendation only. No repository files were modified and no implementation was performed.

## Evidence labels

- **Verified:** directly supported by commit-pinned source, tests, a merged pull request, or official documentation.
- **Inferred:** follows from the verified code path, but no direct end-to-end test was located.
- **Unresolved:** the relevant behavior could not be proved from the available primary sources.

# 1. Executive conclusion

## Strong prior art exists, but the best answer is a synthesis

There is strong open-source prior art for every important part of this backlog item, although no single repository is the exact model for this application.

The three most instructive implementations are:

1. **LibreChat** for a complete resumable generation system. It separates generation start from SSE subscription, persists run state and replayable events in Redis, reconstructs text, reasoning, tool steps, approvals, and pending user actions after reload, supports cross-replica Stop, and reaps stale jobs.
2. **OpenHands Software Agent SDK** for authoritative run ownership. Its agent server uses renewable leases, monotonically increasing fencing generations, guarded writes, event replay, reconnect reconciliation, and crash recovery that converts an abandoned `RUNNING` conversation into a terminal error.
3. **Open WebUI** for the UI pattern closest to this repository. It reloads the durable message snapshot, separately checks whether the chat still has an active task, renders the row as live only when durable content and task liveness agree, and settles an incomplete row when no task exists.

The broad implementation direction that best fits `not-a-wrapper` is **hybrid snapshot plus authoritative run-state subscription**, implemented entirely through the existing Convex model:

- Keep `messages`, `assistantMessageSnapshots`, tool records, and approval records as content and activity truth.
- Treat `generationRuns`, not `message.status` and not remounted `useChat.status`, as the source of run liveness.
- Add a freshness-qualified worker lease or heartbeat to `generationRuns`.
- Add a run-scoped, idempotent durable Stop mutation that any authorized returning client can invoke.
- Project the selected conversation and its active run in one reactive Convex result.
- Fold that run envelope into the existing Assistant turn phase algebra, producing explicit `local-streaming`, `background-streaming`, `awaiting-approval`, `possibly-stale`, and terminal presentation states.
- Keep stream transport ownership local. Do not make a remounted `useChat` instance pretend it owns the old HTTP response.
- Do not add Redis, a broker, or resumable SSE for this backlog item unless exact replay of every missed transient event becomes a product requirement.

This combines Open WebUI's snapshot/task reconciliation with OpenHands' lease and fencing invariants, while retaining the current repository's stronger sequence guards, terminal lifecycle algebra, and Convex subscriptions.

## Important boundary

This recommendation makes the user-visible state truthful and convergent across navigation, reloads, tabs, and devices. It does **not** by itself turn the provider call into a job that survives serverless instance replacement.

The current generation still runs inside a Next.js request with [`maxDuration = 60`](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/app/api/chat/route.ts#L22-L23), and the request-derived signal is passed into the provider stream in [`chat-turn-runtime.ts`](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/app/api/chat/chat-turn-runtime.ts#L808-L960). The application does use backend stream consumption and does not explicitly Stop on normal link-navigation unmount, but a process crash, platform timeout, or instance replacement still cannot be recovered by a database row alone.

If surviving worker death is a hard product requirement, that is a separate durable-execution project. It would justify a durable job or workflow substrate. It is not required to solve the present UI backlog safely.

# 2. Verified current-state gap

## 2.1 Current stack and execution model

The fixed repository snapshot uses Next.js 16, AI SDK 7, and Convex 1.42 in [`package.json`](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/package.json#L32-L60). The route is a thin App Router adapter that prepares a durable turn and returns a UI message stream in [`app/api/chat/route.ts`](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/app/api/chat/route.ts#L183-L204).

**Verified:** link navigation does not intentionally call Stop on the detached generation. The mounted chat-id transition effect stops an old stream when the same component changes chat IDs, while its own comment explicitly says that link navigation remounts the Chat and intentionally leaves durable streaming alive in [`use-chat-core.ts`](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/app/components/chat/use-chat-core.ts#L394-L435).

> **Current-state addendum (2026-07-18):** the stop-on-mounted-transition behavior described above is historical to this snapshot. Mounted chat-id transitions now DETACH instead of aborting — the hook replaces a per-instance **Detachable stream binding** whose finish-time work routes to a frozen origin chat id, with a 120 s watchdog bounding orphaned streams. See `docs/adr/0013-back-navigation-detaches-the-stream.md`.

**Verified:** the response stream is consumed server-side so snapshots and finalization can continue after the browser reader detaches. See the response construction in [`chat-turn-runtime.ts`](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/app/api/chat/chat-turn-runtime.ts#L1356-L1408) and the AI SDK's official guidance on backend stream consumption in [Chatbot Message Persistence](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence#handling-client-disconnects).

**Inferred limitation:** execution remains request and process bound. It is not a durable queue worker.

## 2.2 What is already complete

| Capability | Verified current behavior | Evidence |
|---|---|---|
| Durable run identity | `prepareGeneration` creates a `generationRuns` row and durable Assistant placeholder before streaming. | [`convex/chatRuntime.ts#L1154-L1350`](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/convex/chatRuntime.ts#L1154-L1350) |
| Periodic text and reasoning persistence | The runtime accumulates text and reasoning, writes throttled snapshots, increments a sequence, and flushes before terminal settlement. | [`durable-turn-runtime.ts#L30-L176`](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/app/api/chat/durable-turn-runtime.ts#L30-L176), [`#L328-L456`](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/app/api/chat/durable-turn-runtime.ts#L328-L456) |
| Ordered snapshot adoption | Convex persists sequence-numbered snapshots, ignores writes after a terminal state, and only materializes the newest snapshot. | [`convex/chatRuntime.ts#L1351-L1428`](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/convex/chatRuntime.ts#L1351-L1428) |
| Durable tool and approval activity | Tool invocations and approval requests are persisted by run and message. A late approval request cannot repaint a terminal run. | [`durable-turn-runtime.ts#L826-L976`](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/app/api/chat/durable-turn-runtime.ts#L826-L976), [`convex/chatRuntime.ts#L1571-L1668`](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/convex/chatRuntime.ts#L1571-L1668) |
| Central terminal arbitration | Completion, failure, abort, approval pause, supersession, and empty terminal placeholders are resolved through one lifecycle algebra. Abort is sticky, while the completion/failure callback race has an explicit precedence rule. | [`convex/domain/generation_run_lifecycle.ts`](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/convex/domain/generation_run_lifecycle.ts) |
| Supersession protection | Starting a new generation transactionally closes older live-looking runs and orphan Assistant messages. | [`convex/chatRuntime.ts#L500-L612`](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/convex/chatRuntime.ts#L500-L612) |
| Older-run projection guard | `statusRunId` prevents an older run's delayed terminal mutation from clearing a newer chat spinner. | [`convex/chatRuntime.ts#L400-L499`](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/convex/chatRuntime.ts#L400-L499), [`convex/schema.ts#L82-L99`](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/convex/schema.ts#L82-L99) |
| Detached content convergence | Once the local stream is idle, selected-path projection adopts newer durable Assistant parts and any terminal override without truncating a longer local copy. | [`selected-path.ts#L1-L76`](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/lib/chat-store/turns/selected-path.ts#L1-L76), [`#L94-L155`](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/lib/chat-store/turns/selected-path.ts#L94-L155) |
| Background sidebar state | A local non-idle status gives immediate feedback, but a remounted `ready` status never lowers durable backend `liveRunStatus`. | [`sidebar-chat-status.ts#L11-L95`](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/lib/chat-store/status/sidebar-chat-status.ts#L11-L95) |
| Accessible sidebar status | Sidebar indicators have semantic labels and dedicated visual states. | [`sidebar-item-status.tsx`](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/app/components/layout/sidebar/sidebar-item-status.tsx) |

## 2.3 What remains missing

### The selected Assistant row has no trustworthy background liveness input

`useChat` is remounted for the reopened route and supplies a new local transport status. The initial messages hydrate, but the hook does not own or reconnect to the original response stream in [`use-chat-core.ts`](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/app/components/chat/use-chat-core.ts#L203-L261).

The row renderer intentionally trusts durable status only for `aborted`, `failed`, and `awaiting_approval`. It deliberately ignores durable `submitted` and `streaming`, because those values can lag after Stop, disconnect, or terminal failure. The last row then falls back to the remounted local `useChat.status`, normally `ready`, in [`conversation.tsx`](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/app/components/chat/conversation.tsx#L194-L233).

The canonical Assistant phase algebra makes the same safety choice. Only the last turn owned by the current client stream can enter a live phase; turns that another session may still be running are explicitly settled in [`assistant-turn.ts`](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/lib/chat-messages/assistant-turn.ts#L253-L306).

This is correct defensive behavior with the current data model. Removing that guard and trusting `message.status === "streaming"` would reintroduce zombie loaders.

### The Activity panel is also local-transport driven

`isGenerationActive` is derived only from `isSubmitting` and local `useChat.status`. The panel follows the latest turn and shows live reasoning duration only while that local generation is active in [`use-activity-panel.ts`](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/app/components/chat/use-activity-panel.ts#L91-L101) and [`#L236-L292`](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/app/components/chat/use-activity-panel.ts#L236-L292).

After re-entry, durable parts can keep growing, but:

- reasoning and tools appear settled;
- Activity no longer follows the active turn;
- no background streaming caret is justified;
- settled actions may be exposed too early;
- the user cannot tell an active background run from a frozen partial response.

### `generationRuns.updatedAt` is activity, not proof of current ownership

The run schema has `status`, `startedAt`, `completedAt`, `updatedAt`, `activeStreamId`, and Assistant linkage, but no heartbeat, lease deadline, owner generation, or stale-run deadline in [`convex/schema.ts`](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/convex/schema.ts#L171-L214).

A stale `streaming` row can therefore survive:

- a worker or serverless instance death;
- a lost terminal mutation;
- a provider completion followed by terminal-write failure;
- an abort path that never reaches Convex.

Terminal mutations currently catch and log write failure in [`durable-turn-runtime.ts`](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/app/api/chat/durable-turn-runtime.ts#L970-L1031), but no independent reconciler guarantees that the run eventually becomes terminal.

### Stop is not durable across remount

The hook exposes the local AI SDK `stop()` function. A returning client has no durable run-scoped control path in [`use-chat-core.ts`](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/app/components/chat/use-chat-core.ts#L619-L648).

The server has an abort transition, but no public owner-authorized mutation that:

1. identifies the current run;
2. atomically makes it terminal;
3. fences later worker writes;
4. causes the detached worker to abort its provider call.

## 2.4 Corrected statement of the gap

The original context is substantially correct. The more precise statement is:

> The repository already has durable content persistence, strong lifecycle convergence, and a background sidebar projection. It lacks a freshness-qualified, selected-conversation run projection that can safely tell a remounted client that the Assistant turn is still active and controllable. It also lacks an independent lease/reaper that can prove or revoke liveness after worker loss.

The backlog is therefore not primarily a message-persistence problem and not primarily a stream-reconnection problem. It is a **run-liveness projection and control problem**.

# 3. Candidate repository matrix

Only repositories with directly relevant implementation evidence are included. Popularity alone was not used as an inclusion criterion.

| Repository and license | Maintenance signal | Background execution | Persistence model | Re-entry behavior | Tool, reasoning, approval progress | Stop and control | Multi-client consistency | Zombie protection | Evidence quality | Relevance |
|---|---|---|---|---|---|---|---|---|---|---|
| **[LibreChat](https://github.com/danny-avila/LibreChat/tree/4321f68f29a0c169cd683876c8b34a28d409eb9e)**, [MIT](https://github.com/danny-avila/LibreChat/blob/4321f68f29a0c169cd683876c8b34a28d409eb9e/LICENSE) | HEAD commit on 2026-07-14; extensive current stream tests | Yes. Generation job outlives the SSE subscriber. | Redis job hash, Redis Streams chunks, replay events, materialized aggregated content, run steps, approvals, usage, activity timestamps | Page reload queries active job, rebuilds submission, receives a sync snapshot, replays gap events, then follows live SSE | Yes. Message and reasoning deltas, run steps, pending actions, queued steers, usage, title | Explicit owner-authorized abort endpoint; cross-replica abort signal; restored Stop UI | Redis CAS, global sequence, reorder buffer, durable snapshot plus pub/sub | Inactivity TTL and stale-job reaper emit terminal error | **High**, including integration and stale-job tests | Best complete resumable-stream reference; operationally heavier than needed |
| **[OpenHands Software Agent SDK](https://github.com/OpenHands/software-agent-sdk/tree/e2b852c59b3f7a96fe0decde8d762a1ad7f0bc16)**, [MIT](https://github.com/OpenHands/software-agent-sdk/blob/e2b852c59b3f7a96fe0decde8d762a1ad7f0bc16/LICENSE) | Active 2026 agent-server development; reconnect and lease tests | Yes. Server owns a conversation run task independent of one WebSocket subscriber. | Ordered durable semantic event log plus materialized conversation state; transient token deltas are live-only | WebSocket replay plus full REST reconciliation after reconnect; events deduplicated and ordered by ID | Yes. Tool actions, observations, execution state, confirmations, interrupts | Server interrupt and pause APIs; control is conversation scoped | Single owner lease, monotonic generation fence, guarded writes | Renewable 45-second lease, dead-process takeover, crash recovery from `RUNNING` to `ERROR` | **High**, including lease and reconnect tests | Best source for lease, fencing, crash recovery, and semantic event sourcing |
| **[Open WebUI](https://github.com/open-webui/open-webui/tree/ecd48e2f718220a6400ecf49eafd4867a38feb10)**, [custom Open WebUI License](https://github.com/open-webui/open-webui/blob/ecd48e2f718220a6400ecf49eafd4867a38feb10/LICENSE) | Release 0.10.2 on 2026-07-01 | Yes during process lifetime. An `asyncio.Task` continues after the HTTP response. | Durable chat/message snapshot in the database; active task membership in Redis; live Socket.IO events | Reloads chat snapshot, queries task IDs, marks row live only if task exists, receives later deltas over Socket.IO | Yes. Status, deltas, reasoning, tools, citations, errors | Chat-scoped Stop stops registered tasks; cancellation broadcast across instances | User rooms broadcast to tabs/devices; DB snapshot repairs missed events | UI clears incomplete rows with no active task; no verified lease or task-key TTL | **High** for UI reconciliation, **medium** for worker durability | Closest UI pattern; process-local task ownership is not suitable for serverless |
| **[LobeHub](https://github.com/lobehub/lobehub/tree/857d2a7dd74d777405791ad9d740dc879e1ae12c)**, [custom LobeHub License](https://github.com/lobehub/lobehub/blob/857d2a7dd74d777405791ad9d740dc879e1ae12c/LICENSE) | Active 2026 gateway work | Client reconnects to a server operation; backend implementation is not fully present in this repository | Topic metadata stores `operationId`; client tracks `lastEventId`; gateway promises replay | Reload hook discovers a running operation and reconnects with replay | Agent events and confirmation/wait states | Server interrupt by operation ID | Reconnect deduplication and stale-operation guards | Authoritative resume status, heartbeat, terminal event handling in client | **Medium** because server persistence is unresolved | Strong corroboration for separating transport, run, and presentation state |
| **[Vercel Chatbot](https://github.com/vercel/chatbot/tree/c2f8235e1f3ea903ad8b7f61447c4f74164b5c58)**, [Apache-2.0](https://github.com/vercel/chatbot/blob/c2f8235e1f3ea903ad8b7f61447c4f74164b5c58/LICENSE) | Active template | Backend consumes the stream and can write it to Redis | Database stores stream ID; `resumable-stream` stores SSE | **Current pinned GET endpoint returns 204 unconditionally**, so current template does not prove re-entry | UIMessage stream can contain tools and data | Official AI SDK resume guide warns that built-in resume is incompatible with abort | Redis stream can have multiple subscribers | Stream expiration and active-stream cleanup are described, but current template path is disabled | **High** for infrastructure, **low** for current product behavior | Useful caution and framework reference, not a solved exemplar |
| **[Dify](https://github.com/langgenius/dify/tree/40df83de660d19b17d9674821e82aa2bd4b61a49)**, [modified Apache terms](https://github.com/langgenius/dify/blob/40df83de660d19b17d9674821e82aa2bd4b61a49/LICENSE) | Active 2026 development | Generation pipeline continues in server task context | Process-local progress queue; Redis ownership and Stop keys with TTL; database message state | No complete replay or reload path was verified from the relevant queue code | Workflow events and pings exist | Redis Stop flag and task ownership | Cross-process Stop coordination, but progress queue is local | Execution timeout and Redis TTLs | **Medium** for Stop/timeout, **low** for re-entry | Useful control prior art, not a complete answer |
| **[LangGraph Agent Chat UI](https://github.com/langchain-ai/agent-chat-ui/tree/1cbd509d387b1e9602a80f05e638058b7543d7cc)**, [MIT](https://github.com/langchain-ai/agent-chat-ui/blob/1cbd509d387b1e9602a80f05e638058b7543d7cc/LICENSE) | Active client template | Delegated to LangGraph Server | Thread checkpoints and stream state are backend responsibilities | `useStream` reloads thread state and history | Agent messages, UI events, interrupts | Delegated to LangGraph Server | Delegated | Delegated | **Medium** for client integration, backend unresolved in this repo | Useful boundary example, not an end-to-end open implementation here |

# 4. Deep dives

## 4.1 LibreChat: durable job, materialized snapshot, replay stream, and cross-replica control

### Why it is a strong candidate

LibreChat is the strongest verified example of the full user experience requested in the backlog:

- generation continues after the initiating component unsubscribes;
- route navigation closes only the SSE;
- reload discovers the active run;
- the server sends a materialized sync state and missed events;
- tools, reasoning, approvals, and pending user actions are reconstructed;
- Stop is a separate durable control path;
- stale jobs converge to a terminal error.

The design is more complex than this repository needs, but it is valuable because it makes the hard race boundaries explicit.

### End-to-end path

#### 1. Start and detach

The frontend hook states the architecture directly: generation start is a POST, subscription is a GET EventSource, navigation away closes the SSE without aborting generation, and only the explicit Stop path aborts the backend job in [`useResumableSSE.ts`](https://github.com/danny-avila/LibreChat/blob/4321f68f29a0c169cd683876c8b34a28d409eb9e/client/src/hooks/SSE/useResumableSSE.ts#L443-L455).

The `GenerationJobManager` creates a job before a client subscriber is required. Subscriber departure does not cancel the job. In Redis mode, another replica can later reconstruct a lightweight runtime around the same job. See [`GenerationJobManager.ts#L344-L668`](https://github.com/danny-avila/LibreChat/blob/4321f68f29a0c169cd683876c8b34a28d409eb9e/packages/api/src/stream/GenerationJobManager.ts#L344-L668).

#### 2. Durable data model

LibreChat persists several complementary forms:

- a job record with status, owner, conversation and message IDs, final event, pending action, response ID, and `lastActiveAt`;
- aggregated response content;
- ordered run steps;
- replay events;
- per-user active-job membership;
- Redis Stream chunks;
- pending approval and queued steer state;
- usage and context summaries.

The interface is defined in [`IJobStore.ts`](https://github.com/danny-avila/LibreChat/blob/4321f68f29a0c169cd683876c8b34a28d409eb9e/packages/api/src/stream/interfaces/IJobStore.ts). Redis persistence, TTL refresh, Lua status compare-and-set, and active-job membership are in [`RedisJobStore.ts`](https://github.com/danny-avila/LibreChat/blob/4321f68f29a0c169cd683876c8b34a28d409eb9e/packages/api/src/stream/implementations/RedisJobStore.ts#L23-L113) and [`#L240-L495`](https://github.com/danny-avila/LibreChat/blob/4321f68f29a0c169cd683876c8b34a28d409eb9e/packages/api/src/stream/implementations/RedisJobStore.ts#L240-L495).

This is a hybrid design, not pure event sourcing. The materialized resume state is authoritative for current presentation, while replay events close the race between reading that snapshot and subscribing.

#### 3. Reload and resume

`useResumeOnLoad` checks the stream status for the current conversation, waits for database messages to load, and rebuilds an active submission when a durable job exists. It avoids a common race where the ordinary message query overwrites a more recent resume snapshot. See [`useResumeOnLoad.ts#L93-L290`](https://github.com/danny-avila/LibreChat/blob/4321f68f29a0c169cd683876c8b34a28d409eb9e/client/src/hooks/SSE/useResumeOnLoad.ts#L93-L290) and [`#L335-L459`](https://github.com/danny-avila/LibreChat/blob/4321f68f29a0c169cd683876c8b34a28d409eb9e/client/src/hooks/SSE/useResumeOnLoad.ts#L335-L459).

On the resumed SSE, the client receives a `sync` payload and reconstructs:

- user and Assistant message identity;
- aggregated response content;
- run steps;
- reasoning and message deltas that raced after the snapshot;
- usage;
- pending approval controls;
- queued steer chips;
- title events.

It then restores `isSubmitting` and the Stop button. See [`useResumableSSE.ts#L940-L1147`](https://github.com/danny-avila/LibreChat/blob/4321f68f29a0c169cd683876c8b34a28d409eb9e/client/src/hooks/SSE/useResumableSSE.ts#L940-L1147).

The server route authenticates the stream, sends the resume state, subscribes to the job, and unsubscribes on disconnect without stopping generation in [`api/server/routes/agents/index.js#L61-L172`](https://github.com/danny-avila/LibreChat/blob/4321f68f29a0c169cd683876c8b34a28d409eb9e/api/server/routes/agents/index.js#L61-L172).

#### 4. Closing snapshot-subscribe races

`subscribeWithResume` obtains resume state and subscribes with race-closing behavior. It rechecks mutable approval and steer state after the subscription is established and supplies pending events that landed between snapshot read and listener installation. See [`GenerationJobManager.ts#L807-L1135`](https://github.com/danny-avila/LibreChat/blob/4321f68f29a0c169cd683876c8b34a28d409eb9e/packages/api/src/stream/GenerationJobManager.ts#L807-L1135).

This is a particularly useful invariant for this repository. If the selected messages and active run are returned by one Convex query, Convex supplies the equivalent atomic snapshot. If they remain separate, the client needs a defined reconciliation rule like LibreChat's.

#### 5. Ordering, duplicate handling, and multiple replicas

`RedisEventTransport` assigns a global per-stream sequence, uses a reorder buffer, drops duplicates, and orders terminal events behind prior chunks. Redis pub/sub supplies low latency, while Redis state and Streams recover from missed pub/sub events. It also carries cross-replica abort messages. See [`RedisEventTransport.ts#L7-L218`](https://github.com/danny-avila/LibreChat/blob/4321f68f29a0c169cd683876c8b34a28d409eb9e/packages/api/src/stream/implementations/RedisEventTransport.ts#L7-L218) and [`#L220-L380`](https://github.com/danny-avila/LibreChat/blob/4321f68f29a0c169cd683876c8b34a28d409eb9e/packages/api/src/stream/implementations/RedisEventTransport.ts#L220-L380).

The important pattern is:

> Pub/sub is an acceleration path. Durable state remains the recovery path.

A client that misses pub/sub does not need to guess whether the run is alive or reconstruct state only from future events.

#### 6. Stop

The abort route verifies ownership, signals the job across replicas, preserves partial content, emits a terminal event, and removes the active job. See [`api/server/routes/agents/index.js#L267-L440`](https://github.com/danny-avila/LibreChat/blob/4321f68f29a0c169cd683876c8b34a28d409eb9e/api/server/routes/agents/index.js#L267-L440) and [`GenerationJobManager.ts#L1130-L1310`](https://github.com/danny-avila/LibreChat/blob/4321f68f29a0c169cd683876c8b34a28d409eb9e/packages/api/src/stream/GenerationJobManager.ts#L1130-L1310).

This confirms an important architectural choice: resumable observation and Stop should be separate channels. Stop must target a durable job or run ID, not a particular browser's HTTP reader.

#### 7. Zombie protection

The cleanup path reaps stale running jobs based on inactivity, aborts the underlying worker when possible, removes active membership, and emits a terminal timeout error to subscribers. See [`GenerationJobManager.ts#L1960-L2070`](https://github.com/danny-avila/LibreChat/blob/4321f68f29a0c169cd683876c8b34a28d409eb9e/packages/api/src/stream/GenerationJobManager.ts#L1960-L2070).

The test suite verifies:

- stale jobs are reaped;
- recently active jobs are not reaped;
- replacement jobs are not accidentally reaped;
- active user membership is cleaned;
- a connected client receives a terminal error.

See [`staleJobReaping.spec.ts`](https://github.com/danny-avila/LibreChat/blob/4321f68f29a0c169cd683876c8b34a28d409eb9e/packages/api/src/stream/__tests__/staleJobReaping.spec.ts).

### What to adopt

- Separate durable run identity from transport subscription.
- Return a materialized resume snapshot first, then close the subscription race.
- Treat pub/sub as optional acceleration, never as the only truth.
- Make Stop run scoped and owner authorized.
- Use monotonic sequence and terminal ordering.
- Reap inactivity and emit a terminal outcome.

### What not to adopt by default

- Redis Streams and pub/sub for every token or UI event.
- A second active-job store alongside Convex.
- Rebuilding the entire frontend message state from event replay when current Convex snapshots already provide it.

### Known limitation

**Unresolved:** stale-job correctness during a legitimate, completely silent provider or tool call depends on whether the execution path refreshes activity independently of emitted events. This is one reason an explicit heartbeat or renewable lease is clearer than inferring liveness only from progress writes.

## 4.2 OpenHands: event-sourced semantic activity with lease, fencing, and crash recovery

### Why it is a strong candidate

OpenHands is the strongest primary-source example for the exact problem that `message.status === "streaming"` cannot solve:

> How does a returning client know that some worker still owns the run?

It answers with a renewable owner lease and a fencing generation, not with message state.

### End-to-end path

#### 1. Conversation state and event log

The agent server stores a conversation and an ordered event history. Events represent semantic actions, observations, state changes, tool activity, and user-facing checkpoints. The service publishes events live and persists semantic events before or as part of publication in [`event_service.py`](https://github.com/OpenHands/software-agent-sdk/blob/e2b852c59b3f7a96fe0decde8d762a1ad7f0bc16/openhands-agent-server/openhands/agent_server/event_service.py#L68-L176).

Token-level `StreamingDeltaEvent` values are intentionally live-only. This is an important counterexample to the assumption that polished re-entry requires replay of every token. OpenHands can reconstruct a trustworthy conversation and active agent state without storing every transient delta.

#### 2. Lease and fencing

The lease implementation stores:

- owner instance;
- lease expiry;
- host and process identity;
- a monotonically increasing generation.

A worker renews periodically. A new owner can take over after expiry, and a locally dead process can be detected earlier. Writes carry the lease generation so a stale owner cannot write after takeover. See [`conversation_lease.py`](https://github.com/OpenHands/software-agent-sdk/blob/e2b852c59b3f7a96fe0decde8d762a1ad7f0bc16/openhands-agent-server/openhands/agent_server/conversation_lease.py).

The default relationship is a 45-second TTL with renewal every 15 seconds. The exact values are less important than the invariant:

> Active status is valid only while a current owner can renew a lease, and every write proves that owner generation.

The tests cover active-owner rejection, expiry takeover, generation increments, renewal, stale release rejection, and dead local process takeover in [`test_conversation_lease.py`](https://github.com/OpenHands/software-agent-sdk/blob/e2b852c59b3f7a96fe0decde8d762a1ad7f0bc16/tests/agent_server/test_conversation_lease.py#L36-L225).

#### 3. Background execution and recovery

Starting a conversation claims the lease and creates the background run. Guarded persistence checks the lease generation. When stored state says `RUNNING` but the process is being loaded after a crash, the service does not revive the spinner. It records an interrupted observation for any active tool and moves the conversation to `ERROR`. See [`event_service.py#L739-L1052`](https://github.com/OpenHands/software-agent-sdk/blob/e2b852c59b3f7a96fe0decde8d762a1ad7f0bc16/openhands-agent-server/openhands/agent_server/event_service.py#L739-L1052).

This is the strongest direct prior art for the requested "lost terminal write" and "worker dies while run says streaming" cases.

#### 4. Reconnect and replay

The WebSocket endpoint subscribes a client, optionally replays the event history, then follows live events in [`sockets.py#L227-L373`](https://github.com/OpenHands/software-agent-sdk/blob/e2b852c59b3f7a96fe0decde8d762a1ad7f0bc16/openhands-agent-server/openhands/agent_server/sockets.py#L227-L373).

The remote client uses exponential retry. After reconnect, it performs a full REST reconciliation, merges events by stable event ID, inserts them in order, and joins tool start/end records by `tool_call_id`. See [`remote_conversation.py`](https://github.com/OpenHands/software-agent-sdk/blob/e2b852c59b3f7a96fe0decde8d762a1ad7f0bc16/openhands-sdk/openhands/sdk/conversation/impl/remote_conversation.py).

Reconnect reconciliation tests were added in commit [`5115af7850f80a045acd8c12b01dcb1abdce2b42`](https://github.com/OpenHands/software-agent-sdk/commit/5115af7850f80a045acd8c12b01dcb1abdce2b42).

#### 5. Terminal and Stop races

The service tracks interrupt generation and run generation so an explicit Stop or pause cannot be overwritten by a later completion from the old execution. It waits for pending event publications before writing final execution status and has a backstop terminal path in [`event_service.py#L1180-L1356`](https://github.com/OpenHands/software-agent-sdk/blob/e2b852c59b3f7a96fe0decde8d762a1ad7f0bc16/openhands-agent-server/openhands/agent_server/event_service.py#L1180-L1356).

This maps directly to the current repository's terminal-arbitration lifecycle and suggests one addition: writes should prove the current lease generation, not only the run ID.

### What to adopt

- Renewable liveness lease separate from message status.
- Monotonic fencing generation on all worker writes.
- Crash recovery that explicitly terminates an abandoned active state.
- Stable event or snapshot identity for reconnect deduplication.
- Tool interruption records so a half-finished tool does not remain visually active forever.

### What not to adopt by default

- A full append-only event model for every UI transition.
- Filesystem lease semantics.
- Replaying the entire run to derive the selected Assistant row when Convex already materializes messages and tool records.

### Known limitations

- Token deltas are not durable. Re-entry reconstructs semantic state, not the exact missed token animation.
- The open implementation uses deployment-specific shared storage and file-based lease mechanics rather than a serverless database.
- Schema evolution and event compaction are broader concerns than this backlog requires.

## 4.3 Open WebUI: snapshot plus task liveness reconciliation

### Why it is a strong candidate

Open WebUI's frontend behavior is closest to the missing product behavior in this repository. It does not require the returning component to own the original HTTP stream.

### End-to-end path

#### 1. Start background task and persist message skeleton

The server persists user and Assistant message state, then launches generation as an `asyncio.Task`. The background task records errors and cancellation and updates the durable chat message. See [`backend/open_webui/main.py#L1208-L1264`](https://github.com/open-webui/open-webui/blob/ecd48e2f718220a6400ecf49eafd4867a38feb10/backend/open_webui/main.py#L1208-L1264) and [`#L1475-L1663`](https://github.com/open-webui/open-webui/blob/ecd48e2f718220a6400ecf49eafd4867a38feb10/backend/open_webui/main.py#L1475-L1663).

#### 2. Register task liveness separately

`tasks.py` keeps the actual `asyncio.Task` in process memory, records task-to-chat membership in Redis, and uses Redis pub/sub to broadcast cancellation across instances. Cleanup is idempotent and removes membership. See [`backend/open_webui/tasks.py`](https://github.com/open-webui/open-webui/blob/ecd48e2f718220a6400ecf49eafd4867a38feb10/backend/open_webui/tasks.py).

This cleanly separates:

- message content in the database;
- task liveness in the task registry;
- transport in Socket.IO;
- client control in Stop endpoints.

#### 3. Persist and publish progress

The Socket.IO event emitter updates durable message state and broadcasts status, text deltas, replacements, citations, tool activity, and errors to the user's room. Multiple tabs and devices connected as the same user receive the same events. See [`backend/open_webui/socket/main.py#L919-L1036`](https://github.com/open-webui/open-webui/blob/ecd48e2f718220a6400ecf49eafd4867a38feb10/backend/open_webui/socket/main.py#L919-L1036).

A missed socket event is not fatal because the durable chat can be reloaded.

#### 4. Re-entry reconciliation

When a chat is opened, `Chat.svelte` loads the durable snapshot and queries task IDs for the chat. It then applies the key rule:

- task exists and the final row is incomplete: render as active;
- no task exists and the final row is incomplete: settle it instead of reviving a loader.

The socket then continues updating the same message. On reconnect, the client checks the pending row and reloads durable state if no task remains. See [`Chat.svelte#L610-L758`](https://github.com/open-webui/open-webui/blob/ecd48e2f718220a6400ecf49eafd4867a38feb10/src/lib/components/chat/Chat.svelte#L610-L758), [`#L898-L923`](https://github.com/open-webui/open-webui/blob/ecd48e2f718220a6400ecf49eafd4867a38feb10/src/lib/components/chat/Chat.svelte#L898-L923), and [`#L1587-L1684`](https://github.com/open-webui/open-webui/blob/ecd48e2f718220a6400ecf49eafd4867a38feb10/src/lib/components/chat/Chat.svelte#L1587-L1684).

This is direct prior art for the recommended rule in `not-a-wrapper`:

> A durable partial message is content. A separately verified active run is liveness. The UI needs both.

#### 5. Stop

Stop locates all tasks for the chat, verifies access, and cancels them. Redis cancellation broadcasts allow a request on one instance to reach the instance owning the task. Ownership hardening is visible in commit [`e7ff4768f8ffe1924b4576381c9e45e8a64350e4`](https://github.com/open-webui/open-webui/commit/e7ff4768f8ffe1924b4576381c9e45e8a64350e4).

### What to adopt

- Load durable message content and run liveness independently.
- Reconcile incomplete content with authoritative liveness at chat entry.
- Broadcast live updates to all user clients, while retaining durable recovery.
- Let a returning owner Stop by chat or run identity.
- Render missed-event recovery from the durable snapshot.

### What not to adopt

- Process-local task objects as the authority in a serverless environment.
- Redis membership keys without a verified lease or reaper.
- Treating "task ID exists" as indefinitely valid.

### Known limitations

**Verified:** the actual task is process-local. Redis stores membership and cancellation signals, not executable continuation state.

**Unresolved:** no lease expiry or independent stale-task reaper was located in the task registry. A hard process crash can therefore leave a task membership record that looks active until another cleanup path repairs it.

## 4.4 Secondary findings

### Vercel Chatbot and AI SDK resume streams

The template's POST route includes `createResumableStreamContext` and `consumeSseStream`, but the current pinned [`GET /api/chat/[id]/stream`](https://github.com/vercel/chatbot/blob/c2f8235e1f3ea903ad8b7f61447c4f74164b5c58/app/%28chat%29/api/chat/%5Bid%5D/stream/route.ts) returns `204` unconditionally. An open pull request, [`#1486`](https://github.com/vercel/chatbot/pull/1486), attempts to restore resume behavior but is not merged into the pinned source.

The official AI SDK guide documents Redis-backed resumable streams, multiple clients, active stream IDs, and a GET resume endpoint. It also explicitly warns that built-in stream resumption is incompatible with abort functionality: [Chatbot Resume Streams](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-resume-streams).

Conclusion: this is useful framework infrastructure and a warning against assuming a popular template currently solves the product behavior. It is not the preferred direction for a run that must remain stoppable from any tab.

### LobeHub Agent Gateway client

LobeHub persists a server `operationId` in topic metadata, discovers it on reload in [`useGatewayReconnect.ts`](https://github.com/lobehub/lobehub/blob/857d2a7dd74d777405791ad9d740dc879e1ae12c/src/hooks/useGatewayReconnect.ts), and reconnects a local display operation to the server operation in [`gateway.ts`](https://github.com/lobehub/lobehub/blob/857d2a7dd74d777405791ad9d740dc879e1ae12c/src/store/chat/slices/agentRun/actions/transports/gateway/gateway.ts#L730-L891).

Its gateway client tracks `lastEventId`, buffers replay, reconnects with backoff, sends heartbeats, and distinguishes authoritative `running`, waiting, completed, error, and interrupted states in [`packages/agent-gateway-client/src/client.ts`](https://github.com/lobehub/lobehub/blob/857d2a7dd74d777405791ad9d740dc879e1ae12c/packages/agent-gateway-client/src/client.ts#L13-L354).

The backend operation store and replay implementation are not fully present in the same repository, so the end-to-end durability claim remains unresolved. The client is still valuable evidence for keeping connection state, operation state, and UI operation state separate.

### Dify

Dify's [`BaseAppQueueManager`](https://github.com/langgenius/dify/blob/40df83de660d19b17d9674821e82aa2bd4b61a49/api/core/app/apps/base_app_queue_manager.py) uses a process-local queue for progress events while Redis stores task ownership and Stop flags with TTL. The pipeline has execution timeouts and terminal error handling in [`based_generate_task_pipeline.py`](https://github.com/langgenius/dify/blob/40df83de660d19b17d9674821e82aa2bd4b61a49/api/core/app/task_pipeline/based_generate_task_pipeline.py).

This is useful for Stop polling and timeout design, but no complete durable replay or reload reconstruction path was verified from these components.

### LangGraph Agent Chat UI

The client uses LangGraph's `useStream`, persistent thread IDs, state history, and custom UI events in [`src/providers/Stream.tsx`](https://github.com/langchain-ai/agent-chat-ui/blob/1cbd509d387b1e9602a80f05e638058b7543d7cc/src/providers/Stream.tsx). The durable run and checkpoint semantics live in LangGraph Server, so this repository does not independently prove the requested backend path.

# 5. Pattern comparison

| Pattern | Representative evidence | Durable authority | Re-entry freshness | Missed progress | Stop model | Zombie defense | Operational complexity | Serverless compatibility | Fit for this repository |
|---|---|---|---|---|---|---|---|---|---|
| **A. Durable-state projection without stream resumption** | Open WebUI UI reconciliation; current Convex snapshot projection | Database snapshot plus active-run record | Requires heartbeat, lease, task ownership, or a bounded stale deadline | Next durable snapshot repairs the view; sub-snapshot animation is lost | Separate run-scoped mutation | Lease expiry or task registry reconciliation | Low to medium | High when all authority is in Convex | Strong |
| **B. Resumable event streams** | LibreChat; AI SDK resume guide | Active stream ID plus replay buffer and job state | Stream status plus cursor | Replayed from Redis Streams or replay buffer | Must be a separate control channel; official AI SDK built-in resume warns about abort incompatibility | Stream expiry plus durable job terminal/reaper | High | High only with external Redis or equivalent durable stream store | Useful only if exact replay is required |
| **C. Durable job plus pub/sub** | LibreChat; Open WebUI | Durable job record or task registry | Job status or lease | Pub/sub is low-latency; snapshot repairs missed events | Job ID or chat ID | Job TTL, lease, or reaper | Medium to high | Good if job and pub/sub are external; poor if task is process-local | Convex already supplies subscription, so a new broker adds little |
| **D. Event-sourced generation run** | OpenHands; parts of LibreChat | Ordered event log plus execution state | Event sequence and owner lease | Replay and fold events | Conversation/run command | Lease, fencing, crash-recovery event | High | Depends on durable event store and worker ownership | More complexity than the backlog justifies |
| **E. Hybrid snapshot plus run-state subscription** | Current repository plus Open WebUI, strengthened with OpenHands lease | Materialized message/tool snapshots plus authoritative run envelope | Lease-qualified run state | Convex subscription supplies new snapshots; exact token replay is not required | Durable run mutation, independent of `useChat` | Lease expiry, reaper, run/fence/sequence guards | Low to medium | High for state and control; worker execution still has its own platform limit | **Best fit** |

## Pattern decision

### Why snapshots are likely fresh enough

The current runtime targets a 750 ms snapshot cadence and already writes reasoning and parts, not only text. A returning client can therefore show:

- the latest persisted text;
- the latest persisted reasoning block;
- known tool and approval state;
- a truthful "Generating in background" presentation from the run envelope.

The maximum visual lag after re-entry is bounded by snapshot cadence and network delivery, rather than by the original HTTP stream. That is sufficient for a polished in-progress view unless the product specifically requires replaying every missed token animation.

### How liveness should be proved

Liveness should not be inferred from a message status or from recent content alone. It should require all of the following:

1. the projected run is the chat's current run;
2. the run is linked to the rendered Assistant message;
3. the run is in an active lifecycle status;
4. its lease has not expired;
5. no terminal or superseding transition has won;
6. the client has a current Convex result, or explicitly presents connectivity as unknown.

### Why a new pub/sub system is not justified

Convex React queries already form reactive subscriptions, update when underlying data changes, present a consistent database view, and reconnect automatically after network loss according to the official [Convex React documentation](https://docs.convex.dev/client/react/overview).

The application already stores the content and lifecycle in Convex. Adding Redis only to broadcast progress would create a second authority and a new reconciliation problem. The lower-complexity alternative is to let Convex remain authoritative and subscribe to a small active-run projection.

### Why resumable SSE is not the default

Resumable SSE provides lower-latency replay and exact missed-event reconstruction, but it introduces:

- stream retention;
- cursor and duplicate logic;
- a Redis or broker dependency;
- replay expiration policy;
- a second transport to reconcile with Convex;
- an abort design problem.

The official AI SDK resume guide currently warns that its built-in resume mode is incompatible with abort. LibreChat solves this by creating its own durable job and separate abort channel. Replicating that machinery is not justified when this repository already has sub-second durable snapshots and Convex subscriptions.

# 6. Recommended architecture

## 6.1 Architectural invariant

The selected Assistant row should be derived from four independent inputs:

1. **Transport state:** what this browser's current `useChat` request is doing.
2. **Durable run state:** what the server says the generation run is doing.
3. **Durable content state:** the newest materialized message, parts, tools, approvals, and sequence.
4. **Control capability:** whether this authenticated client may Stop, approve, supersede, or regenerate the run.

No one input substitutes for another.

## 6.2 Authoritative liveness source

`generationRuns` should become the authoritative liveness source, but only after it is freshness-qualified.

Recommended additions to each run:

| Field | Purpose |
|---|---|
| `leaseGeneration: number` | Monotonic fencing token. Every worker write supplies the expected value. |
| `heartbeatAt: number` | Last explicit worker renewal, including periods with no content delta. |
| `leaseExpiresAt: number` | Server-computed deadline after which an active status is not trusted. |
| `lastProgressSequence: number` | Latest accepted durable content/activity sequence for projection and observability. |
| `lastProgressAt: number` | Distinguishes an alive but silent worker from recently changing content. |
| `terminalReason?: completed, user_stop, superseded, provider_error, lease_expired, or terminal_write_recovery` | Gives the UI and operators a stable outcome without multiplying lifecycle statuses. |
| `stopRequestedAt?: number` | Audit and idempotency for Stop. The run may be marked `aborted` in the same mutation. |
| `stopRequestedBy?: Id<"users">` | Control audit. |
| `supersededByRunId?: Id<"generationRuns">` | Explicit causal link for overlapping generations. |
| `terminalAt?: number` | One canonical terminal timestamp. Existing `completedAt` can be migrated or retained for compatibility. |

The current `runId`, `assistantMessageId`, `statusRunId`, terminal guards, and snapshot sequence remain essential.

### Recommended lease timing

A reasonable starting contract is:

- heartbeat every 10 seconds;
- lease expiry 45 seconds after the latest successful heartbeat;
- reaper scan every 15 to 30 seconds;
- UI enters `possibly-stale` immediately after the known lease deadline;
- the reaper converts the run to `failed` with `terminalReason = "lease_expired"`.

The exact values should be load-tested. OpenHands' 15-second renewal and 45-second lease provide mature prior art for the ratio.

## 6.3 Worker heartbeat and fencing

`durable-turn-runtime.ts` should maintain a heartbeat independent of text snapshots. This matters when:

- a model is thinking but has not emitted a token;
- a tool call is running;
- an approval persistence write is in flight;
- the provider is temporarily silent.

Every mutation that writes a snapshot, tool record, approval, heartbeat, or terminal outcome should include the run ID and expected `leaseGeneration`.

A mutation should accept a worker write only when:

```text
run.status is nonterminal
and run.leaseGeneration equals expectedLeaseGeneration
and the run still owns the chat status slot
and the linked Assistant message still belongs to the run
and sequence is newer where sequence applies
```

Stop, supersession, reaping, or takeover makes later worker writes harmless by changing terminal state and, preferably, incrementing the fence.

## 6.4 Selected-conversation projection

For the open conversation, return one reactive Convex result:

```text
{
  selectedMessages,
  activeRun: {
    runId,
    assistantMessageId,
    status,
    terminalReason,
    leaseGeneration,
    heartbeatAt,
    leaseExpiresAt,
    lastProgressSequence,
    lastProgressAt,
    activeToolNames,
    pendingApproval,
    controllable
  } | null
}
```

The `activeRun` projection should be included only when:

- `chat.statusRunId` points at the run;
- the run belongs to the owner and chat;
- the Assistant message is on the selected path or is the pending placeholder for that path.

Returning messages and run state from one query avoids a hydration race where a terminal run and an older message snapshot are rendered as unrelated facts. Convex query results are transactionally consistent, so this is simpler than LibreChat's explicit snapshot-subscribe gap protocol.

The sidebar should continue using its compact chat projection. It does not need tool names, sequence, or control data.

## 6.5 UI presentation after re-entry

The row should not mutate `useChat.status`. Instead, a pure run-presentation resolver should combine local transport and durable run state.

### Local stream

When the current `useChat` instance owns the matching run and reports `submitted` or `streaming`, preserve current immediate behavior. Local transport remains the fastest source for the initiating tab.

### Background stream

When local transport is `ready`, detached, or reconnecting, but the matching durable run is active and its lease is fresh:

- render `background-streaming`;
- show a persistent, accessible label such as "Generating in background";
- keep the appropriate Thinking, tool, image, or responding Activity presentation active;
- show the caret when durable content is actively responding;
- keep Activity following the run;
- suppress edit, regenerate, branch switch, and other settled-only actions;
- expose durable Stop if `controllable`;
- continue adopting Convex message snapshots.

The visual design may distinguish local from background execution subtly, but both are active states.

### Awaiting approval

`awaiting_approval` is not a short-lived worker lease state. It is a durable user-attention state proven by a pending approval record and its own expiry policy.

After re-entry:

- render the approval control from the durable approval row;
- do not show an endlessly running reasoning timer;
- allow exactly one authorized resolution;
- present conflicting second-tab resolution as "Already resolved";
- starting a new generation should continue to auto-deny or supersede pending approvals through the existing lifecycle.

### Possibly stale

If the run claims an active status but its lease is expired, or the client is offline past the last known lease deadline:

- do not show a spinning loader, active caret, or live tool timer;
- preserve partial content;
- show a neutral recovery state such as "Generation status is unknown" or "Generation was interrupted";
- disable approval and destructive actions until current state is known, unless an idempotent Stop is still safe;
- allow the Convex reaper to settle the durable run;
- after settlement, render the terminal error or interrupted outcome.

This preserves the current safeguard against resurrecting stale loaders.

## 6.6 Durable Stop semantics

A returning client should be able to Stop the run without owning the old HTTP stream.

Recommended mutation:

1. authenticate the chat owner;
2. load the run by `runId`;
3. verify it is the current run for the chat and the supplied control or lease generation is current;
4. if already terminal, return the existing outcome;
5. atomically mark it `aborted`, set `terminalReason = "user_stop"`, clear `activeStreamId`, record the requester, and project the chat status;
6. increment or invalidate the worker fence;
7. settle the linked Assistant message through the existing lifecycle algebra.

This makes Stop immediately visible to all tabs and rejects every later snapshot from the old worker.

The detached runtime should use a server-side AbortController composed with the request signal. Its heartbeat or snapshot mutation should return whether the run remains writable. On terminal or fence mismatch, the runtime aborts the provider call. This is best-effort resource cancellation behind an already authoritative terminal state.

The initiating tab can optimistically present `stopping` while the mutation is pending, call local `useChat.stop()` for immediate transport cancellation, and converge on durable `aborted`. A returning tab calls only the durable mutation.

## 6.7 Terminal convergence and stale-state prevention

The terminal guarantee should have three layers:

1. **Idempotent terminal mutation:** completion, abort, and failure use the existing explicit precedence rules and are safe to retry.
2. **Runtime retry:** transient terminal write failures retry with bounded exponential backoff.
3. **Independent reaper:** an active run whose lease expires is converted to `failed` with a machine-readable reason, preserving the latest snapshot.

Convex scheduled functions are persisted in the database and resilient to restarts, and scheduled mutations execute exactly once according to [Scheduled Functions](https://docs.convex.dev/scheduling/scheduled-functions). Two viable implementations are:

- a periodic cron that scans an index such as `by_status_lease_expiry`;
- a versioned scheduled expiry check that no-ops if the lease has since advanced.

A periodic indexed reaper is simpler to observe and avoids scheduling a new timer on every heartbeat.

The reaper must route through the same lifecycle algebra as ordinary failure. It must not directly patch only the run and leave the message or chat projection inconsistent.

## 6.8 Why this is preferable to the strongest alternatives

### Versus LibreChat

The proposed design retains LibreChat's authoritative run status, sequence, Stop, and reaper principles without copying its Redis Streams, pub/sub, reorder buffer, replay cursor, and parallel job store.

The current application already has a durable materialized snapshot and a reactive multi-client data channel. Exact event replay has low incremental product value relative to its operational cost.

### Versus OpenHands event sourcing

The proposed design adopts leases and fencing but does not require every text, tool, approval, and terminal transition to be folded from an event log. Existing materialized messages, snapshots, tool invocations, and approval rows already match the application's read patterns.

### Versus Open WebUI task registry

The proposed design adopts Open WebUI's content-plus-liveness reconciliation, but the authority stays in Convex rather than a process-local task dictionary or unleased Redis membership key.

### Versus built-in AI SDK resume

The proposed design preserves Stop. It avoids the official resume mode's abort incompatibility and does not bind presentation correctness to a retained HTTP/SSE stream.

# 7. Repository integration map

This section describes likely responsibilities and data flow. It is not implementation code.

| Existing seam | Recommended responsibility |
|---|---|
| `app/api/chat/durable-turn-runtime.ts` | Receive `runId` and lease generation from prepare. Start an independent heartbeat. Persist progress sequence. Compose a worker AbortController with the request signal. Abort when heartbeat or snapshot writes report terminal/fence mismatch. Retry terminal writes. Record structured diagnostics for heartbeat loss, fence rejection, Stop latency, and terminal retry. |
| `convex/chatRuntime.ts` | Add lease renewal, durable Stop, stale-run reaping, and active-run projection. Require expected lease generation on all worker writes. Keep terminal settlement in the existing lifecycle algebra. Preserve `statusRunId` projection guard. Return current run writability from heartbeat/snapshot mutations. |
| `convex/schema.ts` | Add lease, fence, progress, terminal reason, Stop audit, and supersession fields. Add an indexed expiry path for active runs. Optionally add approval expiry. Avoid a second job table unless generation execution later moves to a separate worker system. |
| `lib/chat-store/turns/selected-path.ts` | Continue monotonic message-content adoption. Accept or return the selected active-run envelope alongside messages. Never infer liveness from adopted `message.status`. Ensure a run is linked to the selected Assistant message before presenting it as active. |
| `app/components/chat/use-chat-core.ts` | Keep `useChat.status` as local transport state. Expose local run ownership if known. Subscribe to the durable active-run projection. Replace the single local Stop surface with a resolver that calls local Stop for the owner tab and durable Stop for every durable run. Do not set `useChat.status = "streaming"` after remount. |
| `app/components/chat/conversation.tsx` | Derive row execution state from local transport plus the durable run envelope. Use that result for pending placeholder, caret, settled actions, reload/edit availability, and scroll behavior. Preserve durable terminal outcomes. |
| `lib/chat-messages/assistant-turn.ts` | Extend the phase input from a raw render status to a discriminated execution state. Preserve the one-phase invariant. Distinguish local and background origin without letting stale raw part states create activity. |
| `lib/chat-messages/assistant-activity.ts` | Present background reasoning/tool activity from the new execution state. Add stable recovery text for `possibly-stale` and interrupted outcomes. Do not run timers for approval pauses or stale state. |
| `app/components/chat/use-activity-panel.ts` | Follow the selected durable active run after re-entry. Keep historical explicit selection behavior. Drive duration from durable start/progress timestamps when the local reasoning timer does not own the run. |
| `lib/chat-store/status/sidebar-chat-status.ts` | Reuse the same freshness rule. A raw `liveRunStatus` should not spin after known lease expiry. The sidebar can receive a compact projected `leaseExpiresAt` or a server-derived `liveRunFresh` boolean. |
| `app/components/layout/sidebar/sidebar-item-status.tsx` | Add accessible labels for background generation, awaiting approval, and interrupted/stale recovery. Announce state transitions, not every snapshot. |
| New pure module, suggested `lib/chat-runs/run-presentation.ts` | Centralize the cross-layer resolver for local transport, durable run, lease freshness, selected Assistant linkage, connectivity, and control capability. Unit-test the full state table here. |

## Suggested data flow

```text
POST /api/chat
  -> Convex prepareGeneration
       creates run + Assistant placeholder + lease generation
  -> provider stream
       local HTTP chunks -> initiating useChat
       periodic snapshots/tools/heartbeats -> Convex
  -> selected-conversation Convex query
       messages + activeRun envelope -> every tab/device
  -> run-presentation resolver
       local transport + activeRun + connectivity -> one Assistant execution state
  -> row, Activity, sidebar, and controls
       render from that state
  -> terminal / Stop / reaper
       shared lifecycle mutation -> message + run + chat projection settle atomically
```

# 8. State model

## 8.1 Separate state layers

### Transport state

Owned by the current browser and AI SDK transport:

- `idle`
- `connecting`
- `streaming`
- `reconnecting`
- `disconnected`
- `transport-error`

Transport state says nothing by itself about whether the server run is alive.

### Durable run state

Owned by Convex lifecycle mutations:

- `queued`
- `running`
- `streaming`
- `awaiting_approval`
- `completed`
- `aborted`
- `failed`

Recommended outcome details are represented by `terminalReason`, not by multiplying core statuses.

### Presentation state

Owned by a pure client resolver over transport, run, lease, selected message, and connectivity.

| Presentation state | Entry condition | Visible behavior | Allowed control | Transition owner |
|---|---|---|---|---|
| `local-submitted` | Matching local request is submitted; durable run is current and nonterminal | Pending Assistant row, "Starting", no settled actions | Stop | Local transport plus Convex prepare |
| `local-streaming` | Matching local request streams; durable run remains writable | Existing live Thinking, tools, response, caret, Activity timer | Stop | Local transport for immediacy; Convex remains terminal authority |
| `background-streaming` | Local request is absent or idle; matching run is active; lease is fresh | "Generating in background", live Activity, durable content updates, caret when responding | Durable Stop | Convex run subscription |
| `awaiting-approval` | Run is `awaiting_approval`; matching pending approval exists and is unexpired | Approval card, no active reasoning timer, attention status | Approve, deny, Stop, or supersede according to policy | Convex approval lifecycle |
| `stopping` | This client submitted Stop and awaits the durable mutation result | Disable duplicate controls, preserve content | None except retry on error | Client optimistic control |
| `possibly-stale` | Run claims active but lease expired, or client is offline past the last known deadline | No spinner/caret/timer; "Status unknown" or "Interrupted"; preserve partial content | Safe idempotent Stop or wait for reconnect | Client freshness resolver; Convex reaper settles |
| `completed` | Durable run completed and message terminalized | Settled response and actions | Edit, regenerate, branch actions | Convex terminal mutation |
| `stopped` | Durable run aborted with `terminalReason = user_stop` | Stopped banner, partial response preserved where present | Retry/regenerate | Convex Stop or abort mutation |
| `failed` | Durable run failed, including lease expiry or terminal recovery | Failure or interrupted banner, partial content preserved | Retry/regenerate | Convex failure or reaper |
| `superseded` | Durable run aborted with `terminalReason = superseded` or linked replacement | No live indicators; selected branch follows newer run | Inspect historical branch if exposed | Convex prepare/supersession transaction |

## 8.2 Authoritative resolution order

For one Assistant row:

1. A durable terminal outcome wins.
2. A durable pending approval wins.
3. A pending local Stop shows `stopping`.
4. A matching local stream with a current writable run shows local activity.
5. A matching fresh durable run shows background activity.
6. An active-looking but expired or unverifiable run shows `possibly-stale`.
7. Otherwise the row is settled.

This order preserves immediate local Stop behavior without allowing stale durable `streaming` to resurrect a loader.

## 8.3 Race analysis

| Race | Required resolution |
|---|---|
| Navigate away while text or reasoning streams | Unmount closes local observation only. Worker continues while renewing lease. Convex snapshots continue. Sidebar and selected conversation derive background state from the run. |
| Return before the next snapshot | The durable Assistant placeholder and fresh active run render a live generic Thinking or Working state. The next snapshot fills content. |
| Return after a snapshot but before terminal write | Fresh run plus latest sequence renders background activity. Terminal subscription settles it. |
| Terminal write occurs while returning client hydrates | Messages and active run should come from one Convex query. The transactionally latest result wins; terminal state has higher presentation priority. |
| Stop immediately before navigation | Local Stop plus durable Stop mutation makes the run terminal. Re-entry sees `aborted`, not `streaming`. |
| Stop immediately after navigation | Returning client calls run-scoped durable Stop. Any local stream owner is irrelevant. |
| Initiating client disconnects without Stop | No control mutation occurs. The worker remains active only while heartbeat renews the lease. |
| Worker dies while run says `streaming` | Lease expires. UI leaves active animation. Reaper marks failed with `lease_expired`. |
| Newer generation supersedes older | Existing transactional sweep terminalizes old run, sets causal reason/link, and starts new run. Fence and terminal guard reject old writes. |
| Delayed old snapshot arrives after newer run starts | Run terminal guard, lease generation, run-to-message linkage, and sequence reject it. `statusRunId` prevents old chat projection writes. |
| Multiple tabs observe one run | All subscribe to the same Convex projection. Local transport may differ, but durable run and content are shared. |
| Multiple tabs Stop | First mutation terminalizes. Later mutations return existing terminal outcome. |
| Multiple tabs approve or deny | Approval mutation uses expected `pending` state. One transition wins; others receive "already resolved." |
| Multiple tabs edit or regenerate | Disable while active by default. An explicit regenerate or edit transaction supersedes the current run and validates selected-path version. |
| Approval pause and later continuation | Pending approval is durable and independently expiring. Resolution closes the paused run and creates or links the continuation run using existing lifecycle rules. |
| Tool active before Assistant text | Fresh run plus nonterminal tool invocation renders Activity even with an empty text snapshot. |
| Run completes with no visible content | Preserve the existing terminal stub/delete-and-reselect policy in the lifecycle algebra. |
| Convex subscription temporarily lost | Preserve last content, stop live animation after the known lease deadline, show connectivity/status unknown, and reconcile automatically after reconnect. |
| Terminal mutation fails after provider completes | Retry idempotently. If no terminal write succeeds, lease expiry and reaper produce an honest failure instead of a zombie. |
| Completion races with Stop | Existing terminal precedence applies. A successful durable Stop must never be overwritten by late completion. |
| Completion races with failure callback | Preserve current lifecycle rule that can convert a nominal completion to failure when the failure is the authoritative final signal. |

# 9. Verification strategy

## 9.1 Pure unit tests

### Run presentation resolver

Use a table-driven suite for every combination of:

- local status;
- local run ownership;
- durable run status;
- Assistant/run linkage;
- lease fresh or expired;
- approval present or absent;
- terminal reason;
- online or offline;
- Stop mutation pending.

Assert one and only one presentation state.

Key regressions:

- stale `message.status = streaming` never creates a live state;
- background run does create a live state when the lease is fresh;
- terminal always beats local streaming;
- awaiting approval never runs a live reasoning timer;
- expired lease never shows a caret or spinner;
- older run cannot activate a different selected Assistant row.

### Lifecycle and fencing

Test:

- heartbeat renewal with correct generation;
- stale generation rejection;
- Stop then late snapshot;
- supersede then late completion;
- reaper then late tool write;
- duplicate terminal mutation;
- duplicate Stop;
- approval requested after terminal;
- approval resolved twice;
- terminal write recovery reason;
- empty Assistant terminal policy.

### Sequence and snapshot adoption

Extend selected-path tests for:

- background sequence growth;
- same-length parts with changed tool state;
- terminal override of a longer or structurally different local copy;
- older-run snapshot with higher wall-clock time but lower or unrelated run sequence;
- selected branch switch while a different branch runs.

## 9.2 Convex integration tests

Run concurrent mutations against a real or test Convex backend:

1. prepare run A;
2. snapshot A;
3. prepare run B and supersede A;
4. race snapshot A, terminal A, heartbeat A, and Stop A;
5. assert only B owns `statusRunId`;
6. assert A cannot mutate messages or chat projection.

Additional scenarios:

- two clients Stop the same run;
- Stop and completion commit concurrently;
- approval and supersession commit concurrently;
- reaper and heartbeat race at lease boundary;
- reaper and terminal completion race;
- terminal mutation retry after ambiguous client timeout;
- active-run query returns message and run from one consistent database state.

## 9.3 Runtime tests

Use a controllable fake provider stream and fake clock.

- Silent provider for longer than snapshot cadence but shorter than lease.
- Silent provider past lease because heartbeat fails.
- Tool call with no text.
- Reasoning-only output.
- Abort from a remote durable Stop.
- Request disconnect without Stop.
- Provider completes, final snapshot succeeds, terminal mutation fails repeatedly.
- Snapshot mutation returns fence mismatch.
- Heartbeat mutation returns terminal.
- Worker receives Stop during tool execution.
- Process shutdown simulation leaves run for reaper.

Assert provider AbortController behavior, retry bounds, and structured diagnostics.

## 9.4 Browser and navigation tests

Use Playwright with two isolated browser contexts and, where useful, two pages in one context.

### Navigation and reload

- Start a slow text stream, navigate to another chat, return before first snapshot.
- Return after one snapshot.
- Return during reasoning.
- Return during a tool call.
- Hard reload during each phase.
- Open the same chat in a second tab and separate browser context.
- Confirm both show background activity and monotonically growing content.
- Confirm no duplicate Assistant row is created.
- Confirm Activity follows the correct turn.
- Confirm caret and status settle exactly once.

### Stop and concurrency

- Stop from initiating tab.
- Stop from returning tab.
- Stop from second device.
- Stop simultaneously from two tabs.
- Stop just before navigation.
- Stop just after re-entry.
- Start regeneration from another tab according to the chosen policy.
- Assert late output never reappears after Stop or supersession.

### Approval

- Reload while approval is pending.
- Approve in one tab and observe the second tab settle.
- Resolve simultaneously in two tabs.
- Navigate away during continuation and return.
- Expire approval and confirm no live loader remains.

### Failure and recovery

- Kill or terminate the test worker while run is active.
- Drop Convex connectivity while streaming, wait past lease, then reconnect.
- Force terminal mutation failure.
- Force an old snapshot after a newer run.
- Complete with no visible text.
- Fail with partial text, tool card, or reasoning only.

## 9.5 Accessibility and product-quality checks

- `aria-live` announces "Generating in background", "Awaiting approval", "Stopped", and "Generation interrupted" only on state transitions.
- Streaming tokens do not repeatedly announce the whole message.
- Stop remains keyboard reachable and has a stable accessible name.
- Approval controls expose resolved and conflicting states.
- Background status is not communicated by animation or color alone.
- Settled actions are absent or disabled during local and background activity.
- Motion-reduction preferences disable nonessential shimmer/spin while retaining text status.
- Offline or stale state uses neutral language and does not falsely claim failure before the server reconciles.

## 9.6 Observability

Add structured metrics and logs for:

- active run count by status;
- heartbeat success/failure and latency;
- lease expiry count;
- reaper terminalizations;
- terminal write retries and failures;
- Stop request-to-durable-terminal latency;
- Stop request-to-provider-abort latency;
- stale fence and sequence write rejection;
- supersession count;
- reconnect and background re-entry count;
- time from final provider event to terminal Convex mutation;
- runs that finish with no visible content.

# 10. Open questions and residual risks

## 10.1 Verified limitations

1. **Execution is not a durable job.** The provider call remains inside a Next.js request and a 60-second route budget. A lease can make state honest after worker death, but cannot continue the dead provider stream.
2. **Current terminal writes are best effort after failure.** They are logged, but no independent reaper exists.
3. **Current Stop is local transport control.** A remounted client cannot target the detached run.
4. **Current message status has no freshness proof.** Trusting durable `streaming` directly would recreate zombies.
5. **Open WebUI's worker ownership is process-local.** Its UI pattern is reusable; its execution registry is not.
6. **LibreChat's exact replay model requires Redis and materially more code.**
7. **OpenHands does not persist token deltas.** This demonstrates that semantic durability and liveness can be polished without exact token replay.

## 10.2 Unanswered product questions

1. Is surviving serverless instance replacement a hard requirement, or is truthful interruption and recovery sufficient?
2. Can runs legitimately exceed the current 60-second route limit?
3. Should edit and regenerate be disabled during a background run, or should they explicitly supersede it?
4. Should every authenticated chat owner be able to Stop, or are there future collaborator roles?
5. What is the acceptable Stop-to-provider-abort latency for a remote tab?
6. How long may an approval remain pending before it expires?
7. Should an expired worker lease be presented as `failed`, `interrupted`, or a recoverable `unknown` state?
8. Is exact token-level replay after reload a product requirement, or is sub-second snapshot catch-up sufficient?
9. Should background reasoning duration continue from `startedAt`, `lastProgressAt`, or a persisted reasoning-start timestamp?
10. Should the sidebar expose `possibly-stale`, or silently clear its spinner and leave the detailed recovery state to the conversation?
11. What Convex connection-state signal is available or preferred for distinguishing offline cached data from a genuinely expired lease?
12. What snapshot and heartbeat frequency is acceptable at projected concurrent-run scale?

## 10.3 Residual technical risks

### Heartbeat cost

A 10-second heartbeat is modest per run but must be modeled at expected concurrency. Snapshot writes already update frequently during token output, so the heartbeat can be independent only during silent periods, or it can renew on every snapshot and use a lower-frequency timer as a backstop.

### Clock handling

Lease expiry should be computed by the server. Clients may compare the server timestamp with local time for presentation, but clock skew should have a small grace window. The durable reaper remains authoritative.

### Approval pauses

A worker lease should not make an intentionally paused approval look stale. Approval needs a separate expiry and continuation model.

### Immediate durable Stop versus confirmed provider cancellation

Marking the run terminal immediately is the safest UI and write-fencing behavior. The provider may consume tokens briefly until the worker heartbeat observes the terminal state. If the product requires confirmation that the provider socket closed, track that as an operational acknowledgment, not as the source of user-visible terminal truth.

### Terminal recovery cannot prove completion without a successful write

If every terminal mutation fails and the worker disappears, the reaper can guarantee "not active" but cannot safely infer `completed`. The honest recovery outcome is `failed` or `interrupted` with the last durable snapshot preserved.

### Schema migration

Adding required lease fields to existing runs needs a compatibility plan. Old terminal runs need no lease. Existing active-looking rows at deployment should be treated as stale unless explicitly backfilled with a safe deadline.

### Licensing

LibreChat and OpenHands are permissively licensed and their patterns can be adapted directly subject to normal notice obligations. Open WebUI, Dify, and LobeHub use custom or modified terms. Their patterns are useful conceptually, but direct code reuse requires license review.

# 11. Sources

## `not-a-wrapper`

- [Pinned repository commit](https://github.com/darknightdesigner/not-a-wrapper/commit/c65c0022aa94f225df6868a54c27530037b5a59e)
- [Dependencies and versions](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/package.json#L32-L60)
- [Chat API route](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/app/api/chat/route.ts#L22-L23)
- [Chat turn runtime](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/app/api/chat/chat-turn-runtime.ts#L808-L960)
- [Response consumption and finish path](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/app/api/chat/chat-turn-runtime.ts#L1356-L1408)
- [Durable snapshot runtime](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/app/api/chat/durable-turn-runtime.ts#L30-L176)
- [Snapshot tracker](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/app/api/chat/durable-turn-runtime.ts#L328-L456)
- [Durable prepare and terminal writes](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/app/api/chat/durable-turn-runtime.ts#L615-L1031)
- [Convex lifecycle, projection, and supersession](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/convex/chatRuntime.ts#L400-L612)
- [Convex prepare and snapshots](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/convex/chatRuntime.ts#L1154-L1428)
- [Convex terminal and approval paths](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/convex/chatRuntime.ts#L1429-L1668)
- [Generation lifecycle algebra](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/convex/domain/generation_run_lifecycle.ts)
- [Schema](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/convex/schema.ts#L69-L214)
- [Selected-path projection](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/lib/chat-store/turns/selected-path.ts)
- [`useChat` integration](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/app/components/chat/use-chat-core.ts#L203-L492)
- [Conversation status selection](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/app/components/chat/conversation.tsx#L153-L258)
- [Assistant turn phase algebra](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/lib/chat-messages/assistant-turn.ts#L253-L306)
- [Assistant Activity derivation](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/lib/chat-messages/assistant-activity.ts)
- [Activity panel selection](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/app/components/chat/use-activity-panel.ts#L91-L292)
- [Sidebar run projection](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/lib/chat-store/status/sidebar-chat-status.ts#L11-L205)
- [Apache-2.0 license](https://github.com/darknightdesigner/not-a-wrapper/blob/c65c0022aa94f225df6868a54c27530037b5a59e/LICENSE)

## LibreChat

- [Pinned repository commit](https://github.com/danny-avila/LibreChat/commit/4321f68f29a0c169cd683876c8b34a28d409eb9e)
- [Resumable SSE frontend](https://github.com/danny-avila/LibreChat/blob/4321f68f29a0c169cd683876c8b34a28d409eb9e/client/src/hooks/SSE/useResumableSSE.ts)
- [Reload resume hook](https://github.com/danny-avila/LibreChat/blob/4321f68f29a0c169cd683876c8b34a28d409eb9e/client/src/hooks/SSE/useResumeOnLoad.ts)
- [Agents stream, status, and abort routes](https://github.com/danny-avila/LibreChat/blob/4321f68f29a0c169cd683876c8b34a28d409eb9e/api/server/routes/agents/index.js)
- [Generation job manager](https://github.com/danny-avila/LibreChat/blob/4321f68f29a0c169cd683876c8b34a28d409eb9e/packages/api/src/stream/GenerationJobManager.ts)
- [Job store contract](https://github.com/danny-avila/LibreChat/blob/4321f68f29a0c169cd683876c8b34a28d409eb9e/packages/api/src/stream/interfaces/IJobStore.ts)
- [Redis job store](https://github.com/danny-avila/LibreChat/blob/4321f68f29a0c169cd683876c8b34a28d409eb9e/packages/api/src/stream/implementations/RedisJobStore.ts)
- [Redis event transport](https://github.com/danny-avila/LibreChat/blob/4321f68f29a0c169cd683876c8b34a28d409eb9e/packages/api/src/stream/implementations/RedisEventTransport.ts)
- [Stale-job reaping tests](https://github.com/danny-avila/LibreChat/blob/4321f68f29a0c169cd683876c8b34a28d409eb9e/packages/api/src/stream/__tests__/staleJobReaping.spec.ts)
- [MIT license](https://github.com/danny-avila/LibreChat/blob/4321f68f29a0c169cd683876c8b34a28d409eb9e/LICENSE)

## OpenHands Software Agent SDK

- [Pinned repository commit](https://github.com/OpenHands/software-agent-sdk/commit/e2b852c59b3f7a96fe0decde8d762a1ad7f0bc16)
- [Event service](https://github.com/OpenHands/software-agent-sdk/blob/e2b852c59b3f7a96fe0decde8d762a1ad7f0bc16/openhands-agent-server/openhands/agent_server/event_service.py)
- [Conversation lease and fencing](https://github.com/OpenHands/software-agent-sdk/blob/e2b852c59b3f7a96fe0decde8d762a1ad7f0bc16/openhands-agent-server/openhands/agent_server/conversation_lease.py)
- [WebSocket replay endpoint](https://github.com/OpenHands/software-agent-sdk/blob/e2b852c59b3f7a96fe0decde8d762a1ad7f0bc16/openhands-agent-server/openhands/agent_server/sockets.py)
- [Remote reconnect and reconciliation client](https://github.com/OpenHands/software-agent-sdk/blob/e2b852c59b3f7a96fe0decde8d762a1ad7f0bc16/openhands-sdk/openhands/sdk/conversation/impl/remote_conversation.py)
- [Lease tests](https://github.com/OpenHands/software-agent-sdk/blob/e2b852c59b3f7a96fe0decde8d762a1ad7f0bc16/tests/agent_server/test_conversation_lease.py)
- [Reconnect reconciliation commit](https://github.com/OpenHands/software-agent-sdk/commit/5115af7850f80a045acd8c12b01dcb1abdce2b42)
- [MIT license](https://github.com/OpenHands/software-agent-sdk/blob/e2b852c59b3f7a96fe0decde8d762a1ad7f0bc16/LICENSE)

## Open WebUI

- [Pinned repository commit and 0.10.2 release commit](https://github.com/open-webui/open-webui/commit/ecd48e2f718220a6400ecf49eafd4867a38feb10)
- [Background generation path](https://github.com/open-webui/open-webui/blob/ecd48e2f718220a6400ecf49eafd4867a38feb10/backend/open_webui/main.py)
- [Task registry and cross-instance cancellation](https://github.com/open-webui/open-webui/blob/ecd48e2f718220a6400ecf49eafd4867a38feb10/backend/open_webui/tasks.py)
- [Socket persistence and broadcast](https://github.com/open-webui/open-webui/blob/ecd48e2f718220a6400ecf49eafd4867a38feb10/backend/open_webui/socket/main.py)
- [Chat reload and task reconciliation](https://github.com/open-webui/open-webui/blob/ecd48e2f718220a6400ecf49eafd4867a38feb10/src/lib/components/chat/Chat.svelte)
- [Stop ownership fix](https://github.com/open-webui/open-webui/commit/e7ff4768f8ffe1924b4576381c9e45e8a64350e4)
- [Open WebUI License](https://github.com/open-webui/open-webui/blob/ecd48e2f718220a6400ecf49eafd4867a38feb10/LICENSE)

## Secondary repositories

- [Vercel Chatbot pinned commit](https://github.com/vercel/chatbot/commit/c2f8235e1f3ea903ad8b7f61447c4f74164b5c58)
- [Vercel Chatbot POST route](https://github.com/vercel/chatbot/blob/c2f8235e1f3ea903ad8b7f61447c4f74164b5c58/app/%28chat%29/api/chat/route.ts)
- [Vercel Chatbot current stream GET route](https://github.com/vercel/chatbot/blob/c2f8235e1f3ea903ad8b7f61447c4f74164b5c58/app/%28chat%29/api/chat/%5Bid%5D/stream/route.ts)
- [Vercel Chatbot resume PR #1486](https://github.com/vercel/chatbot/pull/1486)
- [Dify pinned repository](https://github.com/langgenius/dify/tree/40df83de660d19b17d9674821e82aa2bd4b61a49)
- [Dify base queue manager](https://github.com/langgenius/dify/blob/40df83de660d19b17d9674821e82aa2bd4b61a49/api/core/app/apps/base_app_queue_manager.py)
- [Dify task pipeline](https://github.com/langgenius/dify/blob/40df83de660d19b17d9674821e82aa2bd4b61a49/api/core/app/task_pipeline/based_generate_task_pipeline.py)
- [LobeHub pinned repository](https://github.com/lobehub/lobehub/tree/857d2a7dd74d777405791ad9d740dc879e1ae12c)
- [LobeHub reconnect hook](https://github.com/lobehub/lobehub/blob/857d2a7dd74d777405791ad9d740dc879e1ae12c/src/hooks/useGatewayReconnect.ts)
- [LobeHub gateway transport](https://github.com/lobehub/lobehub/blob/857d2a7dd74d777405791ad9d740dc879e1ae12c/src/store/chat/slices/agentRun/actions/transports/gateway/gateway.ts)
- [LobeHub gateway client](https://github.com/lobehub/lobehub/blob/857d2a7dd74d777405791ad9d740dc879e1ae12c/packages/agent-gateway-client/src/client.ts)
- [LangGraph Agent Chat UI pinned repository](https://github.com/langchain-ai/agent-chat-ui/tree/1cbd509d387b1e9602a80f05e638058b7543d7cc)
- [LangGraph Stream provider](https://github.com/langchain-ai/agent-chat-ui/blob/1cbd509d387b1e9602a80f05e638058b7543d7cc/src/providers/Stream.tsx)

## Official framework documentation

- [Convex React: reactive queries, consistency, and reconnect](https://docs.convex.dev/client/react/overview)
- [Convex Scheduled Functions](https://docs.convex.dev/scheduling/scheduled-functions)
- [Convex Cron Jobs](https://docs.convex.dev/scheduling/cron-jobs)
- [AI SDK Chatbot Message Persistence](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence)
- [AI SDK Chatbot Resume Streams](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-resume-streams)
