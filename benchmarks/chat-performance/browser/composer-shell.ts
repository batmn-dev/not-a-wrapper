/**
 * Composer shell fidelity (TODO "SSR composer shell fidelity"): does the
 * server-rendered composer already show the saved model and effort on first
 * paint, or does it flip after preferences load?
 *
 * Signs in as the harness user (same flow as harness.ts), saves a NON-default
 * model + effort through the app's own composer controls, then cold-loads `/`
 * RUNS times in fresh contexts carrying that storage state. Each load samples
 * the model and effort button text every animation frame from first paint
 * until SETTLE_MS after load (see below for why not `networkidle`), collects
 * layout-shift entries whose sources intersect the composer form, and reads
 * TTFB from Navigation Timing.
 *
 *   NEXT_DIST_DIR=.next-perf bun run build:next
 *   PERF_AUTH_PASSWORD=... bun run benchmarks/chat-performance/browser/composer-shell.ts
 *
 * Env: NEXT_DIST_DIR (default .next-perf), PERF_PORT (default 3112), RUNS
 * (default 10), BASE_URL (reuse a running server), PW_CHANNEL, OUT (json path),
 * SHELL_MODEL_ID (default the free Gemma route), SHELL_EFFORT_LABEL
 * (default "High").
 */
import { spawn, type ChildProcess } from "node:child_process"
import { existsSync, writeFileSync } from "node:fs"
import path from "node:path"
import { getModelInfo } from "@/lib/models"
import { getModelDisplayName } from "@/lib/models/presentation"
import { chromium, type Browser, type BrowserContext } from "playwright"
import {
  ensurePerfAuthUser,
  getPerfAuthPassword,
  PERF_AUTH_EMAIL,
} from "./ensure-auth-user"

const PERF_PORT = Number(process.env.PERF_PORT ?? 3112)
const RUNS = Number(process.env.RUNS ?? 10)
const DIST_DIR = process.env.NEXT_DIST_DIR ?? ".next-perf"
const SHELL_MODEL_ID =
  process.env.SHELL_MODEL_ID ?? "openrouter:google/gemma-4-26b-a4b-it:free"
const SHELL_EFFORT_LABEL = process.env.SHELL_EFFORT_LABEL ?? "High"
const REPO_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../.."
)

const MODEL_TRIGGER = '[aria-label^="Select model"]'
const EFFORT_TRIGGER = "[data-effort-control]"
const COMPOSER_FORM = '[data-slot="prompt-input-surface"]'

let serverProcess: ChildProcess | null = null

function log(message: string) {
  console.log(`[composer-shell] ${message}`)
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
  throw new Error(`server at ${baseUrl} did not become ready in ${timeoutMs}ms`)
}

async function assertPortFree(baseUrl: string): Promise<void> {
  try {
    await fetch(baseUrl, { redirect: "manual" })
  } catch {
    return
  }
  // A leftover server would silently serve another build's bundle.
  throw new Error(`${baseUrl} is already serving; stop it (or pass BASE_URL)`)
}

function spawnServer(): void {
  if (!existsSync(path.join(REPO_ROOT, DIST_DIR, "BUILD_ID"))) {
    throw new Error(
      `no production build at ${DIST_DIR}: NEXT_DIST_DIR=${DIST_DIR} bun run build:next`
    )
  }
  log(`starting server on :${PERF_PORT} (dist: ${DIST_DIR})`)
  // Own process group so stopServer() reaches `next start` behind bunx.
  serverProcess = spawn("bunx", ["next", "start", "-p", String(PERF_PORT)], {
    cwd: REPO_ROOT,
    env: { ...process.env, NEXT_DIST_DIR: DIST_DIR },
    stdio: ["ignore", "ignore", "inherit"],
    detached: true,
  })
}

function stopServer() {
  if (serverProcess?.pid) {
    try {
      process.kill(-serverProcess.pid, "SIGTERM")
    } catch {
      serverProcess.kill("SIGTERM")
    }
  }
  serverProcess = null
}

async function signIn(browser: Browser, baseUrl: string) {
  const password = getPerfAuthPassword()
  await ensurePerfAuthUser()
  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    await page.goto(`${baseUrl}/auth/login`, { waitUntil: "domcontentloaded" })
    await page.locator("#email").fill(PERF_AUTH_EMAIL)
    await page.locator("#password").fill(password)
    await page.getByRole("button", { name: "Log in" }).click()
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

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>

/**
 * The observation window after `load`. Playwright's `networkidle` never fires
 * here (the Convex WebSocket stays open and the sidebar's `?_rsc=` route
 * prefetches stream past the composer settling), so the window is a fixed
 * tail long enough for every async input the composer resolves from (device
 * memory, the Convex user document, user preferences) to land; each run also
 * reports when the last label change happened so the margin is visible.
 */
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 6000)

/** The selector search that surfaces `SHELL_MODEL_ID`: its display name. */
function shellModelSearch(): string {
  const model = getModelInfo(SHELL_MODEL_ID)
  if (!model)
    throw new Error(`SHELL_MODEL_ID ${SHELL_MODEL_ID} is not in the catalog`)
  return getModelDisplayName(model)
}

/** Save the fixture selection through the composer's own controls. */
async function saveFixtureSelection(
  browser: Browser,
  baseUrl: string,
  authState: StorageState
): Promise<{ state: StorageState; model: string; effort: string }> {
  const context = await browser.newContext({ storageState: authState })
  const page = await context.newPage()
  try {
    await page.goto(`${baseUrl}/`, { waitUntil: "load" })
    await page.waitForTimeout(SETTLE_MS)
    await page.locator(MODEL_TRIGGER).click()
    await page.getByPlaceholder("Search models...").fill(shellModelSearch())
    await page
      .locator(`[data-model-selector-row="model:${SHELL_MODEL_ID}"]`)
      .click()
    await page.locator(EFFORT_TRIGGER).click()
    await page
      .getByRole("menuitemradio", { name: SHELL_EFFORT_LABEL, exact: true })
      .click()
    // Let the selection writes (localStorage, cookie) land before capture.
    await page.waitForTimeout(500)
    const model = (await page.locator(MODEL_TRIGGER).innerText()).trim()
    const effort = (await page.locator(EFFORT_TRIGGER).innerText()).trim()
    log(`fixture selection saved: model "${model}", effort "${effort}"`)
    return { state: await context.storageState(), model, effort }
  } finally {
    await context.close()
  }
}

type Sample = { t: number; model: string | null; effort: string | null }
type Rect = { x: number; y: number; width: number; height: number }
type Shift = { value: number; hadRecentInput: boolean; rects: Rect[] }
type RunResult = {
  ttfbMs: number
  firstPaint: { model: string | null; effort: string | null }
  final: { model: string | null; effort: string | null }
  modelLabelChanges: number
  effortLabelChanges: number
  /** When the last label change happened (ms after navigation start). */
  lastLabelChangeMs: number
  composerCls: number
  pageCls: number
  samples: Sample[]
}

// Installed before any page script: rAF sampler + layout-shift observer.
const OBSERVER_INIT = `
(() => {
  const state = { samples: [], shifts: [] };
  window.__composerShell = state;
  const text = (selector) => {
    const el = document.querySelector(selector);
    return el ? (el.textContent || "").trim() : null;
  };
  const sample = () => {
    const next = {
      t: performance.now(),
      model: text(${JSON.stringify(MODEL_TRIGGER)}),
      effort: text(${JSON.stringify(EFFORT_TRIGGER)}),
    };
    const last = state.samples[state.samples.length - 1];
    if (!last || last.model !== next.model || last.effort !== next.effort) {
      state.samples.push(next);
    }
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
  const toRect = (r) => ({ x: r.x, y: r.y, width: r.width, height: r.height });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      state.shifts.push({
        value: entry.value,
        hadRecentInput: entry.hadRecentInput,
        rects: (entry.sources || []).flatMap((s) => [
          toRect(s.previousRect),
          toRect(s.currentRect),
        ]),
      });
    }
  }).observe({ type: "layout-shift", buffered: true });
})();
`

function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  )
}

function countChanges(values: Array<string | null>): number {
  const firstIndex = values.findIndex((value) => value !== null)
  if (firstIndex < 0) return 0
  let changes = 0
  for (let index = firstIndex + 1; index < values.length; index += 1) {
    if (values[index] !== values[index - 1]) changes += 1
  }
  return changes
}

async function coldLoad(
  browser: Browser,
  baseUrl: string,
  state: StorageState
): Promise<RunResult> {
  const context = await browser.newContext({ storageState: state })
  const page = await context.newPage()
  try {
    await page.addInitScript(OBSERVER_INIT)
    await page.goto(`${baseUrl}/`, { waitUntil: "load" })
    await page.waitForTimeout(SETTLE_MS)
    const collected = await page.evaluate(
      ({ formSelector }) => {
        const state = (
          window as unknown as {
            __composerShell: { samples: Sample[]; shifts: Shift[] }
          }
        ).__composerShell
        const nav = performance.getEntriesByType(
          "navigation"
        )[0] as PerformanceNavigationTiming
        const form = document.querySelector(formSelector)?.closest("form")
        const rect = form?.getBoundingClientRect()
        return {
          samples: state.samples,
          shifts: state.shifts,
          ttfbMs: nav.responseStart - nav.requestStart,
          composerRect: rect
            ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
            : null,
        }
      },
      { formSelector: COMPOSER_FORM }
    )
    const { samples, shifts, composerRect } = collected
    const painted = samples.filter((sample) => sample.model !== null)
    const firstPaint = painted[0] ?? { model: null, effort: null }
    const final = samples[samples.length - 1] ?? { model: null, effort: null }
    const lastLabelChangeMs =
      painted.length > 1 ? painted[painted.length - 1]!.t : 0
    const unforced = shifts.filter((shift) => !shift.hadRecentInput)
    const composerCls = composerRect
      ? unforced
          .filter((shift) =>
            shift.rects.some((rect) => intersects(rect, composerRect))
          )
          .reduce((sum, shift) => sum + shift.value, 0)
      : Number.NaN
    return {
      ttfbMs: collected.ttfbMs,
      firstPaint: { model: firstPaint.model, effort: firstPaint.effort },
      final: { model: final.model, effort: final.effort },
      modelLabelChanges: countChanges(samples.map((sample) => sample.model)),
      effortLabelChanges: countChanges(samples.map((sample) => sample.effort)),
      lastLabelChangeMs,
      composerCls,
      pageCls: unforced.reduce((sum, shift) => sum + shift.value, 0),
      samples,
    }
  } finally {
    await context.close()
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2
}

async function main() {
  const externalBaseUrl = process.env.BASE_URL
  const baseUrl = externalBaseUrl ?? `http://localhost:${PERF_PORT}`
  if (!externalBaseUrl) {
    await assertPortFree(baseUrl)
    spawnServer()
    await waitForServer(baseUrl, 60000)
  }
  const browser = await chromium.launch({
    ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
  })
  try {
    const authState = await signIn(browser, baseUrl)
    const fixture = await saveFixtureSelection(browser, baseUrl, authState)
    const runs: RunResult[] = []
    for (let index = 0; index < RUNS; index += 1) {
      const run = await coldLoad(browser, baseUrl, fixture.state)
      runs.push(run)
      log(
        `run ${index + 1}/${RUNS}: first "${run.firstPaint.model}" / "${run.firstPaint.effort}" → final "${run.final.model}" / "${run.final.effort}", ` +
          `model changes ${run.modelLabelChanges}, effort changes ${run.effortLabelChanges} (last at ${run.lastLabelChangeMs.toFixed(0)}ms), ` +
          `composer CLS ${run.composerCls.toFixed(4)}, TTFB ${run.ttfbMs.toFixed(1)}ms`
      )
    }
    const summary = {
      dist: DIST_DIR,
      runs: RUNS,
      fixture: { model: fixture.model, effort: fixture.effort },
      firstPaint: runs[0]?.firstPaint,
      final: runs[0]?.final,
      modelLabelChangesMedian: median(runs.map((run) => run.modelLabelChanges)),
      modelLabelChangesMax: Math.max(
        ...runs.map((run) => run.modelLabelChanges)
      ),
      effortLabelChangesMedian: median(
        runs.map((run) => run.effortLabelChanges)
      ),
      effortLabelChangesMax: Math.max(
        ...runs.map((run) => run.effortLabelChanges)
      ),
      lastLabelChangeMaxMs: Math.max(
        ...runs.map((run) => run.lastLabelChangeMs)
      ),
      composerClsMedian: median(runs.map((run) => run.composerCls)),
      composerClsMax: Math.max(...runs.map((run) => run.composerCls)),
      pageClsMedian: median(runs.map((run) => run.pageCls)),
      ttfbMedianMs: median(runs.map((run) => run.ttfbMs)),
    }
    console.log("")
    console.log("| Metric | Value |")
    console.log("| --- | --- |")
    console.log(`| Dist | ${summary.dist} |`)
    console.log(`| Runs | ${summary.runs} |`)
    console.log(
      `| Saved selection | ${summary.fixture.model} / ${summary.fixture.effort} |`
    )
    console.log(
      `| First-paint labels (run 1) | ${summary.firstPaint?.model} / ${summary.firstPaint?.effort} |`
    )
    console.log(
      `| Final labels (run 1) | ${summary.final?.model} / ${summary.final?.effort} |`
    )
    console.log(
      `| Model label changes (median / max) | ${summary.modelLabelChangesMedian} / ${summary.modelLabelChangesMax} |`
    )
    console.log(
      `| Effort label changes (median / max) | ${summary.effortLabelChangesMedian} / ${summary.effortLabelChangesMax} |`
    )
    console.log(
      `| Last label change, max over runs | ${summary.lastLabelChangeMaxMs.toFixed(0)} ms after nav start (window: load + ${SETTLE_MS} ms) |`
    )
    console.log(
      `| Composer CLS (median / max) | ${summary.composerClsMedian.toFixed(4)} / ${summary.composerClsMax.toFixed(4)} |`
    )
    console.log(`| Page CLS (median) | ${summary.pageClsMedian.toFixed(4)} |`)
    console.log(`| TTFB median | ${summary.ttfbMedianMs.toFixed(1)} ms |`)
    if (process.env.OUT) {
      writeFileSync(process.env.OUT, JSON.stringify({ summary, runs }, null, 2))
      log(`wrote ${process.env.OUT}`)
    }
  } finally {
    await browser.close()
    stopServer()
  }
}

main().catch((error) => {
  stopServer()
  console.error(error)
  process.exit(1)
})
