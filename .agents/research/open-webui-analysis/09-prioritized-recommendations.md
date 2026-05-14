# Synthesis: Prioritized Recommendations for Not A Wrapper

> **Agent**: Synthesis Agent (Agent 9)
> **Phase**: 3 (Sequential)
> **Status**: Complete
> **Depends On**: `01-architecture-code-quality.md`, `02-ai-engine-tools.md`, `02b-tool-infrastructure.md`, `03-data-layer-scalability.md`, `04-ux-features-extensibility.md`
> **Date**: February 12, 2026

> **Input Gate Note**: Phase 2 comparison docs (05-08) remain in template form — Phase 2 agents were not executed. This synthesis draws directly from the **five completed Phase 1 documents** (01, 02, 02b, 03, 04), which all pass the Phase 1.5 normalization gate: each contains a completed evidence table, confidence labels, uncertainty/falsification sections, and 5 adopt/adapt/skip previews tied to evidence IDs. Additionally cross-referenced: `competitive-feature-analysis.md` (Feb 6–7, 2026) and five existing implementation plans in `.agents/plans/`.

> **Conflict Resolution Protocol**: Since Phase 2 agents did not produce conflict ledgers, conflicts were identified by comparing recommendation previews across Phase 1 docs. Resolution uses: (1) alignment with "universal AI interface" positioning, (2) evidence strength (claim count × confidence), (3) stack fit for NaW's serverless TypeScript architecture.

---

## Summary

This synthesis distills **80 evidence claims** across 5 Phase 1 analysis documents and **25 recommendation previews** into a ranked, actionable roadmap. The dominant finding is that Open WebUI's **breadth-over-depth strategy is the wrong model for NaW** — their 56+ backends, 100+ env vars, and unsandboxed plugin system create maintenance burden that undermines reliability. NaW should instead pursue **depth over breadth**: fewer integrations, each polished to production quality, leveraging structural advantages (end-to-end TypeScript, Convex real-time, Vercel AI SDK multi-provider, managed auth via Clerk). The top three immediate actions are: **(1)** implement the tool calling infrastructure plan with built-in tool conditional injection, **(2)** adopt inline trigger characters (`#`, `/`, `@`) for discoverability, and **(3)** implement cross-conversation memory using Convex's unified document + vector search model with model-callable tools. All 5 existing implementation plans are **confirmed** by this research; the memory plan receives enrichment from Open WebUI's dual-storage + tool exposure pattern.

## Evidence Intake Summary (Required)

| Source Doc | # Key Claims Used | # High Confidence | # Medium Confidence | # Low Confidence | Notes |
|------------|-------------------|-------------------|---------------------|------------------|-------|
| `01-architecture-code-quality.md` | 13 (A1-C01 – A1-C13) | 13 | 0 | 0 | All claims code-sourced; strongest evidence base. 5 recommendations preview. |
| `02-ai-engine-tools.md` | 15 (A2A-C01 – A2A-C15) | 14 | 1 (A2A-C13) | 0 | Middleware monolith analysis strongest; arena adoption uncertain. 5 recs. |
| `02b-tool-infrastructure.md` | 14 (A2B-C01 – A2B-C14) | 14 | 0 | 0 | Security concerns (exec/pip) highest-impact findings. 5 recs. |
| `03-data-layer-scalability.md` | 18 (A3-C01 – A3-C18) | 16 | 2 (A3-C13, A3-C14) | 0 | Most claims Not Comparable to NaW stack; observability gap confirmed. 5 recs. |
| `04-ux-features-extensibility.md` | 20 (A4-C01 – A4-C20) | 18 | 2 (A4-C13, A4-C16) | 0 | Community/governance claims strongest; performance claims user-reported. 5 recs. |
| **Totals** | **80** | **75 (94%)** | **5 (6%)** | **0** | High-confidence base. Phase 1.5 gate: PASS for all 5 docs. |

### Evidence Quality Assessment

- **94% high-confidence claims**: Evidence base is exceptionally strong — all sourced from direct code examination of Open WebUI v0.7.2.
- **No low-confidence claims**: All uncertain assertions (performance, adoption) are explicitly marked with falsification criteria in source docs.
- **Comparability breakdown**: ~40% Directly Comparable, ~35% Conditionally Comparable, ~25% Not Comparable. The Not Comparable claims (self-hosted infra, Python runtime, persistent process) are correctly excluded from feature recommendations.
- **Missing evidence**: No benchmark data exists for either system (A3-C13); arena system adoption is unknown (A2A-C09 uncertainty); i18n translation quality unverified (A4-C08 uncertainty).

---

## 1. Strategic Assessment

### 1.1 Where NaW Has Structural Advantages

| Advantage | Why It Matters | Evidence |
|-----------|---------------|----------|
| **End-to-end TypeScript** | Shared types across frontend/backend/DB eliminate Python↔TypeScript boundary bugs. OWUI has separate Pydantic/TypeScript models that can drift. | A1-C09, A1-C01 |
| **Vercel AI SDK multi-provider** | Native SDK support for 10+ providers with type-safe structured outputs, tool calling, reasoning. OWUI's proxy approach loses SDK features and requires format conversion. | A2A-C01, A2A-C02, A2A-C04 |
| **Convex real-time** | Automatic reactive subscriptions replace OWUI's manual socket.io + Redis pub/sub. Zero-config real-time at any scale. | A3-C04, A3-C06, A3-C07 |
| **Convex unified storage** | Single database provides documents + vector search + file storage. OWUI needs SQL + 11 vector DB backends + 4 file storage backends. | A3-C01, A3-C05, A3-C08 |
| **Managed auth (Clerk)** | MFA, session management, token revocation, OAuth out of the box. OWUI's custom 7-method auth stack (A1-C06) is a massive maintenance surface with security gaps (A1-C12). | A1-C06, A1-C12 |
| **Serverless auto-scaling** | Vercel scales to zero and up automatically. OWUI requires manual uvicorn worker tuning, Redis for multi-worker, no benchmark data for capacity (A3-C13). | A3-C12, A3-C13 |
| **BYOK encryption (AES-256-GCM)** | OWUI stores API keys as plaintext arrays in server memory. NaW encrypts per-provider. | A2A (Security Concern section) |
| **CI/CD quality gates** | NaW enforces lint + typecheck. OWUI has **disabled** lint, test, and integration CI workflows (A1-C04, A1-C05). | A1-C04, A1-C05, A1-C13 |

**Key insight**: NaW's advantages are *architectural* — they compound over time and are hard for OWUI to replicate without fundamental rewrite. Proposed changes must not erode these.

### 1.2 Where NaW Has Structural Disadvantages

| Disadvantage | Impact | Fixable? | Evidence |
|-------------|--------|----------|----------|
| **No persistent backend process** | Cannot run stdio MCP, local model inference, persistent WebSocket connections, or long-running background jobs. | Inherent trade-off — mitigate via SSE-only MCP, cloud APIs, Convex scheduled functions | A2A-C01, A2B-C05, A3-C06 |
| **No Python ML ecosystem** | Cannot run local Whisper, sentence-transformers, Pyodide, or local image generation models. | Inherent trade-off — use API-based alternatives (cloud STT/TTS, API embeddings). Convex vector search covers embedding needs. | A2B-C11, A2A-C09 |
| **Feature breadth gap** | OWUI has ~40+ features NaW lacks: tool calling, RAG, memories, code execution, image gen, audio, channels, notes, arena, prompt library, i18n, PWA, etc. | Fixable incrementally — prioritize by "universal AI interface" alignment | A4-C01 through A4-C20 |
| **No observability** | PostHog analytics only. No structured tracing, no audit logging, no request-level debugging. OWUI has full OpenTelemetry. | Fixable — Vercel has built-in OTEL support | A3-C10, A3-C11 |
| **Limited admin controls** | Basic settings vs. OWUI's 60+ admin settings, feature toggles, per-model ACLs. | Fixable — implement progressively as features demand | A4-C06, A4-C20 |

**Key insight**: NaW's disadvantages are *feature gaps*, not architectural flaws. Features can be added incrementally without compromising the foundation. The persistent-process gap is the only inherent constraint worth tracking.

### 1.3 Positioning Implications

These are **fundamentally different products for different audiences**:

| Dimension | Open WebUI | Not A Wrapper |
|-----------|-----------|---------------|
| **Positioning** | Self-hosted AI platform | Universal AI interface (cloud) |
| **Primary user** | Sysadmins running local LLMs | Power users across cloud providers |
| **Deployment** | Docker one-liner | Vercel managed |
| **Scaling model** | Manual (uvicorn workers, Redis) | Automatic (serverless) |
| **Extensibility** | Python plugin code execution | MCP + typed tool interfaces |
| **AI ecosystem** | Ollama + OpenAI-compatible proxy | Native multi-provider SDK |
| **Growth driver** | Self-hosted privacy + local LLMs | Multi-model comparison + BYOK |

**Strategic recommendation**: Do NOT try to match OWUI's breadth. Instead, beat them on **reliability, performance, and UX polish** for the features NaW builds. OWUI's own users leave because "features don't work reliably" (A4-C09, A4-C10, A4-C13, A4-C16) — NaW should be the product where *every feature works*.

---

## 2. Architectural Recommendations

### 2.1 Built-in Tool Conditional Injection Pattern

- **What**: Inject tools into chat context based on both system-level config AND per-model capabilities. Don't offer web_search to models without tool calling; don't offer code_execution to models that can't use it.
- **Why**: OWUI's `get_builtin_tools()` dual-gate pattern (A2B-C12) prevents wasted tool tokens and failed tool calls. NaW currently has `tools: {} as ToolSet` with no conditional logic.
- **Impact**: Enables correct tool calling for all 73+ models without per-model manual configuration.
- **Effort**: S (< 1 week) — extends existing `ToolCapabilities` type from Phase 7.0 plan.
- **Trade-offs**: Adds a capability-check layer; minimal overhead.
- **Verdict**: **ADOPT**
- **Evidence refs**: A2B-C12, A2B-C05, A2A-C07
- **Confidence**: High
- **Risk if wrong**: Very Low — worst case is minor overhead in tool filtering logic.

### 2.2 Unified Tool Server Interface

- **What**: Surface MCP tools, built-in tools (web search, memory, etc.), and any future tool sources through a single typed interface with uniform access control.
- **Why**: OWUI unifies local tools, OpenAPI servers, and MCP servers into one `ToolUserResponse` type through the same endpoint (A2B-C05). This is the right abstraction — NaW's existing 3-layer tool architecture (Layer 1: provider, Layer 2: Exa, Layer 3: MCP) should converge on a shared tool type.
- **Impact**: Enables consistent tool UI, permission model, and routing regardless of tool source.
- **Effort**: M (1–2 weeks) — refactors `lib/tools/types.ts` to accommodate all tool sources.
- **Trade-offs**: Abstraction layer adds indirection; justified by source diversity.
- **Verdict**: **ADAPT**
- **Evidence refs**: A2B-C05, A2B-C04, A2B-C03
- **Confidence**: High
- **Risk if wrong**: Low — clean architecture regardless of how many tool sources exist.

### 2.3 Visible Failure Feedback for All AI Operations

- **What**: Every failure — tool call errors, RAG context truncation, search failures, context window overflow — produces explicit, visible user feedback. Never silently drop context.
- **Why**: OWUI's #1 user complaint is silent failures (A4-C09, A4-C16). RAG extraction fails without notification; tool results silently disappear; configuration mismatches produce no warnings. The model hallucinates instead of admitting context was lost.
- **Impact**: Directly addresses the reliability gap that causes OWUI users to churn. Establishes trust.
- **Effort**: M (ongoing, per-feature) — add error boundaries and status indicators to each tool/feature.
- **Trade-offs**: More UI surface for error states; justified by trust building.
- **Verdict**: **ADOPT**
- **Evidence refs**: A4-C09, A4-C16, A2A-C04
- **Confidence**: High
- **Risk if wrong**: Very Low — transparency always beats silent failure.

### 2.4 Security Headers by Default

- **What**: Enforce CSP, HSTS, X-Frame-Options, and other security headers out of the box via Next.js `middleware.ts` or `next.config.ts` headers.
- **Why**: OWUI's security headers are opt-in and off by default (A1-C07). Combined with the default JWT secret (A1-C12), naive deployments have zero security headers. NaW should set the standard.
- **Impact**: Every deployment is secure by default; no admin action required.
- **Effort**: S (< 1 day) — add headers config to Next.js.
- **Trade-offs**: May need CSP exceptions for third-party embeds; solvable with nonces.
- **Verdict**: **ADOPT**
- **Evidence refs**: A1-C07, A1-C12
- **Confidence**: High
- **Risk if wrong**: Very Low — security headers are standard practice.

### 2.5 Structured Observability (Audit Logging + Tracing)

- **What**: (a) Structured audit logging for admin mutations with configurable levels, body capture limits, and password redaction. (b) OpenTelemetry tracing via Vercel's built-in OTEL support.
- **Why**: NaW currently has only PostHog analytics. OWUI has production-quality audit logging middleware (A3-C11) and full OTEL integration (A3-C10). Both are necessary for enterprise readiness and debugging at scale.
- **Impact**: Enables compliance auditing, performance debugging, and incident investigation.
- **Effort**: M (2–3 weeks) — audit logging as Convex function wrapper; OTEL via Vercel config.
- **Trade-offs**: Added logging overhead; mitigated by configurable levels.
- **Verdict**: **ADAPT**
- **Evidence refs**: A3-C11, A3-C10, A1-C10
- **Confidence**: High
- **Risk if wrong**: Low — worst case is unused logging infrastructure.

---

## 3. Feature Adoption Roadmap

### 3.1 Quick Wins (< 1 week, high impact)

| # | Feature | Source Doc | Approach | Effort | Aligns with Existing Plan? |
|---|---------|-----------|----------|--------|---------------------------|
| 1 | **Inline trigger characters** (`#` files, `/` prompts, `@` models) | 04 (A4-C15, A4-C19) | ADOPT — framework-agnostic UX pattern; implement in chat input component | S (3–5 days) | No existing plan — new |
| 2 | **Security headers by default** | 01 (A1-C07, A1-C12) | ADOPT — add to `next.config.ts` or `middleware.ts` | XS (< 1 day) | No existing plan — new |
| 3 | **Template variables in prompts** (`{{CURRENT_DATE}}`, `{{USER_NAME}}`, `{{CLIPBOARD}}`) | 04 (A4-C15) | ADOPT — lightweight string interpolation at send time | S (2–3 days) | No existing plan — new |
| 4 | **Message rating/feedback** (thumbs up/down) | 04 (feature parity matrix) | ADOPT — Convex mutation + UI button on assistant messages | S (3–5 days) | Aligns with competitive-feature-analysis P0 |
| 5 | **Conversation export** (JSON, Markdown) | 04 (A4-C10, feature parity) | ADOPT — client-side serialization of Convex chat data | S (2–3 days) | Aligns with competitive-feature-analysis P0 |

### 3.2 Foundation Work (1–4 weeks, unlocks future features)

| # | Feature | Source Doc | Approach | Effort | Aligns with Existing Plan? |
|---|---------|-----------|----------|--------|---------------------------|
| 1 | **Tool calling infrastructure** (3-layer hybrid) | 02, 02b (A2A-C07, A2B-C05, A2B-C12) | ADAPT — implement per existing plan with added conditional injection | M (3–4 weeks) | **YES** — `tool-calling-infrastructure.md` (P0) |
| 2 | **Cross-conversation memory** (Convex vector + tool exposure) | 02b (A2B-C07), 04 (A4 §1.8) | ADAPT — enrich existing plan with OWUI's tool exposure pattern | M (3–4 weeks) | **YES** — `cross-conversation-memory.md` (P1); enriched |
| 3 | **Visible failure feedback system** | 04 (A4-C09, A4-C16) | ADOPT — error boundary components + status indicators per tool type | M (2 weeks) | No existing plan — new |
| 4 | **Task model separation** | 02 (A2A-C10) | ADAPT — `taskModel` user preference for title/tag gen; falls back to chat model | S (1 week) | No existing plan — new |
| 5 | **Structured audit logging** | 03 (A3-C11), 01 (A1-C10) | ADAPT — Convex function wrapper with configurable levels | M (2 weeks) | No existing plan — new |

### 3.3 Major Features (1–3 months, competitive parity)

| # | Feature | Source Doc | Approach | Effort | Aligns with Existing Plan? |
|---|---------|-----------|----------|--------|---------------------------|
| 1 | **RAG pipeline** (document upload → Convex vector search → context injection) | 02b (A2B-C06, A2B-C09, A2B-C14) | ADAPT — use Convex built-in vector search instead of 11 backends; single splitter; API-based embeddings | L (4–6 weeks) | No existing plan — new |
| 2 | **Image generation** (DALL-E, Gemini via BYOK) | 02b (A2B-C10) | ADAPT — API-only (skip ComfyUI/AUTOMATIC1111); 2 providers max | M (2–3 weeks) | Aligns with competitive-feature-analysis |
| 3 | **Code execution sandbox** | 02b (A2B §4) | ADAPT — E2B or WebContainers (WASM), NOT Pyodide/Jupyter | L (4–6 weeks) | **YES** — `phase-7-future-tool-integrations.md` §7.5 |
| 4 | **Audio STT/TTS** (cloud API only) | 02b (A2B-C11) | ADAPT — OpenAI Whisper API + TTS API; skip local engines | M (2–3 weeks) | No existing plan — new |
| 5 | **Custom model presets** (user-created personas wrapping base models) | 02 (A2A-C11) | ADAPT — Convex `customModels` table with `baseModelId`, `systemPrompt`, `params` | M (2–3 weeks) | No existing plan — new |

### 3.4 Strategic Investments (3–6 months, differentiation)

| # | Feature | Source Doc | Approach | Effort | Aligns with Existing Plan? |
|---|---------|-----------|----------|--------|---------------------------|
| 1 | **Valves-equivalent tool configuration** (Zod schemas → auto-generated settings UI) | 04 (A4-C11), 02b (A2B-C03) | ADAPT — Zod schemas replace Pydantic; admin/user tiers | L (4–6 weeks) | No existing plan — new |
| 2 | **Model access control ACLs** (per-model read/write with user/group support) | 04 (A4-C20) | ADAPT — Convex model metadata + Clerk group integration | M (3–4 weeks) | No existing plan — new |
| 3 | **Admin-mutable configuration** (PersistentConfig equivalent via Convex) | 01 (A1-C03, A1-C10) | ADAPT — Convex table for runtime config + reactive subscriptions (eliminates Redis layer) | L (4–6 weeks) | No existing plan — new |
| 4 | **OpenTelemetry integration** | 03 (A3-C10) | ADAPT — Vercel built-in OTEL + custom spans for AI pipeline | M (2–3 weeks) | No existing plan — new |
| 5 | **Prompt library with `/` command** | 04 (A4 §1.13) | ADOPT — Convex table + inline trigger from Quick Win #1 | M (2–3 weeks) | No existing plan — new |

---

## 4. Anti-Patterns to Avoid

### 4.1 Unsandboxed Code Execution (`exec()`)

- **What Open WebUI does**: User-written Python is loaded via `exec()` with no sandboxing. Tool/function code runs in the same process as the web server with full Python runtime access. Runtime `pip install` from tool frontmatter adds arbitrary packages.
- **Why it's a problem**: In multi-tenant or cloud-hosted contexts, any user with tool permissions can execute arbitrary code on the server. A malicious community function compromises the entire deployment. The `SAFE_MODE` flag exists as an emergency kill switch — confirming past security incidents.
- **What NaW should do instead**: Rely on external tool servers (MCP + OpenAPI) for extensibility. Built-in tools are typed TypeScript functions running in the serverless sandbox. Any user code execution uses isolated environments (E2B, WebContainers).
- **Evidence**: A2B-C01, A2B-C02, A4-C04, A4-C05

### 4.2 Combinatorial Backend Explosion

- **What Open WebUI does**: 11 vector DBs, 24 web search providers, 8 content extraction engines, 4 image engines, 5 STT engines, 4 TTS engines — 56+ backends total with ~145+ configuration parameters.
- **Why it's a problem**: Each new feature must be tested against all backends. Less popular backends (Oracle23ai, OpenGauss, S3Vector) receive less testing and accumulate silent bugs. The configuration surface creates onboarding friction and misconfiguration as the #1 failure mode.
- **What NaW should do instead**: 1 vector DB (Convex built-in), 1–2 search providers (Exa + provider-native), 1–2 image APIs (DALL-E + Gemini), 1–2 audio APIs (OpenAI). Depth over breadth. Add backends only when concrete user demand proves need.
- **Evidence**: A2B-C06, A2B-C08, A2B-C13, A2B-C14, A3-C05

### 4.3 Configuration as Feature

- **What Open WebUI does**: ~350 config variables across `env.py` + `config.py`, with a 3-layer persistence system (env → DB → Redis). RAG config alone has 80+ parameters. Adding one config variable requires touching 4 files.
- **Why it's a problem**: New deployers face enormous cognitive load. Env vars silently ignored after first boot. Triple source-of-truth (env, DB, Redis) makes debugging "why is this value X?" a time sink. No validation layer means invalid values fall through to defaults.
- **What NaW should do instead**: Keep configuration in `lib/config.ts` with TypeScript validation and sensible defaults. Progressive disclosure — basic config in UI, advanced in env vars. When admin-mutable config is added, use Convex as single source of truth (no Redis middle layer).
- **Evidence**: A1-C03, A3-C09, A4-C17

### 4.4 Monolithic Component Design

- **What Open WebUI does**: `Chat.svelte` is ~1,500 lines handling model selection, file upload, feature toggles, arena, audio, branching — 30+ props. `middleware.py` is ~2,000 lines handling 10+ concerns in one function scope.
- **Why it's a problem**: Untestable in isolation, prone to merge conflicts, unreadable for new contributors. Coupled state makes bugs hard to trace. The middleware monolith is OWUI's highest-risk maintenance bottleneck.
- **What NaW should do instead**: Enforce component size limits. Use the existing decomposition in `app/components/chat/` (chat.tsx, use-chat-core.ts, message-assistant.tsx) as the pattern. Keep route.ts focused on orchestration, delegate to utility modules.
- **Evidence**: A4-C02, A2A-C03, A1-C01

### 4.5 Silent Failure Modes

- **What Open WebUI does**: RAG content extraction fails without user notification. Tool results are silently truncated. Context window overflow is handled by aggressive trimming with no warning. The model hallucinates instead of admitting context was lost.
- **Why it's a problem**: Users lose trust when they can't tell if the AI is working with full context or guessing. The #1 most-commented open bug (67+ comments) is about tool execution failing silently across versions.
- **What NaW should do instead**: Every AI operation surfaces its status. Tool calls show pending/success/error states. Context truncation displays a warning badge. Search failures show "search unavailable" instead of proceeding without results.
- **Evidence**: A4-C09, A4-C16, A2A-C04

---

## 5. Deliberately Excluded Features

| Feature | Source | Why We're Skipping | Revisit If... |
|---------|--------|-------------------|---------------|
| **Local model inference (Ollama)** | 01, 02 | Requires persistent Python runtime with GPU. NaW is serverless + TypeScript, so self-hosting remains outside the current product boundary. | User demand for local inference materializes AND a TypeScript WASM solution emerges (e.g., llama.cpp WASM) |
| **stdio MCP transport** | 02b (A2B-C05) | Requires persistent backend process to maintain stdio pipes. Serverless functions are ephemeral. SSE + Streamable HTTP transports cover cloud MCP servers. | NaW adds a persistent backend process (e.g., for a "pro" self-hosted tier) |
| **Python plugin system (BYOF)** | 02b (A2B-C01), 04 (A4-C04) | `exec()` without sandboxing is a security non-starter. Runtime pip install adds unpredictable behavior. MCP provides language-agnostic extensibility without these risks. | MCP proves insufficient for power users AND a secure sandboxed execution model is available |
| **Arena/Elo evaluation** | 02 (A2A-C09) | Requires critical mass of user feedback, Python embedding dependencies (sentence-transformers), and blind model selection that conflicts with NaW's explicit multi-model comparison UX. Adoption is unknown even in OWUI. | User demand for blind model comparison emerges AND API-based embedding is used |
| **Channels / Team Chat** | 04 (A4 §1.11) | Major scope expansion (Slack-like features). Low adoption signals even in OWUI. Conflicts with "universal AI interface" positioning — NaW is a chat AI tool, not a team messaging platform. | Product strategy shifts to include team collaboration as a core use case |
| **Notes feature** | 04 (A4 §1.12) | Low-priority auxiliary feature with unclear adoption. Competes with dedicated note apps (Notion, Obsidian). | Knowledge management becomes a core use case |
| **Collaborative editing (Yjs/CRDT)** | 03 (A3-C07) | Requires persistent server state (Redis/in-memory) for CRDT sync. No evidence OWUI's implementation actually works in production. Complex for marginal value in a chat-first product. | Real-time multi-user chat editing becomes a validated user need |
| **i18n (56 languages)** | 04 (A4-C08) | NaW targets power users who are predominantly English-first. OWUI's approach (English strings as keys) is architecturally fragile. When NaW adds i18n, use key-based approach (`t("chat.new")`) with next-intl. | International user base exceeds 20% of MAU |
| **Custom auth (JWT + LDAP + SCIM)** | 01 (A1-C06) | Clerk handles JWT, OAuth, MFA, session management, token revocation out of the box with better security guarantees than OWUI's custom stack (default secret: `"t0p-s3cr3t"`). | Enterprise LDAP/SCIM demand materializes AND Clerk doesn't add support |
| **11 vector DB backends** | 03 (A3-C05), 02b (A2B-C06) | Convex provides built-in vector search. Multi-backend abstraction is maintenance burden for self-hosted flexibility NaW doesn't need. | Convex vector search hits documented scaling limits |
| **Pyodide (browser Python)** | 02b (A2B §4.1) | 10MB+ bundle size for WASM Python runtime. Limited to Pyodide package ecosystem. E2B or WebContainers provide better sandbox isolation without bundle bloat. | User demand for in-browser Python specifically outweighs alternatives |
| **PWA** | 04 (A4 §10) | Mobile is an afterthought even in OWUI (broken on Android, missing features). Better to ship excellent responsive web first, native app later. | Mobile usage exceeds 30% of sessions |

---

## 6. NaW Unique Advantages to Protect

| Advantage | Risk from Changes | Mitigation |
|-----------|------------------|------------|
| **Multi-model comparison** | Adding too many features to chat UI could bury the comparison UX | Keep comparison as a first-class layout mode, not a hidden option |
| **BYOK encryption (AES-256-GCM)** | Adding admin-mutable config could inadvertently expose key material in config tables | Never store API keys in config tables; BYOK storage remains separate encrypted column |
| **End-to-end TypeScript** | Adding Python microservices for ML features would break the single-language advantage | Strictly use API-based alternatives (cloud embedding, cloud STT/TTS) instead of Python services |
| **Convex real-time** | Adopting client-side caching layers (Redis, manual cache) could create stale data | Prefer Convex subscriptions for all real-time data; use TanStack Query only for non-Convex API data |
| **Serverless simplicity** | Adding persistent background services (Redis, message queues) would increase ops burden | Use Convex scheduled functions for async work; avoid introducing infrastructure dependencies |
| **Vercel AI SDK abstraction** | Building custom proxy layers (like OWUI's OpenAI-compat proxy) would duplicate SDK functionality | Always use Vercel AI SDK as the provider abstraction; only build custom adapters for unsupported providers |

---

## 7. Implementation Dependencies

```
                    ┌─────────────────────────────┐
                    │  Security Headers (2.4)       │ ← No deps, immediate
                    └─────────────────────────────┘

                    ┌─────────────────────────────┐
                    │  Inline Triggers (3.1 #1)     │ ← No deps, immediate
                    └──────────────┬──────────────┘
                                   │ enables
                                   ▼
                    ┌─────────────────────────────┐
                    │  Prompt Library (3.4 #5)      │
                    └─────────────────────────────┘

┌─────────────────────────────┐
│  Tool Calling Infra (3.2#1) │ ← Existing P0 plan
│  (Phases 1-5 from plan)     │
└──────────────┬──────────────┘
               │ enables
               ├────────────────────────┬──────────────────────┐
               ▼                        ▼                      ▼
┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────┐
│ Built-in Tool        │  │ Phase 7 Future       │  │ Visible Failure  │
│ Injection (2.1)      │  │ Integrations         │  │ Feedback (2.3)   │
└──────────────────────┘  │ (code exec, etc.)    │  └──────────────────┘
                          └──────────┬───────────┘
                                     │ enables
                                     ▼
                          ┌──────────────────────┐
                          │ Code Execution (3.3#3)│
                          └──────────────────────┘

┌─────────────────────────────┐
│  Memory System (3.2 #2)     │ ← Existing P1 plan (enriched)
│  (Convex vector + tools)    │
└──────────────┬──────────────┘
               │ enables
               ▼
┌─────────────────────────────┐
│  RAG Pipeline (3.3 #1)      │ ← Shares vector search infra
└─────────────────────────────┘

┌─────────────────────────────┐
│  Task Model Separation      │ ← No deps
│  (3.2 #4)                   │
└─────────────────────────────┘

┌─────────────────────────────┐
│  Audit Logging (3.2 #5)     │ ── enables ──→ OTEL (3.4 #4)
└─────────────────────────────┘

┌─────────────────────────────┐
│  Custom Model Presets (3.3#5)│ ── enables ──→ Model ACLs (3.4 #2)
└─────────────────────────────┘
```

**Critical path**: Tool Calling Infrastructure → Built-in Tool Injection → Phase 7 Features → Code Execution. This is the longest dependency chain and should receive priority scheduling.

---

## 8. Revised Priority Matrix

| Rank | Recommendation | Category | Impact (1-5) | Feasibility (1-5) | Confidence | Stack Fit | Ops Cost | Security Risk | Score | Priority |
|------|---------------|----------|--------------|-------------------|------------|-----------|----------|---------------|-------|----------|
| 1 | Tool calling infrastructure (3-layer hybrid) | Foundation | 5 | 4 | High | Strong | Low | Low | 20 | P0 |
| 2 | Inline trigger characters (#, /, @) | UX | 4 | 5 | High | Strong | None | None | 20 | P0 |
| 3 | Cross-conversation memory (Convex vector + tools) | AI | 5 | 4 | High | Strong | Low | Low | 20 | P0 |
| 4 | Visible failure feedback system | UX | 5 | 4 | High | Strong | None | None | 20 | P0 |
| 5 | Security headers by default | Security | 3 | 5 | High | Strong | None | None | 15 | P0 |
| 6 | Message rating/feedback | UX | 3 | 5 | High | Strong | None | None | 15 | P1 |
| 7 | Conversation export | UX | 3 | 5 | High | Strong | None | None | 15 | P1 |
| 8 | Template variables in prompts | UX | 3 | 5 | High | Strong | None | None | 15 | P1 |
| 9 | Task model separation | AI/Cost | 4 | 4 | High | Strong | Low | None | 16 | P1 |
| 10 | Built-in tool conditional injection | AI | 4 | 4 | High | Strong | None | None | 16 | P1 |
| 11 | Structured audit logging | Infra | 3 | 4 | High | Strong | Low | None | 12 | P1 |
| 12 | RAG pipeline (Convex vector) | AI | 5 | 3 | High | Strong | Low | Low | 15 | P1 |
| 13 | Image generation (DALL-E + Gemini) | AI | 4 | 4 | High | Strong | Low | None | 16 | P2 |
| 14 | Custom model presets | UX/AI | 4 | 4 | High | Strong | None | None | 16 | P2 |
| 15 | Code execution sandbox (E2B) | AI | 4 | 3 | Medium | Partial | Medium | Medium | 12 | P2 |
| 16 | Audio STT/TTS (cloud API) | AI | 3 | 4 | High | Strong | Low | None | 12 | P2 |
| 17 | Valves-equivalent tool config (Zod) | DX | 3 | 3 | High | Strong | None | None | 9 | P2 |
| 18 | Model access control ACLs | Security | 3 | 3 | Medium | Strong | Low | None | 9 | P3 |
| 19 | Admin-mutable config (Convex) | DX | 3 | 3 | High | Strong | Low | None | 9 | P3 |
| 20 | OpenTelemetry integration | Infra | 3 | 3 | High | Strong | Low | None | 9 | P3 |
| 21 | Prompt library with `/` command | UX | 3 | 4 | High | Strong | None | None | 12 | P3 |

**Score** = Impact × Feasibility. Priority adjusted by dependencies and strategic alignment.

---

## 9. Comparison with Existing NaW Roadmap

| Existing Plan | Status | This Research Says... | Action |
|--------------|--------|----------------------|--------|
| `tool-calling-infrastructure.md` | Ready for implementation | **CONFIRMED and enriched.** The 3-layer hybrid architecture is validated. Add built-in tool conditional injection (A2B-C12) — dual-gate pattern (system config AND per-model capabilities) should be woven into Phase 1's `ToolCapabilities` type. OWUI's unified tool server interface (A2B-C05) validates the existing plan's direction. | Proceed as planned; add conditional injection to Phase 1 |
| `phase-7-future-tool-integrations.md` | Research updated | **CONFIRMED.** Sub-phases 7.0 (ToolCapabilities), 7.3 (truncation), 7.4 (read-only classification), 7.5 (code execution) all align with findings. Code execution should use E2B/WebContainers, NOT Pyodide (A2B §4). OWUI's task model separation (A2A-C10) is a new addition not in the current plan — add as sub-phase. | Proceed as planned; add task model sub-phase; confirm E2B over Pyodide |
| `cross-conversation-memory.md` | Draft — ready for review | **CONFIRMED and significantly enriched.** OWUI's dual-storage + tool exposure pattern (A2B-C07) validates the plan's core design. Key enrichment: expose memories as model-callable built-in tools (`search_memories`, `add_memory`, `replace_memory_content`) — not just system prompt injection. Convex simplifies OWUI's SQL + vector DB dual-storage into a single store. | Proceed with enriched design; add tool exposure to Phase 2 of plan |
| `thinking-reasoning-configuration.md` | Partially implemented | **CONFIRMED.** OWUI's reasoning tag detection (A2A-C13) supports 8+ tag formats with duration tracking. NaW already has working Anthropic/Google thinking; this research adds confidence that the approach is correct. OWUI's content block architecture (A2A-C08) could improve NaW's reasoning display (thought duration badge). | Proceed as planned; consider content block metadata for reasoning display |
| Self-hosting boundary | Current direction confirmed | **STRONGLY CONFIRMED.** OWUI's self-hosted architecture requires manual uvicorn tuning, Redis as hidden requirement, 100+ env vars, dual migration systems, and 3-4GB Docker images. This operational burden is precisely what NaW avoids by being cloud-first. | Keep self-hosting outside the current product boundary |

---

## 10. Unresolved Conflicts

| Conflict ID | Source Docs | Decision Needed | Options | Recommended Default |
|-------------|-------------|-----------------|---------|---------------------|
| S9-X01 | 02 (A2A-C09) vs. 04 (A4 §1.14) | **Arena/evaluation system**: Agent 2A recommends SKIP (Elo requires Python deps, unknown adoption). Agent 4 notes it as a differentiator worth evaluating. NaW already has explicit multi-model comparison. | (A) Skip entirely, (B) Build simple thumbs-up/down per model without Elo, (C) Build full Elo with API-based embeddings | **Option B** — simple per-model ratings without Elo complexity. Revisit Elo if rating volume justifies it. |
| S9-X02 | 02b (A2B-C07) vs. memory plan | **Memory creation method**: OWUI uses auto-extraction (AI parses conversations) + manual. Existing NaW plan uses tool-based creation (AI calls `add_memory` tool). Both approaches have merit. | (A) Tool-only (explicit), (B) Auto-extraction (implicit), (C) Both | **Option C** — tool-based as primary (user-controlled), auto-extraction as opt-in enhancement later. Matches existing plan with future extensibility. |
| S9-X03 | 04 (A4-C12) vs. complexity budget | **Rich text input (TipTap)**: OWUI uses TipTap v3 with 18+ extensions for rich text editing with AI autocomplete. NaW uses markdown-only input. | (A) Stay markdown-only, (B) Add TipTap for notes/artifacts only, (C) Full TipTap for chat input | **Option A** for now — markdown-only chat input keeps bundle lean. Evaluate TipTap when artifacts/canvas feature is scoped. |
| S9-X04 | 04 (A4-C08) vs. positioning | **i18n timing**: OWUI supports 56 languages. NaW is English-only. When to add i18n? | (A) Never, (B) After 1.0 with key-based approach, (C) Now with OWUI's string-key approach | **Option B** — add i18n after core features stabilize, using `next-intl` with key-based translation IDs (NOT OWUI's English-string-as-key approach). |

---

## 11. Next Steps

### 11.1 Immediate Execution Packets (Required)

#### Packet 1: Tool Calling Infrastructure (Rank #1)

- **First milestone**: Layer 1 provider search tools injected into `streamText()` for OpenAI, Anthropic, Google, xAI models — web search working in chat for 4 providers.
- **Owner role**: Full-stack (route.ts + UI + types)
- **Blocking dependencies**: None — existing plan is Phase 1-ready
- **Validation criteria for "done"**: (1) `enableSearch` toggle in chat UI activates provider-native search for supported models, (2) search results display with source citations, (3) `bun run lint && bun run typecheck` pass, (4) tool invocation component renders search results correctly
- **Files to modify**: `app/api/chat/route.ts`, `lib/tools/types.ts`, `lib/models/types.ts`, `app/components/chat/tool-invocation.tsx`
- **Estimated effort**: 1 week for Layer 1; 3–4 weeks for all 3 layers

#### Packet 2: Inline Trigger Characters (Rank #2)

- **First milestone**: Typing `@` in chat input opens a model selector dropdown; typing `/` opens a command menu (initially with model switch only; prompt library added later).
- **Owner role**: Frontend (chat input component)
- **Blocking dependencies**: None
- **Validation criteria for "done"**: (1) `@` trigger opens model selector popover anchored to cursor position in input, (2) selecting a model switches the active model, (3) `#` trigger opens file picker (can be empty state initially), (4) keyboard navigation (arrow keys + Enter) works within trigger menus, (5) triggers compose naturally with regular typing (debounced, dismissed on space/escape)
- **Files to modify**: `app/components/chat/` (input component), new `app/components/chat/trigger-menu.tsx`
- **Estimated effort**: 3–5 days

#### Packet 3: Cross-Conversation Memory (Rank #3)

- **First milestone**: `add_memory` and `search_memories` tools available in `streamText()` tool set; AI can store and retrieve facts across conversations for authenticated users.
- **Owner role**: Full-stack (Convex schema + functions + route.ts + settings UI)
- **Blocking dependencies**: Tool calling infrastructure Phase 1 (tools must work in `streamText()` first). Can start Convex schema work in parallel.
- **Validation criteria for "done"**: (1) `memories` table in Convex schema with vector index, (2) `add_memory` tool callable by any model, (3) `search_memories` runs on each chat request and injects relevant memories into system prompt, (4) `/memories` settings page shows user's memories with edit/delete, (5) memories work identically across all providers (provider-agnostic)
- **Files to modify**: `convex/schema.ts`, new `convex/memories.ts`, `app/api/chat/route.ts` (tool injection + system prompt), new `app/components/layout/settings/memories.tsx`
- **Estimated effort**: 3–4 weeks

### 11.2 Decisions Requiring Human Input

1. **Task model default**: Should the default task model be the user's cheapest configured model, or a hardcoded fallback (e.g., GPT-4o-mini)?
2. **Memory opt-in/opt-out**: Should memory be on by default for new users (with opt-out) or off by default (with opt-in)?
3. **Code execution provider**: E2B (hosted sandbox API) vs. WebContainers (browser WASM) for the code execution feature. Trade-off: E2B is simpler but adds a service dependency; WebContainers are self-contained but limited to Node.js/browser APIs.
4. **Audit log storage**: Store audit logs in Convex (queryable, limited retention) or external service (Datadog, etc.)? Depends on enterprise requirements.

### 11.3 Additional Research Needed

1. **Convex vector search benchmarks**: Validate embedding + retrieval performance for the memory and RAG use cases. Specific questions: what embedding model to use, what dimension, what's the max collection size, what's the query latency at 10K/100K/1M vectors?
2. **E2B vs. WebContainers evaluation**: Prototype both for the code execution feature. Compare: supported languages, cold start latency, bundle size impact, cost, security model.
3. **Vercel OTEL integration**: Evaluate Vercel's built-in OpenTelemetry support for serverless functions — what traces/metrics are available out of the box, what needs custom instrumentation?

---

*Synthesized from Open WebUI competitive codebase analysis (docs 01–04 + 02b, Phase 1). Phase 2 comparison docs (05–08) provided structural guidance but were not populated by Phase 2 agents — synthesis drew directly from Phase 1 evidence. Cross-referenced with `competitive-feature-analysis.md` and 5 existing plans in `.agents/plans/`. See `00-research-plan.md` for full research plan.*
