# Not A Wrapper

**Not A Wrapper** is an open-source, multi-AI chat platform with a unified interface across major providers. Bring your own API keys, connect MCP tools, upload files, and organize conversations into projects.

## Features

- **Multi-provider chat** — Stream responses through one interface across the configured model catalog
- **Reasoning and activity** — Stream model-provided reasoning or activity when supported
- **Web search** — Use native search with OpenAI, Anthropic, Google, and xAI, plus an optional Exa fallback when configured
- **File attachments** — Upload supported images, PDFs, text, Markdown, JSON, CSV, and spreadsheet files up to 10 MB
- **MCP tools** — Connect external Model Context Protocol servers with per-tool controls, circuit breaking, and durable audit logs
- **BYOK** — Store your own provider keys with AES-256-GCM encryption at rest
- **Guest access** — Try the app without signing up, with five messages per day and a limited model selection
- **Organization** — Group chats into projects and pin important chats or models
- **Sharing** — Publish chats with shareable links and Open Graph metadata
- **History search** — Search your full chat history by conversation title
- **Personalization** — Choose light, dark, or system themes and sidebar or fullscreen layouts

## Supported AI Providers

The configured catalog includes OpenAI, Anthropic, Google, Mistral, xAI,
Perplexity, and OpenRouter-hosted models. Because model availability changes
frequently, [`lib/models/`](./lib/models/) is the source of truth.

## Local Setup

Requires Bun 1.3.1 or later, Node.js 22.13.0 or later, WorkOS, Convex, and at least one supported AI provider key.

```bash
git clone https://github.com/darknightdesigner/not-a-wrapper.git
cd not-a-wrapper
bun install
cp .env.example .env.local
```

Complete the WorkOS, Convex, and environment setup in [INSTALL.md](./INSTALL.md), then run:

```bash
bun run env:check
bun run dev
```

The app runs at [http://localhost:3000](http://localhost:3000). See
[docs/environment.md](./docs/environment.md) for environment-variable ownership
across local development, Convex, Vercel previews, and production.

## Tech Stack

| Layer         | Technology                       |
| ------------- | -------------------------------- |
| App           | Next.js 16, React 19, TypeScript |
| Backend       | Convex and WorkOS AuthKit        |
| AI            | Vercel AI SDK v7                 |
| State         | Zustand and TanStack Query       |
| UI            | Base UI and Tailwind CSS 4       |
| Observability | Sentry, PostHog, and Braintrust  |
| Testing       | Vitest                           |

## Architecture

- `app/` — Next.js pages, API routes, and application UI
- `convex/` — Schema, queries, mutations, jobs, and file storage
- `lib/` — Model routing, tools, MCP, state, encryption, and shared logic
- `components/` — Shared UI primitives

See [CONTEXT.md](./CONTEXT.md) for the domain model and
[`docs/adr/`](./docs/adr/) for architectural decisions.

## Development

```bash
bun run dev          # Next.js and Convex development servers
bun run dev:clean    # Dev with a fresh .next cache
bun run env:check    # Validate local environment variables
bun run lint         # ESLint
bun run typecheck    # TypeScript checks
bun run test         # Vitest
bun run build:next   # Local Next.js production build
bun run build        # Deploy Convex, then build Next.js
```

`bun run build` is a deployment command. Use `bun run build:next` for local verification without deploying Convex.

## Contributing

Contributions are welcome. Please open an issue first to discuss what you would like to change.

For UI work, see [DESIGN.md](./DESIGN.md). Its visual direction is provisional;
prioritize functionality, accessibility, reusable primitives, and consistent
interaction patterns while the formal design rules evolve.

## Based On

Not A Wrapper is a fork of [Zola](https://github.com/ibelick/zola). Special thanks to the Zola team for creating an excellent open-source AI chat foundation.

## License

[Apache License 2.0](./LICENSE)
