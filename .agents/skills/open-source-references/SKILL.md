---
name: open-source-references
description: Route research, evaluation, review, planning, and implementation to focused open-source reference implementations. Use when work concerns functionality upgrades, code review, system architecture evaluation, datamodel design, or any other feature upgrade.
---

Use this skill as a routing index. Use reference implementations to find proven patterns & system architecture, expose edge cases, and challenge an approach. Never recommend copying a pattern merely because another project uses it.

Keep the Convex and AI SDK skills authoritative for current first-party
guidance. Use these repositories as complementary implementation evidence.

For product behavior, interaction, or visual parity, inspect the user's
authenticated reference product named in the task first. Do not let an
open-source implementation override directly observed behavior.

Source paths are relative to this repository's root and point at sibling
checkouts, the same convention as `../reference-ui`. Prefer the local clone in
each entry when that directory exists. If it is missing, use the GitHub URL.

P0 means consult first for its matching surface. P1 is a strong specialist; P2 is narrow; P3 is forensic only.

## P0 — LibreChat

Source Path: `../LibreChat`

Github URL: https://github.com/danny-avila/LibreChat

**Use for:** Provider-neutral chat contracts: branching, resumable multi-device streams, steer/queue/HITL runs, artifact Canvas and conversational images, visible memory controls, MCP OAuth/per-user credentials/RBAC, and current-main’s leased, fenced scheduler.

**Avoid for:** Semantic memory, project knowledge, image-library UX or stack adoption. Memory is bounded key/value injection; Projects are conversation buckets; schedules are unreleased/default-off. Express/Mongo/Redis plus separate RAG and agent packages conflict with Wrapper’s architecture.

## P0 — LobeHub

Source Path: `../LobeHub`

Github URL: https://github.com/lobehub/lobehub

**Use for:** Broad product-shape reference: capability-aware model routing, dedicated image/video feeds, layered source-linked memory, agents/groups/pages/projects/workspaces, skill/MCP discovery, connector permissions and approvals, schedules, and desktop/mobile continuity.

**Avoid for:** V2 is a fast-moving Next/Vite/Drizzle/Postgres/Redis/S3/Upstash platform; hosted Marketplace, credential proxy, credits and cloud runtimes do not prove self-host parity.

## P0 — Open WebUI

Source Path: `../OpenWebUI`

Github URL: https://github.com/open-webui/open-webui

**Use for:** Broadest self-hosted parity flows: multi-provider chat/knowledge, editable automatic memory, OpenAI/Gemini/ComfyUI image creation/editing, MCP OAuth/OpenAPI tools, skills/subagents, recurring automations, voice, RBAC, analytics, Notes and Channels.

**Avoid for:** Persistence or extension foundations. Legacy whole-chat JSON still penalizes long branched histories; migrations carry debt; Python plugins are server-equivalent trusted code. Branding-preserving licensing and an administrator-provisioned MCP registry constrain branded derivatives and consumer-style connector installation.

## P0 — Hermes Agent

Source Path: `../hermes-agent`

Github URL: https://github.com/NousResearch/hermes-agent

**Use for:** Personal-agent continuity: curated profile memory plus session search, self-authoring skills with review, multi-channel identity, image generation/editing, and scheduled jobs with model/tool/skill selection, preflight checks, run ledger, chaining and delivery.

**Avoid for:** Shared tenancy or distributed scheduling. One Hermes home is effectively single-writer; the file-backed scheduler serializes some work and does not reliably reclaim abandoned runs. Approval and memory behavior vary across surfaces. Portal, Tool Gateway and Cloud are paid packaging, not reusable OSS internals.

## P0 — Vercel Chatbot

Source Path: `../VercelChatbot`

Github URL: https://github.com/vercel/chatbot

**Use for:** Wrapper-stack implementation patterns: typed AI SDK message/tool/reasoning parts, normalized persistence, attachments, sharing, approval continuation, streamed/versioned Artifact handlers and deterministic mock-model Playwright tests.

**Avoid for:** Product-parity requirements. It has no memory, knowledge workspace, connector catalog/OAuth, automation or governed BYOK. Gateway, Blob, Neon/Auth and Redis are template choices, while resumable streaming remains experimental and complicates explicit stop/abort semantics.

## P0 — Trigger.dev

Source Path: `../trigger.dev`

Github URL: https://github.com/triggerdotdev/trigger.dev

**Use for:** Durable TypeScript automation mechanics: user-scoped cron/delay CRUD, queues and concurrency, retries, dispatch idempotency, approval waitpoints, child/batch runs, realtime subscriptions, replay, tracing and deployment versioning.

**Avoid for:** Assistant reasoning, connectors or Tasks UX—and never equate trigger idempotency with exactly-once external side effects. Checkpoints, warm starts and autoscaling are cloud boundaries; production self-hosting is operationally heavy. Place it beneath Wrapper’s permissions, notifications, history and provider-level idempotency.

## P0 — Rakazo

Source Path: `../rakazo`

Github URL: https://github.com/elie222/rakazo

**Use for:** Grokbot control-plane architecture: persistent bot/thread/run schemas, provider-neutral sandboxes with portable workspace checkpoints, Team versus Private computers, screen leases/takeover, peer/subagent delegation, connector adapters, and cron/webhook routines shared across web, Electron and Expo.

**Avoid for:** Approval or production-cloud precedent. Computer and shell tools bypass approval rules; Team homes organize rather than isolate; semantic memory and connector catalogs depend on external services. The beta’s only tag trails main, while object-storage persistence and managed cloud remain unfinished.

## P1 — AnythingLLM

Source Path: `../AnythingLLM`

Github URL: https://github.com/Mintplex-Labs/anything-llm

**Use for:** Permissive local-first product patterns: document RAG/citations, workspace and user memory controls, model routing, tool-selecting agents, MCP/custom skills, no-code flows, image creation/editing, Electron/mobile continuity and scheduled-agent traces.

**Avoid for:** Multi-tenant automation, connector governance or isolated computer use. Schedules are single-user, host-bound and miss downtime; skills/MCP can execute host processes; mobile requires tool synchronization. Host control is a macOS/Claude beta and Open Computer remains unfinished. RAG quality depends heavily on model, embedding, chunking and context configuration.

## P1 — OpenBot

Source Path: `../OpenBot`

Github URL: https://github.com/CopilotKit/openbot

**Use for:** Enterprise action governance: AG-UI adapters, server-resolved targets, fail-closed CEL policy, audit-before-execute, encrypted credentials, per-bot tool/MCP grants, live takeover, isolated computers, delegated handoffs, and routines with owner-scoped permissions, caps and failure fatigue.

**Avoid for:** A complete assistant or vendor-neutral foundation. Durable threads/memory require licensed CopilotKit Intelligence; curated connectors are narrow; per-bot isolation needs Supervisor/Helm; UI-created remote agents cannot delegate. It lacks native desktop/mobile/images and remains alpha.

## P1 — OpenMausBot

Source Path: `../OpenMausBot`

Github URL: https://github.com/milind-soni/OpenMausBot

**Use for:** Grokbot’s desktop shell and harness: bots-as-contacts, normalized CLI events, per-bot models/computers/apps, live view/takeover, inline approvals, channels and team imports, routines, voice and paired-phone control.

**Avoid for:** Always-on or multi-tenant infrastructure and agent isolation. The app must remain awake; its loopback harness trusts the host user; installed CLIs inherit host privileges; computer, connectors and voice depend on CUA, Box, Composio and ElevenLabs. Cross-platform packaging remains young.

## P1 — Kortix / Suna

Source Path: `../suna`

Github URL: https://github.com/kortix-ai/suna

**Use for:** Enterprise agent governance where company state is code: Git-versioned agents, skills and memory; branch-per-session sandboxes; change-request approval; roles and resource grants; connector brokerage; computer tunnels; audit; and cron/webhook sessions.

**Avoid for:** Persistent teammate UX, semantic memory or a self-contained stack. Sessions auto-stop, memory is agent-edited files, OpenCode supplies the loop, and self-hosting still requires an external sandbox provider. Project secrets enter sandboxes by default, safer egress is experimental, and ELv2 forbids a competing managed service.

## P1 — T3 Code

Source Path: `../T3Code`

Github URL: https://github.com/pingdotgg/t3code

**Use for:** Local coding-harness control: provider-driver normalization, typed command/event projections and idempotent receipts, inline approval/interruption, Git-ref checkpoints/diff/revert, capability-scoped WebSocket RPC, authenticated remote pairing, and one client runtime across web, Electron and React Native.

**Avoid for:** Raw-model chat, memory, connectors, schedules or cloud workers. Authentication and permissions remain with installed CLIs; one long-lived host owns execution; provider/mobile/remote states can diverge. Copy its event store only when offline replay and exact rollback justify the complexity.

## P1 — QM

Source Path: `../QM`

Github URL: https://github.com/yc-software/qm

**Use for:** Organizational coworker tenancy: principal-to-scope resolution; private/shared scopes owning a computer, memory, keychain, skills and schedules; authorization floors; Slack/web identity continuity; harness adapters; and cron/watch/webhook jobs.

**Avoid for:** Consumer chat or hardened public SaaS. It requires operator-managed Postgres and sandbox infrastructure, while harness-neutral replay sacrifices provider-native behavior. Its security model documents bypassable command policy, plaintext in-use credentials, incomplete screening/egress enforcement, privileged administrator access and indefinite artifact retention.

## P1 — OpenDesign

Source Path: `../open-design`

Github URL: https://github.com/nexu-io/open-design

**Use for:** Artifact-first creative workflows: brief → `DESIGN.md` → skill/template → canonical files → sandboxed preview/critique/export; separate skill/template/design-system/plugin registries; normalized CLI/ACP adapters; and image, video, document and presentation task/library flows.

**Avoid for:** General assistant architecture or dependable export fidelity. External CLIs/models perform the reasoning; the local daemon is broad and heavy; users report generic output, high CPU, adapter churn, blank or mismatched PDF/PPTX and preview-capture failures. Borrow the contracts and retest every generator/exporter.

## P1 — Memoh

Source Path: `../Memoh`

Github URL: https://github.com/felinics/Memoh

**Use for:** Self-hosted multi-user/multi-bot operations: cross-channel identity and ACLs, private/group/bot-to-bot chat, persistent computer workspaces, source-linked graph memory, ACP-hosted Codex/Claude, MCP/connectors, schedules with run history, and bot backup/import.

**Avoid for:** Proprietary reuse or its isolation model. AGPL obligations apply, while the official server runs privileged with host PID and container access. Managed cloud is not live; setup/runtime-contract bugs recur; advertised Mem0/OpenViking adapters are currently disabled placeholders.

## P1 — Browser Use

Source Path: `../browser-use`

Github URL: https://github.com/browser-use/browser-use

**Use for:** Browser-agent mechanics when no structured API exists: CDP/tab lifecycle, enhanced DOM snapshots, stable element reconciliation, typed actions/results, scoped secret substitution, redacted histories, custom tools and watchdog recovery.

**Avoid for:** A production control plane or security boundary. Agents can loop, degrade, hit bot defenses or leak secrets through prompt injection. Enforce budgets, approvals, egress rules and checkpoints. Stealth, proxies, CAPTCHA handling, durable profiles and managed scale are cloud boundaries. Prefer MCP or APIs whenever equivalent structured actions exist.

## P1 — Cua

Source Path: `../cua`

Github URL: https://github.com/trycua/cua

**Use for:** Cross-OS computer contracts: Linux/macOS/Windows/Android sandbox lifecycle, exact-window screenshot/input/shell, focus-preserving Driver interfaces through MCP/CLI/SDK, manifest-bounded permissions, structured outcomes, trajectories and computer-use benchmarks.

**Avoid for:** Product orchestration or a uniform OS guarantee. Behavior remains app- and OS-specific: TCC/Spaces on macOS, signing/UWP/RDP/DPI on Windows, and incomplete Wayland capture/input. Treat Driver, Sandbox, Bench and Lume as separate references; pin and test every target-app/OS combination.

## P1 — E2B SDKs and CLI

Source Path: `../E2B`

Github URL: https://github.com/e2b-dev/e2b

**Use for:** Remote-sandbox client contracts: typed JS/Python lifecycle; templates, volumes, secrets and metadata; pause/auto-resume, snapshots and forks; commands/PTY/stdin/reattach; streamed files/watch/transfers; metrics/logs and service URLs.

**Avoid for:** Agent governance or Firecracker implementation—the latter lives in `e2b-dev/infra`, whose self-host path is an entire cloud platform. Do not assume idempotent creation, per-run resource overrides or seamless stream recovery after resume. Add Wrapper’s lifecycle state machine, authorization, cleanup and cost controls.

## P1 — OpenHands Agent Canvas

Source Path: `../OpenHands`

Github URL: https://github.com/OpenHands/OpenHands

**Use for:** Coding-agent control-center UX: conversation/terminal/browser/files panes, backend registry and switching, ACP onboarding, typed Agent Server access, runtime discovery, embeddable frontend modules, and schedule/webhook/run-history UI. Follow each seam into its owning sibling repository.

**Avoid for:** General chat, images, memory—or treating Canvas as the runtime. It is a React frontend over changing Python services; automation is beta; extensions and ACP bridges remain incomplete; direct-host mode exposes the filesystem; Docker and remote operation are heavier than the shell implies.

## P1 — Mem0

Source Path: `../mem0`

Github URL: https://github.com/mem0ai/mem0

**Use for:** A permissive baseline for scoped memory services: extraction configuration, semantic/BM25/entity retrieval, CRUD/history, expiration, filters, reranking, multimodal input, provider/vector adapters and self-hosted administration.

**Avoid for:** Canonical current truth. OSS v3 is ADD-first, so mutable facts and near-duplicates accumulate; temporal ranking, supersession, decay, consolidation, graph and organization audit are platform boundaries. Extraction quality varies by model and input. Add provenance, selective-storage gates, human review and deletion propagation yourself.

## P1 — Graphiti

Source Path: `../graphiti`

Github URL: https://github.com/getzep/graphiti

**Use for:** Temporal truth and provenance: source episodes, fact validity windows, contradiction invalidation, incremental graph updates, custom ontologies, hybrid semantic/BM25/graph retrieval and historical queries. Borrow its lifecycle when “what was true when, and according to which conversation?” matters.

**Avoid for:** Turnkey user memory, profile UX or cheap ingestion. You must build account/project controls and operate Python plus a graph database. Ingestion fans out many LLM calls, smaller models produce brittle schemas, and false invalidation is possible. Implement only the temporal concepts Wrapper genuinely needs.

## P2 — DeepSeek Harness

Source Path: `../deepseek-harness`

Github URL: https://github.com/deepseek-ai/deepseek-harness

**Use for:** Harness composition: reversible Cordis plugins, profile/bundle overlays, replaceable model/tool/session/loop/filesystem/sandbox providers, interception waterfalls, and one model-visible event stream driving replay, resume, forks and ACP/SDK/web surfaces.

**Avoid for:** Product parity or production control. It is an unaudited developer preview; plugin/config breadth adds setup and token overhead; persisted custom events can strand sessions; and its sandbox does not contain networking, processes, plugins or allowed assets. Borrow seams, not the foundation.

## P2 — E2B Desktop

Source Path: `../desktop`

Github URL: https://github.com/e2b-dev/desktop

**Use for:** Minimal cloud-Linux computer transport: reproducible Xfce template, app launch, screenshots, coordinate input, files/shell, and whole-desktop or window-specific noVNC viewing with view-only/auth options. It clearly demonstrates the sandbox-to-human-takeover seam.

**Avoid for:** Grokbot architecture or a trusted control surface. It is Linux/X11 `xdotool`, `scrot` and noVNC; supports one stream; lacks accessibility grounding, verified actions, approvals and multi-viewer control; and makes authentication optional. Current SDK source lives in the core E2B repository.

## P2 — Hugging Face Chat UI

Source Path: `../HuggingChat`

Github URL: https://github.com/huggingface/chat-ui

**Use for:** Lean Apache Svelte interaction components: response alternatives, model switching, reasoning effort, plans, tool progress/errors/elicitation, attachments, image annotation, voice, sharing, heuristic multimodal/agentic routing and MCP health checks.

**Avoid for:** Full assistant architecture or assuming repository parity with hosted HuggingChat. Current main removed provider-native integrations, embeddings and web search; it lacks memory, knowledge workspaces, image generation/editing and automations. Pin main versus legacy; hosted models, quotas and availability are not repository behavior.

## P2 — Supermemory

Source Path: `../supermemory`

Github URL: https://github.com/supermemoryai/supermemory

**Use for:** Vercel AI SDK memory middleware and product UX: static/dynamic profile injection, bounded fail-open retrieval, hybrid RAG-plus-memory context, source visibility, conversational save/search/forget, review, approval and undo.

**Avoid for:** Memory-engine implementation or production self-hosting. The repository exposes clients and UI while the local server is a prebuilt binary; hosted models/connectors differ. Open issues document missing governance/idempotency, similarity-based deletion, memory-heavy snapshots, wedged ingestion and concurrency failures. Use Mem0/Graphiti for inspectable internals.

## P2 — Letta Code

Source Path: `../letta-code`

Github URL: https://github.com/letta-ai/letta-code

**Use for:** Agent-authored identity and long-horizon learning: editable memory files, Git-tracked history, diffs/rollback, active/archive tiers, periodic reflection in isolated worktrees, and memory inspection/health UX. It is especially relevant to persistent desktop teammates.

**Avoid for:** ChatGPT-style factual memory or passive personalization. The agent edits prose instead of reconciling atomic temporal facts; source-turn lineage is weak; quality depends on reflection-model judgment; memory is agent-scoped unless deliberately shared; and cross-device identity/conversations rely on Letta Cloud. Do not route to retired Letta V1.

## P3 — Grok Bot 0.18 reconstructed

Source Path: `../grok-bot-0.18-reconstructed`

Github URL: https://github.com/b-nnett/grok-bot-0.18-reconstructed

**Use for:** Forensic comparison of Grok Bot 0.18’s Electron/preload RPC, host/coordinator, turn events, plugin/MCP and remote-box boundaries, plus its experimental provider router and local-Docker replacement.

**Avoid for:** Implementation, UI source or current product truth. This archived two-commit hybrid preserves a minified upstream renderer and installers, has no asserted upstream source license, only partially reconstructs the frontend, retains known dependency advisories and targets one pinned Apple-silicon release.
