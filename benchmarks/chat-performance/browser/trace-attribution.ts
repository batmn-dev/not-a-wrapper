/**
 * Drives one deterministic guest turn per case under Chrome tracing and attributes
 * every >50 ms main-thread task to JS / style / layout / paint / GC via
 * trace-event self-times, joined with the app's own `chat-perf:*` User Timing
 * marks (projection advances and Shiki measures fire INSIDE the tasks that
 * pay for them, so the join needs no clock alignment).
 *
 * The v8 CPU profiler is deliberately NOT used: the perf build is minified,
 * so sampled frames would be unreadable without a source-mapped build — if a
 * case comes back JS-dominated beyond what the in-app measures explain, that
 * source-mapped profiling build is the follow-up, not this script.
 *
 * Usage:
 *   NEXT_DIST_DIR=.next-perf build present, then
 *   CI=true bun run benchmarks/chat-performance/browser/trace-attribution.ts
 * Observer overhead: add PERF_OBSERVER_AB=true CASE=b1-long-markdown-100-fixed.
 * One warmup pair and five alternating measured pairs use fresh guest contexts.
 * Native trace evidence and observer-overhead-*.json go to OUT_DIR; this compares
 * the benchmark DOM observer, without production telemetry reporting overhead.
 * Rendering control: STREAMING_PRESENTATION=smooth|quick uses the existing
 * guest preference; each labeled capture is diagnostic, never a baseline.
 * Env: BASE_URL (reuse a running perf server), CASE (one case id), OUT_DIR
 * (default: this directory's results/traces, gitignored with results/),
 * INJECT_CSS_FILE (stylesheet injected into the page before the send —
 * probes a CSS containment hypothesis without a source change or rebuild;
 * LABEL suffixes the output filenames so variants don't overwrite baseline).
 */
import { deterministicScenarioText } from "@/app/api/chat/deterministic-provider"
import { installChatUiObserver, type ChatUiWindow } from "@/lib/observability/chat-ui-observer"
import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import os from "node:os"
import { chromium, type Browser, type Page } from "playwright"
import { BENCHMARK_TYPING_DELAY_MS } from "./scenarios"

const REPO_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../.."
)
const DIST_DIR = process.env.NEXT_DIST_DIR ?? ".next-perf"
const OBSERVER_AB = process.env.PERF_OBSERVER_AB === "true"
const STREAMING_PRESENTATION = process.env.STREAMING_PRESENTATION
const PERF_PORT = Number(process.env.PERF_PORT ?? 3111)
const OUT_DIR =
  process.env.OUT_DIR ??
  path.join(path.dirname(new URL(import.meta.url).pathname), "results", "traces")

type TraceCase = {
  id: string
  scenario: "long-markdown" | "mixed-markdown"
  directive: string
  cpuThrottle: number
}

/** The two rendering bottlenecks identified by the baseline. */
const CASES: TraceCase[] = [
  {
    id: "b1-long-markdown-100-fixed",
    scenario: "long-markdown",
    directive: "[[perf:long-markdown:100:fixed]]",
    cpuThrottle: 1,
  },
  {
    id: "b2-mixed-markdown-30-fixed-cpu4",
    scenario: "mixed-markdown",
    directive: "[[perf:mixed-markdown:30:fixed]]",
    cpuThrottle: 4,
  },
]

const TRACE_CATEGORIES = [
  "toplevel",
  "devtools.timeline",
  "blink.user_timing",
  "v8.execute",
  // e.g. disabled-by-default-devtools.timeline.invalidationTracking to see
  // WHICH nodes dirty layout/style each frame (fat traces; one-off digs only).
  ...(process.env.EXTRA_CATEGORIES?.split(",") ?? []),
]

// Trace-event name → attribution bucket. Everything else inside a task is
// "other" (task scheduling, IPC, unaccounted browser work).
const BUCKET_BY_NAME: Record<string, string> = {
  FunctionCall: "js",
  EvaluateScript: "js",
  TimerFire: "js",
  EventDispatch: "js",
  RunMicrotasks: "js",
  "v8.run": "js",
  "V8.Execute": "js",
  FireAnimationFrame: "js",
  UpdateLayoutTree: "style",
  ScheduleStyleRecalculation: "style",
  Layout: "layout",
  PrePaint: "paint",
  Paint: "paint",
  Layerize: "paint",
  Commit: "paint",
  CompositeLayers: "paint",
  MinorGC: "gc",
  MajorGC: "gc",
  "V8.GCScavenger": "gc",
  "BlinkGC.AtomicPhase": "gc",
}

type TraceEvent = {
  name: string
  ph: string
  ts: number
  dur?: number
  pid: number
  tid: number
  cat?: string
  args?: Record<string, unknown>
}

function log(message: string): void {
  process.stdout.write(`[trace-attribution] ${message}\n`)
}

let serverProcess: ChildProcess | null = null

async function ensureServer(baseUrl: string, external: boolean): Promise<void> {
  if (!external) {
    const buildIdPath = path.join(REPO_ROOT, DIST_DIR, "BUILD_ID")
    if (!existsSync(buildIdPath)) {
      throw new Error(
        `no production build at ${DIST_DIR}; build with NEXT_PUBLIC_CHAT_PERF_INSTRUMENTATION=true NEXT_DIST_DIR=${DIST_DIR} bun run build:next`
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
  throw new Error(`timed out waiting for mark ${name} (${timeoutMs}ms)`)
}

async function drainSetupFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.visibilityState !== "visible")
      throw new Error("trace setup lost foreground visibility")
    return new Promise<void>((resolve, reject) => {
      let frame = 0
      let task: ReturnType<typeof setTimeout> | undefined
      const finish = (error?: Error) => {
        cancelAnimationFrame(frame)
        clearTimeout(task)
        clearTimeout(deadline)
        document.removeEventListener("visibilitychange", visibility)
        if (error) reject(error)
        else resolve()
      }
      const visibility = () => {
        if (document.visibilityState !== "visible")
          finish(new Error("trace setup lost foreground visibility"))
      }
      const deadline = setTimeout(
        () => finish(new Error("trace setup did not drain within 5 seconds")),
        5000
      )
      document.addEventListener("visibilitychange", visibility)
      frame = requestAnimationFrame(() => {
        task = setTimeout(() => {
          frame = requestAnimationFrame(() => {
            task = setTimeout(() => finish(), 0)
          })
        }, 0)
      })
    })
  })
}

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

/** Per-name self time over one task's span, via a sorted event stack. */
function selfTimesInSpan(
  events: TraceEvent[],
  spanStart: number,
  spanEnd: number
): Map<string, number> {
  const inSpan = events
    .filter(
      (event) =>
        event.ph === "X" &&
        event.ts >= spanStart &&
        event.ts + (event.dur ?? 0) <= spanEnd &&
        BUCKET_BY_NAME[event.name] !== undefined
    )
    .sort((a, b) => a.ts - b.ts || (b.dur ?? 0) - (a.dur ?? 0))
  const selfByName = new Map<string, number>()
  const stack: TraceEvent[] = []
  const charge = (event: TraceEvent, amount: number) => {
    selfByName.set(event.name, (selfByName.get(event.name) ?? 0) + amount)
  }
  for (const event of inSpan) {
    while (
      stack.length > 0 &&
      stack[stack.length - 1].ts + (stack[stack.length - 1].dur ?? 0) <=
        event.ts
    ) {
      stack.pop()
    }
    const parent = stack[stack.length - 1]
    if (parent) charge(parent, -(event.dur ?? 0))
    charge(event, event.dur ?? 0)
    stack.push(event)
  }
  return selfByName
}

type TaskAttribution = {
  startMs: number
  durMs: number
  buckets: Record<string, number>
  marksInside: string[]
}

function analyzeTrace(tracePath: string, caseId: string) {
  const trace = JSON.parse(readFileSync(tracePath, "utf8")) as {
    traceEvents: TraceEvent[]
  }
  const events = trace.traceEvents

  // Main renderer thread = the CrRendererMain thread that carries our marks.
  const markEvents = events.filter(
    (event) =>
      event.name.startsWith("chat-perf:") &&
      (event.cat ?? "").includes("blink.user_timing")
  )
  if (markEvents.length === 0) throw new Error("no chat-perf marks in trace")
  const threadKey = (event: TraceEvent) => `${event.pid}:${event.tid}`
  const markThreads = new Map<string, number>()
  for (const event of markEvents) {
    markThreads.set(threadKey(event), (markThreads.get(threadKey(event)) ?? 0) + 1)
  }
  const mainKey = [...markThreads.entries()].sort((a, b) => b[1] - a[1])[0][0]
  const [mainPid, mainTid] = mainKey.split(":").map(Number)
  const main = events.filter(
    (event) => event.pid === mainPid && event.tid === mainTid
  )

  const markTs = (name: string) =>
    markEvents.find(
      (event) =>
        event.name === `chat-perf:${name}` &&
        event.pid === mainPid &&
        event.tid === mainTid
    )?.ts
  const windowStart = markTs("chat_send_intent")
  const windowEnd = markTs("stream_terminal")
  if (windowStart === undefined || windowEnd === undefined || windowEnd <= windowStart) {
    throw new Error("send/terminal marks missing from trace window")
  }

  // Task boundaries come from the 'toplevel' category (the scheduler's
  // RunTask); DevTools' own long-task detection uses the same events.
  const tasks = main.filter(
    (event) =>
      event.ph === "X" &&
      event.name.endsWith("RunTask") &&
      (event.cat ?? "").includes("toplevel") &&
      (event.dur ?? 0) >= 50_000 &&
      event.ts >= windowStart &&
      event.ts <= windowEnd
  )

  // Clip and union native intervals over the full window, including short work.
  const nativeWorkMs = (events: TraceEvent[]) => {
    const spans = events
      .filter((event) => event.ph === "X" && event.ts < windowEnd &&
        event.ts + (event.dur ?? 0) > windowStart)
      .map((event) => [Math.max(windowStart, event.ts),
        Math.min(windowEnd, event.ts + (event.dur ?? 0))] as const)
      .sort((a, b) => a[0] - b[0])
    let coveredUntil = windowStart
    let total = 0
    for (const [start, end] of spans) {
      total += Math.max(0, end - Math.max(start, coveredUntil)) / 1000
      coveredUntil = Math.max(coveredUntil, end)
    }
    return total
  }
  const mainThreadWorkMs = nativeWorkMs(main.filter((event) =>
    event.name.endsWith("RunTask") && (event.cat ?? "").includes("toplevel")))
  if (mainThreadWorkMs <= 0) throw new Error("native scheduler work missing from trace")
  const eventTimingEntries = main.flatMap((event) => {
    if (event.name !== "EventTiming" || event.ph !== "b") return []
    const data = event.args?.data as Record<string, unknown> | undefined
    if (typeof data?.duration !== "number" || data.duration <= 0 ||
      typeof data.type !== "string" || typeof data.interactionId !== "number" ||
      data.interactionId === 0 || event.ts >= windowEnd ||
      event.ts + data.duration * 1000 <= windowStart) return []
    return [{ type: data.type, durationMs: data.duration }]
  })

  const attributions: TaskAttribution[] = tasks.map((task) => {
    const spanEnd = task.ts + (task.dur ?? 0)
    const selfByName = selfTimesInSpan(main, task.ts, spanEnd)
    const buckets: Record<string, number> = {}
    let accounted = 0
    for (const [name, selfUs] of selfByName) {
      const bucket = BUCKET_BY_NAME[name]
      buckets[bucket] = (buckets[bucket] ?? 0) + selfUs / 1000
      accounted += selfUs
    }
    buckets.other = ((task.dur ?? 0) - accounted) / 1000
    return {
      startMs: (task.ts - windowStart) / 1000,
      durMs: (task.dur ?? 0) / 1000,
      buckets,
      marksInside: markEvents
        .filter((event) => event.ts >= task.ts && event.ts <= spanEnd)
        .map((event) => event.name.slice("chat-perf:".length)),
    }
  })

  const totals: Record<string, number> = {}
  for (const attribution of attributions) {
    for (const [bucket, ms] of Object.entries(attribution.buckets)) {
      totals[bucket] = (totals[bucket] ?? 0) + ms
    }
  }
  const tbtMs = attributions.reduce(
    (sum, attribution) => sum + (attribution.durMs - 50),
    0
  )
  return {
    caseId,
    streamWindowMs: (windowEnd - windowStart) / 1000,
    mainThreadWorkMs,
    layoutWorkMs: nativeWorkMs(main.filter((event) => event.name === "Layout")),
    styleWorkMs: nativeWorkMs(main.filter((event) => event.name === "UpdateLayoutTree")),
    eventTimingEntries,
    longTaskCount: attributions.length,
    longTaskTotalMs: attributions.reduce((sum, a) => sum + a.durMs, 0),
    tbtMs,
    bucketTotalsMs: totals,
    tasksWithProjectionAdvance: attributions.filter((a) =>
      a.marksInside.includes("markdown_projection_advance")
    ).length,
    tasks: attributions.sort((a, b) => b.durMs - a.durMs).slice(0, 12),
  }
}

function captureMetadata(browser: Browser, traceCase: TraceCase) {
  const buildIdPath = path.join(REPO_ROOT, DIST_DIR, "BUILD_ID")
  return {
    typingCadenceMs: BENCHMARK_TYPING_DELAY_MS,
    replayPolicy: "disabled-v1",
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim(),
    buildId: process.env.BASE_URL ? "external-unverified" : readFileSync(buildIdPath, "utf8").trim(),
    browser: browser.version(),
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpuModel: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
    memoryBytes: os.totalmem(),
    viewport: { width: 1440, height: 900 },
    cpuThrottle: traceCase.cpuThrottle,
    authentication: "fresh guest per sample",
    httpCache: "fresh browser context per sample",
    fixture: traceCase.directive,
    fixtureHash: createHash("sha256").update(JSON.stringify(deterministicScenarioText(traceCase.scenario))).digest("hex"),
    traceCategories: TRACE_CATEGORIES,
  }
}

async function runCase(
  browser: Browser,
  baseUrl: string,
  traceCase: TraceCase,
  observerRun?: { enabled: boolean; label: string }
) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  })
  const page = await context.newPage()
  if (observerRun || STREAMING_PRESENTATION) {
    await context.addInitScript(installChatUiObserver)
    await context.addInitScript(() => {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible") performance.mark("trace:hidden")
      })
    })
  }
  const cdp = await context.newCDPSession(page)
  if (traceCase.cpuThrottle > 1) {
    await cdp.send("Emulation.setCPUThrottlingRate", {
      rate: traceCase.cpuThrottle,
    })
  }
  // Probe knob: prefers-reduced-motion disables the streaming decay overlay
  // (and motion-gated CSS) without a source change — isolates their cost.
  if (process.env.EMULATE_REDUCED_MOTION) {
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    })
  }
  const oracle = deterministicScenarioText(traceCase.scenario)
  const timeoutMs =
    Math.round(
      ((oracle.text.length + oracle.reasoning.length) / 40 / 100) * 1000 *
        (traceCase.cpuThrottle > 1 ? 4 : 2)
    ) + 120_000

  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" })
    await waitForMark(page, "replay_disabled_v1", 15000)
    // newContext is already a fresh guest; do not mint another guest for A/B.
    if (!observerRun) await clearGuestIdentity(page)
    const editor = page.locator('[contenteditable="true"]').first()
    await editor.waitFor({ state: "visible", timeout: 15000 })
    if (STREAMING_PRESENTATION) {
      await page.evaluate((presentation) => {
        localStorage.setItem("user-preferences", JSON.stringify({ streamingPresentation: presentation }))
        window.dispatchEvent(new Event("user-preferences-change"))
      }, STREAMING_PRESENTATION)
    }
    // After the reload above, so an injected probe stylesheet survives the run.
    if (process.env.INJECT_CSS_FILE) {
      await page.addStyleTag({ path: process.env.INJECT_CSS_FILE })
    }

    const label = observerRun ? `.${observerRun.label}` : process.env.LABEL ? `.${process.env.LABEL}` : ""
    const tracePath = path.join(OUT_DIR, `${traceCase.id}${label}.trace.json`)
    await editor.click()
    await page.keyboard.type(traceCase.directive, { delay: BENCHMARK_TYPING_DELAY_MS })
    if (observerRun || STREAMING_PRESENTATION) {
      if (observerRun) {
        await page.waitForFunction(() => Boolean((window as ChatUiWindow).__chatUiPerf))
      }
      // Drain setup's DOM scan and post-frame task in both arms. A second cycle
      // includes scans queued by DOM commits later in the first rendering step.
      await drainSetupFrames(page)
      if (observerRun && !observerRun.enabled) {
        await page.evaluate(() => {
          // The application's delayed import must not reinstall the off arm.
          const observedWindow = window as ChatUiWindow
          observedWindow.__chatUiPerfDisabled = true
          observedWindow.__chatUiPerf!.dispose()
        })
      }
    }
    const responsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/chat" && response.request().method() === "POST",
    { timeout: timeoutMs })
    // Observe rejection immediately while the independent terminal wait runs.
    const bodyPromise = responsePromise.then(async (response) => {
      if (!response.ok()) throw new Error(`chat response status ${response.status()}`)
      return response.text()
    })
    void bodyPromise.catch(() => {})
    await browser.startTracing(page, {
      path: tracePath,
      screenshots: false,
      categories: TRACE_CATEGORIES,
    })
    await page.locator('[data-testid="send-button"]').click()
    if (STREAMING_PRESENTATION) {
      await waitForMark(page, "first_visible_text", timeoutMs)
      // Observe the actual overlay gate after text renders, not just storage.
      await page.waitForFunction((presentation) => {
        const registered = Array.from(CSS.highlights.keys()).some((name) => name.startsWith("naw-stream-decay-"))
        return registered === (presentation === "smooth")
      }, STREAMING_PRESENTATION, { timeout: 5000 })
    }
    if (observerRun) {
      await waitForMark(page, "first_visible_text", timeoutMs)
      await editor.click()
      await page.keyboard.type("A draft.", { delay: BENCHMARK_TYPING_DELAY_MS })
      if (await page.evaluate(() => performance.getEntriesByName("chat-perf:stream_terminal").length > 0)) {
        throw new Error("typing probe missed the active stream")
      }
    }
    await waitForMark(page, "stream_terminal", timeoutMs)
    await page.waitForTimeout(750)
    await browser.stopTracing()

    let bodyTimer: ReturnType<typeof setTimeout> | undefined
    let body: string
    try {
      body = await Promise.race([bodyPromise, new Promise<never>((_, reject) => {
        bodyTimer = setTimeout(() => reject(new Error("SSE capture timed out")), 10_000)
      })])
    } finally {
      clearTimeout(bodyTimer)
    }
    let text = ""
    let reasoning = ""
    let finished = false
    for (const line of body.split("\n")) {
      if (!line.startsWith("data:")) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === "[DONE]") continue
      const part: { type?: string; delta?: string } = JSON.parse(payload)
      if (part.type === "error") throw new Error("stream returned an error")
      if (part.type === "finish") finished = true
      if (part.type === "text-delta") text += part.delta ?? ""
      if (part.type === "reasoning-delta") reasoning += part.delta ?? ""
    }
    const validPage = await page.evaluate((expectedObserver) => {
      const terminal = performance.getEntriesByName("chat-perf:stream_terminal").at(-1) as PerformanceMark | undefined
      return terminal?.detail?.outcome === "finish" && document.visibilityState === "visible" &&
        performance.getEntriesByName("trace:hidden").length === 0 &&
        (expectedObserver === null || Boolean((window as ChatUiWindow).__chatUiPerf) === expectedObserver)
    }, observerRun?.enabled ?? null)
    if (!validPage || !finished || text !== oracle.text || reasoning !== oracle.reasoning) {
      throw new Error("invalid sample: terminal, foreground, observer state, or full stream oracle mismatch")
    }

    // The app's own measures, for the join: per-advance/highlight durations.
    const measures = await page.evaluate(() =>
      performance
        .getEntriesByType("mark")
        .filter((entry) => entry.name.startsWith("chat-perf:"))
        .map((entry) => ({
          name: entry.name.slice("chat-perf:".length),
          startTime: entry.startTime,
          durationMs: (
            (entry as PerformanceMark).detail as { durationMs?: number } | null
          )?.durationMs,
        }))
    )
    const sum = (name: string) =>
      measures
        .filter((mark) => mark.name === name && mark.durationMs !== undefined)
        .reduce((total, mark) => total + (mark.durationMs ?? 0), 0)
    const count = (name: string) =>
      measures.filter((mark) => mark.name === name).length

    const analysis = {
      ...analyzeTrace(tracePath, traceCase.id),
      correctnessOk: true,
      diagnosticOnly: true,
      metadata: captureMetadata(browser, traceCase),
      streamingPresentation: STREAMING_PRESENTATION ?? "smooth",
      replayPolicy: "disabled-v1",
      observerEnabled: observerRun?.enabled,
      appMeasures: {
        projectionAdvanceCount: count("markdown_projection_advance"),
        projectionAdvanceTotalMs: sum("markdown_projection_advance"),
        shikiHighlightCount: count("shiki_highlight"),
        shikiHighlightTotalMs: sum("shiki_highlight"),
      },
    }
    if (observerRun && !analysis.eventTimingEntries.some((entry) => entry.type === "keydown")) {
      throw new Error("native trace did not capture the typing probe")
    }
    const outPath = path.join(OUT_DIR, `${traceCase.id}${label}.analysis.json`)
    writeFileSync(outPath, JSON.stringify(analysis, null, 2))
    log(
      `${traceCase.id}: window ${Math.round(analysis.streamWindowMs)}ms, ` +
        `${analysis.longTaskCount} long tasks (${Math.round(analysis.longTaskTotalMs)}ms, TBT ${Math.round(analysis.tbtMs)}ms), ` +
        `buckets ${JSON.stringify(
          Object.fromEntries(
            Object.entries(analysis.bucketTotalsMs).map(([bucket, ms]) => [
              bucket,
              Math.round(ms),
            ])
          )
        )}, ` +
        `projection advances in ${analysis.tasksWithProjectionAdvance}/${analysis.longTaskCount} tasks ` +
        `(app-measured ${Math.round(analysis.appMeasures.projectionAdvanceTotalMs)}ms), ` +
        `shiki app-measured ${Math.round(analysis.appMeasures.shikiHighlightTotalMs)}ms → ${outPath}`
    )
    return analysis
  } finally {
    await browser.stopTracing().catch(() => {})
    await context.close()
  }
}

async function main() {
  if (process.env.CI !== "true") {
    throw new Error("This isolated-browser trace tool is CI-only; use authenticated Chrome locally")
  }
  if (!Number.isInteger(PERF_PORT) || PERF_PORT < 1 || PERF_PORT > 65535 || PERF_PORT === 3000) {
    throw new Error("PERF_PORT must be a valid isolated port other than 3000")
  }
  if (STREAMING_PRESENTATION && !["smooth", "quick"].includes(STREAMING_PRESENTATION)) {
    throw new Error("STREAMING_PRESENTATION must be smooth or quick")
  }
  if (STREAMING_PRESENTATION && (OBSERVER_AB || process.env.INJECT_CSS_FILE || process.env.EMULATE_REDUCED_MOTION || process.env.BASE_URL)) {
    throw new Error("Rendering control requires an owned server and cannot combine with observer A/B or other rendering probes")
  }
  if (OBSERVER_AB && ["BASE_URL", "INJECT_CSS_FILE", "EMULATE_REDUCED_MOTION", "EXTRA_CATEGORIES"].some((key) => process.env[key])) {
    throw new Error("Observer A/B requires the owned perf server and unmodified tracing/rendering configuration")
  }
  const wanted = process.env.CASE ?? (OBSERVER_AB ? CASES[0].id : undefined)
  const selected = CASES.filter((traceCase) => !wanted || traceCase.id === wanted)
  if (selected.length === 0) throw new Error(`unknown CASE: ${wanted}`)
  mkdirSync(OUT_DIR, { recursive: true })
  const externalBaseUrl = process.env.BASE_URL
  const baseUrl = externalBaseUrl ?? `http://localhost:${PERF_PORT}`
  await ensureServer(baseUrl, Boolean(externalBaseUrl))
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL })
  try {
    for (const traceCase of selected) {
      if (!OBSERVER_AB) {
        await runCase(browser, baseUrl, traceCase)
        continue
      }
      const captureId = `${traceCase.id}-${Date.now()}`
      type Result = Awaited<ReturnType<typeof runCase>>
      const pairs: Array<{
        pair: number
        order: string[]
        on: Result
        off: Result
        mainThreadWorkDeltaMs: number
        mainThreadWorkDeltaPercent: number
      }> = []
      for (let pair = 0; pair <= 5; pair++) {
        const order = pair % 2 === 0 ? [true, false] : [false, true]
        const results = new Map<boolean, Result>()
        for (const enabled of order) {
          const label = `${captureId}.${pair === 0 ? "warmup" : `pair-${pair}`}.${enabled ? "on" : "off"}`
          results.set(enabled, await runCase(browser, baseUrl, traceCase, { enabled, label }))
        }
        if (pair === 0) continue
        const on = results.get(true)!
        const off = results.get(false)!
        pairs.push({
          pair,
          order: order.map((enabled) => enabled ? "on" : "off"),
          on,
          off,
          mainThreadWorkDeltaMs: on.mainThreadWorkMs - off.mainThreadWorkMs,
          mainThreadWorkDeltaPercent: (on.mainThreadWorkMs / off.mainThreadWorkMs - 1) * 100,
        })
      }
      const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
      const summaryPath = path.join(OUT_DIR, `observer-overhead-${captureId}.json`)
      writeFileSync(summaryPath, JSON.stringify({
        schema: "observer-overhead-v1",
        scope: "incremental benchmark DOM observer during Send-to-terminal, excluding startup, session replay, and production reporting",
        diagnosticOnly: true,
        nativeWorkWindow: "chat_send_intent through stream_terminal; overlapping RunTask intervals clipped and unioned",
        inputMetric: "individual native trace EventTiming durations; not logical interaction maxima or INP",
        metadata: {
          ...captureMetadata(browser, traceCase),
          warmupPairs: 1,
          measuredPairs: pairs.length,
        },
        medianPairedMainThreadWorkDeltaMs: median(pairs.map((pair) => pair.mainThreadWorkDeltaMs)),
        medianPairedMainThreadWorkDeltaPercent: median(pairs.map((pair) => pair.mainThreadWorkDeltaPercent)),
        pairs,
      }, null, 2))
      log(`observer A/B: ${pairs.length} valid pairs; median native main-thread work delta ${median(pairs.map((pair) => pair.mainThreadWorkDeltaPercent)).toFixed(2)}% → ${summaryPath}`)
    }
  } finally {
    await browser.close()
    serverProcess?.kill()
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error)
    serverProcess?.kill()
    process.exit(1)
  }
)
