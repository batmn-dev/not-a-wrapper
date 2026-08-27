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
  directiveFor,
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

type ServerPerfLine = Record<string, unknown> & { event?: string }

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
        const parsed = JSON.parse(trimmed) as ServerPerfLine
        if (parsed._tag === "chat_perf") serverPerfLines.push(parsed)
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
  page.on("response", (response) => {
    if (
      response.url().includes("/api/chat") &&
      response.request().method() === "POST"
    ) {
      chatResponse = response
    }
  })

  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" })
    // Fresh guest identity per run: the anonymous-user daily message limit
    // (NON_AUTH_DAILY_MESSAGE_LIMIT = 5) would otherwise block the sixth
    // send in a shared context. Clearing storage and reloading mints a new
    // guest id while keeping the context (JS caches) warm.
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
    const editor = page.locator('[contenteditable="true"]').first()
    await editor.waitFor({ state: "visible", timeout: 15000 })

    const heapBefore = await readHeap(cdp)
    const domNodesBefore = await page.evaluate(
      () => document.querySelectorAll("*").length
    )

    await editor.click()
    await page.keyboard.type(directiveFor(config))
    await page.locator('[data-testid="send-button"]').click()

    if (config.action === "stop") {
      await waitForMark(page, "first_visible_text", timeoutMs)
      // Let a visible slice stream before stopping.
      await page.waitForTimeout(1000)
      await page.locator('[data-testid="send-button"]').click()
    }
    await waitForMark(page, "stream_terminal", timeoutMs)
    // Let post-terminal effects (summary marks, settlement receipt) land.
    await page.waitForTimeout(750)

    const marks = await readMarks(page)
    const domNodesAfter = await page.evaluate(
      () => document.querySelectorAll("*").length
    )
    const heapAfter = await readHeap(cdp)

    const oracle = deterministicScenarioText(config.scenario)
    let foldedText = ""
    let bodyAvailable = false
    try {
      const body = chatResponse ? await (chatResponse as Response).text() : ""
      bodyAvailable = body.length > 0
      foldedText = foldSseText(body).text
    } catch {
      // A stopped stream's body may be unavailable; correctness falls back
      // to outcome + prefix rules below.
    }

    const terminalMark = marks.find((mark) => mark.name === "stream_terminal")
    const terminalOutcome =
      typeof terminalMark?.detail?.outcome === "string"
        ? (terminalMark.detail.outcome as string)
        : null
    const settleMismatchCount = marks.filter(
      (mark) => mark.name === "markdown_projection_settle_mismatch"
    ).length

    let correctnessOk = terminalOutcome === config.expectedOutcome
    let detail: string | undefined
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
    } else if (foldedText !== oracle.text) {
      correctnessOk = false
      detail = `folded text mismatch (${foldedText.length} vs ${oracle.text.length} chars)`
    }
    if (terminalOutcome !== config.expectedOutcome) {
      detail = `terminal outcome ${terminalOutcome} (expected ${config.expectedOutcome})${detail ? `; ${detail}` : ""}`
    }

    const sendIntent = marks.find((mark) => mark.name === "chat_send_intent")
    const correlationId =
      typeof sendIntent?.detail?.correlationId === "string"
        ? (sendIntent.detail.correlationId as string)
        : undefined
    const serverSpans = correlationId
      ? collectServerSpans(correlationId)
      : undefined

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

  for (const config of suite) {
    const viewport =
      config.viewport === "mobile"
        ? { width: 390, height: 844 }
        : { width: 1440, height: 900 }
    const context = await browser.newContext({ viewport })
    const timeoutMs = scenarioTimeoutMs(config)
    log(
      `scenario ${config.id}: ${WARMUPS} warmups + ${RUNS} runs (timeout ${Math.round(timeoutMs / 1000)}s)`
    )
    const runs: RunMetrics[] = []
    try {
      for (let index = 0; index < WARMUPS + RUNS; index++) {
        const kind = index < WARMUPS ? "warmup" : "run"
        const run = await runScenarioOnce(context, baseUrl, config, timeoutMs)
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
