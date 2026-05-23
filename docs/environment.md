# Environment Setup

This app uses WorkOS AuthKit for identity, Convex for app data and auth token
validation, and Vercel for preview and production hosting. Keep secrets out of
`NEXT_PUBLIC_*` variables.

## Local Setup

```bash
bun install
cp .env.example .env.local
bunx convex dev
bun run env:check
bun run dev
```

Required local `.env.local` values:

- `WORKOS_CLIENT_ID`
- `WORKOS_API_KEY`
- `WORKOS_COOKIE_PASSWORD`
- `NEXT_PUBLIC_WORKOS_REDIRECT_URI`
- `CONVEX_DEPLOYMENT`
- `NEXT_PUBLIC_CONVEX_URL`
- `CSRF_SECRET`
- `ENCRYPTION_KEY`
- at least one AI provider key

`WORKOS_COOKIE_PASSWORD` must be at least 32 characters.
`ENCRYPTION_KEY` must be base64 and decode to exactly 32 bytes:

```bash
openssl rand -base64 32
```

Do not rotate `ENCRYPTION_KEY` after users have saved API keys unless you also
migrate existing encrypted values. Existing encrypted keys will stop decrypting.

For local WorkOS AuthKit, configure:

- Redirect URI: `http://localhost:3000/callback`
- App homepage URL: `http://localhost:3000`
- CORS origin: `http://localhost:3000`

## Convex Env

Convex functions do not read secrets from `.env.local`. Set WorkOS values on
the target Convex deployment:

```bash
bunx convex env set WORKOS_CLIENT_ID <client_id>
bunx convex env set WORKOS_API_KEY <api_key>
bunx convex env set WORKOS_WEBHOOK_SECRET <secret>
```

`WORKOS_ACTION_SECRET` is only needed if WorkOS actions are added later.
`WORKOS_WEBHOOK_SECRET` belongs in Convex env, not Vercel. The Convex app
declares `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, and `WORKOS_WEBHOOK_SECRET` as
required deployment env vars in `convex/convex.config.ts`.

To inspect configured Convex env names, use:

```bash
bunx convex env list
```

This command prints values. Do not paste raw output into issues, docs, PRs, or
logs. Redact values before sharing command output.

## WorkOS Webhook

Create a WorkOS webhook endpoint for each Convex deployment that should receive
identity lifecycle events.

Endpoint:

```text
https://<your-convex-deployment>.convex.site/workos/webhook
```

Required events:

- `user.created`
- `user.updated`
- `user.deleted`

Copy the webhook signing secret into Convex env as `WORKOS_WEBHOOK_SECRET`.
Do not set `WORKOS_WEBHOOK_SECRET` in Vercel; the webhook handler runs in
Convex.

```bash
bunx convex env set WORKOS_WEBHOOK_SECRET "<secret>"
```

## Vercel Preview

Set these Vercel Preview environment variables:

- `WORKOS_CLIENT_ID`
- `WORKOS_API_KEY`
- `WORKOS_COOKIE_PASSWORD`
- `NEXT_PUBLIC_WORKOS_REDIRECT_URI`
- `CONVEX_DEPLOY_KEY`
- `CSRF_SECRET`
- `ENCRYPTION_KEY`
- AI provider keys needed by the deployment
- optional analytics and observability keys

Use a Convex preview deploy key for `CONVEX_DEPLOY_KEY`.

Vercel provides `VERCEL_BRANCH_URL` and
`VERCEL_PROJECT_PRODUCTION_URL`. `convex.json` uses those values to configure
preview redirect URIs and CORS origins. The Vercel build command runs:

```bash
bun run convex:deploy
```

This injects the preview Convex URL into `NEXT_PUBLIC_CONVEX_URL` during the
Next.js build. The shared deploy script fetches `origin/main`, runs the schema
contraction preflight with a required diff base, then runs `convex deploy`.

`NEXT_PUBLIC_WORKOS_REDIRECT_URI` must still match the preview callback URL that
WorkOS will redirect to. For branch previews, use the Vercel preview callback
URL for that deployment or configure dynamic redirect URI handling before
depending on arbitrary branch URLs.

## Production

Set these Vercel Production environment variables:

- `WORKOS_CLIENT_ID`
- `WORKOS_API_KEY`
- `WORKOS_COOKIE_PASSWORD`
- `NEXT_PUBLIC_WORKOS_REDIRECT_URI`
- `CONVEX_DEPLOY_KEY`
- `CSRF_SECRET`
- `ENCRYPTION_KEY`
- AI provider keys needed by the deployment
- optional analytics and observability keys

Use a Convex production deploy key for `CONVEX_DEPLOY_KEY`.

In WorkOS production, configure:

- Redirect URI: `https://<production-domain>/callback`
- App homepage URL: `https://<production-domain>`
- CORS origin: `https://<production-domain>`
- Webhook endpoint:
  `https://<production-convex-deployment>.convex.site/workos/webhook`

`NEXT_PUBLIC_CONVEX_URL` should not be manually set in Vercel. It is injected by
`convex deploy --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL`.

Production `convex deploy` must go through the shared deploy command:

```bash
bun run convex:deploy
```

The read-only preflight uses `convex/migrations/` manifests to verify that
removed schema fields have zero legacy documents on the target deployment. It
prints only table names, field names, and aggregate counts, and blocks deploys
if the diff base or Convex aggregate counts cannot be verified. See
`docs/convex-migrations.md` for the expand/migrate/contract workflow.

## Troubleshooting

| Symptom                                           | Check                                                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_CONVEX_URL is required`              | Run `bunx convex dev` locally, or confirm Vercel uses the Convex deploy build command.                       |
| WorkOS login redirects fail                       | Confirm `NEXT_PUBLIC_WORKOS_REDIRECT_URI` exactly matches the WorkOS redirect URI and ends in `/callback`.   |
| Convex auth returns unauthenticated               | Confirm `WORKOS_CLIENT_ID` is set in Convex env and redeploy with `bunx convex dev` or `bunx convex deploy`. |
| WorkOS webhook events fail                        | Confirm the endpoint URL, subscribed events, and `WORKOS_WEBHOOK_SECRET` in Convex env.                      |
| Saved API keys stop decrypting                    | Restore the previous `ENCRYPTION_KEY` or migrate encrypted values before rotating it.                        |
| `bun run env:check` rejects a custom local domain | Set `ALLOW_NON_LOCAL_WORKOS_REDIRECT_URI=1` only for that check.                                             |
| `CLERK_*` appears in env output                   | Remove stale Clerk variables after confirming the deployment is on WorkOS AuthKit.                           |

Use `bun run test` for test validation. The configured test runner is Vitest;
raw `bun test` is not the project test command.
