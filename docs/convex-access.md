# Reading & Querying Convex (Agent Guide)

How to look at this app's Convex data without getting fooled by the wrong
deployment. Read this **before** querying Convex through the MCP, the CLI, or the
dashboard. For env/secret setup see `docs/environment.md`.

## The one rule

**The app's data lives in exactly one deployment: whatever `CONVEX_DEPLOYMENT`
(server + CLI) and `NEXT_PUBLIC_CONVEX_URL` (client) point to in `.env.local`.**
Read *that* deployment. Any other deployment — preview, a stale dev, a tool's
default — is a different database and will look empty or wrong.

## Deployment map

The project standardizes on Convex's **default per-developer dev deployment,
"Development (Cloud)"** — the one `convex dev` provisions and reconnects to (it
re-creates itself if you delete it). Do **not** run on a custom-named dev
deployment: every tool that defaults to "Development (Cloud)" (notably the MCP)
then reads a different, empty database than your app, which is exactly the trap
that wasted a debugging session.

| Role | How to identify | Notes |
| --- | --- | --- |
| **Local dev (canonical)** | "Development (Cloud)" — its Convex id matches `NEXT_PUBLIC_CONVEX_URL` / `CONVEX_DEPLOYMENT` in `.env.local` | What the app, `convex dev`, the CLI, and the MCP should all use |
| Production | "Production" (`tidy-clam-680`) | Read-only via tooling; never write from an agent |
| Previews | per-branch, ephemeral (Vercel) | per-branch only |

Identify the canonical dev deployment by matching the Convex id in
`NEXT_PUBLIC_CONVEX_URL` — **never** by a friendly label. A deployment's
dashboard label can be a custom string while its real id is the
`*.convex.cloud` slug.

## How to read data — in order of reliability

1. **Dashboard (ground truth).** <https://dashboard.convex.dev> → pick the
   deployment whose id matches `NEXT_PUBLIC_CONVEX_URL` → **Data** tab →
   `chats` / `messages` / `generationRuns` / `users`. The **Logs** tab shows live
   function calls (`chatRuntime.prepareGeneration`,
   `chatRuntime.markGenerationRunCompleted`, …) as turns run.
2. **Convex CLI, from the project root** (so it reads `.env.local`'s
   `CONVEX_DEPLOYMENT`):

   ```bash
   bunx convex data chats            # page a table
   bunx convex run messages:getForChat '{"chatId":"<id>"}'
   bunx convex logs                  # tail function logs
   ```

   `convex data`/`env list` can print values — redact before sharing output.
3. **Convex MCP** — only after the verification below passes.

## ⚠️ Convex MCP gotcha (this cost us a long detour)

The MCP runs `npx convex mcp start`. If it has no explicit `CONVEX_DEPLOYMENT`,
its `status` returns a deployment of kind **`"unspecified"`** and its queries hit
a **different, usually empty backend** than the app — while still *labelling*
itself with a real-looking url. It does not error; it returns confidently wrong
(empty) data.

**Verify before trusting the MCP, every time:**

1. Call `status`; confirm the returned deployment **url matches
   `NEXT_PUBLIC_CONVEX_URL`** and the kind is not `"unspecified"`.
2. Sanity read: count `users` (or `chats`). For an app in active use this is
   `> 0`. **If it's `0`, or `status` is `"unspecified"`, the MCP is pointed at
   the wrong backend — stop and use the dashboard or CLI instead.**

## Sanity checks — distrust the tool, not reality

- **`0 users` while someone is logged in and using the app is impossible.** It
  means the read tool is pointed at the wrong deployment, not that the app is
  empty. A read that contradicts what you can see in the running app is wrong;
  cross-check the dashboard immediately rather than theorising.
- **One empty table ≠ empty deployment.** `anonymousUsage` is often empty while
  `chats` has rows. Check the *specific* table you care about
  (`chats` / `messages` / `generationRuns`), not whatever the dashboard opened by
  default.
- **A known document id that won't `normalizeId` against a deployment** means
  you're querying the wrong deployment.

## Tables you'll usually want

`chats`, `messages`, `generationRuns`, `assistantMessageSnapshots`,
`toolInvocations`, `toolCallLog`, `toolApprovalRequests`, `toolLimitBuckets`,
`users`, `userKeys`, `userPreferences`, `projects`, `mcpServers`,
`mcpToolApprovals`, `chatAttachments`, `anonymousUsage`, `feedback`.
