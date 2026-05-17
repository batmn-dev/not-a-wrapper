# Not A Wrapper Installation Guide

Not A Wrapper is a Next.js AI chat app with Convex persistence, WorkOS AuthKit, BYOK provider keys, and Vercel AI SDK v6 streaming.

## Prerequisites

- Bun 1.3.1 or later.
- Node 22.11.0 or later.
- Git.
- WorkOS project.
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

- WorkOS AuthKit: API key, client ID, cookie password, and redirect URI.
- Convex: deployment name, public URL, and WorkOS webhook sync env.
- Security: `CSRF_SECRET` and `ENCRYPTION_KEY`.
- AI providers: at least one provider key, such as OpenAI or Anthropic.

Generate secrets with:

```bash
openssl rand -base64 32
```

`WORKOS_COOKIE_PASSWORD` must be at least 32 characters. `ENCRYPTION_KEY` must decode to exactly 32 bytes. Keep `ENCRYPTION_KEY` stable across deployments; changing it makes existing encrypted user API keys unrecoverable.

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

## WorkOS AuthKit And Convex

1. Create a WorkOS app and copy `WORKOS_API_KEY` and `WORKOS_CLIENT_ID` into `.env.local`.
2. Set `WORKOS_COOKIE_PASSWORD` to a generated value of at least 32 characters.
3. Configure WorkOS Redirects:
   - Local redirect URI: `http://localhost:3000/callback`
   - Production redirect URI: `https://<production-domain>/callback`
   - Sign-in endpoint: `https://<production-domain>/login` for production, or `http://localhost:3000/login` locally.
   - Sign-out redirect: the app root, for example `https://<production-domain>/`.
4. Set `NEXT_PUBLIC_WORKOS_REDIRECT_URI` to the matching `/callback` URI.
5. Create a Convex project and run:

```bash
bun run dev:convex
```

6. Copy the Convex deployment values into `.env.local`.
7. Set Convex env so Convex can validate WorkOS access tokens and process WorkOS webhook sync:

```bash
bunx convex env set WORKOS_CLIENT_ID <client_id>
bunx convex env set WORKOS_API_KEY <api_key>
bunx convex env set WORKOS_WEBHOOK_SECRET <secret_from_workos_webhook>
```

`WORKOS_WEBHOOK_SECRET` comes from the WorkOS dashboard after creating the webhook endpoint. Do not expose it through a `NEXT_PUBLIC_` variable.

The app uses current Convex with the official `@convex-dev/workos-authkit` component. WorkOS remains the source of truth for identity lifecycle, and Convex remains the source of truth for app data. User rows are still created or updated on first authenticated app load as an idempotent fallback, while WorkOS webhooks keep app-owned user data synchronized.

### WorkOS Webhook Setup

In the WorkOS dashboard, create a webhook endpoint:

- Endpoint: `https://<your-convex-deployment>.convex.site/workos/webhook`
- Events:
  - `user.created`
  - `user.updated`
  - `user.deleted`

Use the WorkOS dashboard endpoint detail page to send test events after saving the endpoint. The webhook handler upserts app users by `workosUserId`; duplicate deliveries and `user.updated` before `user.created` are safe. `user.deleted` soft-deletes/disables the app user row and does not cascade into chats, projects, messages, billing, analytics, roles, organizations, invitations, or sessions.

Optional backfill for existing or test WorkOS users:

```bash
bunx convex run workosAuth:backfillUsers
```

Backfill is idempotent and fires the same `user.created` app sync handler. It is not run automatically.

This migration is a clean auth reset. Do not import users from another auth provider.

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

- Convex auth failures: verify `WORKOS_CLIENT_ID` is set in Convex env and WorkOS redirect URI is `/callback`.
- WorkOS webhook failures: verify the WorkOS endpoint is `https://<your-convex-deployment>.convex.site/workos/webhook`, the endpoint subscribes only to `user.created`, `user.updated`, and `user.deleted`, and `WORKOS_WEBHOOK_SECRET` is set in Convex env.
- Model failures: verify the selected model's provider key is set globally or through BYOK.
- BYOK failures: verify `ENCRYPTION_KEY` is valid base64 for exactly 32 decoded bytes.
- Stale local build behavior: try `bun run dev:clean`.
