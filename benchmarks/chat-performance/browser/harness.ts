/**
 * Chromium benchmark harness.
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
 * Env: SUITE=standard|smoke|durable|thread-switch (default standard),
 *      RUNS (default 10), WARMUPS (default 2), PERF_PORT (default 3111),
 *      PW_CHANNEL (CI only, e.g. "chrome" to use installed Chrome).
 *      thread-switch knobs: THREAD_SWITCH_CHATS (8), THREAD_SWITCH_COUNT (50),
 *      THREAD_SWITCH_DOCUMENTS (5), THREAD_SWITCH_HOVER_MS (250).
 */
import { execSync, spawn, type ChildProcess } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  buildDeterministicPartScript,
  deterministicScenarioText,
} from "@/app/api/chat/deterministic-provider"
import { pacingOverheadMs } from "@/convex/lib/runTimingReceipt"
import {
  installChatUiObserver,
  type ChatUiWindow,
} from "@/lib/observability/chat-ui-observer"
import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
  type Response,
} from "playwright"
import { classifyChatError } from "@/lib/observability/chat-error-taxonomy"
import { hashValue } from "../fixtures"
import { waitForTraceCompletion } from "./diagnostic-trace"
import { parseNativeScroll } from "./native-scroll"
import {
  ensurePerfAuthUser,
  getPerfAuthPassword,
  PERF_AUTH_EMAIL,
} from "./ensure-auth-user"
import {
  durationsOverlappingRun,
  findDirectTranscriptWheelPoint,
  isFollowupSeedReady,
  readHeap,
  readMarks,
  tryWaitForMark,
  waitForAnyMark,
  waitForMark,
  type CollectedMark,
} from "./marks"
import {
  round2,
  summarize,
  type BenchmarkResultFile,
  type RunMetrics,
  type ScenarioResult,
} from "./result-schema"
import {
  BENCHMARK_TYPING_DELAY_MS,
  directiveFor,
  DURABLE_SUITE,
  FOLLOWUP_SEED,
  RESPONSIVENESS_SUITE,
  SMOKE_SUITE,
  STANDARD_SUITE,
  type BrowserScenarioConfig,
} from "./scenarios"
import { formatThreadSwitch, runThreadSwitch } from "./thread-switch"

const PERF_PORT = Number(process.env.PERF_PORT ?? 3111)
const RUNS = Number(process.env.RUNS ?? 10)
const WARMUPS = Number(process.env.WARMUPS ?? 2)
const SUITE_NAME = process.env.SUITE ?? "standard"
const DIST_DIR = process.env.NEXT_DIST_DIR ?? ".next-perf"
const PROFILE_LATE_MENU = process.env.PERF_PROFILE_LATE_MENU === "true"
const REPO_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../.."
)

type ServerPerfLine = Record<string, unknown> & {
  event?: string
  /** Harness wall-clock stamp at pipe read — the cross-tab freshness anchor. */
  receivedAt: number
}

const serverPerfLines: ServerPerfLine[] = []
const serverRouteErrors: Array<{
  requestId: string
  errorName: string
  category: ReturnType<typeof classifyChatError>
}> = []
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
  serverProcess = spawn("bunx", ["next", "start", "-p", String(PERF_PORT)], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NEXT_DIST_DIR: DIST_DIR,
      CHAT_PERF_DETERMINISTIC_PROVIDER: "1",
      CHAT_PERF_SAMPLE_RATE: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  const capture = () => {
    let pending = ""
    return (chunk: Buffer) => {
      const lines = (pending + chunk.toString()).split("\n")
      pending = lines.pop() ?? ""
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith("{")) continue
        try {
          const parsed = JSON.parse(trimmed) as Record<string, unknown>
          if (parsed._tag === "chat_perf") {
            serverPerfLines.push({ ...parsed, receivedAt: Date.now() })
          } else if (
            parsed._tag === "chat_route_error" &&
            typeof parsed.requestId === "string" &&
            typeof parsed.errorName === "string"
          ) {
            serverRouteErrors.push({
              requestId: parsed.requestId,
              errorName: parsed.errorName,
              category: classifyChatError({
                name: parsed.errorName,
                message: parsed.errorMessage,
              }),
            })
          }
        } catch {
          // Non-JSON server output.
        }
      }
    }
  }
  serverProcess.stdout?.on("data", capture())
  serverProcess.stderr?.on("data", capture())
  serverProcess.on("exit", (code) => {
    if (code !== null && code !== 0) log(`perf server exited with code ${code}`)
  })
}

function stopPerfServer() {
  serverProcess?.kill("SIGTERM")
  serverProcess = null
}

/** The send's correlation id, carried by the `chat_send_intent` mark detail. */
function correlationIdOf(marks: CollectedMark[]): string | undefined {
  const sendIntent = marks.find((mark) => mark.name === "chat_send_intent")
  const id = sendIntent?.detail?.correlationId
  return typeof id === "string" ? id : undefined
}

/**
 * Delivered-content length for the durable fallback bound: the markdown
 * containers' textContent, NOT body.innerText — settled off-screen blocks
 * carry `content-visibility: auto` (the B1 layout fix), and innerText is
 * layout-aware so it excludes locked blocks even though their content is
 * fully delivered in the DOM.
 */
function readDeliveredMarkdownLength(): number {
  return Array.from(document.querySelectorAll(".markdown")).reduce(
    (total, element) => total + (element.textContent?.length ?? 0),
    0
  )
}

function readCurrentAssistantSourceLength(): number {
  const turn = Array.from(
    document.querySelectorAll("section[data-turn-id]")
  ).at(-1)
  const source = turn?.querySelector<HTMLElement>("[data-perf-text-length]")
  if (!source) throw new Error("current assistant source marker is missing")
  return Number(source.dataset.perfTextLength)
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

/**
 * Signs in as the harness test user through the real /auth/login form and
 * returns the context storage state (the sealed wos-session cookie). Runs
 * once per harness process; every authenticated scenario context reuses it.
 */
async function acquireAuthState(
  browser: Browser,
  baseUrl: string
): Promise<Awaited<ReturnType<BrowserContext["storageState"]>>> {
  const password = getPerfAuthPassword()
  await ensurePerfAuthUser()
  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    await page.goto(`${baseUrl}/auth/login`, { waitUntil: "domcontentloaded" })
    await waitForMark(page, "replay_disabled_v1", 15000)
    await page.locator("#email").fill(PERF_AUTH_EMAIL)
    await page.locator("#password").fill(password)
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
      (
        window as unknown as {
          __perfGrowth?: Array<{ t: number; len: number }>
        }
      ).__perfGrowth ?? []
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

async function waitForSendReady(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const button = document.querySelector<HTMLButtonElement>(
      '[data-testid="send-button"]'
    )
    return button?.getAttribute("aria-label") === "Send prompt" &&
      !button.disabled && button.getAttribute("aria-disabled") !== "true" &&
      Boolean((window as ChatUiWindow).__chatUiPerf
        ?.values.navigationToSendReadyMs?.length)
  })
}

type NativeWheelCapture = {
  name: string
  eventAt: number
  observedAt: number
  ready: boolean
  error?: string
}
type NativeWheelWindow = Window & { __perfNativeWheel?: NativeWheelCapture }

/** No geometry reads after input: native tracing owns the presentation timestamp. */
function prepareNativeWheel(root: Element): number {
  if (!(root instanceof HTMLElement) ||
    document.querySelector('[data-testid="send-button"]')?.getAttribute("aria-label") !== "Stop")
    throw new Error("Native scroll preparation missed the active stream")
  const deltaY = root.scrollTop > 0 ? -400 : 400
  if (root.scrollHeight <= root.clientHeight) throw new Error("Transcript cannot scroll")
  document.addEventListener("wheel", (event) => {
    const observedAt = performance.now()
    const eventAt = event.timeStamp > 1e12 ? event.timeStamp - performance.timeOrigin : event.timeStamp
    const capture: NativeWheelCapture = {
      name: "chat-perf:native-wheel", eventAt, observedAt, ready: false,
    }
    ;(window as NativeWheelWindow).__perfNativeWheel = capture
    if (event.target !== root || event.ctrlKey || event.shiftKey || event.deltaY !== deltaY) {
      capture.error = "Native wheel missed the prepared direct transcript target"
      return
    }
    performance.mark(capture.name, { startTime: observedAt, detail: { eventAt, observedAt } })
    const scrolled = (scrollEvent: Event) => {
      if (scrollEvent.target !== root) return
      document.removeEventListener("scroll", scrolled, true)
      // Match the observer's one-frame handoff; the trace verifies presentation
      // precedes menu input and remains the sole scroll latency endpoint.
      requestAnimationFrame(() => setTimeout(() => {
        if (event.defaultPrevented || document.querySelector("[data-scroll-root]") !== root)
          capture.error = "Native wheel cancelled or transcript replaced"
        else capture.ready = true
      }, 0))
    }
    document.addEventListener("scroll", scrolled, { capture: true, passive: true })
  }, { once: true, capture: true, passive: true })
  return deltaY
}

async function runScenarioOnce(
  context: BrowserContext,
  baseUrl: string,
  config: BrowserScenarioConfig,
  timeoutMs: number
): Promise<RunMetrics> {
  const page = await context.newPage()
  await page.addInitScript(installChatUiObserver, { observeWheel: false })
  await page.setViewportSize(
    config.viewport === "mobile"
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 }
  )
  await page.bringToFront()
  const cdp: CDPSession = await context.newCDPSession(page)
  let profiling = false
  let tracing = false
  let traceResult: Promise<string | undefined> | undefined
  let lateMenuTraceComplete = false
  let traceDataLoss = false
  let traceBytes: Buffer | undefined
  let nativeWheel: NativeWheelCapture | undefined
  const stopTrace = async () => {
    traceResult = new Promise<string | undefined>((resolve) => {
      cdp.once("Tracing.tracingComplete", (event) => {
        traceDataLoss = event.dataLossOccurred === true
        resolve(event.stream)
      })
    })
    await cdp.send("Tracing.end")
    tracing = false
    // Encoding the trace can outlast the remaining stream. Drain after probes.
  }
  const readTrace = async () => {
    if (traceBytes) return traceBytes
    if (!traceResult) throw new Error("Native trace was not completed")
    const handle = await waitForTraceCompletion(traceResult)
    const chunks: Buffer[] = []
    try {
      let eof = false
      while (!eof) {
        const part = await cdp.send("IO.read", { handle })
        chunks.push(Buffer.from(part.data, part.base64Encoded ? "base64" : "utf8"))
        eof = part.eof
      }
    } finally {
      await cdp.send("IO.close", { handle })
    }
    traceBytes = Buffer.concat(chunks)
    return traceBytes
  }
  let interactionProbeStage = "entry"
  let wheelPoint: { x: number; y: number } | undefined
  await cdp.send("Performance.enable")
  if (config.cache === "cold") {
    await cdp.send("Network.enable")
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true })
  }
  if (config.network === "constrained") {
    await cdp.send("Network.enable")
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: 1_600_000 / 8,
      uploadThroughput: 750_000 / 8,
    })
  }
  if (config.cpuThrottle > 1) {
    await cdp.send("Emulation.setCPUThrottlingRate", {
      rate: config.cpuThrottle,
    })
  }

  let chatResponse: Response | null = null
  const chatResponseStatuses: number[] = []
  let rejectFailedPost: (error: Error) => void = () => undefined
  const failedPost = new Promise<never>((_resolve, reject) => {
    rejectFailedPost = reject
  })
  // A response can fail before the first-visible waiter attaches.
  void failedPost.catch(() => undefined)
  let chatRequestCount = 0
  let routeErrorStart = serverRouteErrors.length
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === "/api/chat" &&
      request.method() === "POST"
    ) chatRequestCount++
  })
  page.on("response", (response) => {
    if (
      new URL(response.url()).pathname === "/api/chat" &&
      response.request().method() === "POST"
    ) {
      chatResponseStatuses.push(response.status())
      chatResponse = response
      if (response.status() >= 400) {
        rejectFailedPost(new Error(`chat POST failed (HTTP ${response.status()})`))
      }
    }
  })

  const failureEvidence = async () => {
    const marks = await readMarks(page).catch(() => [])
    return {
      postRequests: chatRequestCount,
      postStatuses: chatResponseStatuses,
      terminalOutcomes: marks
        .filter((mark) => mark.name === "stream_terminal")
        .map((mark) => mark.detail?.outcome),
      // Route requestIds are not exposed to the browser; these are temporal candidates.
      routeErrorWindow: serverRouteErrors.slice(routeErrorStart),
    }
  }

  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" })
    await waitForMark(page, "replay_disabled_v1", 15000)
    // Fresh guest identity per run: the anonymous-user daily message limit
    // (NON_AUTH_DAILY_MESSAGE_LIMIT = 5) would otherwise block the sixth
    // send in a shared context. Clearing storage and reloading mints a new
    // guest id while keeping the context (JS caches) warm. Authenticated
    // runs skip this: the signed-in daily limit is 1000 and clearing would
    // churn the Convex client state between runs.
    if (!config.auth) await clearGuestIdentity(page)
    const editor = page.locator('[contenteditable="true"]').first()
    await editor.waitFor({ state: "visible", timeout: 15000 })

    if (config.followup) {
      await editor.click()
      await page.keyboard.type(directiveFor(FOLLOWUP_SEED), { delay: BENCHMARK_TYPING_DELAY_MS })
      await waitForSendReady(page)
      await page.locator('[data-testid="send-button"]').click()
      await Promise.race([waitForMark(page, "stream_terminal", 60000), failedPost])
      const seedTerminal = (await readMarks(page)).find(
        (mark) => mark.name === "stream_terminal"
      )
      if (seedTerminal?.detail?.outcome !== "finish")
        throw new Error("follow-up seed did not finish successfully")
      if (
        markAt(await readMarks(page), "durable_settlement_receipt") ===
        undefined
      )
        await waitForMark(page, "durable_settlement_receipt", 15000)
      await page
        .locator('[data-testid="send-button"][aria-label="Send prompt"]')
        .waitFor()
      // The measured document is an existing conversation, not the seed turn.
      await page.reload({ waitUntil: "domcontentloaded" })
      await editor.waitFor({ state: "visible" })
      chatResponse = null
      chatResponseStatuses.length = 0
      chatRequestCount = 0
      routeErrorStart = serverRouteErrors.length
      // A visible composer can precede history hydration. The follow-up's
      // selected-path token must include the settled seed, not an empty path.
      await waitForMark(page, "authoritative_thread_content_received", 30000)
      await page.waitForFunction(
        isFollowupSeedReady,
        deterministicScenarioText(FOLLOWUP_SEED.scenario).text.length,
        { timeout: 30000 }
      )
    }

    const heapBefore = await readHeap(cdp)
    const domNodesBefore = await page.evaluate(
      () => document.querySelectorAll("*").length
    )

    await editor.click()
    await page.keyboard.type(directiveFor(config), { delay: BENCHMARK_TYPING_DELAY_MS })
    await waitForSendReady(page)
    if (process.env.PERF_PROFILE === "true") {
      await cdp.send("Profiler.enable")
      await cdp.send("Profiler.start")
      profiling = true
      if (!PROFILE_LATE_MENU) {
        await cdp.send("Tracing.start", {
          categories: "devtools.timeline,blink.user_timing,input,latencyInfo,cc,benchmark",
          transferMode: "ReturnAsStream",
        })
        tracing = true
      }
    }
    await page.locator('[data-testid="send-button"]').click()

    // Durable turns navigate to the server chat URL on acceptance.
    let secondTab: Page | null = null
    let foregroundUi:
      | {
          values: Record<string, number[]>
          hidden: boolean
          pendingDeltas: number
          droppedSamples: number
        }
      | undefined
    if (config.auth) {
      await page.waitForURL(/\/c\//, { timeout: 30000 })
    }

    let reloadedMidStream = false
    let preReloadCorrelationId: string | undefined
    // Durable sends occasionally lose live-stream adoption after the hard
    // navigation to /c/<chatId>: the turn runs and settles server-side and
    // content renders from the 750 ms snapshots, but the local stream marks
    // (first_chunk_received / first_visible_text / stream_terminal) never
    // fire. Measured, not fatal: such runs are counted and their correctness
    // falls back to the settlement rules.
    let liveStreamNotAdopted = false
    let stoppedTextStable = true
    let stopSourceLengths: RunMetrics["stopSourceLengths"]
    const awaitFirstVisible = async (): Promise<boolean> => {
      if (!config.auth) {
        await Promise.race([
          waitForMark(page, "first_visible_text", timeoutMs),
          failedPost,
        ])
        return true
      }
      const seen = await Promise.race([
        waitForAnyMark(
          page,
          ["first_visible_text", "durable_settlement_receipt"],
          timeoutMs
        ),
        failedPost,
      ])
      if (seen !== "first_visible_text") {
        liveStreamNotAdopted = true
        return false
      }
      return true
    }

    if (config.interact) {
      interactionProbeStage = "first visible response"
      await awaitFirstVisible()
      const requireStreaming = async (phase: string, interaction: string) => {
        if (
          (await page.getByTestId("send-button").getAttribute("aria-label")) !==
          "Stop"
        )
          throw new Error(
            `${config.id}: ${phase} ${interaction} missed the active stream`
          )
      }
      for (const phase of ["early", "late"] as const) {
        if (phase === "late") {
          interactionProbeStage = "late 80% checkpoint"
          const expectedLength = deterministicScenarioText(config.scenario).text
            .length
          await page.waitForFunction(
            (length) => {
              const turn = Array.from(
                document.querySelectorAll("section[data-turn-id]")
              ).at(-1)
              const source = turn?.querySelector<HTMLElement>(
                "[data-perf-text-length]"
              )
              return Number(source?.dataset.perfTextLength ?? 0) >= length * 0.8
            },
            expectedLength,
            { timeout: timeoutMs }
          )
        }
        await page.evaluate(
          (value) => (window as ChatUiWindow).__chatUiPerf?.setPhase(value),
          phase
        )
        interactionProbeStage = `${phase} typing`
        await requireStreaming(phase, "typing")
        await editor.click()
        await page.keyboard.type("A draft.", {
          delay: BENCHMARK_TYPING_DELAY_MS,
        })
        const scroll = page.locator("[data-scroll-root]")
        let menuPoint: { x: number; y: number } | undefined
        if (phase === "late") {
          interactionProbeStage = "late scroll target"
          wheelPoint = await scroll.evaluate(findDirectTranscriptWheelPoint)
          // The sticky composer stays fixed while the transcript scrolls. Native
          // input avoids locator.click's extra stable-box frame waits mid-stream.
          menuPoint = await page.getByTestId("composer-plus-btn").evaluate((button) => {
            if (!(button instanceof HTMLButtonElement) || button.disabled ||
              button.getAttribute("aria-disabled") === "true" ||
              button.getAttribute("aria-expanded") === "true")
              throw new Error("Late menu trigger is not ready")
            const bounds = button.getBoundingClientRect()
            const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
            if (bounds.width <= 0 || bounds.height <= 0 ||
              point.x < 0 || point.x >= innerWidth || point.y < 0 || point.y >= innerHeight ||
              document.elementFromPoint(point.x, point.y)?.closest('[data-testid="composer-plus-btn"]') !== button)
              throw new Error("Late menu trigger is obscured")
            return point
          })
          // Move the pointer without Playwright scrolling the root into view.
          await page.mouse.move(wheelPoint.x, wheelPoint.y)
          if (!tracing) {
            await cdp.send("Tracing.start", {
              categories: PROFILE_LATE_MENU
                ? "input,benchmark,blink.user_timing,devtools.timeline,disabled-by-default-devtools.timeline.invalidationTracking"
                : "input,benchmark,blink.user_timing",
              transferMode: "ReturnAsStream",
            })
            tracing = true
          }
          const direction = await scroll.evaluate(prepareNativeWheel)
          interactionProbeStage = "late native scroll"
          await page.mouse.wheel(0, direction)
          await page.waitForFunction(() => {
            const capture = (window as NativeWheelWindow).__perfNativeWheel
            if (capture?.error) throw new Error(capture.error)
            return capture?.ready === true
          }, undefined, { timeout: 5000 })
          nativeWheel = await page.evaluate(() => (window as NativeWheelWindow).__perfNativeWheel)
        }
        interactionProbeStage = `${phase} menu open`
        await requireStreaming(phase, "menu")
        if (menuPoint) await page.mouse.click(menuPoint.x, menuPoint.y)
        else await page.getByTestId("composer-plus-btn").click()
        interactionProbeStage = `${phase} menu frame`
        await page.waitForFunction(
          (value) => {
            const observer = (window as ChatUiWindow).__chatUiPerf
            if (
              (observer?.values[
                value === "early" ? "menuToFrameEarlyMs" : "menuToFrameLateMs"
              ]?.length ?? 0) > 0
            ) {
              if (value === "late" &&
                document.querySelector('[data-testid="send-button"]')
                  ?.getAttribute("aria-label") !== "Stop")
                throw new Error("Stream ended before late interaction completion")
              return true
            }
            if (observer?.droppedSamples())
              throw new Error("UI capture invalid before menu frame")
            if (
              document.querySelector('[data-testid="send-button"]')
                ?.getAttribute("aria-label") !== "Stop"
            )
              throw new Error("Stream ended before menu frame")
            return false
          },
          phase
        )
        if (PROFILE_LATE_MENU && phase === "late") {
          await stopTrace()
          lateMenuTraceComplete = true
        }
        interactionProbeStage = `${phase} menu close`
        await page.keyboard.press("Escape")
        await page.locator("[data-chat-composer-menu]")
          .waitFor({ state: "hidden" })
        if (phase === "early") {
          interactionProbeStage = "early interaction completion"
          await requireStreaming(phase, "interaction completion")
        }
      }
    }
    if (config.action === "stop") {
      if (await awaitFirstVisible()) {
        // Let a visible slice stream before stopping.
        await page.waitForTimeout(1000)
        await page.locator('[data-testid="send-button"]').click()
        await page.waitForFunction(() =>
          Boolean(
            (window as ChatUiWindow).__chatUiPerf?.values.stopToReadyFrameMs
              ?.length
          )
        )
        const atReady = await page.evaluate(readCurrentAssistantSourceLength)
        await page.waitForTimeout(250)
        const after250Ms = await page.evaluate(readCurrentAssistantSourceLength)
        stopSourceLengths = { atReady, after250Ms }
        // Terminal reconciliation can replace a local draft with a shorter snapshot.
        stoppedTextStable = after250Ms <= atReady
      }
    } else if (config.action === "second-tab") {
      if (await awaitFirstVisible()) {
        await page.waitForFunction(() =>
          Boolean(
            (window as ChatUiWindow).__chatUiPerf?.values
              .inputToFirstTextFrameMs?.length
          )
        )
        foregroundUi = await page.evaluate(() => ({
          values: (window as ChatUiWindow).__chatUiPerf?.values ?? {},
          hidden: (window as ChatUiWindow).__chatUiPerf?.hidden ?? true,
          pendingDeltas:
            (window as ChatUiWindow).__chatUiPerf?.pendingDeltas() ?? 0,
          droppedSamples:
            (window as ChatUiWindow).__chatUiPerf?.droppedSamples() ?? 0,
        }))
        secondTab = await context.newPage()
        await secondTab.goto(page.url(), { waitUntil: "domcontentloaded" })
        await installGrowthObserver(secondTab)
      }
    } else if (config.action === "reload") {
      if (await awaitFirstVisible()) {
        // Let a couple of 750 ms snapshot beats land before the cut.
        await page.waitForTimeout(2000)
        // The reload discards this document's marks; keep the send's
        // correlation id so the server-span, receipt, and durable-write
        // joins still find the run. (The /c/<chatId> hop is a pushState,
        // so marks survive it.)
        preReloadCorrelationId = correlationIdOf(await readMarks(page))
        foregroundUi = await page.evaluate(() => ({
          values: (window as ChatUiWindow).__chatUiPerf?.values ?? {},
          hidden: (window as ChatUiWindow).__chatUiPerf?.hidden ?? true,
          pendingDeltas:
            (window as ChatUiWindow).__chatUiPerf?.pendingDeltas() ?? 0,
          droppedSamples:
            (window as ChatUiWindow).__chatUiPerf?.droppedSamples() ?? 0,
        }))
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
        if (config.action === "stop")
          await waitForMark(page, "durable_settlement_receipt", 15000)
        else await tryWaitForMark(page, "durable_settlement_receipt", 15000)
      }
    }
    // Let post-terminal effects (summary marks, settlement writes) land.
    await page.waitForTimeout(config.auth ? 1500 : 750)
    if (stopSourceLengths) {
      const afterSettlement = await page.evaluate(readCurrentAssistantSourceLength)
      stoppedTextStable &&= afterSettlement <= stopSourceLengths.after250Ms
      stopSourceLengths.afterSettlement = afterSettlement
    }

    const marks = await readMarks(page)
    const uiObservation =
      foregroundUi ??
      (await page.evaluate(() => ({
        values: (window as ChatUiWindow).__chatUiPerf?.values ?? {},
        hidden: (window as ChatUiWindow).__chatUiPerf?.hidden ?? true,
        pendingDeltas:
          (window as ChatUiWindow).__chatUiPerf?.pendingDeltas() ?? 0,
        droppedSamples:
          (window as ChatUiWindow).__chatUiPerf?.droppedSamples() ?? 0,
      })))
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
          ? `empty body [${chatResponseStatuses.join(", ")}]`
          : "no /api/chat response captured"
      }
    } catch (error) {
      // A stopped stream's body may be unavailable; correctness falls back
      // to outcome + prefix rules below.
      bodyCaptureNote = `body unreadable: ${String(error).split("\n")[0]} [${chatResponseStatuses.join(", ")}]`
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
      const renderedLength = await page.evaluate(readDeliveredMarkdownLength)
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
        if (config.auth && settlementOutcome !== "aborted") {
          correctnessOk = false
          detail = `settlement outcome ${settlementOutcome} (expected aborted)`
        } else if (bodyAvailable && !oracle.text.startsWith(foldedText)) {
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
            readDeliveredMarkdownLength
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

    const correlationId = preReloadCorrelationId ?? correlationIdOf(marks)
    const serverSpans = correlationId
      ? collectServerSpans(correlationId)
      : undefined
    const timingReceipt = correlationId
      ? collectTimingReceipt(correlationId)
      : undefined
    const durableWrites =
      config.auth && correlationId
        ? collectDurableWrites(correlationId)
        : undefined

    // Provider segments of the run timing receipt are a correctness check,
    // never a gate (ADR-0030): the deterministic script fixes when the first
    // output chunk and the finish arrive, so the SDK-sourced figures must
    // agree with it or the run's timings are invalid.
    if (
      correctnessOk &&
      timingReceipt &&
      config.action === "complete" &&
      config.expectedOutcome === "finish"
    ) {
      const scripted = scriptedProviderTiming(config)
      const firstOutputDelta = Math.abs(
        (timingReceipt.providerFirstOutputMs ?? Number.NaN) -
          scripted.firstOutputMs
      )
      const responseDelta = Math.abs(
        (timingReceipt.modelResponseMs ?? Number.NaN) - scripted.totalMs
      )
      if (
        !(firstOutputDelta <= RECEIPT_FIRST_OUTPUT_TOLERANCE_MS) ||
        !(
          responseDelta <=
          scripted.totalMs * 0.1 + RECEIPT_RESPONSE_TOLERANCE_MS
        )
      ) {
        correctnessOk = false
        detail = `timing receipt disagrees with the script (first output ${timingReceipt.providerFirstOutputMs}ms vs ${scripted.firstOutputMs}ms; response ${timingReceipt.modelResponseMs}ms vs ${scripted.totalMs}ms)`
      }
    }

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

    const runStart = markAt(marks, "chat_send_intent") ?? 0
    const runEnd = markAt(marks, "stream_terminal") ?? Infinity
    const longTasks = durationsOverlappingRun(marks, "long_task", runStart, runEnd)
    const rafGaps = durationsOverlappingRun(marks, "raf_gap", runStart, runEnd)
    const projections = durations(marks, "markdown_projection_advance")
    const shiki = durations(marks, "shiki_highlight")
    const summary = marks
      .filter((mark) => mark.name === "stream_publication_summary")
      .at(-1)

    let scrollInputToPresentationMs: number | undefined
    if (config.interact) {
      if (!nativeWheel) throw new Error("Native wheel anchor missing")
      if (tracing) await stopTrace()
      const trace = await readTrace()
      if (traceDataLoss) throw new Error("Native trace lost events")
      scrollInputToPresentationMs = parseNativeScroll(JSON.parse(trace.toString()), nativeWheel).inputToPresentationMs
    }

    const result: RunMetrics = {
      scrollInputToPresentationMs,
      ui: uiObservation.values,
      hiddenDuringMeasurement: uiObservation.hidden,
      pendingDeltaSamples: uiObservation.pendingDeltas,
      droppedUiSamples: uiObservation.droppedSamples,
      sendToOptimisticPaintMs: diff(
        marks,
        "chat_send_intent",
        "optimistic_message_painted"
      ),
      sendToThreadRouteCommittedMs: diff(
        marks,
        "chat_send_intent",
        "thread_route_committed"
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
      stopSourceLengths,
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
      timingReceipt,
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
        ok:
          correctnessOk &&
          !uiObservation.hidden &&
          stoppedTextStable &&
          uiObservation.droppedSamples === 0 &&
          (config.action !== "complete" || uiObservation.pendingDeltas === 0),
        foldedTextHash: hashValue(foldedText),
        expectedTextHash: hashValue(oracle.text),
        terminalOutcome,
        settlementOutcome,
        settleMismatchCount,
        detail:
          uiObservation.droppedSamples > 0
            ? "UI observation was lost or could not be matched; capture invalid"
            : config.action === "complete" && uiObservation.pendingDeltas > 0
              ? "received content never reached the visible rendering watermark"
              : uiObservation.hidden
                ? "tab was hidden; responsiveness measurements invalid"
                : !stoppedTextStable
                  ? "assistant text grew after Stop feedback"
                  : detail,
      },
    }
    if (!result.correctness.ok) {
      result.correctness.detail = `${result.correctness.detail ?? "correctness failed"}; evidence=${JSON.stringify(await failureEvidence())}`
    }
    return result
  } catch (error) {
    const evidence = await failureEvidence()
    const probe = await page.evaluate((point) => {
      const observer = (window as ChatUiWindow).__chatUiPerf
      const root = document.querySelector<HTMLElement>("[data-scroll-root]")
      const menu = document.querySelector<HTMLElement>("[data-chat-composer-menu]")
      const target = point ? document.elementFromPoint(point.x, point.y) : null
      return {
        streaming: document.querySelector('[data-testid="send-button"]')
          ?.getAttribute("aria-label") === "Stop",
        hidden: document.visibilityState !== "visible",
        menuVisible: Boolean(menu?.checkVisibility({
          checkOpacity: true, checkVisibilityCSS: true,
        })),
        uiSamples: Object.fromEntries(
          Object.entries(observer?.values ?? {}).map(
            ([metric, samples]) => [metric, samples.length]
          )
        ),
        droppedUiSamples: observer?.droppedSamples(),
        pendingDeltas: observer?.pendingDeltas(),
        wheel: observer?.wheelDiagnostics(),
        marks: [...new Set(performance.getEntriesByType("mark")
          .filter((mark) => mark.name.startsWith("chat-perf:"))
          .map((mark) => mark.name.slice("chat-perf:".length)))],
        scroll: root ? {
          top: root.scrollTop,
          range: root.scrollHeight - root.clientHeight,
          pointInside: target ? root.contains(target) : undefined,
        } : undefined,
      }
    }, wheelPoint).catch(() => undefined)
    const message = String(error).split("\n")[0]
    const stage = config.interact
      ? interactionProbeStage
      : config.followup ? "follow-up" : "turn"
    throw new Error(
      `${config.id}: ${stage}: ${message}; evidence=${JSON.stringify(evidence)}; probe=${JSON.stringify(probe)}`,
      { cause: error }
    )
  } finally {
    try {
      if (profiling || tracing || traceResult) {
        const directory = path.join(
          REPO_ROOT,
          "benchmarks/chat-performance/browser/results"
        )
        mkdirSync(directory, { recursive: true })
        const capture = `${config.id}-${Date.now()}`
        if (profiling) {
          const { profile } = await cdp.send("Profiler.stop")
          writeFileSync(
            path.join(directory, `${capture}.cpuprofile`),
            JSON.stringify(profile)
          )
        }
        if (tracing) await stopTrace()
        if (traceResult) {
          const trace = await readTrace()
          const scope = PROFILE_LATE_MENU
            ? `.late-menu${lateMenuTraceComplete ? "" : ".partial"}`
            : ""
          writeFileSync(
            path.join(directory, `${capture}${scope}.trace.json`),
            trace
          )
        }
      }
    } finally {
      await page.close()
    }
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

const RECEIPT_FIRST_OUTPUT_TOLERANCE_MS = 75
const RECEIPT_RESPONSE_TOLERANCE_MS = 150

/**
 * When the deterministic script schedules its first output chunk and its
 * last part, relative to the provider call — the oracle for the receipt's
 * provider segments. Mirrors the SDK's output-chunk definition.
 */
function scriptedProviderTiming(config: BrowserScenarioConfig): {
  firstOutputMs: number
  totalMs: number
} {
  let elapsedMs = 0
  let firstOutputMs: number | undefined
  for (const timed of buildDeterministicPartScript({
    scenario: config.scenario,
    chunksPerSecond: config.chunksPerSecond,
    shape: config.shape,
  })) {
    elapsedMs += timed.delayMs
    const part = timed.part
    // Mirrors the SDK's isOutputChunk exactly (the runtime keeps its own copy).
    const isOutput =
      ((part.type === "text-delta" ||
        part.type === "reasoning-delta" ||
        part.type === "tool-input-delta") &&
        part.delta.length > 0) ||
      part.type === "tool-call" ||
      part.type === "file" ||
      part.type === "reasoning-file"
    if (firstOutputMs === undefined && isOutput) firstOutputMs = elapsedMs
  }
  return { firstOutputMs: firstOutputMs ?? 0, totalMs: elapsedMs }
}

/** The sampled `run_timing_receipt` mirror for one turn (ADR-0030). */
function collectTimingReceipt(
  correlationId: string
): RunMetrics["timingReceipt"] {
  for (const line of serverPerfLines) {
    if (line.correlationId !== correlationId) continue
    if (line.event !== "run_timing_receipt") continue
    const receipt: Record<string, number> = {}
    for (const [key, value] of Object.entries(line)) {
      if (typeof value === "number" && key !== "receivedAt") {
        receipt[key] = value
      }
    }
    return Object.keys(receipt).length > 0 ? receipt : undefined
  }
  return undefined
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
  // Sum the actual part script's scheduled delays — exact by construction,
  // and the only formula that survives shapes whose wall-clock diverges from
  // delta-count cadence (paused gaps, bursty regrouping).
  const scheduledMs = buildDeterministicPartScript({
    scenario: config.scenario,
    chunksPerSecond: config.chunksPerSecond,
    shape: config.shape,
  }).reduce((sum, timed) => sum + timed.delayMs, 0)
  return Math.round(scheduledMs * (config.cpuThrottle > 1 ? 2 : 1.5)) + 60_000
}

async function main() {
  if (
    !Number.isInteger(RUNS) ||
    RUNS < 1 ||
    !Number.isInteger(WARMUPS) ||
    WARMUPS < 0
  )
    fail("RUNS must be positive and WARMUPS nonnegative integers")
  if (!process.env.CI && !process.env.PERF_CDP_URL)
    fail(
      "Local benchmarks require PERF_CDP_URL for your authenticated Chrome session. No separate browser or server was launched."
    )
  const isThreadSwitch = SUITE_NAME === "thread-switch"
  let suite =
    SUITE_NAME === "smoke"
      ? SMOKE_SUITE
      : SUITE_NAME === "standard"
        ? STANDARD_SUITE
        : SUITE_NAME === "durable"
          ? DURABLE_SUITE
          : SUITE_NAME === "responsiveness"
            ? RESPONSIVENESS_SUITE
            : isThreadSwitch
              ? []
              : fail(`unknown SUITE: ${SUITE_NAME}`)
  if (process.env.ONLY && !isThreadSwitch) {
    const wanted = process.env.ONLY.split(",").map((id) => id.trim())
    suite = suite.filter((config) => wanted.includes(config.id))
    if (suite.length === 0)
      fail(`ONLY matched no scenario: ${process.env.ONLY}`)
  }
  if (
    PROFILE_LATE_MENU &&
    (process.env.PERF_PROFILE !== "true" ||
      isThreadSwitch ||
      suite.some((config) => !config.interact))
  )
    fail("PERF_PROFILE_LATE_MENU requires PERF_PROFILE=true and only interaction scenarios")
  if (process.env.PERF_CDP_URL && suite.some((config) => !config.auth))
    fail(
      "Guest suites need a CI browser; the attached authenticated profile must not have its storage cleared or be reported as a guest."
    )

  if (process.env.BASE_URL)
    fail(
      "BASE_URL is unsupported: the harness must own its deterministic production server"
    )
  if (PERF_PORT === 3000)
    fail("PERF_PORT must not use the developer server port 3000")
  const baseUrl = `http://localhost:${PERF_PORT}`
  spawnPerfServer(baseUrl)
  await waitForServer(baseUrl, 60_000)

  let browser: Browser
  try {
    browser = process.env.PERF_CDP_URL
      ? await chromium.connectOverCDP(process.env.PERF_CDP_URL)
      : await chromium.launch({
          channel: process.env.PW_CHANNEL,
        })
  } catch (error) {
    if (process.env.PERF_CDP_URL) throw error
    log(`chromium launch failed (${String(error).split("\n")[0]})`)
    log(`retrying with channel: chrome`)
    browser = await chromium.launch({ channel: "chrome" })
  }

  const results: ScenarioResult[] = []
  let anyCorrectnessFailure = false

  const authState =
    isThreadSwitch || suite.some((config) => config.auth)
      ? process.env.PERF_CDP_URL
        ? await browser.contexts()[0].storageState()
        : await acquireAuthState(browser, baseUrl)
      : null

  let threadSwitch: BenchmarkResultFile["threadSwitch"]
  if (isThreadSwitch && authState) {
    const chatCount = Number(process.env.THREAD_SWITCH_CHATS ?? 8)
    const switchCount = Number(process.env.THREAD_SWITCH_COUNT ?? 50)
    log(`thread-switch: ${chatCount} chats, ${switchCount} visited switches`)
    threadSwitch = await runThreadSwitch(browser, baseUrl, authState, {
      chatCount,
      switchCount,
      hoverMs: Number(process.env.THREAD_SWITCH_HOVER_MS ?? 250),
      documents: Number(process.env.THREAD_SWITCH_DOCUMENTS ?? 5),
      heapSampleAt: [10, 25, switchCount],
      log,
    })
    for (const line of formatThreadSwitch(threadSwitch)) log(line)
    if (!threadSwitch.correctnessOk) anyCorrectnessFailure = true
  }

  for (const config of suite) {
    const viewport =
      config.viewport === "mobile"
        ? { width: 390, height: 844 }
        : { width: 1440, height: 900 }
    const contextOptions = {
      viewport,
      ...(config.auth && authState ? { storageState: authState } : {}),
    }
    const context = process.env.PERF_CDP_URL
      ? browser.contexts()[0]
      : await browser.newContext(contextOptions)
    const timeoutMs = scenarioTimeoutMs(config)
    log(
      `scenario ${config.id}: ${WARMUPS} warmups + ${RUNS} runs (timeout ${Math.round(timeoutMs / 1000)}s)`
    )
    const runs: RunMetrics[] = []
    try {
      for (let index = 0; index < WARMUPS + RUNS; index++) {
        const kind = index < WARMUPS ? "warmup" : "run"
        let run: RunMetrics
        const runContext =
          config.cache === "cold" && !process.env.PERF_CDP_URL
            ? await browser.newContext(contextOptions)
            : context
        try {
          run = await runScenarioOnce(runContext, baseUrl, config, timeoutMs)
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
        } finally {
          if (runContext !== context) await runContext.close()
        }
        log(
          `  ${kind} ${index + 1}/${WARMUPS + RUNS}: ` +
            `${run.correctness.ok ? "ok" : `CORRECTNESS FAILED (${run.correctness.detail ?? "unknown"})`}`
        )
        if (index >= WARMUPS) runs.push(run)
      }
    } finally {
      if (!process.env.PERF_CDP_URL) await context.close()
    }

    let correctnessOk = runs.every((run) => run.correctness.ok)
    const liveStreamNotAdoptedRuns = runs.filter(
      (run) => run.liveStreamNotAdopted
    ).length
    // A layout-owned Chat must never lose its live binding across a route
    // segment commit.
    if (liveStreamNotAdoptedRuns > 0) {
      correctnessOk = false
      log(
        `  GATE: ${liveStreamNotAdoptedRuns} run(s) lost live-stream adoption (expected 0 since the layout-owned Chat fix)`
      )
    }
    if (!correctnessOk) anyCorrectnessFailure = true

    const numeric = (pick: (run: RunMetrics) => number | undefined): number[] =>
      runs.map(pick).filter((value): value is number => Number.isFinite(value))
    results.push({
      id: config.id,
      network: config.network ?? "unthrottled",
      cache: config.cache ?? "warm",
      auth: config.auth ?? false,
      followup: config.followup ?? false,
      scenario: config.scenario,
      directive: directiveFor(config),
      viewport: config.viewport,
      cpuThrottle: config.cpuThrottle,
      action: config.action,
      sampleCount: RUNS,
      warmupRuns: WARMUPS,
      wheelProtocol: config.interact ? "native-presentation-v1" : undefined,
      menuProtocol: config.interact ? "activation-v1" : undefined,
      interactionProtocol: config.interact ? "late-typing-native-wheel-menu-v2" : undefined,
      contentFrameProtocol: "publisher-frame-v1",
      correctnessOk,
      ...(liveStreamNotAdoptedRuns > 0 ? { liveStreamNotAdoptedRuns } : {}),
      metrics: {
        ...(config.interact ? { scrollInputToPresentationMs: summarize(numeric((run) => run.scrollInputToPresentationMs)) } : {}),
        ...Object.fromEntries(
          [...new Set(runs.flatMap((run) => Object.keys(run.ui ?? {})))].map(
            (metric) => [
              metric,
              summarize(runs.flatMap((run) => run.ui?.[metric] ?? [])),
            ]
          )
        ),
        sendToOptimisticPaintMs: summarize(
          numeric((run) => run.sendToOptimisticPaintMs)
        ),
        sendToThreadRouteCommittedMs: summarize(
          numeric((run) => run.sendToThreadRouteCommittedMs)
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
        // Run timing receipt segments (ADR-0030). Only the segments this
        // server owns gate; the provider ones are correctness-checked against
        // the deterministic script and reported for reference.
        prepareMs: summarize(numeric((run) => run.timingReceipt?.prepareMs)),
        firstWriteDelayMs: summarize(
          numeric((run) => run.timingReceipt?.firstWriteDelayMs)
        ),
        pacingOverheadMs: summarize(
          numeric((run) =>
            run.timingReceipt ? pacingOverheadMs(run.timingReceipt) : undefined
          )
        ),
        settlementTotalMs: summarize(
          numeric((run) => run.serverSpans?.settlement_total)
        ),
        providerFirstOutputMs: summarize(
          numeric((run) => run.timingReceipt?.providerFirstOutputMs)
        ),
        modelResponseMs: summarize(
          numeric((run) => run.timingReceipt?.modelResponseMs)
        ),
      },
      runs,
    })
    const first = results.at(-1)
    log(
      `  ${config.id}: correctness=${correctnessOk ? "OK" : "FAILED"} ` +
        `sendToRouteCommitted p50=${first?.metrics.sendToThreadRouteCommittedMs?.p50}ms ` +
        `sendToOptimisticPaint p50=${first?.metrics.sendToOptimisticPaintMs?.p50}ms ` +
        `sendToFirstVisible p50=${first?.metrics.sendToFirstVisibleTextMs?.p50}ms ` +
        `longTaskMax max=${first?.metrics.longTaskMaxMs?.max}ms`
    )
  }

  const buildIdPath = path.join(REPO_ROOT, DIST_DIR, "BUILD_ID")
  const buildId = existsSync(buildIdPath)
    ? readFileSync(buildIdPath, "utf8").trim()
    : "unknown"
  const commit = execSync("git rev-parse --short HEAD", {
    cwd: REPO_ROOT,
  })
    .toString()
    .trim()
  const file: BenchmarkResultFile = {
    schemaVersion: 2,
    measurementVersion: "dom-frame-v3",
    accountReadinessProtocol: "matching-account-v1",
    typingCadenceMs: BENCHMARK_TYPING_DELAY_MS,
    replayPolicy: "disabled-v1",
    identityProtocol: process.env.PERF_CDP_URL
      ? "attached-session-v1"
      : "ci-isolated-v1",
    profiled: process.env.PERF_PROFILE === "true",
    fixtureHash: hashValue(
      isThreadSwitch
        ? ["short-prose", "long-markdown"].map((scenario) =>
            buildDeterministicPartScript({
              scenario: scenario as "short-prose" | "long-markdown",
              chunksPerSecond: 100,
              shape: "fixed",
            })
          )
        : suite.flatMap((config) => [
            buildDeterministicPartScript(config),
            ...(config.followup
              ? [buildDeterministicPartScript(FOLLOWUP_SEED)]
              : []),
          ])
    ),
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
    ...(threadSwitch ? { threadSwitch } : {}),
  }

  const resultsDir = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    "results"
  )
  mkdirSync(resultsDir, { recursive: true })
  const outPath = path.join(
    resultsDir,
    `${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}-${SUITE_NAME}.json`
  )
  writeFileSync(outPath, JSON.stringify(file, null, 2))
  log(`results written to ${outPath}`)

  // Playwright closes its CDP transport here; attached Chrome is not terminated.
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
