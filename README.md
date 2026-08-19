# Not A Wrapper

**Not A Wrapper** is an open-source, multi-AI chat platform with a unified interface across major providers. Bring your own API keys, connect MCP tools, upload files, and organize conversations into projects.

Forked from [Zola](https://github.com/ibelick/zola) and rebuilt with Convex, WorkOS AuthKit, and the Vercel AI SDK.

## Features

### Core Chat

- **Multi-provider AI chat** — Stream responses from OpenAI, Anthropic, Google, Mistral, xAI, Perplexity, and OpenRouter-hosted models
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

The configured catalog includes OpenAI, Anthropic, Google, Mistral, xAI,
Perplexity, and OpenRouter-hosted models. Because model availability changes
frequently, `lib/models/` is the source of truth.

## Quick Start

```bash
git clone https://github.com/darknightdesigner/not-a-wrapper.git
cd not-a-wrapper
bun install
cp .env.example .env.local   # Edit with your keys
bun run env:check
bun dev                       # Starts Next.js + Convex dev servers
```

The app runs at [http://localhost:3000](http://localhost:3000). You need at least one AI provider key to chat.

For full setup (WorkOS AuthKit, Convex database, BYOK encryption), see [INSTALL.md](./INSTALL.md) and [docs/environment.md](./docs/environment.md).
The current Convex setup uses the official WorkOS AuthKit component for webhook-backed app user sync on `user.created`, `user.updated`, and `user.deleted`.

## Tech Stack

| Layer         | Technology                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Framework     | [Next.js 16](https://nextjs.org/) (App Router), React 19, TypeScript                                                                                                                 |
| Database      | [Convex](https://convex.dev) — Real-time reactive database with file storage and WorkOS webhook-backed user sync                                                                     |
| Auth          | [WorkOS AuthKit](https://workos.com/authkit) — Hosted authentication with guest access preserved                                                                                     |
| AI            | [Vercel AI SDK v7](https://ai-sdk.dev/) — Multi-provider streaming, tool calling                                                                                                     |
| State         | Zustand + TanStack Query                                                                                                                                                             |
| UI            | [Base UI](https://base-ui.com/) + [Tailwind CSS 4](https://tailwindcss.com/)                                                                                                         |
| Observability | [Sentry](https://sentry.io/) for app/error tracing, [PostHog](https://posthog.com/) for product and LLM analytics, [Braintrust](https://www.braintrust.dev/) for AI traces and evals |
| Testing       | [Vitest](https://vitest.dev/)                                                                                                                                                        |

## Architecture

```
app/                        # Next.js App Router
├── api/                    # API routes (chat streaming, models, keys, MCP, projects)
├── c/[chatId]/             # Chat pages
├── p/[projectId]/          # Project pages
├── share/[chatId]/         # Public share pages
└── components/
    ├── chat/               # Chat UI, message rendering, tool invocations
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

| Feature                                       | Status  |
| --------------------------------------------- | ------- |
| Multi-provider chat                           | Shipped |
| BYOK with AES-256-GCM encryption              | Shipped |
| File uploads with Convex storage              | Shipped |
| Projects & chat organization                  | Shipped |
| Public chat sharing                           | Shipped |
| Web search (native + Exa fallback)            | Shipped |
| MCP tool integration                          | Shipped |
| Light/dark themes, layout options             | Shipped |
| Sentry, PostHog, and Braintrust observability | Shipped |
| Guest access with rate limiting               | Shipped |
| Code execution tools                          | Planned |

## Development

```bash
bun run dev          # Dev server (Next.js + Convex)
bun run dev:clean    # Dev with fresh .next cache
bun run env:check    # Validate local environment variables
bun run lint         # ESLint
bun run typecheck    # TypeScript checks
bun run build        # Production build (deploys Convex)
bun run test         # Vitest
```

## Contributing

Contributions are welcome. Please open an issue first to discuss what you'd like to change.

For UI work, see [DESIGN.md](./DESIGN.md). Its visual direction is provisional;
prioritize functionality, accessibility, reusable primitives, and consistent
interaction patterns while the formal design rules evolve.

## Based On

This project is a fork of [Zola](https://github.com/ibelick/zola), the open-source AI chat interface. Special thanks to the Zola team for creating an excellent foundation.

## License

[Apache License 2.0](./LICENSE)
