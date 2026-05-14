# WebClaw & OpenClaw Competitive Codebase Analysis — Research Plan

> **Date**: February 15, 2026
> **Repository**: [ibelick/webclaw](https://github.com/ibelick/webclaw) (470 stars, ~80 commits)
> **Platform**: [OpenClaw](https://docs.openclaw.ai) — self-hosted AI gateway for messaging apps
> **Purpose**: Deep codebase analysis of WebClaw, investigation of the OpenClaw gateway protocol, comparison with Not A Wrapper, and prioritized recommendations for patterns, components, and UX improvements.
> **Prior Art**: See `../open-webui-analysis/SUMMARY.md` for Open WebUI competitive research (Feb 12, 2026). See `../competitive-feature-analysis.md` for ChatGPT/Claude feature comparison (Feb 6, 2026).

---

## 0. Research Quality Contract (Required)

Every document in this research track must follow a shared evidence contract so Phase 3 can compare claims directly and integrate with findings from the Open WebUI research track.

### Required Evidence Record Per Major Claim

Each major finding must include:

| Field | Description |
|-------|-------------|
| `claim_id` | Unique ID (format: `WC-A{agent}-C{nn}`, e.g. `WC-A1-C01`) |
| `claim` | The assertion being made |
| `evidence_type` | Code / docs / convention / pattern / benchmark |
| `source_refs` | File paths (GitHub URLs) or doc URLs used as evidence |
| `confidence` | High / Medium / Low |
| `impact_area` | Architecture / UX / performance / DX / streaming / state |
| `transferability` | Direct (same stack) / Adaptable (different infra, same concept) / Non-transferable |
| `notes` | Caveats and assumptions |

### Required Uncertainty Capture

Each document must include:
- Top 3 unresolved questions
- What evidence would change the top conclusions ("falsification criteria")
- Which claims are based on inference rather than direct evidence

### Transferability Guardrail

Agents must explicitly tag findings as one of:
- **Directly Transferable**: Same React 19 + Base UI + Tailwind 4 + TanStack Query + Zustand stack — patterns can be lifted with minimal modification
- **Adaptable**: Different infrastructure assumptions (TanStack Router/Start vs Next.js, WebSocket gateway vs direct provider streaming) but transferable concept
- **Non-Transferable**: Tied to OpenClaw gateway protocol, single-agent architecture, or TanStack Start/Nitro server assumptions NaW does not share

This prevents false parity conclusions between WebClaw's single-gateway client and NaW's multi-provider multi-model platform.

---

## 1. Executive Context

### WebClaw at a Glance

| Layer | Technology |
|-------|------------|
| Framework | TanStack Start (Nitro/Vite) + TanStack Router, React 19 |
| Server State | TanStack Query |
| Client State | Zustand |
| UI | Base UI (`@base-ui/react ^1.1.0`) + Tailwind CSS 4, CVA, clsx, tailwind-merge |
| Streaming | WebSocket (gateway events) → React state → streamdown + Shiki |
| Animation | motion |
| Scroll | use-stick-to-bottom |
| Testing | Vitest |
| Deployment | Monorepo: `apps/webclaw` (web app) + `packages/webclaw` (CLI via npx) |

### Not A Wrapper at a Glance

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Server State | TanStack Query + Convex subscriptions |
| Client State | Zustand |
| UI | Shadcn/Base UI + Tailwind CSS 4 |
| Streaming | Vercel AI SDK → multi-provider (OpenAI, Claude, Gemini, etc.) |
| Database | Convex (reactive DB + built-in RAG) |
| Auth | Clerk |
| Deployment | Vercel (managed serverless) |

### Shared Stack Surface (Why This Research Matters)

WebClaw and NaW share an unusually high stack overlap:

| Shared Technology | NaW | WebClaw |
|-------------------|-----|---------|
| React 19 | Yes | Yes |
| Base UI (`@base-ui/react`) | Yes | Yes |
| Tailwind CSS 4 | Yes | Yes |
| TanStack Query | Yes | Yes |
| Zustand | Yes | Yes |
| TypeScript | Yes | Yes |
| Vitest | Yes | Yes |

This makes WebClaw's patterns **directly transferable** in a way that Open WebUI's SvelteKit + Python patterns were not. Any React component pattern, hook decomposition, Base UI usage, or TanStack Query strategy they employ can be evaluated for direct adoption.

### Research Dimensions (Prioritized)

1. **Chat UX & Component Architecture** — highest priority (prompt-kit, hook decomposition, streaming UX)
2. **Performance Patterns** — memoization, streaming efficiency, re-render avoidance
3. **Base UI Usage** — direct comparison since we share the same library
4. **State Management & Data Flow** — TanStack Query patterns, optimistic updates, Zustand usage
5. **Architecture & Code Quality** — TanStack Start patterns, module organization, conventions

### Research Framing

**This research mines for implementation patterns, UX polish, and performance techniques from a codebase that shares our core stack.** Unlike the Open WebUI analysis (which studied a fundamentally different stack for architectural lessons), this analysis focuses on **directly adoptable patterns** from a team building with the same tools we use.

**This research focuses on:**
- **Component quality**: How does their prompt-kit compare to our chat components? What's better?
- **Hook decomposition**: Their 13+ focused chat hooks vs our `use-chat-core.ts` monolith
- **Performance patterns**: Their documented memoization strategies, streaming optimizations, re-render avoidance
- **Base UI patterns**: Direct comparison of how they use the same UI library we do
- **Streaming UX**: Their gateway WebSocket → streamdown → Shiki pipeline vs our Vercel AI SDK approach
- **Intentional simplicity**: What can we learn from their philosophy of doing less, better?

**Every analysis must assess both strengths AND weaknesses.** WebClaw is intentionally minimal — document where that simplicity is a strength (better UX, better performance) and where it's a limitation (missing features users need).

**Bias control rule**: Do not defend existing NaW patterns by default. If WebClaw's approach is cleaner, say so. If NaW's approach is better, say so. Prefer disconfirming evidence.

**Scale calibration**: WebClaw is ~80 commits, ~470 stars, one main contributor. This is a focused, opinionated client — not a platform. Research depth should match this scope (3 Phase 1 agents, 2 Phase 2 agents, 1 Phase 3 agent — vs 5/4/1 for Open WebUI).

---

## 2. Research Architecture

### Parallel Agent Structure

```
┌───────────────────────────────────────────────────────────────────────────┐
│                  PHASE 1: WEBCLAW & OPENCLAW DEEP DIVE                    │
│                        (3 agents in parallel)                             │
├──────────────────────┬──────────────────────┬─────────────────────────────┤
│       Agent 1        │       Agent 2        │          Agent 3            │
│    ARCHITECTURE      │    CHAT UX,          │    STATE MANAGEMENT,        │
│    & CODE QUALITY    │    STREAMING &        │    PERFORMANCE &            │
│    + OPENCLAW        │    COMPONENTS         │    DATA FLOW                │
│    PROTOCOL          │                      │                             │
│                      │                      │                             │
│  01-architecture     │  02-chat-ux          │  03-state-performance       │
│     -gateway.md      │     -components.md   │     -data-flow.md           │
└──────────┬───────────┴──────────┬───────────┴──────────────┬──────────────┘
           │                      │                           │
           ▼                      ▼                           ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                    PHASE 2: COMPARISON & MAPPING                          │
│            (2 agents in parallel — each reads ALL Phase 1 outputs)        │
├───────────────────────────────────┬───────────────────────────────────────┤
│            Agent 4                │              Agent 5                  │
│     ARCHITECTURE &                │       UI, CHAT UX &                  │
│     PATTERN COMPARISON            │       PERFORMANCE COMPARISON          │
│                                   │                                       │
│     04-cmp-architecture.md        │       05-cmp-ux-performance.md        │
└────────────────┬──────────────────┴──────────────────┬────────────────────┘
                 │                                      │
                 ▼                                      ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                PHASE 3: SYNTHESIS & RECOMMENDATIONS                       │
│                         (1 agent, sequential)                             │
│                                                                           │
│                    06-recommendations.md                                   │
└───────────────────────────────────────────────────────────────────────────┘
```

### Document Map

| Doc ID | File | Agent | Phase | Primary Dep | Also Reads |
|--------|------|-------|-------|-------------|------------|
| 01 | `01-architecture-gateway.md` | Agent 1 | 1 (parallel) | — | — |
| 02 | `02-chat-ux-components.md` | Agent 2 | 1 (parallel) | — | — |
| 03 | `03-state-performance-data-flow.md` | Agent 3 | 1 (parallel) | — | — |
| 04 | `04-cmp-architecture.md` | Agent 4 | 2 (parallel) | 01 | 02, 03 |
| 05 | `05-cmp-ux-performance.md` | Agent 5 | 2 (parallel) | 02, 03 | 01 |
| 06 | `06-recommendations.md` | Synthesis | 3 (sequential) | 04, 05 | All Phase 1 + Open WebUI research |

> Note: This folder contains `00` + docs `01-06` (7 markdown files total). Execution outputs are the six research documents `01`–`06`.

---

## 3. Phase 1: WebClaw & OpenClaw Deep Dive

### Agent 1 — Architecture & Code Quality + OpenClaw Protocol (`01-architecture-gateway.md`)

**Mission**: Map WebClaw's full application architecture — TanStack Start/Router setup, server/client boundary, the gateway.ts WebSocket client, OpenClaw protocol, route structure, screen-based module pattern, code quality practices, testing strategy. Also investigate the OpenClaw Gateway protocol using docs at https://docs.openclaw.ai.

**Scope Boundary**: Owns system architecture, routing, server layer, gateway protocol, module organization, code conventions, testing. Chat-specific UI components belong to Agent 2. State management internals and performance patterns belong to Agent 3.

**Key Questions to Answer**:
1. How is TanStack Start/Router configured? (Nitro server, Vite build, file-based routing)
2. What is the server/client boundary? (`server/gateway.ts` as the only server file — how does it work?)
3. How does `gateway.ts` implement connection pooling? (shared client Map, RPC pattern, event streaming)
4. What is the OpenClaw Gateway WebSocket protocol? (req/res/event framing, auth handshake, session management)
5. How does the screen-based module pattern work? (`screens/chat/` as a self-contained feature module — is this a pattern we should adopt?)
6. What is the route structure? (file-based routing, layout composition, route loaders)
7. What are the code conventions? (`function` keyword, `type` over `interface`, kebab-case, no `useEffect` for render logic)
8. What is the testing strategy? (Vitest setup, what's tested, what's NOT tested)
9. How does the monorepo structure work? (`apps/webclaw` + `packages/webclaw` CLI)
10. **Where does the architecture show strain?** (any signs of tech debt in 80 commits?)
11. **What does the OpenClaw protocol offer that direct-provider streaming doesn't?** (agent routing, session persistence, multi-app bridging)

**Files/Directories to Examine**:

```
# GitHub base: https://github.com/ibelick/webclaw/tree/main/apps/webclaw/src

# Core architecture
apps/webclaw/src/router.tsx                    # TanStack Router config
apps/webclaw/src/routeTree.gen.ts              # Auto-generated route tree
apps/webclaw/src/routes/__root.tsx             # Root layout
apps/webclaw/src/routes/index.tsx              # Home page
apps/webclaw/src/routes/connect.tsx            # Gateway connection page
apps/webclaw/src/routes/new.tsx                # New chat page
apps/webclaw/src/routes/chat/$sessionKey.tsx   # Chat session route
apps/webclaw/src/routes/api/                   # API routes

# Server layer
apps/webclaw/src/server/gateway.ts             # OpenClaw Gateway WebSocket client
                                                # (connection pooling, RPC, event streaming, auth)

# Module structure
apps/webclaw/src/screens/chat/                 # Self-contained chat feature module
apps/webclaw/src/screens/chat/chat-screen.tsx  # Main chat screen component
apps/webclaw/src/screens/chat/types.ts         # TypeScript types

# Config & conventions
apps/webclaw/package.json                      # Dependencies, scripts
apps/webclaw/tsconfig.json                     # TypeScript config
apps/webclaw/vite.config.ts                    # Vite/Nitro config (if exists)
apps/webclaw/app.config.ts                     # TanStack Start config (if exists)
AGENTS.md                                      # Their conventions
CONTRIBUTING.md                                # Contributing guidelines

# Monorepo structure
packages/webclaw/                              # CLI installer package
package.json                                   # Root workspace config

# Testing
apps/webclaw/vitest.config.ts                  # Vitest config (if exists)
apps/webclaw/src/**/*.test.*                   # Test files
```

**OpenClaw Protocol Investigation**:

```
# External documentation
https://docs.openclaw.ai                       # Gateway docs landing
https://docs.openclaw.ai/protocol              # WebSocket protocol spec (if exists)
https://docs.openclaw.ai/api                   # API reference (if exists)

# Infer protocol from client code
apps/webclaw/src/server/gateway.ts             # Primary source of protocol understanding
apps/webclaw/src/screens/chat/types.ts         # GatewayMessage types reveal protocol shape
apps/webclaw/src/screens/chat/hooks/use-chat-stream.ts  # How events are consumed
```

---

### Agent 2 — Chat UX, Streaming & Components (`02-chat-ux-components.md`)

**Mission**: Deep dive into WebClaw's chat implementation — the prompt-kit component library, streaming pipeline (gateway WebSocket events → React state → rendered markdown), 13+ chat hooks decomposition, composer architecture, sidebar/session management, and Base UI usage patterns. This is the highest-value area of the analysis given our shared stack.

**Scope Boundary**: Owns all UI components, chat UX, component architecture, hook decomposition, streaming rendering, and Base UI patterns. The gateway protocol itself belongs to Agent 1. State management internals and performance optimization belong to Agent 3.

**Key Questions to Answer**:
1. What is the prompt-kit component library? (full inventory: chat-container, markdown, message, prompt-input, code-block, thinking, tool, scroll-button, typing-indicator, text-shimmer)
2. How does streaming markdown rendering work? (streamdown + Shiki pipeline — latency, chunking, syntax highlighting during stream)
3. How are the 13+ chat hooks decomposed? (responsibilities, dependencies, composition pattern)
   - `use-chat-stream` — core streaming logic
   - `use-chat-history` — message history management
   - `use-chat-sessions` — session CRUD
   - `use-chat-error-state` — error handling
   - `use-chat-generation-guard` — generation lifecycle
   - `use-chat-measurements` — performance metrics?
   - `use-chat-mobile` — mobile adaptations
   - `use-chat-pending-send` — optimistic send
   - `use-chat-redirect` — navigation logic
   - `use-chat-settings` — settings management
   - `use-delete-session` — session deletion
   - `use-rename-session` — session rename
   - `use-session-shortcuts` — keyboard shortcuts
4. How does the composer work? (prompt-input architecture, attachment handling, local state management)
5. How does the sidebar work? (session list, pinned sessions, search, mobile drawer)
6. What is the context-meter component? (token counting? context window visualization?)
7. How does the gateway-status component work? (connection state display)
8. How does the settings-dialog work? (model selection, configuration)
9. How do they use Base UI? (which primitives: alert-dialog, autocomplete, button, collapsible, command, dialog, input, menu, preview-card, scroll-area, switch, tabs, tooltip)
10. **What is the component composition pattern?** (props vs children vs render props vs compound components)
11. **How do they handle responsive design / mobile?** (`use-chat-mobile` hook)
12. **What animations/transitions do they use?** (motion library usage patterns)
13. **How does the export functionality work?** (`use-export` hook)

**Files/Directories to Examine**:

```
# GitHub base: https://github.com/ibelick/webclaw/tree/main/apps/webclaw/src

# Prompt-kit component library
components/prompt-kit/chat-container.tsx        # Chat layout container
components/prompt-kit/markdown.tsx              # Streaming markdown renderer (streamdown + Shiki)
components/prompt-kit/message.tsx               # Message bubble component
components/prompt-kit/prompt-input.tsx          # Input/composer component
components/prompt-kit/code-block.tsx            # Syntax-highlighted code blocks
components/prompt-kit/thinking.tsx              # AI thinking/reasoning display
components/prompt-kit/tool.tsx                  # Tool call/result display
components/prompt-kit/scroll-button.tsx         # Scroll-to-bottom button
components/prompt-kit/typing-indicator.tsx      # Typing animation
components/prompt-kit/text-shimmer.tsx          # Text shimmer effect
components/prompt-kit/                          # Any other prompt-kit components

# Base UI primitives
components/ui/alert-dialog.tsx                  # Alert dialog wrapper
components/ui/autocomplete.tsx                  # Autocomplete wrapper
components/ui/button.tsx                        # Button wrapper
components/ui/collapsible.tsx                   # Collapsible wrapper
components/ui/command.tsx                       # Command palette wrapper
components/ui/dialog.tsx                        # Dialog wrapper
components/ui/input.tsx                         # Input wrapper
components/ui/menu.tsx                          # Menu wrapper
components/ui/preview-card.tsx                  # Preview card wrapper
components/ui/scroll-area.tsx                   # Scroll area wrapper
components/ui/switch.tsx                        # Switch wrapper
components/ui/tabs.tsx                          # Tabs wrapper
components/ui/tooltip.tsx                       # Tooltip wrapper

# Chat screen components
screens/chat/components/composer.tsx            # Chat input composer
screens/chat/components/header.tsx              # Chat header
screens/chat/components/message-list.tsx        # Message list container
screens/chat/components/sidebar.tsx             # Session sidebar
screens/chat/components/message-item.tsx        # Individual message row
screens/chat/components/context-meter.tsx       # Context window meter
screens/chat/components/gateway-status.tsx      # Connection status
screens/chat/components/settings-dialog.tsx     # Settings UI
screens/chat/components/                        # Any other chat components

# Chat hooks (13+ files)
screens/chat/hooks/use-chat-stream.ts           # Core streaming hook
screens/chat/hooks/use-chat-history.ts          # History management
screens/chat/hooks/use-chat-sessions.ts         # Session CRUD
screens/chat/hooks/use-chat-error-state.ts      # Error state
screens/chat/hooks/use-chat-generation-guard.ts # Generation lifecycle
screens/chat/hooks/use-chat-measurements.ts     # Measurements/metrics
screens/chat/hooks/use-chat-mobile.ts           # Mobile adaptations
screens/chat/hooks/use-chat-pending-send.ts     # Optimistic send
screens/chat/hooks/use-chat-redirect.ts         # Navigation
screens/chat/hooks/use-chat-settings.ts         # Settings
screens/chat/hooks/use-delete-session.ts        # Delete session
screens/chat/hooks/use-rename-session.ts        # Rename session
screens/chat/hooks/use-session-shortcuts.ts     # Keyboard shortcuts

# Main screen
screens/chat/chat-screen.tsx                    # Orchestrating component

# Global hooks
hooks/use-chat-settings.ts                      # Global chat settings
hooks/use-export.ts                             # Export functionality
hooks/use-pinned-sessions.ts                    # Pinned sessions

# Styles
styles.css                                      # Global styles (Tailwind 4)
```

---

### Agent 3 — State Management, Performance & Data Flow (`03-state-performance-data-flow.md`)

**Mission**: Analyze TanStack Query patterns, Zustand usage, optimistic update strategy, performance patterns (memoization, re-render avoidance, streaming efficiency), and connection lifecycle management. This is the most technically nuanced area given their documented emphasis on aggressive performance optimization.

**Scope Boundary**: Owns state management, data flow, caching, optimistic updates, performance patterns, and connection lifecycle. UI component structure belongs to Agent 2. Gateway protocol belongs to Agent 1.

**Key Questions to Answer**:
1. How do they use TanStack Query? (`chat-queries.ts` — query key design, stale time, cache time, invalidation patterns)
2. How do they store UI state in TanStack Query cache? (`chat-ui.ts` — is this a good pattern? what are the trade-offs?)
3. How do they use Zustand? (which stores, what state lives where, store composition)
4. How does the optimistic update pattern work?
   - `pending-send.ts` — what's the optimistic send flow?
   - `session-tombstones.ts` — how do they handle deleted session tracking?
   - Direct TanStack Query cache manipulation — how and where?
   - Reconciliation on server response — clientId/near-timestamp matching
5. What performance patterns do they use? (from their AGENTS.md):
   - Memoize large UI blocks during streaming
   - Pass stable callbacks
   - Keep prompt input state local to composer
   - Memoize message rows with content-based equality
   - Scroll container memoization
6. How do they avoid chat-wide re-renders during streaming? (this is critical for NaW)
7. How does the gateway client connection lifecycle work? (pooling, shared references via Map, cleanup)
8. What data flows through the WebSocket vs what's fetched via HTTP? (events vs queries)
9. How do they handle reconnection? (WebSocket drops, reconnection strategy, state recovery)
10. **What is the performance cost of their streaming pipeline?** (WebSocket → state → markdown → DOM)
11. **How do they handle long conversations?** (virtualization? pagination? lazy loading?)
12. **What Zustand middleware do they use?** (persist? devtools? immer?)

**Files/Directories to Examine**:

```
# GitHub base: https://github.com/ibelick/webclaw/tree/main/apps/webclaw/src

# TanStack Query patterns
screens/chat/chat-queries.ts                    # Query key design, fetchers, options
screens/chat/chat-ui.ts                         # UI state via TanStack Query cache

# Optimistic updates
screens/chat/pending-send.ts                    # Optimistic send management
screens/chat/session-tombstones.ts              # Deleted session tracking

# State management
screens/chat/hooks/use-chat-stream.ts           # Streaming state management
screens/chat/hooks/use-chat-history.ts          # History state management
screens/chat/hooks/use-chat-pending-send.ts     # Pending send hook
screens/chat/hooks/use-chat-generation-guard.ts # Generation lifecycle state
screens/chat/hooks/use-chat-error-state.ts      # Error state management

# Connection lifecycle
server/gateway.ts                               # WebSocket client (pooling, shared Map, cleanup)

# Performance-critical components
screens/chat/components/message-list.tsx         # Message list (memoization, virtualization?)
screens/chat/components/message-item.tsx         # Message row (content-based equality?)
screens/chat/components/composer.tsx             # Composer (local state isolation?)
screens/chat/chat-screen.tsx                     # Main screen (re-render boundaries?)
components/prompt-kit/chat-container.tsx         # Container (scroll memoization?)
components/prompt-kit/markdown.tsx               # Markdown (streaming render efficiency?)

# Utilities
screens/chat/utils.ts                           # Chat utilities
lib/utils.ts                                    # Global utilities

# Types
screens/chat/types.ts                           # TypeScript types (message shape, state shape)
```

---

## 4. Phase 2: Comparison & Mapping

> **Critical Rule for All Phase 2 Agents**: Read ALL Phase 1 outputs before writing your comparison document. Your primary dependency defines your focus area, but reading the other tracks prevents siloed analysis. Also read the Open WebUI research summary (`../open-webui-analysis/SUMMARY.md`) for context on prior comparative analysis.

> **Normalization Rule for All Phase 2 Agents**: Every recommendation must include confidence, evidence count, transferability tag, and implementation dependency notes so synthesis can rank proposals consistently.

### Agent 4 — Architecture & Pattern Comparison (`04-cmp-architecture.md`)

**Primary Dependency**: `01-architecture-gateway.md`
**Also Reads**: `02-chat-ux-components.md`, `03-state-performance-data-flow.md`

**Mission**: Compare WebClaw's architectural patterns against NaW's. Focus on structural patterns that are transferable despite different meta-frameworks. Explicitly assess what is directly transferable vs what requires adaptation.

**Key Comparisons**:

| Dimension | WebClaw | NaW | Key Question |
|-----------|---------|-----|--------------|
| Meta-framework | TanStack Start (Nitro/Vite) | Next.js 16 (App Router) | Are TanStack Start patterns informing future Next.js patterns? |
| Routing | TanStack file-based Router | Next.js App Router | How do route loaders compare to server components? |
| Server layer | Single `gateway.ts` file | Multiple API routes | Is extreme server simplicity achievable for NaW? |
| Module pattern | `screens/chat/` self-contained | `app/components/chat/` + scattered | Should NaW adopt screen-based modules? |
| AI transport | WebSocket gateway (OpenClaw) | Vercel AI SDK (direct providers) | What does the gateway abstraction buy? What does it cost? |
| Auth | Gateway auth handshake | Clerk middleware | Different concerns, different solutions |
| Database | None (gateway manages state) | Convex (full persistence) | How does stateless client vs stateful platform change architecture? |
| Config | Minimal env vars | `lib/config.ts` + env vars | Both lean — how do conventions compare? |
| Testing | Vitest (scope?) | Vitest (scope?) | Who tests more? Who tests better? |
| Conventions | `function` keyword, `type`, kebab-case, no `useEffect` | Varied | Which conventions should NaW adopt? |

**NaW Files to Cross-Reference**:
- `app/api/chat/route.ts` — Gold standard API route
- `app/components/chat/` — Chat component directory
- `app/components/chat/use-chat-core.ts` — Monolithic chat hook
- `lib/chat-store/` — State management
- `middleware.ts` — Auth middleware
- `.agents/project/README.md` — Project context

---

### Agent 5 — UI, Chat UX & Performance Comparison (`05-cmp-ux-performance.md`)

**Primary Dependency**: `02-chat-ux-components.md`, `03-state-performance-data-flow.md`
**Also Reads**: `01-architecture-gateway.md`
**Additional Context**: `../open-webui-analysis/SUMMARY.md` (relevant patterns), existing plans in `.agents/plans/`

**Mission**: Compare WebClaw's UI components, chat UX, hook decomposition, streaming approach, and performance patterns against NaW's. This is where the most directly actionable findings will emerge given the shared stack. For every pattern, assess: adopt (lift directly), adapt (modify for NaW's multi-provider context), or skip (doesn't apply to our architecture).

**Key Comparisons**:

| Dimension | WebClaw | NaW | Key Question |
|-----------|---------|-----|--------------|
| Chat components | prompt-kit library (10+ focused) | `app/components/chat/` (monolithic?) | Is prompt-kit's decomposition better? Can we adopt it? |
| Hook decomposition | 13 focused hooks | `use-chat-core.ts` (single hook) | Should we decompose our monolith? How? |
| Base UI usage | 13 primitives with CVA variants | Shadcn/Base UI wrappers | Whose wrappers are cleaner? More consistent? |
| Streaming markdown | streamdown + Shiki | Our markdown renderer | Which produces better UX during streaming? |
| Thinking/reasoning | `thinking.tsx` component | Our thinking display | How do they display reasoning tokens? |
| Tool display | `tool.tsx` component | `tool-invocation.tsx` | How do they visualize tool calls? |
| Composer | Local state, isolated renders | Our composer pattern | Is their isolation strategy better? |
| Scroll behavior | `use-stick-to-bottom` | Our scroll approach | Is their scroll library worth adopting? |
| Typing indicator | Dedicated component | Our approach | Better animation? Better UX? |
| Sidebar/sessions | Session list with tombstones | Our sidebar | Better session management UX? |
| Context meter | Token/context visualization | Not implemented | Should we add this? |
| Memoization | Content-based equality, streaming-aware | Our memoization | Are their patterns more aggressive? More effective? |
| Optimistic updates | Direct cache manipulation + reconciliation | Convex optimistic updates | Which is more reliable? More responsive? |
| Re-render avoidance | Documented AGENTS.md patterns | Our patterns | Who avoids re-renders better during streaming? |
| Mobile | `use-chat-mobile` dedicated hook | Our responsive approach | Is a dedicated mobile hook better than responsive CSS? |
| Export | `use-export` hook | Our export (if any) | What export formats do they support? |
| Typography | Never bolder than font-medium, text-balance, text-pretty | Our typography | Are their typography rules worth adopting? |
| Animations | motion library | Our animations (if any) | What animations improve perceived performance? |

**NaW Files to Cross-Reference**:
- `app/components/chat/` — All chat components
- `app/components/chat/use-chat-core.ts` — Monolithic chat hook
- `app/components/chat/chat.tsx` — Main chat component
- `components/ui/` — Design system
- `lib/chat-store/` — State management
- `lib/chat-store/chats/provider.tsx` — Optimistic update pattern

---

## 5. Phase 3: Synthesis & Recommendations

### Synthesis Agent — Prioritized Recommendations (`06-recommendations.md`)

**Depends On**: `04-cmp-architecture.md`, `05-cmp-ux-performance.md`
**Also Reads**: All Phase 1 outputs, `../open-webui-analysis/SUMMARY.md`, existing plans in `.agents/plans/`

**Mission**: Synthesize all comparison findings into a single, actionable, prioritized list of recommendations for NaW. Reconcile with findings from the Open WebUI research track. Cross-reference existing implementation plans.

**Output Structure**:
1. **Quick Wins** — Patterns adoptable immediately with low effort (< 1 week)
2. **Architectural Lessons** — Structural patterns to learn from (screen modules, hook decomposition)
3. **UI/UX Patterns to Adopt** — Component patterns, animations, typography rules
4. **Performance Patterns to Adopt** — Memoization, streaming optimization, re-render avoidance
5. **Things We Should NOT Copy** — Patterns tied to their single-gateway architecture or intentional limitations
6. **Things We Do Better** — Honest assessment of NaW's advantages to protect
7. **Comparison with Open WebUI Findings** — How do WebClaw findings confirm, contradict, or extend Open WebUI findings?
8. **Implementation Dependencies** — Dependency graph for recommended changes
9. **Unresolved Questions** — Items needing human decision or further investigation

**Minimum recommendation payload** (required for each proposed change):

| Field | Description |
|-------|-------------|
| Title | Recommendation name |
| Action | Adopt / Adapt / Skip |
| Confidence | High / Medium / Low |
| Transferability | Direct / Adaptable / Non-transferable |
| Effort | Time estimate |
| Impact | What it improves in NaW (UX / Performance / DX / Architecture) |
| Evidence | `claim_id` references from Phase 1 & 2 |
| Risk if wrong | What happens if this recommendation is bad? |
| Synergy with Open WebUI findings | Does this confirm/contradict prior research? |

**Conflict Resolution**: When Phase 2 agents disagree or when WebClaw findings contradict Open WebUI findings, resolve by: (1) checking evidence strength, (2) assessing transferability given shared stack, (3) defaulting to the simpler solution when evidence is roughly equal.

---

## 6. Execution Guidelines

### For Each Research Agent

1. **Browse the repo**: Use GitHub raw URLs at `https://raw.githubusercontent.com/ibelick/webclaw/main/`
2. **Read primary files first**: Start with files listed in your section's "Files to Examine"
3. **Follow the code**: Trace execution paths, don't just catalog structure — WebClaw is small enough to read most files in full
4. **Document patterns, not just features**: "They use X pattern because Y" > "They have X"
5. **Note trade-offs**: Every choice has pros and cons — document both
6. **Compare to NaW directly**: Since we share the stack, direct code comparisons are meaningful
7. **Include code snippets**: Reference specific patterns worth studying (with GitHub URLs)
8. **Flag "gems"**: Particularly clever or well-designed patterns worth adopting
9. **Flag "warnings"**: Anti-patterns or limitations to avoid
10. **Assess transferability**: Direct / Adaptable / Non-transferable for each finding
11. **Use confidence labels**: High / Medium / Low for each major conclusion
12. **Separate facts from interpretation**: Include an evidence table for all major claims
13. **Check the OpenClaw docs**: For Agent 1, investigate https://docs.openclaw.ai for protocol understanding

### For Phase 2 Agents (Additional)

14. **Read ALL Phase 1 outputs**: Not just your primary dependency
15. **Read Open WebUI SUMMARY.md**: Understand prior competitive findings for context
16. **Cross-reference existing plans**: Check `.agents/plans/` for existing implementation decisions
17. **Flag conflicts**: If recommendation contradicts Open WebUI findings or existing plans, note it explicitly
18. **Validate stack fit**: Every recommendation should note whether it transfers to Next.js App Router + Convex

### Phase 1.5: Evidence Normalization Gate (Required)

Before Phase 2 begins, verify each Phase 1 document includes:
- Completed evidence table for all major claims
- Confidence labels for top conclusions
- Uncertainty and falsification section
- At least 3 concrete "adopt/adapt/skip" previews tied to evidence IDs
- Transferability tags for all findings

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

## Key Patterns Worth Studying
[Specific code patterns with GitHub file references]

## Concerns & Limitations
[Issues found, limitations of their approach]

## Unexpected Findings
[Anything surprising or not covered by planned sections]

## Evidence Table
[All major claims with evidence records per the quality contract]

## Uncertainty & Falsification
[Top 3 unresolved questions + falsification criteria]

## Recommendations Preview
[Top 3-5 recommendations, each marked: ADOPT / ADAPT / SKIP with transferability tag]
```

---

## 7. How to Execute This Plan

### Option A: Sequential (Single Agent)

Run agents 1, 2, 3 sequentially, then 4, 5, then 6. ~2-3 hours total.

### Option B: Parallel (Multi-Agent) — Recommended

- **Batch 1**: Launch Agents 1, 2, 3 simultaneously → ~45-60 minutes
- **Gate 1.5**: Run evidence normalization check on docs 01-03 → ~10-15 minutes
- **Batch 2**: Launch Agents 4, 5 simultaneously (using normalized Phase 1 outputs) → ~30-45 minutes
- **Batch 3**: Launch Agent 6 (using Phase 2 outputs) → ~20-30 minutes
- **Total**: ~1.5-2.5 hours

### Option C: Hybrid

- **Batch 1**: Launch Agent 2 (highest priority — chat UX) + Agent 3 (performance)
- **Batch 2**: Launch Agent 1 (architecture) — can start slightly later as it includes OpenClaw doc research
- **Gate**: Run evidence normalization check
- **Batch 3**: Launch Agents 4, 5 as soon as gate passes
- **Batch 4**: Launch Agent 6 when 4, 5 complete

### Token Budget Notes

WebClaw is small enough (~80 commits, focused codebase) that each agent should be able to read most relevant files in full without hitting context limits. The OpenClaw docs investigation (Agent 1) is the wildcard — if docs are extensive, prioritize the WebSocket protocol spec and auth handshake over higher-level platform docs.

---

## 8. Key URLs & Resources

### Repository

| Resource | URL |
|----------|-----|
| GitHub repo | https://github.com/ibelick/webclaw |
| Raw file base | https://raw.githubusercontent.com/ibelick/webclaw/main/ |
| WebClaw app source | https://github.com/ibelick/webclaw/tree/main/apps/webclaw/src |
| WebClaw CLI package | https://github.com/ibelick/webclaw/tree/main/packages/webclaw |

### OpenClaw Platform

| Resource | URL |
|----------|-----|
| OpenClaw docs | https://docs.openclaw.ai |
| OpenClaw (likely) | https://openclaw.ai |

### NaW Files for Cross-Reference

| Pattern | File |
|---------|------|
| Chat hook (monolith) | `app/components/chat/use-chat-core.ts` |
| Chat components | `app/components/chat/` |
| Main chat component | `app/components/chat/chat.tsx` |
| API route (gold standard) | `app/api/chat/route.ts` |
| State management | `lib/chat-store/` |
| Optimistic updates | `lib/chat-store/chats/provider.tsx` |
| UI primitives | `components/ui/` |
| Project context | `.agents/project/README.md` |

---

## 9. Success Criteria

This research is complete when:

- [ ] All 6 documents (01, 02, 03, 04, 05, 06) are written and marked "Complete"
- [ ] WebClaw's architecture, components, and patterns are fully mapped
- [ ] OpenClaw Gateway protocol is understood (WebSocket framing, auth, session management)
- [ ] Both strengths AND limitations are documented for every subsystem
- [ ] Every major pattern is assessed with transferability tag (Direct / Adaptable / Non-transferable)
- [ ] Every major claim has evidence, confidence, and transferability tags
- [ ] Base UI usage patterns are directly compared between WebClaw and NaW
- [ ] Hook decomposition pattern is fully analyzed with concrete adoption recommendation
- [ ] Performance patterns are documented with specific code references
- [ ] Recommendations are prioritized by impact x effort, grouped into Quick Wins / Architectural Lessons / UI Patterns / Performance Patterns
- [ ] "Things we do better" section honestly assesses NaW's advantages
- [ ] Findings are cross-referenced with Open WebUI research track
- [ ] Phase 1.5 normalization gate is passed before Phase 2 starts
- [ ] The output is actionable — each recommendation includes enough detail to begin implementation

---

## 10. Appendix: Research Framing Notes

### Why WebClaw Matters for NaW

WebClaw is **not a competitor** — it's a focused client for a different product (OpenClaw gateway). The value of this research is in studying a team that made the same technology choices we did (React 19, Base UI, Tailwind 4, TanStack Query, Zustand) and shipped a polished chat experience with those tools. Their patterns are more directly transferable than anything from the Open WebUI (SvelteKit + Python) or commercial competitors (proprietary stacks).

### What to Look For vs What to Ignore

**Focus on**:
- Component decomposition quality (their prompt-kit vs our chat components)
- Hook architecture (13 focused hooks vs our monolith — is decomposition actually better?)
- Performance micro-patterns (memoization, stable callbacks, content-based equality)
- Base UI wrapper patterns (we literally use the same library)
- Streaming UX polish (animation, scroll behavior, typing indicators)
- Convention discipline (their strict rules from AGENTS.md)

**Ignore or note briefly**:
- OpenClaw platform features (messaging app bridging, agent routing — not our problem space)
- Their lack of multi-model support (they're a single-agent client)
- Their lack of persistence (gateway manages state, not the client)
- Their lack of auth complexity (gateway handles auth)
- Their monorepo tooling (pnpm workspace + Turbo — not relevant unless we go monorepo)

### Relationship to Open WebUI Research

This research complements the Open WebUI analysis:

| Dimension | Open WebUI Research | WebClaw Research |
|-----------|-------------------|------------------|
| Stack relevance | Low (SvelteKit + Python) | High (React 19 + Base UI + same tools) |
| Architecture lessons | High (scale, patterns, anti-patterns) | Medium (focused patterns, conventions) |
| Feature breadth | Very high (270+ components, 56+ backends) | Low (single chat client) |
| Pattern transferability | Adaptable (different stack) | Direct (same stack) |
| Performance lessons | Medium (different rendering model) | High (same React rendering model) |
| Primary value | Strategic direction, anti-patterns to avoid | Tactical patterns to adopt |

---

*Research plan authored February 15, 2026. Based on WebClaw repo at current commit (~80 commits, 470 stars) and Not A Wrapper codebase on branch `am-i-in-over-my-head`.*
