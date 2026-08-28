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
- **Update Activity UX:** Make activity appear more progressive like ChatGPT, Claude and other modern AI chat platforms. Currently all activity get's logged into the right panel. However, modern AI chat apps show thinking activity, some text below it, more activty, etc... We should still be able to see the right panel, we just need to update our UX in the chat thread view itself.
- **Chat composer text editing:** Add chat composer text / markdown editing (link, bold, italic, headings, etc...)
- **Dictation:** Add chat-composer dictation
- **Image generation:** Nano banna and state of the art image gen tools (Using Vercel's SDK Framework)
- **Video generation:** Using Vercel's SDK framework
- **Admin Portal:** A way to manage users, controls, features, etc...
- **Dynamic Activity-panel source presentation:** adapt each source item to the
metadata available instead of forcing every source into one fixed layout.
Prefer a readable headline when available; include useful supporting details
such as a publication date or description when provided; and fall back to the
URL when richer metadata is missing.
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
- **Project-scoped agent context:** let each project define shared instructions,
knowledge and files, tool or connector permissions, and optional durable
memory that are automatically available to every chat in that project,
similar to ChatGPT Projects and Claude Projects. Make context precedence,
token budgeting, provenance, access control, versioning, and user-visible
reset or opt-out behavior explicit so project chats remain reproducible and
do not leak context across project boundaries.
- **Voice Mode:** Using Eleven Labs
- **Assistant Response UI Widgets:** Image Carousels, Image Previews, Weather, Stock UI, Charts (maybe), editable markdown (maybe)
- **Monetization:** Setup Usage-based monthly pricing using Stripe or better option
- **Agent-first file library:** Create a computer-like environment where agents can easily discover files?
- **Connectors:** Integrations with Google, YouTube, Figma, and personal tools
- **Agentic design system (future):** Define an agent-readable, customizable
visual system after the product's core interaction patterns stabilize.



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

- **Stopped turns are billed the full reserved estimate:** a user Stop before
any step usage is captured settles with
`settlementBasis: "estimated_after_unknown_usage"`, charging the entire
reservation — measured ~18.6k credits for a ~5-second stopped turn (this is
how the perf-harness user exhausted a 1M-credit allowance mid-suite; see
`docs/performance/2026-08-28-experiment-2-reactive-read-split.md`, finding 2).
Investigate fully and resolve: trace where the abort path loses (or never
receives) provider usage for the partial stream, decide the product policy for
usage-unknown aborts (charge actuals when recoverable; otherwise a bounded
floor or time/output-proportional estimate rather than the full reservation),
and implement it within ADR-0011's settle-never-rejects and ADR-0021's
reserve-then-settle contracts. Add a regression test that a first-beat Stop
settles for far less than the full estimate.
- ~~**Intermittent live-stream adoption loss after the first durable send's
hard navigation**~~ — RESOLVED 2026-08-28: root cause was NOT the ADR-0013
binding machinery (adoption succeeded every time) but the route structure —
both `(chat)` page segments rendered their own `<Chat/>`, and when the router
intermittently committed the `/c/[chatId]` segment 30–90ms after the shallow
pushState handoff, the page-subtree swap remounted Chat and orphaned the live
binding. Fixed by mounting `<Chat/>` in the persistent `(chat)/layout.tsx`
(pages render null, keep the /c auth redirect); verified 0/90 losses post-fix
vs ~7% before, and `liveStreamNotAdoptedRuns > 0` now FAILS the harness
scenario as the regression gate. Full forensics:
`docs/performance/2026-08-28-adoption-loss-root-cause.md`. Known residual
(small, separate): a project-originated first send crosses from `/p/[projectId]`
into the `(chat)` layout, which still remounts Chat if the router commits
mid-stream — same class, different layout boundary; fix when project first
sends matter.

- **Document nuanced motion-performance exceptions:** update the front-end
guidance to distinguish the default prohibition on continuously repainting
animations from narrowly approved, behavior-critical exceptions. Require a
bounded live-state lifecycle, reduced-motion fallback, and measured profiling
before assigning severity or changing established behavior; prefer a
compositor-friendly equivalent when it preserves the same interaction and
visual result.
- **Retired Google title model:** `selectChatTitleModelConfig` picks the cheapest
visible same-provider model, which for Google is `gemini-2.5-flash-lite`; Google
now returns 404 "no longer available to new users" for it, so every new Gemini
chat stays titled "New chat" (`chat_title_generation_failed`, AI_APICallError).
Mark the retired 2.5 Flash models non-visible in the Google catalog (Google
points at `gemini-3.5-flash-lite`) and make title selection skip models the
provider has retired.
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
- **Assistant responsiveness:** investigate and improve time to first token and
text-streaming feel end to end. Known suspects are catalogued in
`docs/streaming-regression-suspects-2026-08-20.md`: the platform
`maxOutputTokens` cap (no reasoning headroom for OpenAI/Google), route
flapping incl. first-turn local chat ids skipping the platform tier,
sequential Convex roundtrips on the admission critical path
(reserve/getKeySettings/getUserKey), and settle waiting on title usage.
Beyond fixing those, look for anything else that makes responses feel fast:
parallelize admission reads, measure TTFT via the chat-perf spans, and
re-verify perceived streaming smoothness in the browser.
