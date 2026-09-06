# To Do

- **Model presentation: Improve how models display across the UI**
  - Make model logos appear during thinking states to make assistant output ownership clear
- **Per-turn effort, platform-funded UX (ADR-0026 v1 follow-up):** two accepted
  nuances to review and tackle: (1) platform-funded turns silently run at the
  provider default even when the resolved route supports the requested level —
  requested and the concrete provider default are both recorded so the badge and
  reopened composer stay honest, but the composer gives no hint before sending.
  Decide between surfacing an affordance ("effort applies on your own key / paid
  usage") and implementing effort-scaled reservations. (2) An effort
  selection can steer resolution off a platform-entitled route onto the user's
  own BYOK key when only that route serves the level — capability-correct, but
  it silently shifts cost onto the user's key; decide whether that needs
  disclosure in the composer or a funding-tier preference in the resolver.
- **Web Search modes and quantity controls:** Think through how the Composer
should expose an **Always** option that lets users force `web_search`, alongside
the existing Off and Auto behavior where the model decides whether to search.
Research and implement the multiple search-quantity controls exposed by
t3.chat, including their interaction model and request-level mapping.
- **Progressive Activity UX:** Inline thinking/status exists. Add progressive
reasoning and intermediate text in the thread; retain full Activity-panel history.
- **Chat composer text editing:** Add chat composer text / markdown editing (link, bold, italic, headings, etc...)
- **Dictation:** Add chat-composer dictation
- **Image generation:** Nano banna and state of the art image gen tools (Using Vercel's SDK Framework)
- **Video generation:** Using Vercel's SDK framework
- **Admin Portal:** A way to manage users, controls, features, etc...
- **Automatic conversation context management:** replace the current
context-limit hard stop with model-aware input budgeting that reserves space
for instructions, tool schemas, attachments, and output. Before the selected
path exceeds its budget, derive a versioned summary checkpoint for older
completed turns while retaining recent turns verbatim and preserving the full
canonical transcript, branch/edit/regeneration semantics, tool outcomes, and
source provenance. Make compaction idempotent, observable, and visible to the
user; fall back to an explicit hard stop when safe compaction cannot fit. Cover
authenticated and guest chats, model switches, attachments, and multi-step
tool turns with cross-provider tests and token/compaction telemetry.
- **Durable long-running generations:** design and implement provider execution
outside the lifetime of the initiating HTTP request so deep research and long
reasoning turns are not stopped by Vercel's function-duration ceiling. Preserve
live Convex snapshots, user Stop and supersession behavior, authorization,
concurrency ownership, usage and allowance settlement, recovery, and terminal
state correctness. Replace the total provider deadline and its settlement
reserve/watchdog coupling with durable worker ownership and, if needed, a true
stream-inactivity safeguard. Review the architecture against current ADRs and
open-source reference chat apps, then document the final decision in an ADR.
- **Project-scoped agent context:** let each project define shared instructions,
knowledge and files, tool or connector permissions, and optional durable
memory that are automatically available to every chat in that project, similar
to project-scoped contexts in modern AI chat products. Make context precedence,
token budgeting, provenance, access control, versioning, and user-visible
reset or opt-out behavior explicit so project chats remain reproducible and
do not leak context across project boundaries.
- **Voice Mode:** Using Eleven Labs
- **Assistant Response UI Widgets:** Image Carousels, Image Previews, Weather, Stock UI, Charts (maybe), editable markdown (maybe)
- **Monetization:** Setup Usage-based monthly pricing using Stripe or better option
- **Agent-first file library:** Create a computer-like environment where agents can easily discover files?
- **Evaluate Next.js to TanStack migration:** From [Theo's post](https://x.com/theo/status/1997406196660400228?lang=en)
- **Evaluate inference on Fluid:** From [Theo's post](https://x.com/theo/status/1997784385337372877)
- **Retained-stream admission:** Before multi-user rollout, bound concurrent
replay readers per user across instances and measure Redis command/connection
usage. Reuse existing admission patterns; preserve refresh and multi-tab recovery.
- **Evaluate Vercel's BotID:** Consider narrowly scoped bot attestation before
expensive platform-funded generations.
- **Connectors:** Integrations with Google, YouTube, Figma, and personal tools
- **Agentic design system (future):** Define an agent-readable, customizable
visual system after the product's core interaction patterns stabilize.
- **Thread code splitting:** Shared lazy Markdown and Composer intent warming
are implemented. Attribute and defer charts/composer extras, audit client Zod,
and split remaining thread-only code. Verify cold `/` JS bytes, requests, typing
latency, and first-text timing in the browser. Target: ≥250 KB Brotli reduction
from the 2026-08-31 baseline, no first-text regression or new first-send long task.
Existing script-size evidence is not browser validation; see
`docs/performance/2026-09-05-interaction-optimizations.md`.
- **Warm chat navigation:** Bounded query caching, hover/click warming, and
`SUITE=thread-switch` shipped (ADR-0031). Reach one-frame revisited navigation
and evaluate thread-list persistence across reloads. Verify visited/unvisited
p50/p95 paint times, subscriptions per switch, and memory after 50 switches;
keep unvisited navigation no slower and memory bounded.
- **Investigate visibility-gated chat hydration (replicate T3 Chat):** observed
on 2026-09-02 while benchmarking against t3.chat: their chat client does not
finish hydrating while `document.visibilityState` is `hidden`. The composer
stays a disabled server-rendered shell (send button disabled, model picker
reads "Loading…", no React props on the textarea) until the tab is actually
shown, then boots normally; our app hydrates and streams fully in a hidden
tab. Plan: confirm what they gate (hydration itself, the model catalog and
sync-engine boot, or both), then prototype a `visibilitychange`-deferred boot
for the chat surface behind an env escape hatch so the harness and hidden-tab
automation keep working. Verifiable test: open the app in five background
tabs before and after and record, until the first time each tab is shown,
renderer CPU time and memory (Chrome task manager or
`performance.measureUserAgentSpecificMemory`), bytes transferred, and open
Convex subscriptions; then show a tab and measure time from visible to a
working composer. Expected: near-zero subscriptions and chat JS execution
while hidden, and a composer that accepts input within 500 ms of becoming
visible.
- **Evaluate effort-level naming: API accuracy vs provider-interface parity:**
the composer's effort menu labels are the wire values spelled out
(`lib/reasoning-effort.ts`: `none` → "Off", `xhigh` → "Extra High", `max` →
"Max"), which ADR-0026 chose as "the honest provider-level names, not invented
tiers". The providers' own products do not use those words: T3 Chat and
ChatGPT show "Instant" for OpenAI's `none`, Anthropic's console groups
`output_config.effort`, and xAI/Google expose their own scales. Decide, per
level and per provider, whether the label should track the API value (stable,
greppable, matches docs and the request-shaping code, but "Off" next to a
model that still reasons a little is misleading and "Extra High/Max" read as
invented) or the provider's consumer-facing name (recognizable to users coming
from ChatGPT/T3, but a single label table then lies for other providers that
share the wire value, e.g. Grok 4.3's `none`, and names drift with each
provider's marketing). Options to weigh: keep API names; per-provider label
overrides in the catalog (ADR-0020 discipline: a route fact, not a UI
constant); or API name as the primary label with the provider's word as
secondary text or tooltip. Verifiable test: a five-person label-comprehension
check with the three benchmark models (which option makes users pick the
level they intended for "fastest reply" and "deepest reasoning"), plus a
catalog test asserting every declared `effortLevels` value has a label per
provider so no route can render a wrong or missing word. Expected outcome: a
short ADR-0026 amendment recording the rule and the label source of truth.



## Dependency watch

- **AI SDK stable approval-persistence hook:** retain the Durable turn runtime's
`experimental_transform` while it is the only released pre-callback,
backpressure-preserving seam for persisting approval requests before forwarding
them. Exit when a stable released API preserves ordering, abort propagation,
multi-step behavior, and approval-settle -> snapshot-flush -> terminal-write
ordering without moving durable ownership out of ADR-0009.
- **Research and implement Anthropic** `pause_turn` **continuation:** check the
  latest AI SDK and Anthropic provider behavior against Anthropic's replay
  contract, and measure production incidence by model and search configuration.
  If no released SDK fix exists, build a provider-boundary continuation adapter
  that replays paused assistant content with the same tools, bounded
  continuation, abort propagation, deduplicated parts, and exact aggregate
  usage. Until those guarantees are tested, retain the catalog-scoped
  fixed-thinking search workaround only for Claude 4.6 models that still accept
  `budget_tokens`; never apply it to adaptive-only models. Remove
  `searchThinkingDowngrade` after the continuation path is proven.
- **Signed tool approvals:** defer `experimental_toolApprovalSecret` until the
coherent AI SDK patch line preserves signatures end to end and the deployment
has a shared-secret, unsigned-pending-approval, and rotation strategy. Reassess
adoption when the API is stable or the application begins trusting
noncanonical client history. Do not introduce application-owned signing while
Convex remains the canonical authenticated approval authority without a
demonstrated threat gap.



## Correctness and maintenance

- **Document nuanced motion-performance exceptions:** update the front-end
guidance to distinguish the default prohibition on continuously repainting
animations from narrowly approved, behavior-critical exceptions. Require a
bounded live-state lifecycle, reduced-motion fallback, and measured profiling
before assigning severity or changing established behavior; prefer a
compositor-friendly equivalent when it preserves the same interaction and
visual result.
- **Routine compatible dependency refresh:** update the remaining compatible
patch and minor releases, including React, Sentry, Braintrust, PostHog,
WorkOS, TanStack Query, Shiki, Base UI, React Hook Form, Tailwind, Vitest, and
Prettier. Update the declared package manager from `bun@1.3.1` to
`bun@1.3.14`, refresh safe transitive dependencies such as `undici`, rerun the
dependency audit, and validate with the normal project checks.
- **Staged major dependency upgrades:** evaluate TypeScript 6 before TypeScript
7 and wait for compatible compiler-API tooling; keep `@types/node` aligned
with the supported runtime; defer jsdom 30 until the Node engine floor is
compatible; and handle ESLint 10, Motion 13, and Recharts 3.10 as separate,
focused upgrades with migration-specific lint, animation, and visual checks.
- **Assistant responsiveness:** Rendering optimizations shipped; end-to-end
responsiveness remains open. Measure TTFT with chat-performance spans, quantify
the platform-funded title-usage wait before settlement, and verify streaming
smoothness in the browser.
- **Burst responses after ~10 s (benchmark finding 1):** in the 2026-09-02
comparison (`docs/performance/2026-09-02-ttft-tps-vs-t3-chat.md`) five of 27
production turns on Claude Haiku 4.5 and GLM-5.3 arrived as one burst: SDK
time-to-first-output of 10.1–13.4 s followed by an output window under 260 ms
and 7–13 SSE chunks, which also inflates the Generation stats rate to
300–4,272 tok/s. T3 Chat's GLM never showed it. Investigate whether a ~10 s
timeout or fallback sits in the provider, OpenRouter routing, the AI gateway,
or our own request options (retries, `abortSignal`, provider fallback), and
whether Anthropic thinking and OpenRouter reasoning share a cause.
*Measure first:* query the Run timing receipt (ADR-0030) on production runs
for `providerFirstOutputMs > 8000` joined with `modelResponseMs −
providerFirstOutputMs < 500`, bucketed by route, provider, and reasoning
setting, to get the real incidence and confirm it is provider-side (receipt
segments) rather than pacing (which sits after the SDK clock). Add a
`bench:browser` recipe that reproduces the burst shape with a deterministic
delayed-stream script so the detection is testable offline.
*Verify a fix:* the incidence query drops to zero over at least 50 production
turns per affected route, the deterministic reproduction streams normally, and
the stats line rejects sub-second windows on multi-hundred-token replies
(rate hidden or flagged, never 4,000 tok/s). Land only with the before/after
query results attached to the PR.
- **0.5–2.3 s before the stream headers (benchmark finding 3):** between the
client's `/api/chat` request leaving and the `start` chunk arriving we spend
0.5–2.3 s on 26 of 27 runs (Luna P1 runs: 2.2, 2.3, 0.8 s; the one excluded
GLM P3 burst run took 2.7 s), plus a serial `/api/rate-limits`
round trip and 0.3–0.7 s of client work before the request even leaves. T3
Chat spends its overhead before the request instead (~0.9 s) and then returns
headers in 0.0–0.9 s. This segment is ours under ADR-0030 (the receipt's
`prepareMs`: HTTP receipt → provider dispatch, plus whatever Vercel adds
before the handler runs) and is the entire Luna P1 gap. Attribute it across auth,
admission proof, allowance reservation, Convex `createWithFirstTurn`, model
resolution, and any awaited title or telemetry work, and check whether the
rate-limit call can be folded into the turn request. *Measure first:* pull
`prepareMs` (and `firstWriteDelayMs`, to confirm the post-first-output side
is not the culprit) from the receipt for the last week by route and cold/warm
function instance, and add a browser-side span from click to headers to the
`bench:browser` harness so both halves are gated.
*Verify a fix:* p50 `prepareMs` on warm instances under 400 ms and
p95 under 1 s in the weekly benchmark gate table, the rate-limit round trip
gone from the pre-request waterfall, and a same-day A/B rerun of Luna P1
against main showing the send→first-text-chunk median at or below T3's
(2.97 s in this session, from the single T3 Luna P1 run timed at the chunk)
before merging.
