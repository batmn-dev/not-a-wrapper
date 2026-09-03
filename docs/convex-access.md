# Reading & Querying Convex (Agent Guide)

How to look at this app's Convex data without getting fooled by the wrong
deployment. Read this **before** querying Convex through the MCP, the CLI, or the
dashboard. For env/secret setup see `docs/environment.md`.

## The one rule

**The app's data lives in exactly one deployment: whatever `CONVEX_DEPLOYMENT`
(server + CLI) and `NEXT_PUBLIC_CONVEX_URL` (client) point to in `.env.local`.**
Read _that_ deployment. Any other deployment — preview, a stale dev, a tool's
default — is a different database and will look empty or wrong.

## Deployment map

The canonical dev deployment is **whatever `CONVEX_DEPLOYMENT` /
`NEXT_PUBLIC_CONVEX_URL` point to in `.env.local`** — that is the only database
the app reads and writes. Make every tool agree with it:

- The **CLI** and **`convex dev`** read `.env.local` automatically.
- The **MCP does _not_ reliably follow `.env.local`.** Pin it explicitly with
  `--deployment <slug>` in its config (the `convex` server entry in
  `~/.claude.json`), matching the `*.convex.cloud` slug in
  `NEXT_PUBLIC_CONVEX_URL`. Without an explicit `--deployment` it resolves a
  deployment of kind `"unspecified"` and reads a different, often empty backend
  — exactly the trap that wasted a debugging session.

| Role                      | How to identify                                                 | Notes                                               |
| ------------------------- | --------------------------------------------------------------- | --------------------------------------------------- |
| **Local dev (canonical)** | the Convex id in `NEXT_PUBLIC_CONVEX_URL` / `CONVEX_DEPLOYMENT` | App, `convex dev`, CLI, and MCP must all point here |
| Production                | "Production" (`tidy-clam-680`)                                  | Read-only via tooling; never write from an agent    |
| Previews                  | per-branch, ephemeral (Vercel)                                  | per-branch only                                     |

Identify the canonical dev deployment by matching the Convex id in
`NEXT_PUBLIC_CONVEX_URL` — **never** by a friendly dashboard label. A
deployment's label can be a custom string while its real id is the
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
   bunx convex run messages:getSelectedPath '{"chatId":"<publicId>"}'
   bunx convex logs                  # tail function logs
   ```

   Client-facing chat functions take the chat's client-minted `publicId`
   (the `/c/<publicId>` route segment, the `chats.publicId` column), never
   the Convex `_id` (ADR-0033).

   `convex data`/`env list` can print values — redact before sharing output.

3. **Convex MCP** — only after the verification below passes.

## ⚠️ Convex MCP gotcha (this cost us a long detour)

The MCP runs `npx convex mcp start`. If it has no explicit `CONVEX_DEPLOYMENT`,
its `status` returns a deployment of kind **`"unspecified"`** and its queries hit
a **different, usually empty backend** than the app — while still _labelling_
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
  `chats` has rows. Check the _specific_ table you care about
  (`chats` / `messages` / `generationRuns`), not whatever the dashboard opened by
  default.
- **A known document id that won't `normalizeId` against a deployment** means
  you're querying the wrong deployment.

## Tables you'll usually want

`chats`, `messages`, `generationRuns`, `toolInvocations`, `toolCallLog`,
`toolApprovalRequests`, `toolLimitBuckets`,
`users`, `userKeys`, `userPreferences`, `projects`, `mcpServers`,
`mcpToolApprovals`, `chatAttachments`, `anonymousUsage`, `feedback`.
