#!/usr/bin/env node
/**
 * Defensive backfill for the chats.updatedAt optional→required narrowing
 * (docs/sidebar-chat-list-streaming-plan.md commit 5).
 *
 * Invokes the internal mutation `chats:backfillUpdatedAt`, which sets
 * `updatedAt = _creationTime` for any chat missing it so the `by_user_updated`
 * index has no null keys. Idempotent — safe to run repeatedly.
 *
 * Because `chats.create` has always set `updatedAt`, no live row should lack it
 * and the required-schema push succeeds directly; this script is the fallback.
 * If a deployment DOES hold legacy rows, the required-schema push will be
 * rejected — in that case run this WHILE `updatedAt` is still optional (i.e.
 * before deploying commit 5's schema), then push the narrowed schema.
 *
 * Usage:
 *   node scripts/backfill-chat-updated-at.mjs            # current deployment
 *   node scripts/backfill-chat-updated-at.mjs --prod     # production deployment
 */
import { spawnSync } from "node:child_process"

const args = ["convex", "run", "chats:backfillUpdatedAt"]
if (process.argv.includes("--prod")) {
  args.push("--prod")
}

const result = spawnSync("npx", args, { stdio: "inherit" })

if (result.error) {
  console.error("Failed to run chats:backfillUpdatedAt:", result.error.message)
  process.exit(1)
}

if (result.signal || result.status === null) {
  console.error("chats:backfillUpdatedAt was interrupted")
  process.exit(1)
}

process.exit(result.status)
