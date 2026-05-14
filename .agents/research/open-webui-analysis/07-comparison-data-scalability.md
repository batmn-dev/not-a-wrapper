# Comparison: Data Layer & Scalability — Open WebUI vs. Not A Wrapper

> **Agent**: Agent 7
> **Phase**: 2 (Parallel)
> **Status**: Complete
> **Primary Dependency**: `03-data-layer-scalability.md`
> **Also Read**: `01-architecture-code-quality.md`, `02-ai-engine-tools.md`, `02b-tool-infrastructure.md`, `04-ux-features-extensibility.md`
> **Cross-Reference**: `competitive-feature-analysis.md` (prior ChatGPT/Claude comparison)
> **Date**: February 12, 2026

> **Important**: All Phase 1 outputs were read before writing. Primary focus is data/scalability (doc 03), with cross-cutting context from architecture (01), AI pipeline (02/02b), and UX (04).

---

## Summary

Open WebUI and Not A Wrapper represent fundamentally opposite data layer philosophies: **self-managed infrastructure with maximal configurability** vs. **managed services with minimal operational surface**. Open WebUI's SQLAlchemy + Redis + socket.io stack provides deployment flexibility (SQLite for single-user, PostgreSQL + Redis for multi-node) but requires operators to manually coordinate five infrastructure components, tune connection pools, and manage a dual migration system — with no published benchmarks proving capacity. NaW's Convex + Vercel stack eliminates operational burden entirely (zero connection pools, zero migration scripts, automatic real-time subscriptions) but trades away self-hosting capability, offline operation, and fine-grained infrastructure control. The most actionable findings are in observability (NaW has a critical gap), message storage design (NaW's normalized model is structurally superior), and caching (NaW likely doesn't need a server-side cache layer given Convex's architecture, but should monitor). Every data/scalability recommendation must be filtered through the managed-service lens: patterns designed for self-hosted Redis/PostgreSQL infrastructure are Not Comparable unless a realistic Convex/Vercel equivalent exists.

---

## Input Traceability (Required)

List the key Phase 1 claim IDs used in this comparison:
- `A3-*`: A3-C01 through A3-C18 (all 18 claims from data layer analysis — primary input)
- `A1-*`: A1-C01 (monolith orchestrator), A1-C03 (config explosion), A1-C04 (disabled CI), A1-C09 (JSON columns), A1-C10 (PersistentConfig), A1-C12 (default JWT secret)
- `A2A-*`: A2A-C05 (model cache TTL), A2A-C08 (content block streaming), A2A-C14 (no timeout protection)
- `A2B-*`: A2B-C06 (vector DB ABC), A2B-C07 (memory dual storage), A2B-C09 (RAG hybrid search), A2B-C13 (80+ RAG config params)
- `A4-*`: A4-C03 (flat Svelte stores), A4-C13 (performance degradation), A4-C16 (silent RAG failures), A4-C17 (config trap)

---

## Comparison Evidence Table (Required)

| claim_id | comparison_claim | phase1_claim_refs | confidence | stack_fit_for_naw | comparability | notes |
|----------|------------------|-------------------|------------|-------------------|---------------|-------|
| A7-C01 | NaW's normalized per-message Convex documents are structurally superior to OWUI's denormalized JSON blob pattern for message storage — enabling per-message indexing, efficient updates, and message-level features | A3-C02 | High | Strong | Directly Comparable | OWUI's read-modify-write pattern is O(n) per update; NaW's pattern is O(1) |
| A7-C02 | NaW's Convex subscriptions provide automatic real-time with zero configuration, while OWUI requires Redis + socket.io + manual event handling for equivalent functionality | A3-C06, A3-C04, A3-C17 | High | Strong | Conditionally Comparable | Convex manages pub/sub internally; OWUI's is explicit but more flexible for non-DB events |
| A7-C03 | NaW has no structured observability (traces, metrics, structured logs) beyond PostHog analytics and `toolCallLog` — a significant gap vs. OWUI's full OpenTelemetry integration | A3-C10, A3-C11 | High | Strong | Directly Comparable | Vercel has native OTEL support; NaW simply hasn't enabled it |
| A7-C04 | NaW has no audit logging middleware for API requests — OWUI's 4-level configurable audit system (NONE/METADATA/REQUEST/REQUEST_RESPONSE) is a pattern worth adopting | A3-C11 | High | Strong | Directly Comparable | Next.js middleware or Convex function wrappers can replicate this pattern |
| A7-C05 | OWUI's server-side Redis caching (model lists, sessions, shared state) has no NaW equivalent and likely doesn't need one — Convex handles caching internally and NaW's TanStack Query provides client-side stale-while-revalidate | A3-C04, A3-C17, A2A-C05 | Medium | Weak | Not Comparable | Redis solves multi-worker state sharing; NaW's serverless model eliminates this problem class |
| A7-C06 | NaW's Convex auto-managed schema eliminates OWUI's dual migration system (peewee + Alembic) and dialect-specific SQL — zero migration scripts, zero dialect branching | A3-C15, A3-C01 | High | Strong | Conditionally Comparable | Convex trades migration control for operational simplicity; OWUI's approach is more flexible but more fragile |
| A7-C07 | OWUI's 11 vector DB backends behind a clean ABC is impressive engineering but unnecessary for NaW — Convex's built-in vector search covers the single-backend need; multi-backend abstraction should be deferred until evidence of demand | A3-C05, A2B-C06 | High | Weak | Not Comparable | The VectorDBBase pattern is well-designed for reference if NaW ever needs a second backend |
| A7-C08 | NaW's Vercel serverless auto-scaling eliminates OWUI's entire horizontal scaling coordination problem (Redis, PostgreSQL, shared file storage, distributed locks) | A3-C04, A3-C12, A3-C16, A3-C17, A3-C18 | High | Strong | Not Comparable | Different problem domains — self-hosted scaling vs. managed scaling |
| A7-C09 | OWUI's 100+ env var configuration surface is an anti-pattern for NaW's managed deployment model — NaW's `lib/config.ts` with TypeScript validation is structurally superior | A3-C09, A1-C03, A4-C17 | High | Strong | Conditionally Comparable | OWUI's env vars serve self-hosted flexibility that NaW doesn't need |
| A7-C10 | NaW's Convex storage is simpler than OWUI's 4-backend file storage (Local/S3/GCS/Azure) but loses multi-cloud flexibility — acceptable trade-off for NaW's cloud-first positioning | A3-C08 | Medium | Partial | Not Comparable | OWUI's write-local-then-upload pattern is a cautionary lesson in hidden complexity |
| A7-C11 | OWUI's collaborative editing (Yjs CRDT + pycrdt + Redis) is sophisticated but adoption is unverified — NaW should defer this until clear user demand exists | A3-C07, A4-C03 | Medium | Weak | Conditionally Comparable | Yjs is available for React; the question is whether NaW's audience needs it |
| A7-C12 | Both systems lack published performance benchmarks — neither can make evidence-based capacity claims | A3-C13, A4-C13 | High | N/A | Directly Comparable | OWUI user reports suggest degradation at 100+ messages (A4-C13); NaW's limits are UNKNOWN |
| A7-C13 | NaW's `toolCallLog` table provides tool-call-level audit trailing that OWUI lacks at the database level — OWUI's audit is request-level (HTTP middleware), not operation-level | A3-C11 | Medium | Strong | Conditionally Comparable | Different granularity; both are valuable; NaW should add request-level audit alongside existing tool-level |
| A7-C14 | OWUI's heartbeat-writes-to-DB pattern (continuous `update_last_active` on every heartbeat) is an anti-pattern NaW should avoid — use Convex presence or client-side tracking instead | A3-C02 (pattern context) | High | Strong | Directly Comparable | Continuous DB writes for presence info creates unnecessary write load |
| A7-C15 | NaW's end-to-end TypeScript type safety (schema → query → component) eliminates OWUI's Python/JavaScript type boundary and dialect-specific SQL — reducing entire bug classes | A3-C01, A1-C09 | High | Strong | Conditionally Comparable | OWUI's Pydantic provides backend safety only; NaW has full-stack safety |

---

## 1. Database Philosophy

| Dimension | Open WebUI | Not A Wrapper | Trade-off Assessment |
|-----------|-----------|---------------|---------------------|
| Engine | SQLAlchemy (SQLite/PostgreSQL) | Convex (managed reactive DB) | OWUI offers deployment flexibility; NaW offers zero-ops. For cloud-first SaaS, NaW's approach is superior. For self-hosted/air-gapped, OWUI wins. |
| Schema | Explicit Python models + Alembic migrations | TypeScript schema, auto-managed | NaW eliminates migration scripts entirely. OWUI's dual peewee/Alembic system (A3-C15) is tech debt NaW avoids by design. |
| Queries | SQL via ORM with dialect-specific branching | Convex query/mutation functions (TypeScript) | NaW avoids the SQLite/PostgreSQL dialect split (A3-C01). All queries are single-dialect TypeScript functions with built-in auth context. |
| Real-time | Manual (socket.io + Redis pub/sub) | Automatic (Convex subscriptions) | NaW gets real-time "for free" via `useQuery`. OWUI requires Redis + socket.io + manual event wiring (A3-C06). NaW trades away custom event types (typing indicators, presence) unless modeled as DB state. |
| Vector search | 11 external vector DBs (A3-C05) | Built-in (Convex vector search) | OWUI's breadth is impressive but creates O(11) maintenance burden. NaW's single built-in option covers cloud-first needs. The `VectorDBBase` ABC (A2B-C06) is good reference architecture if a second backend is ever needed. |
| Type safety | Pydantic models (backend only) | End-to-end TypeScript (schema → query → component) | NaW's approach eliminates the Python/JavaScript type boundary entirely (A7-C15). Schema changes propagate type errors to all consumers at compile time. |

### Deep Comparison

**Where OWUI's model wins**: Self-hosted deployments where operators need to choose between SQLite (development/single-user), PostgreSQL (production/multi-user), and specific vector DB engines optimized for their workload. The ability to swap PostgreSQL for managed RDS or run SQLite on a Raspberry Pi serves the self-hosted community well.

**Where NaW's model wins**: Cloud-first deployments where operational burden matters more than infrastructure choice. Zero connection pool tuning (A3-C03 is not a problem NaW has), zero migration management (A3-C15 doesn't exist), zero dialect branching (A3-C01 is eliminated). Convex's document model with per-document indexing is also fundamentally better suited to chat applications than OWUI's JSON blob pattern (A3-C02).

**What NaW cannot do**: Run fully offline, use a specific enterprise-mandated database engine, or execute raw SQL for ad-hoc analytics. These are acceptable trade-offs for NaW's cloud-first positioning.

---

## 2. Schema Design Comparison

### 2.1 Chat & Message Storage

| Aspect | Open WebUI | Not A Wrapper | Assessment |
|--------|-----------|---------------|------------|
| Message storage | Single JSON blob in `chat.chat` column (A3-C02) | Normalized `messages` table with per-message rows | **NaW is structurally superior.** OWUI's pattern creates O(n) read-modify-write for each message update, prevents message-level indexing, and requires dialect-specific JSON queries. |
| Message search | Dialect-specific raw SQL (`json_each` for SQLite, `json_array_elements` for PostgreSQL) | Convex full-text search or indexed queries on `messages` table | NaW can index and query individual messages without parsing JSON at the database level. |
| Message metadata | Embedded in JSON blob | `parts` field (AI SDK format), `messageGroupId`, `orderId` | NaW's `parts` format is the Vercel AI SDK standard, ensuring compatibility with SDK evolution. |
| Chat-message relationship | Implicit (navigating `chat['history']['messages']`) | Explicit (`messages.by_chat` index) | NaW has proper foreign-key-like relationships with indexed lookups. |
| Write contention | High — entire chat JSON read-modify-written per message | Low — individual message documents inserted/updated independently | NaW's normalized model avoids the write amplification bottleneck. |

### 2.2 User & Auth Data

| Aspect | Open WebUI | Not A Wrapper | Assessment |
|--------|-----------|---------------|------------|
| User model | Full user table with auth fields, settings JSON, password hash | Lean `users` table; auth delegated to Clerk | NaW avoids storing sensitive auth data (passwords, tokens) in its database. Clerk handles session management, MFA, and token revocation. |
| User settings | JSON column on user row + Redis sync | `userPreferences` table (normalized) | NaW's separate preferences table is cleaner than OWUI's JSON settings blob. |
| API keys (BYOK) | Plaintext in `app.state.config` arrays | AES-256-GCM encrypted in `userKeys` table | NaW's encryption-at-rest for BYOK keys is a security advantage. |

### 2.3 File & Attachment Storage

| Aspect | Open WebUI | Not A Wrapper | Assessment |
|--------|-----------|---------------|------------|
| Storage options | Local, S3, GCS, Azure (A3-C08) | Convex built-in storage | OWUI offers multi-cloud flexibility; NaW offers simplicity. |
| Metadata | `ChatFile` junction table | `chatAttachments` table with `storageId` | Both use proper relational links. NaW's approach is simpler. |
| Upload flow | Write local → upload to cloud (all backends cache locally first) | Generate URL → direct client upload → save metadata mutation | NaW's direct upload avoids the server-as-middleman pattern. |
| Cascade deletes | `ChatFile` junction with foreign keys | Cleanup logic in Convex mutation on chat delete | OWUI has database-level cascades; NaW has application-level cleanup. |

### 2.4 Schema Evolution

| Aspect | Open WebUI | Not A Wrapper | Assessment |
|--------|-----------|---------------|------------|
| Migration system | Dual: peewee (legacy) → Alembic (current) (A3-C15) | Convex auto-managed (push schema, automatic migration) | NaW eliminates entire migration complexity. OWUI's dual system is acknowledged tech debt. |
| Breaking changes | Requires writing migration scripts for both peewee and Alembic | Schema changes deployed via `npx convex deploy` | NaW's approach is vastly simpler for additive changes; destructive changes require Convex's migration workflow. |
| Rollback | Alembic downgrade scripts (if written) | Convex snapshot restore | Different mechanisms; both have coverage gaps for complex rollbacks. |

---

## 3. Caching

| Dimension | Open WebUI | Not A Wrapper | Adopt / Adapt / Skip |
|-----------|-----------|---------------|----------------------|
| Server cache | Redis + aiocache (A3-C04, A2A-C05) | None (serverless, stateless) | **SKIP.** NaW's serverless model eliminates multi-worker state sharing. Convex handles query caching internally. Adding Redis would add infrastructure complexity for no proven benefit. |
| Client cache | Svelte stores (A4-C03) | Zustand + TanStack Query + IndexedDB | **NaW is superior.** TanStack Query provides stale-while-revalidate, cache invalidation, and background refetching. Svelte's 50+ flat stores lack structure and persistence. IndexedDB provides offline-capable local caching. |
| Session cache | Redis-backed sessions | Clerk (managed) | **SKIP.** Clerk handles session management entirely. Redis sessions are a self-hosted concern. |
| Model cache | In-memory + Redis (1s TTL) (A2A-C05) | TanStack Query stale-while-revalidate | **NaW is adequate.** Model lists change infrequently; TanStack Query's default stale-while-revalidate is appropriate. If model list fetches become a latency concern, Convex caching or edge caching can be added. |

### Analysis: Does NaW Need Server-Side Caching?

**Short answer: No, not currently.** The reasons OWUI needs Redis are:

1. **Multi-worker state sharing** (A3-C04, A3-C17) — NaW's serverless functions are stateless by design; there's no in-process state to share.
2. **WebSocket pub/sub across nodes** (A3-C06) — Convex subscriptions handle this automatically.
3. **Distributed locks for periodic tasks** (A3-C18) — NaW uses Convex cron jobs instead of per-worker cleanup tasks.
4. **Model list caching** (A2A-C05) — TanStack Query on the client provides equivalent functionality.

**When caching might become necessary**: If NaW adds API rate limiting that requires shared counters across serverless invocations, a caching layer (Convex itself, Vercel KV, or edge-level caching) would be needed. This should be addressed when the need materializes, not preemptively.

**What Convex provides implicitly**: Convex caches query results and invalidates on mutation. This means repeated `useQuery` calls for the same data don't re-execute the query function — they serve from Convex's internal cache until the relevant data changes. This is analogous to Redis + pub/sub invalidation but fully managed.

---

## 4. Real-Time Architecture

| Dimension | Open WebUI | Not A Wrapper | Trade-off Assessment |
|-----------|-----------|---------------|---------------------|
| Technology | socket.io + Redis pub/sub (A3-C06) | Convex subscriptions (automatic) | NaW's approach is zero-configuration. OWUI's provides more flexibility for custom events. |
| Setup complexity | High (manual event handling, Redis required for multi-node) | Low (automatic with `useQuery` hooks) | NaW developers write `useQuery(api.messages.getForChat, { chatId })` — real-time updates are automatic. OWUI requires defining socket events, rooms, and Redis pub/sub. |
| Scalability | Redis-backed multi-node (A3-C16 — Sentinel support) | Managed by Convex (scales automatically) | NaW developers never think about scaling real-time. OWUI operators must configure Redis Sentinel for HA. |
| Feature scope | Chat, presence, model usage, typing indicators, collaborative editing | Database queries (any data that changes) | OWUI supports non-DB events (typing indicators, model usage tracking). NaW's real-time is data-change-driven only. |
| Collaborative editing | Yjs + pycrdt + Redis (A3-C07) | Not implemented | OWUI has sophisticated CRDT-based collaborative note editing. NaW does not. |

### What NaW Gets "For Free" with Convex

1. **Automatic subscription management**: No socket.io rooms, no Redis channels, no manual event emission. If data changes in Convex, all subscribed clients see it immediately.
2. **Optimistic updates**: NaW's `optimisticOps` pattern (add/update/delete merged with server data) provides instant UI feedback while Convex confirms the mutation.
3. **Automatic reconnection**: Convex client handles connection drops and reconnects automatically — no custom retry logic needed.
4. **Consistent ordering**: Convex guarantees that queries reflect all mutations up to a consistent point — no eventual consistency surprises.

### What NaW Cannot Do Without Additional Work

1. **Typing indicators**: Requires modeling typing state as Convex data (a `typing` table or ephemeral field) rather than a socket event. This is feasible but adds write operations.
2. **Non-data events**: Custom events (user joined, model usage started) would need to be modeled as data changes or handled via a separate channel (e.g., Convex actions that push to client).
3. **Collaborative editing**: Yjs CRDTs (A3-C07) require a persistent connection and state management layer. If NaW ever implements collaborative features, Yjs libraries exist for React, but the Convex integration would need to be designed.

### Is Collaborative Editing (Yjs) Worth Studying for NaW?

**Not yet.** Evidence is mixed:
- The Yjs integration in OWUI is technically sophisticated (A3-C07) but adoption is **unverified** — Agent 4 found no user reports confirming it works in production (A4-C03 note on Yjs).
- NaW's current audience (individual AI chat users) doesn't have a clear collaborative editing use case.
- **Revisit if**: NaW adds project/team features where multiple users need to co-edit notes or documents. At that point, Yjs + Convex would be the natural architecture.

---

## 5. File Storage

| Dimension | Open WebUI | Not A Wrapper | Adopt / Adapt / Skip |
|-----------|-----------|---------------|----------------------|
| Options | Local, S3, GCS, Azure Blob (A3-C08) | Convex storage (single backend) | **SKIP multi-backend.** NaW's Convex storage is sufficient for cloud-first. Multi-cloud file storage adds operational complexity NaW doesn't need. |
| Configuration | Admin-configurable via env vars | Automatic (Convex-managed) | **SKIP configuration.** NaW's zero-config storage is a feature, not a limitation. |
| Processing | Compression, extraction, OCR, format conversion | Basic upload + serve | **ADAPT selectively.** If NaW adds RAG/document processing, a file processing pipeline (possibly via Convex actions calling extraction APIs) would be needed. This is feature-driven, not infrastructure-driven. |
| Local caching | All cloud providers write locally first, then upload | Direct client-to-Convex upload | **SKIP.** OWUI's write-local-then-upload pattern exists because the server processes files. NaW's direct upload is cleaner. |

### File Storage Gap Assessment

NaW's file storage is **adequate for current needs** (chat attachments). Gaps emerge only if:
- **RAG/document processing** is added (requires server-side file access for extraction)
- **Large file support** is needed (Convex storage has size limits — UNKNOWN exact limits; mark as unknown rather than guessing)
- **Multi-region redundancy** is required (Convex handles this internally; specifics are UNKNOWN)

---

## 6. Deployment & Scaling

| Dimension | Open WebUI | Not A Wrapper | Trade-off Assessment |
|-----------|-----------|---------------|---------------------|
| Model | Self-hosted (Docker/K8s/bare-metal) (A3-C12) | Managed (Vercel + Convex) | Fundamentally different philosophies. OWUI serves privacy-first/self-hosted users. NaW serves cloud-first users who want zero-ops. |
| Horizontal scaling | Redis sessions, multi-worker uvicorn, distributed locks (A3-C04, A3-C16, A3-C18) | Automatic (serverless auto-scaling) | NaW eliminates the entire scaling coordination problem. No Redis, no worker count tuning, no distributed locks. |
| GPU support | Native (:cuda, :ollama images) | N/A (cloud API only) | Not Comparable. NaW users access GPU compute via API providers, not local hardware. |
| Offline | Fully offline capable (Ollama + SQLite + local storage) | Requires internet (Convex + Clerk + API providers) | Not Comparable. Different audience requirements. NaW could add a guest/offline mode using IndexedDB only, but this is a product decision, not an infrastructure limitation. |
| Ops burden | High — manage DB, Redis, file storage, workers, SSL, backups (A3-C09) | Low — Vercel handles deployment, Convex handles data, Clerk handles auth | NaW's operational simplicity is a core advantage. |
| Cold start | None (persistent process) | Vercel serverless cold starts (typically <1s) | OWUI's persistent process has zero cold start. NaW's serverless functions have cold start latency. This is typically negligible for AI chat (streaming response latency dominates). |
| Cost model | Fixed (server cost regardless of usage) | Usage-based (scales with actual demand) | OWUI is cheaper at high constant load; NaW is cheaper at variable/low load. For a growing SaaS, usage-based is generally preferable. |

### Self-Hosted vs. Managed Trade-offs

**What NaW gains from serverless**:
- Zero infrastructure management for developers AND operators
- Automatic scaling from 0 to N concurrent users
- Pay-per-use cost model aligned with growth
- Global edge distribution (Vercel CDN)
- Built-in DDoS protection

**What NaW loses from serverless**:
- No self-hosting option for privacy-conscious users
- No offline capability
- No GPU access for local model inference
- Vendor dependency (Vercel + Convex)
- Cold start latency (minor for chat workloads)
- Less control over infrastructure tuning

**What use cases each approach serves better**:
- **OWUI**: Air-gapped environments, self-hosted enterprise, local LLM experimentation, regulatory compliance requiring data sovereignty
- **NaW**: SaaS users, BYOK cloud API users, developers wanting zero-ops, teams wanting managed infrastructure

---

## 7. Observability

| Dimension | Open WebUI | Not A Wrapper | Adopt / Adapt / Skip |
|-----------|-----------|---------------|----------------------|
| Tracing | OpenTelemetry (full stack, opt-in) (A3-C10) | None | **ADAPT.** Vercel has native OTEL support. NaW should enable it for API routes and Convex functions. This is the highest-priority observability gap. |
| Metrics | OpenTelemetry + custom (A3-C10) | PostHog (product analytics only) | **ADAPT.** Add application metrics (request latency, error rates, AI provider response times) via Vercel's OTEL integration. PostHog covers product analytics but not system health. |
| Audit | Custom ASGI middleware with 4 levels (A3-C11) | `toolCallLog` (tool calls only) | **ADAPT.** NaW's `toolCallLog` provides tool-level audit. Missing: request-level audit for API routes (who did what, when). Implement as Convex function wrapper or Next.js middleware. |
| Logging | Loguru (structured) | `console.log` (basic) | **ADAPT.** Move to structured logging (pino or Vercel's built-in logging). `console.log` is inadequate for production debugging. |

### What NaW Should Adopt for Observability

**Priority 1: Structured tracing (ADAPT from A3-C10)**
- Enable Vercel's native OpenTelemetry support for API routes
- Add custom spans for: AI provider calls (latency, tokens, model), Convex mutations (operation type, affected records), BYOK key decryption operations
- Include user ID and request ID in all spans for correlation

**Priority 2: Request-level audit logging (ADAPT from A3-C11)**
- NaW already has `toolCallLog` for tool call auditing — good foundation
- Add a general `auditLog` pattern for sensitive operations: BYOK key creation/deletion, chat sharing, admin actions
- Start with METADATA level (user, action, timestamp, resource) — body capture can be added later
- Consider Convex's built-in `_audit` table if available, or create a custom `auditEvents` table

**Priority 3: Structured logging (ADAPT)**
- Replace `console.log` with pino (Next.js compatible) or Vercel's structured logging
- Include request IDs, user IDs, and operation context in all log entries
- Set up log levels (error, warn, info, debug) with production defaulting to warn+

**Vercel-Native Approach**: Vercel provides built-in observability via:
- **Runtime logs**: Accessible via dashboard and API
- **Speed Insights**: Core Web Vitals and performance metrics
- **OTEL export**: Can forward traces to Datadog, Grafana, etc.
- This means NaW doesn't need to build OTEL infrastructure — just enable and configure what Vercel provides.

---

## 8. Gaps & Opportunities

### Where NaW's Data Layer Falls Short

| Gap | Impact | Severity | Resolution Complexity |
|-----|--------|----------|----------------------|
| **No structured observability** (A7-C03) | Cannot debug production issues efficiently; no latency baselines; no error rate tracking | High | Low — Vercel OTEL enablement is configuration, not code |
| **No request-level audit logging** (A7-C04) | Cannot answer "who did what, when" for compliance or debugging | Medium | Low — Convex table + function wrapper pattern |
| **Basic logging** (`console.log`) | Production debugging is grep-based; no structured search | Medium | Low — pino adoption is straightforward |
| **No presence/typing indicators** | Cannot show "user is typing" or "user is online" | Low | Medium — requires Convex data model for ephemeral state |
| **No collaborative editing** | Cannot co-edit documents or notes | Low | High — requires Yjs integration and new data model |
| **Convex storage size limits** | UNKNOWN — may be a constraint for large file uploads | UNKNOWN | UNKNOWN — need to verify Convex storage limits |

### Where NaW's Approach Is Inherently Better (Protect These)

| Advantage | Why It Matters | Risk if Lost |
|-----------|---------------|--------------|
| **Normalized per-message storage** (A7-C01) | O(1) message updates, per-message indexing, no write contention | OWUI's JSON blob pattern (A3-C02) is a cautionary anti-pattern that causes real performance issues |
| **Zero-ops real-time** (A7-C02) | Developers never configure pub/sub infrastructure; real-time is automatic | Adding manual event systems would re-introduce the complexity Convex eliminates |
| **End-to-end type safety** (A7-C15) | Schema changes propagate compile-time errors to all consumers | Introducing untyped JSON columns would erode this advantage |
| **No migration management** (A7-C06) | Schema evolution is push-and-deploy, not write-migration-scripts | Custom migration logic would re-introduce the tech debt OWUI suffers from (A3-C15) |
| **Encrypted BYOK keys** | AES-256-GCM at rest vs. OWUI's plaintext arrays in memory | Weakening encryption would be a security regression |
| **Usage-based scaling** (A7-C08) | Cost scales with demand; no capacity planning needed | Moving to fixed infrastructure would trade this advantage for control |

### Architectural Change vs. Incremental Improvement

| Category | Items |
|----------|-------|
| **Incremental (no architecture change)** | Enable Vercel OTEL, add audit log table, adopt pino logging, add structured error responses |
| **Moderate (new Convex tables/patterns)** | Typing indicators via ephemeral Convex data, request-level audit table, presence tracking |
| **Architectural (requires design work)** | Collaborative editing (Yjs + Convex), multi-backend file storage, offline/guest mode with sync |

---

## 9. Unexpected Findings

1. **NaW already has better tool-call auditing than OWUI at the database level.** NaW's `toolCallLog` table (with `source`, `serviceName`, `inputPreview`, `outputPreview`, `durationMs`, `success`, `error`) provides structured, queryable tool call audit data that OWUI's request-level ASGI middleware doesn't capture at the same granularity. OWUI logs HTTP requests; NaW logs semantic operations. Both are needed, but NaW has the harder one already.

2. **OWUI's "optional Redis" is effectively mandatory for any serious deployment.** The documentation says Redis is optional, but without it: no cross-worker state sharing (A3-C04), no WebSocket scaling (A3-C06), no collaborative editing (A3-C07), no token revocation (A1-C12 context), and in-memory dicts grow unbounded. NaW avoids this "optional but actually required" trap entirely because Convex handles all shared state.

3. **OWUI's heartbeat pattern writes to the database on every heartbeat event.** `Users.update_last_active_by_id()` is called continuously for active users (A3-C02 context). This creates unnecessary write load that NaW should explicitly avoid — use Convex presence features or client-side last-active tracking with periodic sync instead.

4. **NaW's IndexedDB layer provides offline-like capabilities that OWUI's SQLite doesn't for its web users.** OWUI's SQLite runs server-side; the web client has no local persistence. NaW's IndexedDB persistence (`idb-keyval` for chats, messages, sync) means the client retains data even when disconnected — closer to a native app experience.

5. **The Convex caching story is underappreciated.** Convex internally caches query results and invalidates on mutation — this is functionally equivalent to Redis caching + pub/sub invalidation, but fully managed. NaW doesn't need to build a caching layer because it already has one it doesn't see.

---

## 10. Recommendations

| Recommendation | Verdict | Confidence | Evidence Count | User Impact (1-5) | Feasibility (1-5) | Time to Value | Ops Cost Impact | Security Impact | Dependencies | Risk if Wrong |
|----------------|---------|------------|----------------|-------------------|-------------------|---------------|-----------------|-----------------|--------------|---------------|
| **R1: Enable Vercel OpenTelemetry for API routes and AI provider calls** | ADAPT | High | 3 (A3-C10, A7-C03, A4-C13) | 4 — enables production debugging, latency monitoring, error tracking | 5 — Vercel config + minimal code changes | Days | Low (Vercel built-in) | Low (no sensitive data in traces if configured correctly) | Vercel Pro plan for advanced OTEL export | Low — worst case is unused trace data |
| **R2: Add request-level audit logging for sensitive operations** | ADAPT | High | 3 (A3-C11, A7-C04, A7-C13) | 3 — enables compliance, debugging, admin transparency | 4 — Convex table + function wrapper | 1-2 weeks | Low (Convex storage) | Medium (audit trail improves security posture) | `auditEvents` Convex table; admin UI for viewing | Low — adds observability; can start minimal |
| **R3: Adopt structured logging (pino) replacing console.log** | ADAPT | High | 2 (A3-C10, A7-C03) | 3 — enables log search, alerting, correlation | 5 — library swap, search-and-replace | Days | Low | Low | None | Very Low — strictly better than console.log |
| **R4: Protect normalized message storage — never adopt JSON blob pattern** | SKIP (anti-pattern) | High | 3 (A3-C02, A7-C01, A4-C13) | 5 — prevents O(n) write amplification that degrades at scale | 5 — already implemented correctly | Immediate | None | None | N/A — defensive recommendation | Low — OWUI's pattern is a documented pain point |
| **R5: Skip server-side caching layer (Redis equivalent)** | SKIP | Medium | 4 (A3-C04, A3-C17, A2A-C05, A7-C05) | 1 — no user-visible benefit currently | 5 — nothing to implement | Immediate | Negative (avoids infrastructure cost) | None | Monitor Convex query latency; revisit if bottlenecks emerge | Medium — if Convex query performance degrades under load, a cache layer may be needed |
| **R6: Skip multi-backend vector DB abstraction** | SKIP | High | 3 (A3-C05, A2B-C06, A7-C07) | 1 — NaW users don't choose vector backends | 5 — nothing to implement | Immediate | Negative (avoids maintenance burden) | None | Monitor Convex vector search performance; keep VectorDBBase as reference pattern | Medium — if Convex vector search hits scaling limits, migration is harder without abstraction |
| **R7: Skip env-var-heavy configuration pattern** | SKIP | High | 3 (A3-C09, A1-C03, A4-C17) | 2 — protects DX by keeping config surface small | 5 — already using `lib/config.ts` | Immediate | Negative (avoids config complexity) | Low | Maintain TypeScript config with validation | Low — centralized typed config is strictly better for cloud-first |
| **R8: Defer collaborative editing (Yjs) until user demand is proven** | SKIP (for now) | Medium | 2 (A3-C07, A7-C11) | 2 — no current user demand signal | N/A (deferred) | N/A | N/A | None | Clear user demand + team/project feature development | Medium — if competitors ship collab editing and it drives adoption, NaW would be behind |
| **R9: Add presence/typing indicators via Convex data model** | ADAPT | Low | 2 (A3-C06, A7-C02) | 2 — useful for shared chats but not critical for individual use | 3 — requires ephemeral Convex data model design | Weeks | Low (Convex storage for ephemeral data) | None | Shared chat feature must exist first | Low — worst case is underused feature |
| **R10: Avoid heartbeat-writes-to-DB anti-pattern** | SKIP (anti-pattern) | High | 1 (A7-C14) | 3 — prevents unnecessary write load as user base grows | 5 — defensive design choice | Immediate | Negative (avoids unnecessary DB writes) | None | N/A — defensive recommendation | Very Low — continuous DB writes for presence is a proven anti-pattern |

---

## Conflict Ledger (Required)

| Conflict ID | With Doc | Conflict Summary | Proposed Resolution | Escalate to Phase 3? |
|-------------|----------|------------------|---------------------|----------------------|
| A7-X01 | 05 (Architecture) | Architecture comparison (Agent 5) may recommend PersistentConfig pattern (A1-C10) for runtime-mutable admin settings. This requires Convex as persistence + real-time sync layer, which is consistent with A7's "Convex handles caching internally" conclusion. However, if Agent 5 recommends Redis for config sync, that conflicts with A7-R5 (skip server-side caching). | **Resolution**: Use Convex for config persistence and real-time sync. No Redis needed. Convex subscriptions provide the same env→DB→sync pattern that OWUI achieves with PersistentConfig→Redis. | Yes — confirm Convex-only approach for runtime config |
| A7-X02 | 06 (AI Capabilities) | AI comparison (Agent 6) may recommend model list caching. OWUI uses Redis with 1s TTL (A2A-C05). A7-R5 says skip server-side caching. | **Resolution**: Model list caching should use TanStack Query on the client (stale-while-revalidate) or Convex queries with built-in caching. No need for a separate server-side cache layer. If model list fetches are slow, optimize the provider API call, not add a cache layer. | No — TanStack Query or Convex caching covers this |
| A7-X03 | 08 (UX/Extensibility) | UX comparison (Agent 8) may identify that OWUI's silent RAG failures (A4-C16) are a data layer issue (extraction pipeline failures not propagated to UI). A7's observability recommendations (R1, R2, R3) would help surface these failures, but the fix also requires UI-level error display. | **Resolution**: Observability (A7 scope) + UI error feedback (Agent 8 scope) are complementary. Both are needed. No conflict — just ensure recommendations from both tracks are implemented together. | No — complementary, not conflicting |
| A7-X04 | 09 (Synthesis) | A7-R8 defers collaborative editing. If Agent 8 or synthesis (Agent 9) identifies strong user demand signals from OWUI's community, the deferral may need to be reconsidered. | **Resolution**: Maintain deferral unless Phase 3 synthesis surfaces concrete user demand evidence (e.g., from NaW's own user feedback, not just OWUI's feature list). Feature existence in a competitor is not sufficient justification. | Yes — synthesis should validate demand signal |
| A7-X05 | All | A7-C12 notes that **neither system has published performance benchmarks**. Any performance-related recommendation from other tracks (latency claims, throughput estimates, user capacity) should be treated as UNKNOWN unless backed by benchmark data. | **Resolution**: All comparison documents should mark performance claims as UNKNOWN where no benchmark evidence exists. Inference from code patterns (e.g., "O(n) write amplification suggests degradation at scale") is acceptable with explicit caveats. | Yes — Phase 3 should establish a consistent "mark unknowns" policy |

---

**NaW Files Cross-Referenced**:
- `convex/schema.ts` — Full schema with 12 tables, normalized messages, indexed queries
- `convex/` — Mutation and query functions (auth patterns, optimistic updates)
- `lib/chat-store/` — ChatsProvider, MessagesProvider, IndexedDB persistence, optimistic ops
- `README.md` — current project map

---

*Generated as part of Open WebUI competitive analysis. See `00-research-plan.md` for full plan.*
