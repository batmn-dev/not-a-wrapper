# Not A Wrapper

**Not A Wrapper** is an open-source, multi-AI chat platform with a unified interface for 80+ models across 8 providers. Compare models side-by-side, bring your own API keys, connect MCP tools, upload files, and organize conversations into projects — all from a single, clean interface.

Forked from [Zola](https://github.com/ibelick/zola) and rebuilt with Convex, WorkOS AuthKit, and the Vercel AI SDK.

## Features

### Core Chat
- **Multi-provider AI chat** — Stream responses from OpenAI, Anthropic, Google, Mistral, xAI, Perplexity, DeepSeek, and OpenRouter
- **Multi-model comparison** — Send one prompt to up to 10 models and compare responses side-by-side
- **Streaming with reasoning** — See model thinking in real-time (Claude, o3, DeepSeek R1, etc.)
- **File uploads** — Share documents, images, and code for AI analysis (Convex-backed storage)
- **Guest access** — Try the app without signing up (5 messages/day, limited model selection)

### Tools & Integrations
- **Web search** — Native provider search (OpenAI, Anthropic, Google, xAI) with Exa fallback for providers without built-in search
- **MCP support** — Connect external tool servers via the Model Context Protocol; per-tool approval, circuit breaker, and audit logging
- **BYOK (Bring Your Own Key)** — Securely use your own API keys with AES-256-GCM encryption at rest

### Organization & Sharing
- **Projects** — Group related chats into folders
- **Public sharing** — Publish chats with a shareable link and OG metadata
- **Pinned chats** — Pin important conversations for quick access
- **Chat history** — Full conversation history with search

### Personalization
- **Light / Dark / System themes** — Automatic or manual theme switching
- **Layout options** — Sidebar or fullscreen modes
- **Favorite & hidden models** — Curate your model list
- **Custom system prompts** — Set default instructions for AI behavior

## Supported AI Providers

| Provider | Notable Models | Capabilities |
|----------|---------------|-------------|
| **OpenAI** | GPT-5.2, GPT-5.1, GPT-5, GPT-4.1, o3, o4-mini | Vision, Tools, Web Search |
| **Anthropic** | Claude Opus 4.6, Sonnet 4.5, Sonnet 4, Haiku 4.5 | Extended thinking, Vision, Web Search |
| **Google** | Gemini 2.5 Pro, 2.5 Flash, 3 Pro Preview, Gemma 3 | Vision, Multimodal, Web Search |
| **Mistral** | Mistral Large, Codestral, Pixtral Large, Ministral | Vision, Code |
| **xAI** | Grok 4, Grok 4.1 Fast, Grok Code Fast, Grok 2 Vision | Vision, Web Search |
| **Perplexity** | Sonar Pro, Sonar Deep Research, Sonar Reasoning Pro | Built-in web search |
| **DeepSeek** | DeepSeek R1, DeepSeek-V3 | Reasoning (via OpenRouter) |
| **OpenRouter** | 18+ models from all major providers | Aggregator, BYOK |

> Models are regularly updated. The full list is configured in `lib/models/`.

## Quick Start

```bash
git clone https://github.com/batmn-dev/not-a-wrapper.git
cd not-a-wrapper
bun install
cp .env.example .env.local   # Edit with your keys
bun dev                       # Starts Next.js + Convex dev servers
```

The app runs at [http://localhost:3000](http://localhost:3000). You need at least one AI provider key to chat.

For full setup (WorkOS AuthKit, Convex database, BYOK encryption), see [INSTALL.md](./INSTALL.md).
Auth is configured as a clean reset with no imported legacy users.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | [Next.js 16](https://nextjs.org/) (App Router), React 19, TypeScript |
| Database | [Convex](https://convex.dev) — Real-time reactive database with file storage |
| Auth | [WorkOS AuthKit](https://workos.com/authkit) — Hosted authentication with guest access preserved |
| AI | [Vercel AI SDK v6](https://sdk.vercel.ai/) — Multi-provider streaming, tool calling |
| State | Zustand + TanStack Query |
| UI | [Base UI](https://base-ui.com/) + [Tailwind CSS 4](https://tailwindcss.com/) |
| Observability | [Sentry](https://sentry.io/) for app/error tracing, [PostHog](https://posthog.com/) for product and LLM analytics, [Braintrust](https://www.braintrust.dev/) for AI traces and evals |
| Testing | [Vitest](https://vitest.dev/) |

## Architecture

```
app/                        # Next.js App Router
├── api/                    # API routes (chat streaming, models, keys, MCP, projects)
├── c/[chatId]/             # Chat pages
├── p/[projectId]/          # Project pages
├── share/[chatId]/         # Public share pages
└── components/
    ├── chat/               # Chat UI, message rendering, tool invocations
    ├── multi-chat/         # Multi-model comparison
    ├── layout/             # Sidebar, settings, dialogs
    └── history/            # Chat history

lib/                        # Shared logic
├── models/                 # AI model definitions per provider
├── openproviders/          # Provider factory & SDK mapping
├── tools/                  # Web search (provider + Exa), tool types
├── mcp/                    # MCP server loading, circuit breaker
├── chat-store/             # Chat & message state (Zustand)
├── ai/                     # Message conversion, context management
├── encryption.ts           # AES-256-GCM for BYOK keys
└── config.ts               # Rate limits, free models, defaults

components/                 # Shared UI components (Base UI primitives)
convex/                     # Database schema, queries, mutations, file storage
```

## Roadmap

| Feature | Status |
|---------|--------|
| Multi-provider chat (8 providers, 80+ models) | Shipped |
| Multi-model comparison (up to 10 models) | Shipped |
| BYOK with AES-256-GCM encryption | Shipped |
| File uploads with Convex storage | Shipped |
| Projects & chat organization | Shipped |
| Public chat sharing | Shipped |
| Web search (native + Exa fallback) | Shipped |
| MCP tool integration | Shipped |
| Light/dark themes, layout options | Shipped |
| Sentry, PostHog, and Braintrust observability | Shipped |
| Guest access with rate limiting | Shipped |
| Code execution tools | Planned |

## Development

```bash
bun run dev          # Dev server (Next.js + Convex)
bun run dev:clean    # Dev with fresh .next cache
bun run lint         # ESLint
bun run typecheck    # TypeScript checks
bun run build        # Production build (deploys Convex)
bun run test         # Vitest
```

## Contributing

Contributions are welcome. Please open an issue first to discuss what you'd like to change.

## Based On

This project is a fork of [Zola](https://github.com/ibelick/zola), the open-source AI chat interface. Special thanks to the Zola team for creating an excellent foundation.

## License

[Apache License 2.0](./LICENSE)
