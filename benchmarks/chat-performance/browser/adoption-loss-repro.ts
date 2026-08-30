/**
 * Live-stream adoption-loss regression reproducer (fix documented 2026-08-28).
 *
 * Repeats the durable first-send flow N times and classifies each run:
 * adopted (local stream marks fired) vs lost (settlement receipt only — the
 * page rendered from 750 ms snapshots). For every run it captures the
 * discriminating evidence:
 *   - document `load` events after the send (a REAL navigation would wipe
 *     the User Timing marks and kill the in-flight fetch — the shallow
 *     pushState handoff must never produce one),
 *   - RSC fetches (`?_rsc=`) after the send (an App Router server-patch
 *     navigation re-renders the route tree and can remount the surface),
 *   - the full chat-perf mark timeline, including the binding-lifecycle
 *     gauges (`detached_binding_gauge`: created/adopted/detached/...),
 *   - console errors.
 *
 * Usage: RUNS=30 bun run benchmarks/chat-performance/browser/adoption-loss-repro.ts
 * (spawns the perf server like the harness; BASE_URL reuses one).
 * MODE=project sends from a project surface (/p/<projectId>, created once via
 * the UI) instead of home — the project first send crosses the /p → (chat)
 * LAYOUT boundary, the remount class the shared-owner readopt must survive.
 */
import { spawn, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { chromium, type Page } from "playwright"
import {
  ensurePerfAuthUser,
  getPerfAuthPassword,
  PERF_AUTH_EMAIL,
} from "./ensure-auth-user"

const REPO_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../.."
)
const DIST_DIR = process.env.NEXT_DIST_DIR ?? ".next-perf"
const PERF_PORT = Number(process.env.PERF_PORT ?? 3111)
const RUNS = Number(process.env.RUNS ?? 30)
const MODE = process.env.MODE === "project" ? "project" : "home"
const DIRECTIVE = "[[perf:text-only:60:fixed]]"

function log(message: string): void {
  process.stdout.write(`[adoption-repro] ${message}\n`)
}

let serverProcess: ChildProcess | null = null

async function ensureServer(baseUrl: string, external: boolean): Promise<void> {
  if (!external) {
    if (!existsSync(path.join(REPO_ROOT, DIST_DIR, "BUILD_ID"))) {
      throw new Error(`no production build at ${DIST_DIR}`)
    }
    serverProcess = spawn("bunx", ["next", "start", "-p", String(PERF_PORT)], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        NEXT_DIST_DIR: DIST_DIR,
        CHAT_PERF_DETERMINISTIC_PROVIDER: "1",
        CHAT_PERF_SAMPLE_RATE: "0",
      },
      stdio: ["ignore", "ignore", "inherit"],
    })
  }
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl, { redirect: "manual" })
      if (response.status < 500) return
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(`server at ${baseUrl} did not become ready`)
}

type Mark = { name: string; t: number; detail: Record<string, unknown> | null }

async function readMarks(page: Page): Promise<Mark[]> {
  return page.evaluate(() =>
    performance
      .getEntriesByType("mark")
      .filter((entry) => entry.name.startsWith("chat-perf:"))
      .map((entry) => ({
        name: entry.name.slice("chat-perf:".length),
        t: Math.round(entry.startTime),
        detail:
          ((entry as PerformanceMark).detail as Record<
            string,
            unknown
          > | null) ?? null,
      }))
  )
}

async function waitFor(
  page: Page,
  predicate: () => Promise<boolean>,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return false
}

async function hasMark(page: Page, name: string): Promise<boolean> {
  return page.evaluate(
    (markName) => performance.getEntriesByName(markName).length > 0,
    `chat-perf:${name}`
  )
}

async function main() {
  const externalBaseUrl = process.env.BASE_URL
  const baseUrl = externalBaseUrl ?? `http://localhost:${PERF_PORT}`
  const password = getPerfAuthPassword()
  await ensureServer(baseUrl, Boolean(externalBaseUrl))
  await ensurePerfAuthUser()

  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  })
  // History forensics: patched before any app code loads, so every URL
  // transition — the app's shallow handoff AND whatever Next's router does —
  // is recorded with a stack.
  await context.addInitScript(() => {
    type NavEntry = { t: number; kind: string; url: string; stack: string }
    const navLog: NavEntry[] = []
    ;(window as unknown as { __navLog: NavEntry[] }).__navLog = navLog
    const record = (kind: string, url: unknown) => {
      navLog.push({
        t: Math.round(performance.now()),
        kind,
        url: String(url ?? location.href),
        stack: (new Error().stack ?? "")
          .split("\n")
          .slice(2, 6)
          .map((line) => line.trim())
          .join(" <- "),
      })
    }
    const rawPush = history.pushState.bind(history)
    const rawReplace = history.replaceState.bind(history)
    history.pushState = (state, title, url) => {
      record("pushState", url)
      return rawPush(state, title, url)
    }
    history.replaceState = (state, title, url) => {
      record("replaceState", url)
      return rawReplace(state, title, url)
    }
    window.addEventListener("popstate", () => record("popstate", location.href))
  })
  const page = await context.newPage()

  // Sign in once through the real form.
  await page.goto(`${baseUrl}/auth/login`, { waitUntil: "domcontentloaded" })
  await page.locator("#email").fill(PERF_AUTH_EMAIL)
  await page.locator("#password").fill(password)
  await page.getByRole("button", { name: "Log in" }).click()
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), {
    timeout: 30000,
  })
  log(`signed in as ${PERF_AUTH_EMAIL}`)

  // Instrumentation channels that survive across runs on this page object.
  let loadEvents: number[] = []
  let rscRequests: string[] = []
  let consoleErrors: string[] = []
  page.on("load", () => loadEvents.push(Date.now()))
  page.on("request", (request) => {
    const url = request.url()
    if (url.includes("_rsc=")) rscRequests.push(url)
  })
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })

  let sendUrl = baseUrl
  if (MODE === "project") {
    // Create one project through the real dialog; every run reuses it.
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" })
    await page.locator('[aria-label="New project"]').first().click()
    await page
      .getByPlaceholder("Project name")
      .fill(`adoption-repro-${Date.now()}`)
    await page.getByRole("button", { name: "Create Project" }).click()
    await page.waitForURL(/\/p\//, { timeout: 20000 })
    sendUrl = page.url()
    log(`project surface: ${sendUrl}`)
  }

  let adopted = 0
  let lost = 0
  const lossDetails: string[] = []

  for (let run = 1; run <= RUNS; run++) {
    await page.goto(sendUrl, { waitUntil: "domcontentloaded" })
    const editor = page.locator('[contenteditable="true"]').first()
    await editor.waitFor({ state: "visible", timeout: 15000 })
    // Reset channels AFTER the onboarding load settles.
    loadEvents = []
    rscRequests = []
    consoleErrors = []
    const sentAt = Date.now()

    await editor.click()
    await page.keyboard.type(DIRECTIVE)
    await page.locator('[data-testid="send-button"]').click()

    // Terminal condition: either the local stream finished, or (loss) the
    // settlement receipt arrived with no local stream marks.
    const done = await waitFor(
      page,
      async () =>
        (await hasMark(page, "stream_terminal")) ||
        (await hasMark(page, "durable_settlement_receipt")),
      60_000
    )
    await page.waitForTimeout(1500)

    const marks = await readMarks(page)
    const names = new Set(marks.map((mark) => mark.name))
    const isAdopted =
      names.has("first_chunk_received") || names.has("stream_terminal")
    const url = page.url()
    const navLog = await page.evaluate(
      () =>
        (
          window as unknown as {
            __navLog?: { t: number; kind: string; url: string; stack: string }[]
          }
        ).__navLog ?? []
    )
    const createdCount = marks.filter(
      (mark) =>
        mark.name === "detached_binding_gauge" &&
        mark.detail?.event === "created"
    ).length

    if (!done) {
      log(`run ${run}: TIMEOUT (url ${url}) — treating as loss`)
    }
    if (isAdopted && done) {
      adopted++
      log(
        `run ${run}: adopted (loads=${loadEvents.length} rsc=${rscRequests.length} bindingsCreated=${createdCount} navs=${navLog.length})`
      )
    } else {
      lost++
      const gauges = marks
        .filter((mark) => mark.name === "detached_binding_gauge")
        .map(
          (mark) =>
            `${mark.t}ms ${String(mark.detail?.event)} [${String(mark.detail?.bindingClass)}] a=${String(mark.detail?.attachedCount)} d=${String(mark.detail?.detachedCount)}`
        )
      const timeline = marks
        .filter((mark) => mark.name !== "detached_binding_gauge")
        .map((mark) => `${mark.t}ms ${mark.name}`)
      const detail = [
        `run ${run}: LOST (url ${url})`,
        `  history ops (t=ms since doc start):`,
        ...navLog.map(
          (entry) =>
            `    ${entry.t}ms ${entry.kind} -> ${entry.url}\n      ${entry.stack.slice(0, 400)}`
        ),
        `  loads after send: ${loadEvents.length} (${loadEvents.map((t) => `+${t - sentAt}ms`).join(", ") || "none"})`,
        `  rsc fetches after send: ${rscRequests.length}`,
        ...rscRequests.slice(0, 5).map((u) => `    ${u}`),
        `  console errors: ${consoleErrors.length}`,
        ...consoleErrors.slice(0, 5).map((e) => `    ${e.slice(0, 200)}`),
        `  binding gauges: ${gauges.length ? "" : "(none)"}`,
        ...gauges.map((g) => `    ${g}`),
        `  marks: ${timeline.join(" | ") || "(none — document was replaced?)"}`,
      ].join("\n")
      lossDetails.push(detail)
      log(detail)
    }
  }

  log(`done: ${adopted} adopted, ${lost} lost of ${RUNS}`)
  await browser.close()
  serverProcess?.kill()
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  serverProcess?.kill()
  process.exit(1)
})
