# Not A Wrapper Installation Guide

Not A Wrapper is a Next.js AI chat app with Convex persistence, WorkOS AuthKit, BYOK provider keys, and Vercel AI SDK v7 streaming.

## Prerequisites

- Bun 1.3.1 or later.
- Node 22.13.0 or later.
- Git.
- WorkOS project.
- Convex project.
- At least one supported AI provider API key.

## Local Setup

```bash
git clone https://github.com/darknightdesigner/not-a-wrapper.git
cd not-a-wrapper
bun install
cp .env.example .env.local
```

Fill `.env.local` from `.env.example`, then validate it:

```bash
bun run env:check
```

Treat `.env.example` as the canonical variable list and
`docs/environment.md` as the canonical ownership guide for local, Convex,
Vercel preview, and production variables.

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

The app uses the official `@convex-dev/workos-authkit` component. WorkOS is the
source of truth for identity lifecycle, and Convex is the source of truth for
app data.

Create a Convex project and run:

```bash
bun run dev:convex
```

Then set Convex env so Convex can validate WorkOS access tokens and process
WorkOS webhook sync:

```bash
bunx convex env set WORKOS_CLIENT_ID <client_id>
bunx convex env set WORKOS_API_KEY <api_key>
bunx convex env set WORKOS_WEBHOOK_SECRET <secret>
```

Do not expose `WORKOS_API_KEY`, `WORKOS_WEBHOOK_SECRET`, `CSRF_SECRET`,
`ENCRYPTION_KEY`, provider keys, or deploy keys through `NEXT_PUBLIC_*`.

### WorkOS Webhook Setup

In the WorkOS dashboard, create a webhook endpoint for each Convex deployment:

- Endpoint: `https://<your-convex-deployment>.convex.site/workos/webhook`
- Events:
  - `user.created`
  - `user.updated`
  - `user.deleted`

Use the WorkOS dashboard endpoint detail page to send test events after saving
the endpoint. The webhook handler upserts app users by `workosUserId`;
duplicate deliveries and `user.updated` before `user.created` are safe.
`user.deleted` soft-deletes/disables the app user row and does not cascade into
chats, projects, messages, billing, analytics, roles, organizations,
invitations, or sessions.

Optional backfill for existing or test WorkOS users:

```bash
bunx convex run workosAuth:backfillUsers
```

Backfill is idempotent and fires the same `user.created` app sync handler. It is not run automatically.

The Convex schema lives in `convex/schema.ts`; generated Convex types are managed by the Convex dev process.

Pre-launch, the database is disposable: change `convex/schema.ts` directly —
including removing fields — and wipe dev data if it conflicts. The
expand/migrate/contract workflow is dormant until the app has real users. See
AGENTS.md → "Pre-Launch: The Database Is Disposable".

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

## Verification

```bash
bun run env:check
bun run lint
bun run typecheck
bun run test
bun run build:next
```

Use `bun run test`; the configured test runner is Vitest.

`bun run build` deploys Convex before building and injects
`NEXT_PUBLIC_CONVEX_URL`; production deploys also run the schema contraction
preflight. Use `bun run build:next` for a local Next.js production build without
deploying Convex.

## Production Deployment

Deploy the app through Vercel with:

```bash
bun run convex:deploy
```

Configure Vercel and Convex env according to `docs/environment.md`.

## Troubleshooting

- Convex auth failures: verify `WORKOS_CLIENT_ID` is set in Convex env and WorkOS redirect URI is `/callback`.
- WorkOS webhook failures: verify the WorkOS endpoint is `https://<your-convex-deployment>.convex.site/workos/webhook`, the endpoint subscribes only to `user.created`, `user.updated`, and `user.deleted`, and `WORKOS_WEBHOOK_SECRET` is set in Convex env.
- Model failures: verify the selected model's provider key is set globally or through BYOK.
- BYOK failures: verify `ENCRYPTION_KEY` is valid base64 for exactly 32 decoded bytes.
- Stale local build behavior: try `bun run dev:clean`.
