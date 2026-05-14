# Open WebUI Competitive Codebase Analysis — Research Plan

> **Date**: February 12, 2026
> **Repository**: [open-webui/open-webui](https://github.com/open-webui/open-webui) (124k stars, 14.8k commits, 702 contributors)
> **Purpose**: Deep codebase analysis of Open WebUI, comparison with Not A Wrapper, and prioritized recommendations for fundamental improvements.
> **Prior Art**: See `competitive-feature-analysis.md` for ChatGPT/Claude feature comparison (Feb 6, 2026).

---

## 1. Executive Context

## 0. Research Quality Contract (Required)

Every document in this research track must follow a shared evidence contract so Phase 3 can compare claims directly.

### Required Evidence Record Per Major Claim

Each major finding must include:

| Field | Description |
|-------|-------------|
| `claim_id` | Unique ID (`A1-C01`, `A2B-C12`, etc.) |
| `claim` | The assertion being made |
| `evidence_type` | Code / issue-discussion / release-note / benchmark / docs |
| `source_refs` | File paths or URLs used as evidence |
| `confidence` | High / Medium / Low |
| `impact_area` | Architecture / AI / data / UX / DX / security / cost |
| `reversibility` | Easy / Moderate / Hard to change later |
| `stack_fit_for_naw` | Strong / Partial / Weak |
| `notes` | Caveats and assumptions |

### Required Uncertainty Capture

Each document must include:
- Top 5 unresolved questions
- What evidence would change the top conclusions ("falsification criteria")
- Which claims are based on inference rather than direct evidence

### Comparable vs. Non-Comparable Guardrail

Agents must explicitly tag findings as one of:
- **Directly Comparable**: same problem space and constraints
- **Conditionally Comparable**: useful pattern, different infra assumptions
- **Not Comparable**: tied to self-hosted/Python/long-running runtime assumptions NaW does not share

This avoids false parity conclusions between Open WebUI's self-hosted monolith and NaW's serverless TypeScript stack.

---

### Open WebUI at a Glance

| Layer | Technology |
|-------|------------|
| Frontend | SvelteKit (Svelte 5), Tailwind 4, TipTap rich editor, CodeMirror |
| Backend | Python FastAPI, SQLAlchemy, Pydantic |
| Database | SQLite/PostgreSQL (selectable), 9 vector DB options |
| Real-time | socket.io (Python + JS client), WebSocket, Redis pub/sub |
| AI | Direct Ollama + OpenAI-compatible API proxy, LangChain for RAG |
| Auth | Custom JWT + OAuth/OIDC + LDAP + SCIM 2.0 |
| Deployment | Docker (self-hosted), Kubernetes (Helm/Kustomize), pip install |
| Observability | OpenTelemetry (traces, metrics, logs) |

### Not A Wrapper at a Glance

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16 (React 19), Shadcn/Base UI, Tailwind 4 |
| Backend | Next.js API Routes (serverless), Vercel AI SDK |
| Database | Convex (reactive DB + built-in vector search) |
| Real-time | Convex subscriptions (automatic) |
| AI | Vercel AI SDK → 10 providers, 73+ models |
| Auth | Clerk (managed) |
| Deployment | Vercel (managed serverless) |
| Observability | PostHog analytics |

### Research Dimensions (User-Prioritized)

1. **Architecture / Code Quality** — highest priority
2. **AI Capabilities** — tool calling, MCP, RAG, code execution, image gen, memories
3. **Performance / Scalability** — caching, real-time, horizontal scaling
4. **UX** — feature richness, interaction patterns, i18n, accessibility
5. **Developer Experience / Extensibility** — plugin system, API design, contribution model

### Research Framing

**This research mines for implementation patterns and architectural lessons.** The current roadmap is anchored by `competitive-feature-analysis.md` (ChatGPT/Claude comparison, Feb 2026), but this Open WebUI analysis is allowed to challenge or reorder existing assumptions when evidence is strong.

**This research focuses on:**
- **Implementation intelligence**: How did Open WebUI solve problems we'll also face? What patterns, abstractions, and architectures can we learn from?
- **Honest trade-off analysis**: What did they get right AND wrong? What is the maintenance cost of their feature breadth?
- **Architectural lessons**: What structural decisions enabled or limited them? What should we adopt, adapt, or deliberately avoid?
- **Community & growth signals**: How did a 124k-star project build its contributor ecosystem? What drove adoption?

**Every analysis must assess both strengths AND weaknesses.** Feature inventories provide context, but the primary outputs are patterns, trade-offs, and lessons — not feature shopping lists. For every feature Open WebUI has, agents must assess whether NaW should **adopt** it (build it), **adapt** it (modify for our stack), or **deliberately skip** it (with documented rationale).

**Bias control rule**: Do not defend existing NaW plans by default. Prefer disconfirming evidence over confirming evidence when both are available.

---

## 2. Research Architecture

### Parallel Agent Structure

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     PHASE 1: OPEN WEBUI DEEP DIVE                       │
│                        (5 agents in parallel)                            │
├─────────────┬─────────────┬─────────────┬─────────────┬─────────────────┤
│  Agent 1    │  Agent 2A   │  Agent 2B   │  Agent 3    │    Agent 4      │
│  ARCH &     │  AI ENGINE  │  TOOL &     │  DATA &     │  UX, FEATURES  │
│  CODE       │  & PIPELINE │  FEATURE    │  SCALE      │  EXTENSIBILITY │
│             │             │  INFRA      │             │  & COMMUNITY   │
│ 01-arch     │ 02-ai       │ 02b-tools   │ 03-data     │ 04-ux-ext      │
└─────┬───────┴─────┬───────┴─────┬───────┴─────┬───────┴────────┬────────┘
      │             │             │             │                │
      ▼             ▼             ▼             ▼                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    PHASE 2: COMPARISON & MAPPING                         │
│           (4 agents in parallel — each reads ALL Phase 1 outputs)        │
├──────────────┬──────────────┬──────────────┬────────────────────────────┤
│   Agent 5    │   Agent 6    │   Agent 7    │        Agent 8             │
│  ARCH        │  AI          │  DATA &      │   UX & EXT                │
│  COMPARISON  │  COMPARISON  │  SCALE COMP  │   COMPARISON              │
│              │              │              │                            │
│ 05-cmp-arch  │ 06-cmp-ai   │ 07-cmp-data  │  08-cmp-ux-ext            │
└──────┬───────┴──────┬───────┴──────┬───────┴──────────┬─────────────────┘
       │              │              │                   │
       ▼              ▼              ▼                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│               PHASE 3: SYNTHESIS & RECOMMENDATIONS                       │
│                        (1 agent, sequential)                             │
│                                                                          │
│                    09-recommendations.md                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

### Document Map

| Doc ID | File | Agent | Phase | Primary Dep | Also Reads |
|--------|------|-------|-------|-------------|------------|
| 01 | `01-architecture-code-quality.md` | Agent 1 | 1 (parallel) | — | — |
| 02 | `02-ai-engine-tools.md` | Agent 2A | 1 (parallel) | — | — |
| 02b | `02b-tool-infrastructure.md` | Agent 2B | 1 (parallel) | — | — |
| 03 | `03-data-layer-scalability.md` | Agent 3 | 1 (parallel) | — | — |
| 04 | `04-ux-features-extensibility.md` | Agent 4 | 1 (parallel) | — | — |
| 05 | `05-comparison-architecture.md` | Agent 5 | 2 (parallel) | 01 | 02, 02b, 03, 04 |
| 06 | `06-comparison-ai-capabilities.md` | Agent 6 | 2 (parallel) | 02, 02b | 01, 03, 04 + existing plans |
| 07 | `07-comparison-data-scalability.md` | Agent 7 | 2 (parallel) | 03 | 01, 02, 02b, 04 |
| 08 | `08-comparison-ux-extensibility.md` | Agent 8 | 2 (parallel) | 04 | 01, 02, 02b, 03 + competitive analysis |
| 09 | `09-prioritized-recommendations.md` | Synthesis | 3 (sequential) | 05-08 | competitive analysis + existing plans |

> Note: This folder currently includes `00` + docs `01-09` + `02b` template (11 markdown files total). Execution outputs are the ten research documents `01`, `02`, `02b`, `03`, `04`, `05`, `06`, `07`, `08`, `09`.

---

## 3. Phase 1: Open WebUI Deep Dive

### Agent 1 — Architecture & Code Quality (`01-architecture-code-quality.md`)

**Mission**: Map Open WebUI's system architecture, code organization, patterns, and quality practices. Assess both strengths and weaknesses of their architectural decisions.

**Scope Boundary**: Owns system architecture, code organization, patterns, middleware, auth flow, configuration, and testing. Database *schema design quality* is in scope, but database *engine internals, caching, and scaling* belong to Agent 3. Frontend *feature UX* belongs to Agent 4.
**Do not duplicate**: deep RAG/vector backend internals (Agent 2B + 3), community popularity claims (Agent 4).

**Key Questions to Answer**:
1. How is the backend structured? (FastAPI app composition, router organization, middleware chain)
2. How is the frontend structured? (SvelteKit routing, component tree, store architecture)
3. How do frontend and backend communicate? (API layer, WebSocket, real-time)
4. What patterns do they use for error handling, validation, and auth?
5. What is their testing strategy? (unit, integration, e2e — and what's notably UNTESTED?)
6. How do they manage configuration? (env vars, runtime config, admin settings)
7. What is the code quality like? (lint rules, type safety, code review practices)
8. **Where does the architecture show strain?** (tech debt, code churn, regretted decisions)
9. **What security vulnerabilities or gaps exist?** (input sanitization, CVE history)

**Files/Directories to Examine**:

```
# Backend structure
backend/open_webui/main.py          # FastAPI app composition, middleware, lifespan
backend/open_webui/routers/         # All API routers (24 files)
backend/open_webui/models/          # SQLAlchemy data models
backend/open_webui/config.py        # Configuration management
backend/open_webui/env.py           # Environment variable handling
backend/open_webui/utils/           # Utilities (auth, middleware, security)
backend/open_webui/socket/          # WebSocket/socket.io handling
backend/open_webui/constants.py     # Application constants

# Frontend structure
src/routes/                         # SvelteKit routes/pages
src/lib/components/                 # UI components (examine structure)
src/lib/stores/                     # Svelte stores (state management)
src/lib/apis/                       # API client layer
src/lib/utils/                      # Frontend utilities
src/lib/types/                      # TypeScript type definitions
src/lib/constants.ts                # Frontend constants

# Config & tooling
.eslintrc.cjs                       # Lint configuration
tsconfig.json                       # TypeScript config
svelte.config.js                    # SvelteKit config
vite.config.ts                      # Build config
```

---

### Agent 2A — AI Engine & Chat Pipeline (`02-ai-engine-tools.md`)

**Mission**: Analyze how Open WebUI handles AI provider abstraction, model management, the chat completion pipeline (request → middleware → provider → response → storage), and the evaluation/arena system.

**Scope Boundary**: Owns provider routing, middleware composition, streaming mechanics, model lifecycle, and evaluation/arena. Tool calling, MCP, RAG, code execution, image gen, audio, memories, and web search belong to Agent 2B. User-facing feature UX belongs to Agent 4.
**Do not duplicate**: implementation internals for tools/MCP/RAG execution paths (Agent 2B).

**Key Questions to Answer**:
1. How do they abstract multiple AI providers? (Ollama proxy + OpenAI-compatible)
2. How is chat completion handled? (streaming, middleware pipeline, response processing)
3. How does the middleware chain compose? Is it maintainable as features are added?
4. How does model management work? (custom models, model builder, access control)
5. What is the evaluation/arena system? Is it actively used?
6. **What happens when a provider is down or rate-limited?** (failover, retry, error propagation)
7. **Does the "proxy everything through OpenAI-compatible format" approach create limitations?**
8. **What are the known edge cases or failure modes in the pipeline?**

**Files/Directories to Examine**:

```
# AI routing & completion
backend/open_webui/routers/ollama.py     # Ollama proxy router
backend/open_webui/routers/openai.py     # OpenAI-compatible proxy router
backend/open_webui/utils/chat.py         # Chat completion logic
backend/open_webui/utils/middleware.py    # Chat payload/response processing
backend/open_webui/utils/models.py       # Model management utilities

# Model management
backend/open_webui/routers/models.py     # Model CRUD + builder
backend/open_webui/models/models.py      # Model data model

# Evaluation
backend/open_webui/routers/evaluations.py  # Arena/evaluation system

# Post-processing
backend/open_webui/routers/tasks.py      # Title gen, tag gen, follow-ups
```

---

### Agent 2B — Tool & Feature Infrastructure (`02b-tool-infrastructure.md`)

**Mission**: Deeply analyze all capability subsystems that plug into the chat pipeline: tool calling, MCP, RAG, code execution, image generation, audio, memories, and web search. Assess both the implementation quality and the maintenance burden of supporting this breadth.

**Scope Boundary**: Owns backend implementation of all tool/feature subsystems. The chat pipeline itself (providers, streaming, middleware) belongs to Agent 2A. User-facing feature UX belongs to Agent 4.
**Timebox rule**: Prioritize depth in tool calling + MCP + RAG + memories first. Cover code execution/image/audio/search after core subsystems meet evidence-quality requirements.

**Key Questions to Answer**:
1. How does their tool/function calling system work? (native Python tools, BYOF)
2. How is MCP integrated? (client, tool server connections, transport)
3. How does RAG work? (embeddings, chunking, vector DB, retrieval pipeline)
4. How does code execution work? (Pyodide browser-side, Jupyter server-side)
5. How does image generation work? (DALL-E, ComfyUI, AUTOMATIC1111, Gemini)
6. How do memories work? (storage, retrieval, injection into prompts)
7. How does web search work? (15+ provider support, injection into chat)
8. **What is the total maintenance cost of this breadth?** (9 vector DBs × 9 extraction engines × 15+ search providers × 4 image engines × 5+ STT × 5+ TTS)
9. **What capabilities require Python that TypeScript structurally cannot match?** (local Whisper, sentence-transformers, Pyodide)
10. **What integration paths appear abandoned or poorly maintained?**

**Files/Directories to Examine**:

```
# Tools & functions
backend/open_webui/routers/tools.py      # Tool management
backend/open_webui/routers/functions.py  # Function management
backend/open_webui/utils/plugin.py       # Plugin/tool dependency installation
backend/open_webui/routers/pipelines.py  # Pipeline framework

# RAG & knowledge
backend/open_webui/routers/retrieval.py  # RAG pipeline
backend/open_webui/routers/knowledge.py  # Knowledge base management
backend/open_webui/routers/files.py      # File handling

# Code execution
src/lib/pyodide/                         # Browser-side Python execution
scripts/prepare-pyodide.js               # Pyodide build preparation

# Image & audio
backend/open_webui/routers/images.py     # Image generation routing
backend/open_webui/routers/audio.py      # STT/TTS routing

# Memories
backend/open_webui/routers/memories.py   # Memory CRUD
backend/open_webui/models/memories.py    # Memory data model

# MCP
# Search for "mcp" in backend/ — mcp==1.25.0 in pyproject.toml
```

---

### Agent 3 — Data Layer & Scalability (`03-data-layer-scalability.md`)

**Mission**: Analyze the database layer, caching strategy, real-time infrastructure, deployment model, and horizontal scaling approach. Assess operational burden for self-hosted users.

**Scope Boundary**: Owns database engine internals, caching, real-time communication, file storage, deployment infrastructure, horizontal scaling, and observability. Database *schema design quality and code organization* belong to Agent 1. *Vector DB abstraction for RAG* is shared with Agent 2B — cover infrastructure/scaling here, Agent 2B covers pipeline logic.
**Evidence rule**: Any throughput or concurrency statements require benchmark artifacts or maintainer-reported data; otherwise mark as unknown.

**Key Questions to Answer**:
1. How is the database structured? (SQLAlchemy models, migrations via Alembic, schema design)
2. How do they handle multi-database support? (SQLite vs PostgreSQL, vector DB abstraction)
3. What is the caching strategy? (Redis, aiocache, in-memory)
4. How does real-time communication work? (socket.io architecture, Redis pub/sub for multi-node)
5. How do they deploy? (Docker, Kubernetes, pip install, multi-worker)
6. How do they handle horizontal scaling? (Redis sessions, WebSocket across nodes)
7. What observability do they have? (OpenTelemetry integration, audit logging)
8. **What is the operational burden for self-hosted deployments?** (setup complexity, migration pain, what breaks during upgrades)
9. **Is Redis a help or a hindrance?** (what breaks without it?)
10. **How many concurrent users can a single instance handle?**

**Files/Directories to Examine**:

```
# Database layer
backend/open_webui/internal/db.py        # Database engine, session management
backend/open_webui/models/               # All SQLAlchemy models
backend/open_webui/migrations/           # Alembic migrations

# Caching & sessions
backend/open_webui/utils/redis.py        # Redis connection management

# Real-time
backend/open_webui/socket/main.py        # socket.io server

# Deployment
Dockerfile                               # Multi-stage Docker build
docker-compose*.yaml                     # Various deployment configs
backend/start.sh                         # Backend startup script

# Observability
backend/open_webui/utils/telemetry/      # OpenTelemetry setup
backend/open_webui/utils/audit.py        # Audit logging middleware
```

---

### Agent 4 — UX, Features, Extensibility & Community (`04-ux-features-extensibility.md`)

**Mission**: Catalog the complete feature set, analyze UX patterns, evaluate the plugin/extension system, assess developer experience, and investigate community dynamics and growth trajectory.

**Scope Boundary**: Owns the **user-facing surface** — feature inventory, UX patterns, UI components, design system, i18n, RBAC, admin panel, plugin system, DX, and community/growth analysis. Backend implementation of AI features belongs to Agents 2A and 2B.
**Quality-over-breadth rule**: If scope is too wide, prioritize: (1) UX coherence + discoverability, (2) extensibility model, (3) admin/RBAC relevance to NaW, (4) community signals. Capture lower-priority features as inventory notes, not deep analysis.

**Key Questions to Answer**:
1. What is the complete feature inventory? (every user-facing capability)
2. How is the UI component system organized? (design system, reusable patterns)
3. How does i18n work? (translation system, coverage)
4. How does RBAC work? (roles, permissions, groups, admin controls)
5. How does the plugin/pipeline system work? (architecture, API, distribution)
6. How do channels, notes, knowledge bases, and other auxiliary features work?
7. What keyboard shortcuts exist?
8. How does the admin panel work? (feature toggles, user management, settings)
9. **How did Open WebUI reach 124k stars?** (growth trajectory, adoption drivers, community governance)
10. **What features seem most/least popular based on community signals?** (issue frequency, discussion activity)
11. **Can a new contributor ship a feature within a week?** (onboarding friction)
12. **What do users complain about most?** (GitHub issues, Discord)
13. **What features feel half-baked or abandoned?** (cost of breadth on UX coherence)

**Files/Directories to Examine**:

```
# Frontend features
src/lib/components/                      # Full component inventory
src/routes/(app)/                        # App routes (feature pages)
src/lib/components/chat/                 # Chat-specific components
src/lib/components/admin/               # Admin panel components
src/lib/components/workspace/           # Workspace features
src/lib/shortcuts.ts                     # Keyboard shortcuts

# i18n
src/lib/i18n/                            # Translation files
i18next-parser.config.ts                 # i18n configuration

# RBAC & auth
backend/open_webui/routers/auths.py      # Auth endpoints
backend/open_webui/routers/groups.py     # Group management
backend/open_webui/utils/access_control.py  # Permission checking

# Plugin system
backend/open_webui/routers/functions.py  # Functions (plugins)
backend/open_webui/routers/tools.py      # Tools
backend/open_webui/routers/pipelines.py  # Pipeline framework

# Community signals
# GitHub issues, discussions, star history, contributor stats
# Release notes and changelog
```

---

## 4. Phase 2: Comparison & Mapping

> **Critical Rule for All Phase 2 Agents**: Read ALL Phase 1 outputs before writing your comparison document. Your primary dependency defines your focus area, but reading the other tracks prevents siloed analysis. Also read `competitive-feature-analysis.md` for prior ChatGPT/Claude gap analysis — use it as baseline context, not a hard constraint. This research may refine or reprioritize roadmap assumptions when evidence warrants.

> **Normalization Rule for All Phase 2 Agents**: Every recommendation must include confidence, evidence count, stack fit, and implementation dependency notes so synthesis can rank proposals consistently.

### Agent 5 — Architecture Comparison (`05-comparison-architecture.md`)

**Primary Dependency**: `01-architecture-code-quality.md`
**Also Reads**: `02-ai-engine-tools.md`, `02b-tool-infrastructure.md`, `03-data-layer-scalability.md`, `04-ux-features-extensibility.md`

**Mission**: Map Open WebUI's architectural patterns against Not A Wrapper's. Identify strengths to adopt, patterns to avoid, and structural differences that inform recommendations. Explicitly assess what NaW **structurally cannot do** because of its serverless + TypeScript stack.

**Key Comparisons**:
- Monolith (FastAPI + SvelteKit) vs. Full-stack serverless (Next.js + Convex)
- Python backend vs. TypeScript-only stack — what can each do that the other cannot?
- SQLAlchemy + explicit migrations vs. Convex reactive schema
- Custom JWT auth vs. Clerk managed auth
- Self-hosted-first vs. Cloud-first deployment
- Testing strategies
- Configuration complexity (hundreds of env vars vs. compact config)

**NaW Files to Cross-Reference**:
- `app/api/chat/route.ts` — Gold standard API route
- `lib/chat-store/` — State management
- `convex/schema.ts` — Database schema
- `.agents/project/README.md` — Project context
- `middleware.ts` — Auth/CSP middleware

---

### Agent 6 — AI Capabilities Comparison (`06-comparison-ai-capabilities.md`)

**Primary Dependency**: `02-ai-engine-tools.md`, `02b-tool-infrastructure.md`
**Also Reads**: `01-architecture-code-quality.md`, `03-data-layer-scalability.md`, `04-ux-features-extensibility.md`
**Additional Context**: `.agents/plans/tool-calling-infrastructure.md`, `.agents/plans/phase-7-future-tool-integrations.md`, `.agents/plans/cross-conversation-memory.md`

**Mission**: Compare AI feature implementation depth. For every capability, explicitly assess: **adopt** (build it), **adapt** (modify approach for NaW's serverless/TypeScript stack), or **skip** (don't build, with rationale). Cross-reference existing NaW implementation plans to avoid contradicting prior decisions.

**Key Comparisons**:
- Provider abstraction (OpenAI-compat proxy vs. Vercel AI SDK multi-provider)
- Tool calling (native Python BYOF vs. tool-calling-infrastructure plan)
- MCP (built-in mcp==1.25.0 vs. library-only, serverless constraints)
- RAG (full pipeline with 9 vector DBs vs. Convex built-in vector search)
- Code execution (Pyodide + Jupyter vs. E2B/WASM options)
- Image generation (4 engines vs. BYOK provider API approach)
- Audio (multi-provider STT/TTS vs. browser API + provider API)
- Memories (full CRUD + injection vs. cross-conversation-memory plan)
- Web search (15+ providers vs. single provider per-model)
- **Capabilities structurally blocked by NaW's stack** (local model inference, stdio MCP, persistent WebSocket, etc.)

**NaW Files to Cross-Reference**:
- `app/api/chat/route.ts` — Chat route
- `lib/mcp/` — MCP client
- `lib/openproviders/` — Provider abstraction
- `app/components/chat/tool-invocation.tsx` — Tool UI
- `.agents/plans/tool-calling-infrastructure.md`
- `.agents/plans/phase-7-future-tool-integrations.md`
- `.agents/plans/cross-conversation-memory.md`

---

### Agent 7 — Data Layer & Scalability Comparison (`07-comparison-data-scalability.md`)

**Primary Dependency**: `03-data-layer-scalability.md`
**Also Reads**: `01-architecture-code-quality.md`, `02-ai-engine-tools.md`, `02b-tool-infrastructure.md`, `04-ux-features-extensibility.md`

**Mission**: Compare data layer design, caching, real-time capabilities, and scaling approaches. Identify what's relevant to NaW's managed infrastructure (Convex + Vercel) vs. what's only relevant to self-hosted deployments.

**Key Comparisons**:
- SQLAlchemy + manual migrations vs. Convex auto-managed reactive DB
- Redis caching + sessions vs. no caching layer (does NaW need one?)
- socket.io (manual) vs. Convex real-time subscriptions (automatic)
- Self-hosted Docker/K8s vs. Vercel serverless
- Multi-worker horizontal scaling vs. serverless auto-scaling
- File storage (S3/GCS/Azure) vs. Convex storage
- Observability (OpenTelemetry vs. PostHog) — clear gap to address

**NaW Files to Cross-Reference**:
- `convex/schema.ts` — Database schema
- `convex/` — All Convex functions
- `lib/chat-store/` — Client-side state/cache
- `.agents/project/README.md` — Database context pointer

---

### Agent 8 — UX & Extensibility Comparison (`08-comparison-ux-extensibility.md`)

**Primary Dependency**: `04-ux-features-extensibility.md`
**Also Reads**: `01-architecture-code-quality.md`, `02-ai-engine-tools.md`, `02b-tool-infrastructure.md`, `03-data-layer-scalability.md`
**Additional Context**: `competitive-feature-analysis.md` — already identifies prioritized feature gaps against ChatGPT/Claude

**Mission**: Compare feature richness, UX patterns, plugin systems, and developer experience. **DO NOT duplicate** the prior competitive feature analysis — that document covers ChatGPT/Claude gaps with established priorities. This comparison should ADD the Open WebUI perspective: features the prior analysis didn't cover, implementation patterns worth studying, and features to deliberately skip. For every feature, assess: adopt, adapt, or skip (with rationale).

**Key Comparisons**:
- Feature inventory: every Open WebUI feature → NaW status → adopt/adapt/skip assessment
- Plugin system (Python BYOF + pipelines) vs. no plugin system — is a plugin system necessary, or is MCP sufficient?
- RBAC (granular roles + groups) vs. Clerk-delegated — which features actually matter for NaW's audience?
- i18n (full internationalization) vs. English-only — is this aligned with NaW's positioning?
- UI richness (TipTap + CodeMirror + Mermaid + KaTeX + Leaflet) vs. Markdown renderer
- Community/ecosystem comparison — what can NaW learn about community building?

**NaW Files to Cross-Reference**:
- `app/components/` — All UI components
- `app/components/chat/` — Chat components
- `app/components/layout/settings/` — Settings UI
- `components/ui/` — Design system
- `.agents/research/competitive-feature-analysis.md` — Prior analysis

---

## 5. Phase 3: Synthesis & Recommendations

### Synthesis Agent — Prioritized Recommendations (`09-prioritized-recommendations.md`)

**Depends On**: `05-comparison-architecture.md`, `06-comparison-ai-capabilities.md`, `07-comparison-data-scalability.md`, `08-comparison-ux-extensibility.md`
**Also Reads**: `competitive-feature-analysis.md`, existing plans in `.agents/plans/`, `.agents/project/README.md`

**Mission**: Synthesize all comparison findings into a single, actionable, prioritized list of recommendations. Reconcile conflicts between comparison tracks. Cross-reference with existing implementation plans and the prior competitive feature analysis to produce a coherent, non-contradictory roadmap.

**Output Structure**:
1. **Strategic Assessment** — Where NaW has structural advantages vs. disadvantages
2. **Architectural Recommendations** — Foundational changes (not features)
3. **Feature Adoption Roadmap** — Prioritized by impact × feasibility, grouped into: Quick Wins, Foundation Work, Major Features, Strategic Investments
4. **Anti-Patterns to Avoid** — Things Open WebUI does that NaW should NOT copy
5. **Deliberately Excluded Features** — Features consciously rejected, with documented rationale
6. **NaW Unique Advantages to Protect** — Strengths to preserve, with risk assessment
7. **Implementation Dependencies** — Dependency graph for recommended changes
8. **Comparison with Existing Roadmap** — How recommendations align/conflict with existing plans
9. **Unresolved Conflicts** — Disagreements between tracks that need human decision

**Recommendation Criteria**:
- Aligns with "universal AI interface" positioning
- Prioritizes architecture/code quality (dimension 1)
- Favors fundamental improvements over surface-level feature parity
- Open to larger refactors that optimize for best-in-class foundations
- Preserves NaW's unique advantages (multi-model, BYOK, open-source, serverless)
- Consistent with existing implementation plans (or explicitly proposes changes to them)

**Conflict Resolution**: When Phase 2 agents disagree, resolve by: (1) checking alignment with "universal AI interface" positioning, (2) assessing evidence strength, (3) documenting both positions and resolution rationale in the "Unresolved Conflicts" section if no clear winner.

**Minimum recommendation payload** (required for each proposed change):
- Recommendation title
- Adopt / Adapt / Skip
- Evidence summary (`claim_id` references)
- Confidence (High/Medium/Low)
- User impact (1-5)
- Feasibility (1-5)
- Time to value (days/weeks/months)
- Operational cost impact (Low/Medium/High)
- Security/compliance impact (Low/Medium/High)
- Dependencies / blockers
- Risk if wrong

---

## 6. Execution Guidelines

### For Each Research Agent

1. **Clone/browse the repo**: Use GitHub raw URLs or local clone of `open-webui/open-webui@main`
2. **Read primary files first**: Start with the files listed in your section's "Files to Examine"
3. **Follow the code**: Trace execution paths, don't just catalog structure
4. **Document patterns, not just features**: "They use X pattern because Y" > "They have X"
5. **Note trade-offs**: Every architectural choice has pros and cons — document both
6. **Assess maintenance burden**: For every subsystem, ask "what is the ongoing cost of this?"
7. **Look for pain points**: Check GitHub issues, PRs, and discussions for signals of what doesn't work well
8. **Quantify where possible**: Lines of code, number of components, test coverage, dependency count
9. **Include code snippets**: Reference specific patterns worth studying (with file paths)
10. **Flag "gems"**: Particularly clever or well-designed patterns worth adopting
11. **Flag "warnings"**: Anti-patterns, tech debt, or poor decisions to avoid
12. **For every feature, assess**: Adopt (copy), Adapt (modify for NaW), or Skip (don't copy, with rationale)
13. **Tag comparability**: Directly comparable / conditionally comparable / not comparable
14. **Use confidence labels**: High/Medium/Low for each major conclusion
15. **Separate facts from interpretation**: include an evidence table for all major claims

### For Phase 2 Agents (Additional)

13. **Read ALL Phase 1 outputs**: Not just your primary dependency — prevents siloed analysis
14. **Read `competitive-feature-analysis.md`**: Understand established priorities before proposing new ones
15. **Cross-reference existing plans**: Check `.agents/plans/` for existing implementation decisions
16. **Flag conflicts**: If your recommendation contradicts another track or existing plan, note it explicitly
17. **Add stack-fit checks**: Explicitly validate serverless + Convex compatibility for each recommendation
18. **Avoid false parity**: Mark self-hosted-only Open WebUI capabilities as non-comparable unless a realistic NaW path exists

### Phase 1.5: Evidence Normalization Gate (New, Required)

Before Phase 2 begins, verify each Phase 1 document includes:
- Completed evidence table for all major claims
- Confidence labels for top conclusions
- Uncertainty and falsification section
- At least 3 concrete "adopt/adapt/skip" previews tied to evidence IDs

If any Phase 1 doc fails this gate, fix it before launching Phase 2.

### Output Format for Each Document

```markdown
# [Title]

> **Agent**: [Agent N]
> **Phase**: [1 or 2]
> **Status**: [Draft / In Progress / Complete]
> **Date**: [Date completed]

## Summary
[3-5 sentence executive summary]

## Findings
[Main analysis content organized by section]

## Tech Debt, Pain Points & Maintenance Burden
[What doesn't work well, what's expensive to maintain]

## Key Patterns Worth Studying
[Specific code patterns with file references]

## Concerns & Anti-Patterns
[Issues found, things to avoid]

## Unexpected Findings
[Anything surprising or not covered by planned sections]

## Recommendations Preview
[Top 3-5 recommendations, each marked: ADOPT / ADAPT / SKIP]
```

---

## 7. How to Execute This Plan

### Option A: Sequential (Single Agent)
Run agents 1, 2A, 2B, 3, 4 sequentially, then 5-8, then 9. ~5-7 hours total.

### Option B: Parallel (Multi-Agent)
- **Batch 1**: Launch Agents 1, 2A, 2B, 3, 4 simultaneously → ~1-1.5 hours
- **Batch 1.5**: Run evidence normalization gate for docs 01-04 → ~20-30 minutes
- **Batch 2**: Launch Agents 5, 6, 7, 8 simultaneously (using normalized Phase 1 outputs) → ~1 hour
- **Batch 3**: Launch Agent 9 (using Phase 2 outputs) → ~30 minutes
- **Total**: ~3-3.5 hours

### Option C: Hybrid (Recommended)
- **Batch 1**: Launch Agents 1 + 2A + 2B (architecture + AI — the three highest-priority dimensions)
- **Batch 2**: Launch Agents 3 + 4 (data + UX — can start slightly later)
- **Gate**: Run evidence normalization check on completed Phase 1 docs
- **Batch 3**: Launch Agents 5 + 6 as soon as Gate passes for docs 01/02/02b
- **Batch 4**: Launch Agents 7 + 8 as soon as Gate passes for docs 03/04
- **Batch 5**: Launch Agent 9 as soon as 5-8 complete

### Token Budget Warning
Agent 2B has the broadest scope (8 subsystems). If context limits are hit, prioritize: (1) tool calling + MCP, (2) RAG, (3) memories, (4) code execution. Image gen, audio, and web search can be covered at less depth.

---

## 8. Success Criteria

This research is complete when:

- [ ] All 10 documents (01, 02, 02b, 03, 04, 05, 06, 07, 08, 09) are written and marked "Complete"
- [ ] Every key Open WebUI subsystem is mapped and understood
- [ ] Both strengths AND weaknesses are documented for every subsystem
- [ ] Every feature is assessed as Adopt / Adapt / Skip with rationale
- [ ] Every major claim has evidence, confidence, and comparability tags
- [ ] Recommendations are prioritized by impact × feasibility
- [ ] Recommendations preserve NaW's unique advantages
- [ ] Recommendations are consistent with (or explicitly modify) existing NaW plans
- [ ] Deliberately excluded features are documented with rationale
- [ ] Phase 1.5 normalization gate is passed before Phase 2 starts
- [ ] The output is actionable — each recommendation includes enough detail to begin implementation

---

*Research plan authored February 12, 2026. Based on Open WebUI v0.7.2 (latest release Jan 10, 2026) and Not A Wrapper codebase at current commit.*
