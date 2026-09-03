#!/usr/bin/env bun
/**
 * Provision the agent's WorkOS test user and save a reusable authenticated
 * session (Playwright storageState) so other tooling can run signed-in.
 *
 * Steps: ensure the pre-verified test user exists (idempotent) → sign in via
 * /auth/login → write the sealed session to a storageState file. Point QA or
 * test runs at that file to skip logging in every time.
 *
 *   bun run agent:login                          # against http://localhost:3000
 *   bun run agent:login --base-url http://localhost:3000 --out playwright/.auth/user.json
 *
 * Requires PERF_AUTH_PASSWORD (and optionally PERF_AUTH_EMAIL) in the env, and
 * the app running at --base-url. The storageState carries a session cookie —
 * it is written under playwright/.auth (gitignored), never committed.
 */
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"
import { ensurePerfAuthUser } from "@/benchmarks/chat-performance/browser/ensure-auth-user"
import { chromium } from "playwright"
import { getAgentCredentials, signInWithPassword } from "./lib/agent-auth"

const DEFAULT_OUT = "playwright/.auth/user.json"

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "base-url": { type: "string", default: "http://localhost:3000" },
      out: { type: "string", default: DEFAULT_OUT },
    },
  })
  const baseUrl = values["base-url"] ?? "http://localhost:3000"
  const out = values.out ?? DEFAULT_OUT
  const credentials = getAgentCredentials()

  await ensurePerfAuthUser()

  const browser = await chromium.launch({
    channel: "chrome",
    args: ["--no-sandbox"],
  })
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    await signInWithPassword(page, baseUrl, credentials)
    await mkdir(path.dirname(out), { recursive: true })
    await context.storageState({ path: out })
    console.log(`agent-login: signed in as ${credentials.email}`)
    console.log(`agent-login: wrote session to ${out}`)
  } finally {
    await browser.close()
  }
}

void main()
