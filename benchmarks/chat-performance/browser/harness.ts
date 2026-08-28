/**
 * Chromium benchmark harness (measurement plan Phase 3 §3.2).
 *
 * Drives the PRODUCTION app (an isolated perf build, never the dev .next)
 * through the deterministic stream provider, extracts the app's own
 * content-free `chat-perf:*` User Timing marks plus DOM/heap growth, folds
 * the captured SSE stream for a byte-level correctness check against the
 * scenario oracle, joins sampled server `chat_perf` spans by correlation id,
 * and emits one versioned JSON result file. A correctness failure marks the
 * scenario failed — its timings must not be read as a valid sample.
 *
 * Usage (guest-path scenarios; see the runbook for the manual protocol):
 *   1. NEXT_PUBLIC_CHAT_PERF_INSTRUMENTATION=true NEXT_DIST_DIR=.next-perf \
 *        bun run build:next
 *   2. bun run bench:browser            # spawns `next start` on PERF_PORT
 * Env: SUITE=standard|smoke (default standard), RUNS (default 10),
 *      WARMUPS (default 2), PERF_PORT (default 3111), BASE_URL (reuse a
 *      running perf server instead of spawning; server-span join unavailable),
 *      PW_CHANNEL (e.g. "chrome" to use installed Chrome).
 */
import { deterministicScenarioText } from "@/app/api/chat/deterministic-provider"
import { execSync, spawn, type ChildProcess } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
  type Response,
} from "playwright"
import { hashValue } from "../fixtures"
import {
  round2,
  summarize,
  type BenchmarkResultFile,
  type RunMetrics,
  type ScenarioResult,
} from "./result-schema"
import {
  ensurePerfAuthUser,
  PERF_AUTH_EMAIL,
  PERF_AUTH_PASSWORD,
} from "./ensure-auth-user"
import {
  directiveFor,
  DURABLE_SUITE,
  SMOKE_SUITE,
  STANDARD_SUITE,
  type BrowserScenarioConfig,
} from "./scenarios"

const PERF_PORT = Number(process.env.PERF_PORT ?? 3111)
const RUNS = Number(process.env.RUNS ?? 10)
const WARMUPS = Number(process.env.WARMUPS ?? 2)
const SUITE_NAME = process.env.SUITE ?? "standard"
const DIST_DIR = process.env.NEXT_DIST_DIR ?? ".next-perf"
const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..")

type CollectedMark = {
  name: string
  startTime: number
  detail: Record<string, unknown> | null
}

type ServerPerfLine = Record<string, unknown> & {
  event?: string
  /** Harness wall-clock stamp at pipe read — the cross-tab freshness anchor. */
  receivedAt: number
}

const serverPerfLines: ServerPerfLine[] = []
let serverProcess: ChildProcess | null = null

function log(message: string) {
  console.log(`[bench:browser] ${message}`)
}

function fail(message: string): never {
  console.error(`[bench:browser] FATAL: ${message}`)
  process.exit(1)
}

async function waitForServer(baseUrl: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl, { redirect: "manual" })
      if (response.status < 500) return
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  fail(`server at ${baseUrl} did not become ready in ${timeoutMs}ms`)
}

function spawnPerfServer(baseUrl: string): void {
  const buildIdPath = path.join(REPO_ROOT, DIST_DIR, "BUILD_ID")
  if (!existsSync(buildIdPath)) {
    fail(
      `no production build at ${DIST_DIR}. Build one first:\n` +
        `  NEXT_PUBLIC_CHAT_PERF_INSTRUMENTATION=true NEXT_DIST_DIR=${DIST_DIR} bun run build:next`
    )
  }
  log(`starting perf server on :${PERF_PORT} (dist: ${DIST_DIR})`)
  serverProcess = spawn(
    "bunx",
    ["next", "start", "-p", String(PERF_PORT)],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        NEXT_DIST_DIR: DIST_DIR,
        CHAT_PERF_DETERMINISTIC_PROVIDER: "1",
        CHAT_PERF_SAMPLE_RATE: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  )
  const capture = (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      const trimmed = line.trim()
      if (!trimmed.startsWith("{")) continue
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>
        if (parsed._tag === "chat_perf") {
          serverPerfLines.push({ ...parsed, receivedAt: Date.now() })
        }
      } catch {
        // Non-JSON server output.
      }
    }
  }
  serverProcess.stdout?.on("data", capture)
  serverProcess.stderr?.on("data", capture)
  serverProcess.on("exit", (code) => {
    if (code !== null && code !== 0) log(`perf server exited with code ${code}`)
  })
}

function stopPerfServer() {
  serverProcess?.kill("SIGTERM")
  serverProcess = null
}

async function readMarks(page: Page): Promise<CollectedMark[]> {
  return page.evaluate(() =>
    performance
      .getEntriesByType("mark")
      .filter((entry) => entry.name.startsWith("chat-perf:"))
      .map((entry) => ({
        name: entry.name.slice("chat-perf:".length),
        startTime: entry.startTime,
        detail:
          ((entry as PerformanceMark).detail as Record<
            string,
            unknown
          > | null) ?? null,
      }))
  )
}

async function waitForMark(
  page: Page,
  name: string,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = await page.evaluate(
      (markName) => performance.getEntriesByName(markName).length > 0,
      `chat-perf:${name}`
    )
    if (found) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const seen = await page
    .evaluate(() =>
      performance
        .getEntriesByType("mark")
        .filter((entry) => entry.name.startsWith("chat-perf:"))
        .map((entry) => entry.name.slice("chat-perf:".length))
    )
    .catch(() => ["<marks unreadable>"])
  throw new Error(
    `timed out waiting for mark ${name} (${timeoutMs}ms) at ${page.url()}; ` +
      `marks seen: ${[...new Set(seen)].join(", ") || "none"}`
  )
}

/** Clears storage and reloads so the next send mints a fresh guest id. */
async function clearGuestIdentity(page: Page): Promise<void> {
  await page.evaluate(async () => {
    localStorage.clear()
    sessionStorage.clear()
    const databases = (await indexedDB.databases?.()) ?? []
    await Promise.all(
      databases.map(
        (db) =>
          new Promise<void>((resolve) => {
            if (!db.name) return resolve()
            const request = indexedDB.deleteDatabase(db.name)
            request.onsuccess = () => resolve()
            request.onerror = () => resolve()
            request.onblocked = () => resolve()
          })
      )
    )
  })
  await page.reload({ waitUntil: "domcontentloaded" })
}

/** Waits for the first of several marks; returns the name that appeared. */
async function waitForAnyMark(
  page: Page,
  names: string[],
  timeoutMs: number
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const name of names) {
      const found = await page.evaluate(
        (markName) => performance.getEntriesByName(markName).length > 0,
        `chat-perf:${name}`
      )
      if (found) return name
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(
    `timed out waiting for any of [${names.join(", ")}] (${timeoutMs}ms) at ${page.url()}`
  )
}

/** Like waitForMark but resolves false on timeout instead of throwing. */
async function tryWaitForMark(
  page: Page,
  name: string,
  timeoutMs: number
): Promise<boolean> {
  try {
    await waitForMark(page, name, timeoutMs)
    return true
  } catch {
    return false
  }
}

/**
 * Signs in as the harness test user through the real /auth/login form and
 * returns the context storage state (the sealed wos-session cookie). Runs
 * once per harness process; every authenticated scenario context reuses it.
 */
async function acquireAuthState(
  browser: Browser,
  baseUrl: string
): Promise<Awaited<ReturnType<BrowserContext["storageState"]>>> {
  await ensurePerfAuthUser()
  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    await page.goto(`${baseUrl}/auth/login`, { waitUntil: "domcontentloaded" })
    await page.locator("#email").fill(PERF_AUTH_EMAIL)
    await page.locator("#password").fill(PERF_AUTH_PASSWORD)
    await page.getByRole("button", { name: "Log in" }).click()
    // The action redirects home; the composer appearing proves the session
    // is live (and the users.createOrUpdate bootstrap has a chance to run).
    await page.waitForURL((url) => !url.pathname.startsWith("/auth"), {
      timeout: 20000,
    })
    await page
      .locator('[contenteditable="true"]')
      .first()
      .waitFor({ state: "visible", timeout: 20000 })
    log(`signed in as ${PERF_AUTH_EMAIL}`)
    return await context.storageState()
  } finally {
    await context.close()
  }
}

/**
 * Installs a body-growth observer in a page: records `{t, len}` wall-clock
 * samples whenever rendered text grows. Perturbs THIS page's layout (it
 * reads innerText per mutation batch) — use only on the observation tab,
 * never the measured one.
 */
async function installGrowthObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __perfGrowth?: Array<{ t: number; len: number }>
    }
    w.__perfGrowth = []
    const record = () => {
      const len = document.body.innerText.length
      const last = w.__perfGrowth![w.__perfGrowth!.length - 1]
      if (!last || len > last.len) w.__perfGrowth!.push({ t: Date.now(), len })
    }
    new MutationObserver(record).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    })
    record()
  })
}

async function readGrowthSamples(
  page: Page
): Promise<Array<{ t: number; len: number }>> {
  return page.evaluate(
    () =>
      (window as unknown as { __perfGrowth?: Array<{ t: number; len: number }> })
        .__perfGrowth ?? []
  )
}

function foldSseText(body: string): { text: string; sawError: boolean } {
  let text = ""
  let sawError = false
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue
    const payload = line.slice("data: ".length).trim()
    if (!payload || payload === "[DONE]") continue
    try {
      const chunk = JSON.parse(payload) as { type?: string; delta?: string }
      if (chunk.type === "text-delta" && typeof chunk.delta === "string") {
        text += chunk.delta
      }
      if (chunk.type === "error") sawError = true
    } catch {
      // Ignore non-JSON frames.
    }
  }
  return { text, sawError }
}

function markAt(marks: CollectedMark[], name: string): number | undefined {
  return marks.find((mark) => mark.name === name)?.startTime
}

function diff(
  marks: CollectedMark[],
  from: string,
  to: string
): number | undefined {
  const a = markAt(marks, from)
  const b = markAt(marks, to)
  return a !== undefined && b !== undefined ? round2(b - a) : undefined
}

function durations(marks: CollectedMark[], name: string): number[] {
  return marks
    .filter((mark) => mark.name === name)
    .map((mark) => Number(mark.detail?.durationMs))
    .filter((value) => Number.isFinite(value))
}

async function runScenarioOnce(
  context: BrowserContext,
  baseUrl: string,
  config: BrowserScenarioConfig,
  timeoutMs: number
): Promise<RunMetrics> {
  const page = await context.newPage()
  const cdp: CDPSession = await context.newCDPSession(page)
  await cdp.send("Performance.enable")
  if (config.cpuThrottle > 1) {
    await cdp.send("Emulation.setCPUThrottlingRate", {
      rate: config.cpuThrottle,
    })
  }

  let chatResponse: Response | null = null
  const chatResponseUrls: string[] = []
  page.on("response", (response) => {
    if (
      response.url().includes("/api/chat") &&
      response.request().method() === "POST"
    ) {
      chatResponseUrls.push(`${response.status()} ${response.url()}`)
      chatResponse = response
    }
  })

  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" })
    // Fresh guest identity per run: the anonymous-user daily message limit
    // (NON_AUTH_DAILY_MESSAGE_LIMIT = 5) would otherwise block the sixth
    // send in a shared context. Clearing storage and reloading mints a new
    // guest id while keeping the context (JS caches) warm. Authenticated
    // runs skip this: the signed-in daily limit is 1000 and clearing would
    // churn the Convex client state between runs.
    if (!config.auth) await clearGuestIdentity(page)
    const editor = page.locator('[contenteditable="true"]').first()
    await editor.waitFor({ state: "visible", timeout: 15000 })

    const heapBefore = await readHeap(cdp)
    const domNodesBefore = await page.evaluate(
      () => document.querySelectorAll("*").length
    )

    await editor.click()
    await page.keyboard.type(directiveFor(config))
    await page.locator('[data-testid="send-button"]').click()

    // Durable turns navigate to the server chat URL on acceptance.
    let secondTab: Page | null = null
    if (config.auth) {
      await page.waitForURL(/\/c\//, { timeout: 30000 })
    }

    let reloadedMidStream = false
    // Durable sends occasionally lose live-stream adoption after the hard
    // navigation to /c/<chatId>: the turn runs and settles server-side and
    // content renders from the 750 ms snapshots, but the local stream marks
    // (first_chunk_received / first_visible_text / stream_terminal) never
    // fire. Measured, not fatal: such runs are counted and their correctness
    // falls back to the settlement rules.
    let liveStreamNotAdopted = false
    const awaitFirstVisible = async (): Promise<boolean> => {
      if (!config.auth) {
        await waitForMark(page, "first_visible_text", timeoutMs)
        return true
      }
      const seen = await waitForAnyMark(
        page,
        ["first_visible_text", "durable_settlement_receipt"],
        timeoutMs
      )
      if (seen !== "first_visible_text") {
        liveStreamNotAdopted = true
        return false
      }
      return true
    }

    if (config.action === "stop") {
      if (await awaitFirstVisible()) {
        // Let a visible slice stream before stopping.
        await page.waitForTimeout(1000)
        await page.locator('[data-testid="send-button"]').click()
      }
    } else if (config.action === "second-tab") {
      if (await awaitFirstVisible()) {
        secondTab = await context.newPage()
        await secondTab.goto(page.url(), { waitUntil: "domcontentloaded" })
        await installGrowthObserver(secondTab)
      }
    } else if (config.action === "reload") {
      if (await awaitFirstVisible()) {
        // Let a couple of 750 ms snapshot beats land before the cut.
        await page.waitForTimeout(2000)
        await page.reload({ waitUntil: "domcontentloaded" })
        reloadedMidStream = true
      }
    } else if (config.auth) {
      // Complete-action durable runs: detect adoption loss up front so the
      // terminal wait below cannot burn the full timeout.
      await awaitFirstVisible()
    }

    if (reloadedMidStream) {
      // The foreground stream is gone; recovery is measured through the
      // reloaded page's navigation marks and the settlement receipt.
      await waitForMark(page, "authoritative_thread_content_received", 30000)
      await tryWaitForMark(page, "durable_settlement_receipt", timeoutMs)
    } else if (liveStreamNotAdopted) {
      await tryWaitForMark(page, "durable_settlement_receipt", timeoutMs)
    } else {
      await waitForMark(page, "stream_terminal", timeoutMs)
      if (config.auth) {
        await tryWaitForMark(page, "durable_settlement_receipt", 15000)
      }
    }
    // Let post-terminal effects (summary marks, settlement writes) land.
    await page.waitForTimeout(config.auth ? 1500 : 750)

    const marks = await readMarks(page)
    const domNodesAfter = await page.evaluate(
      () => document.querySelectorAll("*").length
    )
    const heapAfter = await readHeap(cdp)

    const oracle = deterministicScenarioText(config.scenario)
    let foldedText = ""
    let bodyAvailable = false
    let bodyCaptureNote = ""
    try {
      // A reload interrupts the SSE request mid-flight; Playwright's text()
      // then waits forever for a response-finished event that never comes.
      // Reload runs skip the body outright, and every read is time-boxed.
      const body =
        chatResponse && config.action !== "reload"
          ? await Promise.race([
              (chatResponse as Response).text(),
              new Promise<string>((_, reject) =>
                setTimeout(
                  () => reject(new Error("body read timed out (10s)")),
                  10000
                )
              ),
            ])
          : ""
      bodyAvailable = body.length > 0
      foldedText = foldSseText(body).text
      if (!bodyAvailable) {
        bodyCaptureNote = chatResponse
          ? `empty body [${chatResponseUrls.join("; ")}]`
          : "no /api/chat response captured"
      }
    } catch (error) {
      // A stopped stream's body may be unavailable; correctness falls back
      // to outcome + prefix rules below.
      bodyCaptureNote = `body unreadable: ${String(error).split("\n")[0]} [${chatResponseUrls.join("; ")}]`
    }

    const terminalMark = marks.find((mark) => mark.name === "stream_terminal")
    const terminalOutcome =
      typeof terminalMark?.detail?.outcome === "string"
        ? (terminalMark.detail.outcome as string)
        : null
    const settleMismatchCount = marks.filter(
      (mark) => mark.name === "markdown_projection_settle_mismatch"
    ).length

    const settlementReceipt = marks.find(
      (mark) => mark.name === "durable_settlement_receipt"
    )
    const settlementOutcome =
      typeof settlementReceipt?.detail?.outcome === "string"
        ? (settlementReceipt.detail.outcome as string)
        : null

    let correctnessOk: boolean
    let detail: string | undefined
    if (liveStreamNotAdopted) {
      // No local stream marks exist; the durable plane must still be whole.
      correctnessOk =
        settlementOutcome === "completed" && settleMismatchCount === 0
      detail = `live stream not adopted (settlement ${settlementOutcome})`
    } else if (config.action === "reload") {
      // No stream marks survive the reload; correctness is the durable
      // plane's own story: settlement completed, no settle mismatch, and a
      // substantial settled answer rendered (markdown rendering strips
      // syntax, so this is a bound, not byte equality).
      correctnessOk =
        settlementOutcome === "completed" && settleMismatchCount === 0
      if (settlementOutcome !== "completed") {
        detail = `settlement outcome ${settlementOutcome} (expected completed)`
      }
      const renderedLength = await page.evaluate(
        () => document.body.innerText.length
      )
      if (correctnessOk && renderedLength < oracle.text.length * 0.4) {
        correctnessOk = false
        detail = `reloaded page rendered only ${renderedLength} chars`
      }
    } else {
      correctnessOk = terminalOutcome === config.expectedOutcome
      if (settleMismatchCount > 0) {
        correctnessOk = false
        detail = `settle mismatches: ${settleMismatchCount}`
      } else if (config.action === "stop") {
        if (bodyAvailable && !oracle.text.startsWith(foldedText)) {
          correctnessOk = false
          detail = "stopped stream text is not a prefix of the oracle"
        }
      } else if (config.expectedOutcome === "error") {
        // An errored stream's response body may be unreadable from the driver
        // (the fetch aborts mid-stream); fall back to outcome + settle-mismatch
        // rules, mirroring the stop branch.
        if (bodyAvailable && foldedText !== oracle.text) {
          correctnessOk = false
          detail = `pre-error text mismatch (${foldedText.length} vs ${oracle.text.length} chars)`
        }
      } else if (config.auth && !bodyAvailable) {
        // The first durable send hard-navigates to /c/<chatId>, which
        // flushes Chromium's network buffer — the SSE body is unreadable
        // from the driver. Byte fidelity of the identical stream pipeline is
        // proven by the guest suite; durable correctness rests on the
        // settlement receipt plus the settle-mismatch and outcome gates.
        if (settlementOutcome !== "completed") {
          correctnessOk = false
          detail = `settlement outcome ${settlementOutcome} (expected completed)`
        } else {
          const renderedLength = await page.evaluate(
            () => document.body.innerText.length
          )
          if (renderedLength < oracle.text.length * 0.4) {
            correctnessOk = false
            detail = `durable page rendered only ${renderedLength} chars`
          }
        }
      } else if (foldedText !== oracle.text) {
        correctnessOk = false
        detail = `folded text mismatch (${foldedText.length} vs ${oracle.text.length} chars)${bodyCaptureNote ? `; ${bodyCaptureNote}` : ""}`
      }
      if (terminalOutcome !== config.expectedOutcome) {
        detail = `terminal outcome ${terminalOutcome} (expected ${config.expectedOutcome})${detail ? `; ${detail}` : ""}`
      }
    }

    const sendIntent = marks.find((mark) => mark.name === "chat_send_intent")
    const correlationId =
      typeof sendIntent?.detail?.correlationId === "string"
        ? (sendIntent.detail.correlationId as string)
        : undefined
    const serverSpans = correlationId
      ? collectServerSpans(correlationId)
      : undefined
    const durableWrites =
      config.auth && correlationId
        ? collectDurableWrites(correlationId)
        : undefined

    // Cross-tab freshness (second-tab runs): each accepted/deduped snapshot
    // checkpoint's harness-clock stamp matched to the first tab-2 rendered
    // growth at or after it. Same machine clock on both sides.
    let snapshotToSecondTabMedianMs: number | undefined
    let snapshotToSecondTabMaxMs: number | undefined
    let terminalToSecondTabSettledMs: number | undefined
    if (secondTab && correlationId) {
      await tryWaitForMark(secondTab, "durable_settlement_receipt", 15000)
      const samples = await readGrowthSamples(secondTab)
      const deltas = acceptedCheckpointStamps(correlationId)
        .map((stamp) => {
          const next = samples.find((sample) => sample.t >= stamp)
          return next ? next.t - stamp : undefined
        })
        .filter((value): value is number => Number.isFinite(value))
      if (deltas.length > 0) {
        const sorted = [...deltas].sort((a, b) => a - b)
        snapshotToSecondTabMedianMs = round2(
          sorted[Math.floor(sorted.length / 2)]
        )
        snapshotToSecondTabMaxMs = round2(sorted[sorted.length - 1])
      }
      const tab1Origin = await page.evaluate(() => performance.timeOrigin)
      const tab2Origin = await secondTab.evaluate(() => performance.timeOrigin)
      const tab1Terminal = markAt(marks, "stream_terminal")
      const tab2Receipt = markAt(
        await readMarks(secondTab),
        "durable_settlement_receipt"
      )
      if (tab1Terminal !== undefined && tab2Receipt !== undefined) {
        terminalToSecondTabSettledMs = round2(
          tab2Origin + tab2Receipt - (tab1Origin + tab1Terminal)
        )
      }
      await secondTab.close()
    }

    const longTasks = durations(marks, "long_task")
    const rafGaps = durations(marks, "raf_gap")
    const projections = durations(marks, "markdown_projection_advance")
    const shiki = durations(marks, "shiki_highlight")
    const summary = marks
      .filter((mark) => mark.name === "stream_publication_summary")
      .at(-1)

    return {
      sendToOptimisticPaintMs: diff(
        marks,
        "chat_send_intent",
        "optimistic_message_painted"
      ),
      sendToRequestDispatchedMs: diff(
        marks,
        "chat_send_intent",
        "request_dispatched"
      ),
      dispatchToFirstStreamChunkMs: diff(
        marks,
        "request_dispatched",
        "client_first_stream_bytes"
      ),
      firstTextDeltaToFirstVisibleMs: diff(
        marks,
        "client_first_text_delta_received",
        "first_visible_text"
      ),
      sendToFirstVisibleTextMs: diff(
        marks,
        "chat_send_intent",
        "first_visible_text"
      ),
      streamDurationMs: diff(marks, "first_chunk_received", "stream_terminal"),
      stopToTerminalMs:
        config.action === "stop"
          ? diff(marks, "stop_intent", "stream_terminal")
          : undefined,
      longTaskCount: longTasks.length,
      longTaskMaxMs: round2(Math.max(0, ...longTasks)),
      totalBlockingTimeMs: round2(
        longTasks.reduce((sum, duration) => sum + Math.max(0, duration - 50), 0)
      ),
      rafGapCount: rafGaps.length,
      rafGapMaxMs: round2(Math.max(0, ...rafGaps)),
      markdownProjectionCount: projections.length,
      markdownProjectionMaxMs: round2(Math.max(0, ...projections)),
      shikiHighlightCount: shiki.length,
      shikiHighlightTotalMs: round2(
        shiki.reduce((sum, duration) => sum + duration, 0)
      ),
      callbackCount: Number(summary?.detail?.callbackCount) || undefined,
      publicationCount: Number(summary?.detail?.publicationCount) || undefined,
      coalescedCount:
        summary?.detail?.coalescedCount !== undefined
          ? Number(summary.detail.coalescedCount)
          : undefined,
      domNodesBefore,
      domNodesAfter,
      jsHeapUsedBeforeBytes: heapBefore,
      jsHeapUsedAfterBytes: heapAfter,
      serverSpans,
      durableWrites,
      snapshotToSecondTabMedianMs,
      snapshotToSecondTabMaxMs,
      terminalToSecondTabSettledMs,
      reloadToAuthoritativeMs: reloadedMidStream
        ? markAt(marks, "authoritative_thread_content_received")
        : undefined,
      reloadToSettlementReceiptMs: reloadedMidStream
        ? markAt(marks, "durable_settlement_receipt")
        : undefined,
      terminalToSettlementReceiptMs:
        config.auth && !reloadedMidStream
          ? diff(marks, "stream_terminal", "durable_settlement_receipt")
          : undefined,
      liveStreamNotAdopted: liveStreamNotAdopted || undefined,
      correctness: {
        ok: correctnessOk,
        foldedTextHash: hashValue(foldedText),
        expectedTextHash: hashValue(oracle.text),
        terminalOutcome,
        settleMismatchCount,
        detail,
      },
    }
  } finally {
    await page.close()
  }
}

async function readHeap(cdp: CDPSession): Promise<number | undefined> {
  try {
    const { metrics } = await cdp.send("Performance.getMetrics")
    const metric = metrics.find((entry) => entry.name === "JSHeapUsedSize")
    return metric?.value
  } catch {
    return undefined
  }
}

function collectServerSpans(
  correlationId: string
): Record<string, number> | undefined {
  const spans: Record<string, number> = {}
  for (const line of serverPerfLines) {
    if (line.correlationId !== correlationId) continue
    if (line.event === "server_span" && typeof line.span === "string") {
      spans[line.span] = Number(line.durationMs)
    }
  }
  return Object.keys(spans).length > 0 ? spans : undefined
}

function collectDurableWrites(
  correlationId: string
): RunMetrics["durableWrites"] {
  const snapshots: number[] = []
  const otherOps: Record<string, number> = {}
  for (const line of serverPerfLines) {
    if (line.correlationId !== correlationId) continue
    if (line.event !== "durable_write" || typeof line.op !== "string") continue
    const durationMs = Number(line.durationMs)
    if (!Number.isFinite(durationMs)) continue
    if (line.op === "updateAssistantSnapshot") snapshots.push(durationMs)
    else otherOps[line.op] = durationMs
  }
  if (snapshots.length === 0 && Object.keys(otherOps).length === 0) {
    return undefined
  }
  return {
    snapshotCount: snapshots.length,
    snapshotMeanMs: round2(
      snapshots.reduce((sum, value) => sum + value, 0) /
        Math.max(1, snapshots.length)
    ),
    snapshotMaxMs: round2(Math.max(0, ...snapshots)),
    otherOps,
  }
}

/** Harness-clock stamps of accepted snapshot checkpoints for one turn. */
function acceptedCheckpointStamps(correlationId: string): number[] {
  return serverPerfLines
    .filter(
      (line) =>
        line.correlationId === correlationId &&
        line.event === "checkpoint" &&
        (line.kind === "accepted" || line.kind === "deduped")
    )
    .map((line) => line.receivedAt)
}

function scenarioTimeoutMs(config: BrowserScenarioConfig): number {
  const oracle = deterministicScenarioText(config.scenario)
  const deltas = Math.ceil((oracle.reasoning.length + oracle.text.length) / 40)
  const streamMs = (deltas / config.chunksPerSecond) * 1000
  return Math.round(streamMs * (config.cpuThrottle > 1 ? 2 : 1.5)) + 60_000
}

async function main() {
  let suite =
    SUITE_NAME === "smoke"
      ? SMOKE_SUITE
      : SUITE_NAME === "standard"
        ? STANDARD_SUITE
        : SUITE_NAME === "durable"
          ? DURABLE_SUITE
          : fail(`unknown SUITE: ${SUITE_NAME}`)
  if (process.env.ONLY) {
    suite = suite.filter((config) => config.id === process.env.ONLY)
    if (suite.length === 0) fail(`ONLY matched no scenario: ${process.env.ONLY}`)
  }

  const externalBaseUrl = process.env.BASE_URL
  const baseUrl = externalBaseUrl ?? `http://localhost:${PERF_PORT}`
  if (!externalBaseUrl) spawnPerfServer(baseUrl)
  await waitForServer(baseUrl, 60_000)

  let browser: Browser
  try {
    browser = await chromium.launch({
      channel: process.env.PW_CHANNEL,
    })
  } catch (error) {
    log(`chromium launch failed (${String(error).split("\n")[0]})`)
    log(`retrying with channel: chrome`)
    browser = await chromium.launch({ channel: "chrome" })
  }

  const results: ScenarioResult[] = []
  let anyCorrectnessFailure = false

  const authState = suite.some((config) => config.auth)
    ? await acquireAuthState(browser, baseUrl)
    : null

  for (const config of suite) {
    const viewport =
      config.viewport === "mobile"
        ? { width: 390, height: 844 }
        : { width: 1440, height: 900 }
    const context = await browser.newContext({
      viewport,
      ...(config.auth && authState ? { storageState: authState } : {}),
    })
    const timeoutMs = scenarioTimeoutMs(config)
    log(
      `scenario ${config.id}: ${WARMUPS} warmups + ${RUNS} runs (timeout ${Math.round(timeoutMs / 1000)}s)`
    )
    const runs: RunMetrics[] = []
    try {
      for (let index = 0; index < WARMUPS + RUNS; index++) {
        const kind = index < WARMUPS ? "warmup" : "run"
        let run: RunMetrics
        try {
          run = await runScenarioOnce(context, baseUrl, config, timeoutMs)
        } catch (error) {
          // A crashed run (timeout, navigation failure, admission rejection)
          // fails the scenario's correctness but must not abort the suite —
          // the other scenarios' samples and the result file still land.
          run = {
            longTaskCount: 0,
            longTaskMaxMs: 0,
            totalBlockingTimeMs: 0,
            rafGapCount: 0,
            rafGapMaxMs: 0,
            markdownProjectionCount: 0,
            markdownProjectionMaxMs: 0,
            shikiHighlightCount: 0,
            shikiHighlightTotalMs: 0,
            domNodesBefore: 0,
            domNodesAfter: 0,
            correctness: {
              ok: false,
              foldedTextHash: hashValue(""),
              expectedTextHash: hashValue(""),
              terminalOutcome: null,
              settleMismatchCount: 0,
              detail: `run crashed: ${String(error).split("\n")[0]}`,
            },
          }
        }
        log(
          `  ${kind} ${index + 1}/${WARMUPS + RUNS}: ` +
            `${run.correctness.ok ? "ok" : `CORRECTNESS FAILED (${run.correctness.detail ?? "unknown"})`}`
        )
        if (index >= WARMUPS) runs.push(run)
      }
    } finally {
      await context.close()
    }

    const correctnessOk = runs.every((run) => run.correctness.ok)
    if (!correctnessOk) anyCorrectnessFailure = true
    const liveStreamNotAdoptedRuns = runs.filter(
      (run) => run.liveStreamNotAdopted
    ).length

    const numeric = (
      pick: (run: RunMetrics) => number | undefined
    ): number[] =>
      runs
        .map(pick)
        .filter((value): value is number => Number.isFinite(value))
    results.push({
      scenario: config.scenario,
      directive: directiveFor(config),
      viewport: config.viewport,
      cpuThrottle: config.cpuThrottle,
      action: config.action,
      sampleCount: RUNS,
      warmupRuns: WARMUPS,
      correctnessOk,
      ...(liveStreamNotAdoptedRuns > 0 ? { liveStreamNotAdoptedRuns } : {}),
      metrics: {
        sendToOptimisticPaintMs: summarize(
          numeric((run) => run.sendToOptimisticPaintMs)
        ),
        sendToRequestDispatchedMs: summarize(
          numeric((run) => run.sendToRequestDispatchedMs)
        ),
        dispatchToFirstStreamChunkMs: summarize(
          numeric((run) => run.dispatchToFirstStreamChunkMs)
        ),
        firstTextDeltaToFirstVisibleMs: summarize(
          numeric((run) => run.firstTextDeltaToFirstVisibleMs)
        ),
        sendToFirstVisibleTextMs: summarize(
          numeric((run) => run.sendToFirstVisibleTextMs)
        ),
        streamDurationMs: summarize(numeric((run) => run.streamDurationMs)),
        stopToTerminalMs: summarize(numeric((run) => run.stopToTerminalMs)),
        longTaskCount: summarize(numeric((run) => run.longTaskCount)),
        longTaskMaxMs: summarize(numeric((run) => run.longTaskMaxMs)),
        totalBlockingTimeMs: summarize(
          numeric((run) => run.totalBlockingTimeMs)
        ),
        rafGapCount: summarize(numeric((run) => run.rafGapCount)),
        markdownProjectionMaxMs: summarize(
          numeric((run) => run.markdownProjectionMaxMs)
        ),
        shikiHighlightTotalMs: summarize(
          numeric((run) => run.shikiHighlightTotalMs)
        ),
        publicationCount: summarize(numeric((run) => run.publicationCount)),
        coalescedCount: summarize(numeric((run) => run.coalescedCount)),
        domNodeGrowth: summarize(
          numeric((run) => run.domNodesAfter - run.domNodesBefore)
        ),
        terminalToSettlementReceiptMs: summarize(
          numeric((run) => run.terminalToSettlementReceiptMs)
        ),
        snapshotToSecondTabMedianMs: summarize(
          numeric((run) => run.snapshotToSecondTabMedianMs)
        ),
        snapshotToSecondTabMaxMs: summarize(
          numeric((run) => run.snapshotToSecondTabMaxMs)
        ),
        terminalToSecondTabSettledMs: summarize(
          numeric((run) => run.terminalToSecondTabSettledMs)
        ),
        reloadToAuthoritativeMs: summarize(
          numeric((run) => run.reloadToAuthoritativeMs)
        ),
        reloadToSettlementReceiptMs: summarize(
          numeric((run) => run.reloadToSettlementReceiptMs)
        ),
        snapshotWriteMeanMs: summarize(
          numeric((run) => run.durableWrites?.snapshotMeanMs)
        ),
        snapshotWriteCount: summarize(
          numeric((run) => run.durableWrites?.snapshotCount)
        ),
      },
      runs,
    })
    const first = results.at(-1)
    log(
      `  ${config.id}: correctness=${correctnessOk ? "OK" : "FAILED"} ` +
        `sendToFirstVisible p50=${first?.metrics.sendToFirstVisibleTextMs?.p50}ms ` +
        `longTaskMax p95=${first?.metrics.longTaskMaxMs?.p95}ms`
    )
  }

  const buildId = readFileSync(
    path.join(REPO_ROOT, DIST_DIR, "BUILD_ID"),
    "utf8"
  ).trim()
  const commit = execSync("git rev-parse --short HEAD", {
    cwd: REPO_ROOT,
  })
    .toString()
    .trim()
  const file: BenchmarkResultFile = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    commit,
    buildId,
    buildClass: "production",
    instrumentationBuild: true,
    machineClass: `${os.platform()}-${os.arch()}`,
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    cpuCount: os.cpus().length,
    memoryGb: Math.round(os.totalmem() / 1024 ** 3),
    osVersion: `${os.type()} ${os.release()}`,
    browserVersion: browser.version(),
    baseUrl,
    suite: SUITE_NAME,
    scenarios: results,
  }

  const resultsDir = path.join(path.dirname(new URL(import.meta.url).pathname), "results")
  mkdirSync(resultsDir, { recursive: true })
  const outPath = path.join(
    resultsDir,
    `${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}-${SUITE_NAME}.json`
  )
  writeFileSync(outPath, JSON.stringify(file, null, 2))
  log(`results written to ${outPath}`)

  await browser.close()
  stopPerfServer()
  if (anyCorrectnessFailure) {
    fail("one or more scenarios failed correctness — timings are invalid")
  }
}

main().catch((error) => {
  stopPerfServer()
  console.error(error)
  process.exit(1)
})
