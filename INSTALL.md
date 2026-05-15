# Not A Wrapper Installation Guide

Not A Wrapper is a Next.js AI chat app with Convex persistence, Clerk auth, BYOK provider keys, and Vercel AI SDK v6 streaming.

## Prerequisites

- Bun 1.3.1 or later.
- Git.
- Clerk project.
- Convex project.
- At least one supported AI provider API key.

## Local Setup

```bash
git clone https://github.com/batmn-dev/not-a-wrapper.git
cd not-a-wrapper
bun install
cp .env.example .env.local
```

Fill `.env.local` from `.env.example`. Treat `.env.example` as the canonical environment-variable list.

Required groups:

- Clerk auth: publishable key, secret key, JWT issuer domain, and webhook secret.
- Convex: deployment name and public URL.
- Security: `CSRF_SECRET` and `ENCRYPTION_KEY`.
- AI providers: at least one provider key, such as OpenAI or Anthropic.

Generate secrets with:

```bash
openssl rand -base64 32
```

`ENCRYPTION_KEY` must decode to exactly 32 bytes. Keep it stable across deployments; changing it makes existing encrypted user API keys unrecoverable.

## Optional Observability

Braintrust is optional and disabled unless `BRAINTRUST_API_KEY` is present:

```bash
BRAINTRUST_API_KEY=
BRAINTRUST_PROJECT_NAME=not-a-wrapper
# BRAINTRUST_API_URL=
# BRAINTRUST_ENABLED=true
# BRAINTRUST_LOG_CONTENT=false
```

`BRAINTRUST_LOG_CONTENT=false` is the default privacy posture. Chat prompts, responses, tool arguments, and tool results are redacted before upload unless this flag is explicitly set to `true`; even then, content passes through the analytics scrubber.

Observability roles:

- Sentry: application errors, route tracing, and reliability signals.
- PostHog: product analytics and existing LLM generation analytics.
- Braintrust: AI traces, streaming/model spans, tool-call visibility, future feedback, datasets, and evals.

## Clerk And Convex

1. Create a Clerk app and copy the required keys into `.env.local`.
2. Configure Clerk JWT auth for Convex using the issuer domain from Clerk.
3. Create a Convex project and run:

```bash
bun run dev:convex
```

4. Copy the Convex deployment values into `.env.local`.

The Convex schema lives in `convex/schema.ts`; generated Convex types are managed by the Convex dev process.

## Run Locally

```bash
bun run dev
```

The app runs at [http://localhost:3000](http://localhost:3000). The default dev script starts both Next.js and Convex.

Useful variants:

```bash
bun run dev:next
bun run dev:convex
bun run dev:clean
```

## AI Tool Skills

For AI coding tools that use this repo's local skills, run:

```bash
./.agents/skills/sync-agent-skills/scripts/sync-skills.sh
```

The script creates gitignored symlinks for supported tools and keeps `.agents/skills/` as the canonical source.

## Verification

```bash
bun run lint
bun run typecheck
bun run test
bun run build:next
```

`bun run build` deploys Convex before building; use `bun run build:next` for a local Next.js production build without deploying Convex.

## Production Deployment

Deploy the app through Vercel and configure the same environment variables from `.env.example`. The CI workflow runs lint, typecheck, and `build:next`; Convex deploys from the GitHub workflow for `main`.

## Troubleshooting

- Convex auth failures: verify Clerk JWT issuer domain and Convex auth provider settings.
- Model failures: verify the selected model's provider key is set globally or through BYOK.
- BYOK failures: verify `ENCRYPTION_KEY` is valid base64 for exactly 32 decoded bytes.
- Stale local build behavior: try `bun run dev:clean`.
