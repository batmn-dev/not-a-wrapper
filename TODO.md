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
- **Update Activity UX:** Make activity feel progressive in the chat thread.
  Currently all activity is logged in the right panel. Show thinking activity and
  intermediate text in the thread while keeping the full right-panel history
  available.
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
- **Evaluate Vercel's BotID:** Consider narrowly scoped bot attestation before
  expensive platform-funded generations.
- **Connectors:** Integrations with Google, YouTube, Figma, and personal tools
- **Agentic design system (future):** Define an agent-readable, customizable
  visual system after the product's core interaction patterns stabilize.
- **Persist the thread list across reloads (T3 Chat local-first follow-up):**
  the warm client query cache (ADR-0031) covers in-document revisits and
  sidebar hover/click preload; a reload still cold-loads the sidebar window and
  thread. Evaluate persisting the bounded chat list (and possibly the last
  selected path) so a reload paints from local state first, with the same
  before/after `nav_to_thread_painted` and reload-to-content measurements.
- **Investigate SSR composer shell fidelity (replicate T3 Chat):** t3.chat's
  server-rendered composer looks like the final one before hydration. Ours
  renders "5 Mini / Medium" in the shell and flips to the saved model and
  effort after preferences load, a visible flicker on every cold load. Plan:
  since the root layout already awaits the auth session, read the persisted
  model and effort preference server-side (or a cookie mirror of it) and pass
  it into the shell, or render neutral placeholders when no preference exists.
  Verifiable test: Playwright cold load before and after, sampling the model
  and effort button text every animation frame from first paint until network
  idle and counting label changes, plus CLS of the composer region and TTFB.
  Expected: zero label changes between first paint and hydration, no CLS
  contribution from the composer, and TTFB within 20 ms of the baseline.

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
- **Assistant responsiveness:** investigate and improve time to first token and
  text-streaming feel end to end. Measure TTFT through the chat-performance spans,
  check whether title usage delays terminal settlement, and re-verify perceived
  streaming smoothness in the browser.
