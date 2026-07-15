# To Do

- **Better in-progress conversation view:** persist and surface active progress
  when a user leaves and returns to a streaming chat.
- **Fix orphaned completed chat turns:** prevent expired request auth from losing
  answers, leaving runs streaming, or showing false success; follow the
  [incident remediation plan](docs/chat-turn-token-expiry-orphaned-run-incident-2026-07-14.md).
- **Remember conversation scroll position:** restore each chat thread to its
  previous scroll position when navigating away and returning.
- **Assistant message highlighting:** When highlighting text from an asssitant response, add a clear "Add to chat" button that adds it to the chat composer.
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
- **Add chat-composer dictation**
- **Voice Mode:** Using Eleven Labs
- **Image generation:** Nano banna and state of the art image gen tools (Using Vercel's SDK Framework)
- **Video generation:** Using Vercel's SDK framework
- **Assistant Response UI Widgets:** Image Carousels, Image Previews, Weather, Stock UI, Charts (maybe), editable markdown (maybe)
- **Monetization:** Setup Usage-based monthly pricing using Stripe or better option
- **Admin Portal:** A way to manage users, controls, features, etc...
- **Agent-first file library:** Create a computer-like environment where agents can easily discover files?
- **Connectors:** Integrations with Google, YouTube, Figma, and personal tools
- **Agentic Design System:** A customizable design system that helps agents ship consistent and high quality UI
- **AI SDK stable approval-persistence hook:** retain the Durable turn runtime's
  `experimental_transform` while it is the only released pre-callback,
  backpressure-preserving seam for persisting approval requests before forwarding
  them. Exit when a stable released API preserves ordering, abort propagation,
  multi-step behavior, and approval-settle -> snapshot-flush -> terminal-write
  ordering without moving durable ownership out of ADR-0009.
- **Anthropic `pause_turn` continuation:** retain the catalog-scoped fixed-thinking
  search workaround only for Claude 4.6 models that still accept `budget_tokens`;
  never apply it to adaptive-only models. Measure production incidence of raw
  `pause_turn` by model and search configuration before changing terminal
  semantics. Exit when a released AI SDK or Anthropic provider correctly replays
  paused assistant content with the same tools, bounded continuation, abort
  propagation, deduplicated parts, and exact aggregate usage—or after a fully
  tested provider-specific continuation adapter provides those guarantees.
- **Signed tool approvals:** defer `experimental_toolApprovalSecret` until the
  coherent AI SDK patch line preserves signatures end to end and the deployment
  has a shared-secret, unsigned-pending-approval, and rotation strategy. Reassess
  adoption when the API is stable or the application begins trusting
  noncanonical client history. Do not introduce application-owned signing while
  Convex remains the canonical authenticated approval authority without a
  demonstrated threat gap.
- **Edit/regeneration freshness:** replace the selected-message count proxy with
  a server-issued revision or equivalent identity-bearing token. Verify that a
  rapid regenerate → branch-switch → send → regenerate sequence cannot
  falsely reject a subsequent in-session edit as stale.
- **Exa verification:** after saving a valid BYOK Exa key, verify one search turn
  and one `extract_content` turn. The current stored key was rejected by Exa.
- **Model presentation:** centralize route labels and icon precedence currently
  duplicated across model selectors and settings.
