/**
 * Thread-switch flow (`SUITE=thread-switch`): sidebar row click → first
 * destination content observed across a DOM/frame opportunity, for chats the
 * document has not opened yet (unvisited: click, and hover-then-click) and
 * for chats it has (visited). Alongside each switch: the Convex query-set
 * `Add` count sent on the WebSocket, the commit-time cache hit/miss mark, and
 * a forced-GC JS heap sample at fixed switch counts so growth per switch is
 * visible.
 *
 * Fixtures: freshly seeded deterministic chats, including one long answer.
 * React navigation marks remain diagnostic breakdowns, separate from the browser observation.
 */
import {
  installChatUiObserver,
  type ChatUiWindow,
} from "@/lib/observability/chat-ui-observer"
import type { Browser, BrowserContext, CDPSession, Page } from "playwright"
import {
  readHeap,
  readMarks,
  tryWaitForMark,
  waitForAnyMark,
  type CollectedMark,
} from "./marks"
import {
  round2,
  summarize,
  type ThreadSwitchPassResult,
  type ThreadSwitchResult,
  type ThreadSwitchSample,
} from "./result-schema"

const ROW_SELECTOR = 'a[data-sidebar-item="true"][href^="/c/"]'
const TURN_ROW_SELECTOR = "section[data-turn-id]"
const CREATE_DIRECTIVE = "[[perf:short-prose:100:fixed]]"
const SWITCH_TIMEOUT_MS = 15_000
const SETTLE_AFTER_SWITCH_MS = 300

export type ThreadSwitchOptions = {
  chatCount: number
  switchCount: number
  hoverMs: number
  /** Fresh documents for the unvisited passes; the visited pass runs once. */
  documents: number
  heapSampleAt: number[]
  log: (message: string) => void
}

type SwitchSample = ThreadSwitchSample

type PassAccumulator = {
  kind: ThreadSwitchPassResult["kind"]
  samples: SwitchSample[]
}

function last(marks: CollectedMark[], name: string): CollectedMark | undefined {
  return marks.filter((mark) => mark.name === name).at(-1)
}

/**
 * Counts `Add` modifications in outgoing Convex `ModifyQuerySet` frames — one
 * per subscription the client opened. Frames are JSON text on the sync
 * socket; anything else is ignored.
 */
function installQuerySetCounter(page: Page): { adds: () => number } {
  let adds = 0
  page.on("websocket", (socket) => {
    socket.on("framesent", (frame) => {
      const payload = frame.payload
      if (typeof payload !== "string" || !payload.includes("ModifyQuerySet")) {
        return
      }
      try {
        const message = JSON.parse(payload) as {
          type?: string
          modifications?: Array<{ type?: string }>
        }
        if (message.type !== "ModifyQuerySet") return
        adds +=
          message.modifications?.filter((entry) => entry.type === "Add")
            .length ?? 0
      } catch {
        // Not a JSON frame.
      }
    })
  })
  return { adds: () => adds }
}

async function readRowHrefs(page: Page): Promise<string[]> {
  const hrefs = await page
    .locator(ROW_SELECTOR)
    .evaluateAll((anchors) =>
      anchors.map((anchor) => anchor.getAttribute("href") ?? "")
    )
  return [...new Set(hrefs.filter((href) => href.startsWith("/c/")))]
}

async function waitForRows(page: Page, count: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const hrefs = await readRowHrefs(page)
    if (hrefs.length >= count) return hrefs
    await page.waitForTimeout(100)
  }
  return readRowHrefs(page)
}

/** Sends one short deterministic turn from the home surface: a new durable chat. */
async function createChat(page: Page, baseUrl: string, long: boolean) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" })
  const editor = page.locator('[contenteditable="true"]').first()
  await editor.waitFor({ state: "visible", timeout: 15_000 })
  await editor.click()
  await page.keyboard.type(
    long ? "[[perf:long-markdown:100:fixed]]" : CREATE_DIRECTIVE
  )
  await page.locator('[data-testid="send-button"]').click()
  await page.waitForURL(/\/c\//, { timeout: 30_000 })
  // A turn that lost live-stream adoption emits only the receipt; one that
  // kept it emits the terminal first and settles after, so wait for that
  // settlement like the durable suite does (bounded: the receipt mark is not
  // guaranteed on every path) before the fixture is switched to.
  const first = await waitForAnyMark(
    page,
    ["stream_terminal", "durable_settlement_receipt"],
    60_000
  )
  if (first === "stream_terminal") {
    await tryWaitForMark(page, "durable_settlement_receipt", 15_000)
  }
  await page.waitForTimeout(1_000)
  return new URL(page.url()).pathname
}

async function ensureChats(
  page: Page,
  baseUrl: string,
  chatCount: number,
  log: ThreadSwitchOptions["log"]
): Promise<string[]> {
  const hrefs: string[] = []
  while (hrefs.length < chatCount) {
    log(`  fixtures: ${hrefs.length}/${chatCount} chats, creating one`)
    hrefs.push(await createChat(page, baseUrl, hrefs.length === 0))
  }
  return hrefs.slice(0, chatCount)
}

async function switchTo(
  page: Page,
  href: string,
  hoverMs: number,
  querySet: { adds: () => number }
): Promise<SwitchSample> {
  const paintedBefore = await page.evaluate(
    () =>
      (window as ChatUiWindow).__chatUiPerf?.values.threadSwitchToFrameMs
        ?.length ?? 0
  )
  const addsBefore = querySet.adds()
  const row = page
    .locator(`a[data-sidebar-item="true"][href="${href}"]`)
    .first()
  if (hoverMs > 0) {
    await row.hover()
    await page.waitForTimeout(hoverMs)
  }
  await row.click()

  const deadline = Date.now() + SWITCH_TIMEOUT_MS
  let painted = false
  while (Date.now() < deadline) {
    const count = await page.evaluate(
      () =>
        (window as ChatUiWindow).__chatUiPerf?.values.threadSwitchToFrameMs
          ?.length ?? 0
    )
    if (count > paintedBefore) {
      painted = true
      break
    }
    await page.waitForTimeout(20)
  }
  // Let the switch's subscription changes reach the socket before counting.
  await page.waitForTimeout(SETTLE_AFTER_SWITCH_MS)

  const marks = await readMarks(page)
  const intent = last(marks, "chat_navigation_intent")
  const committed = last(marks, "chat_route_state_committed")
  const firstContent = last(marks, "first_thread_content_painted")
  const paintedMark = last(marks, "nav_to_thread_painted")
  const cacheDetail = last(marks, "navigation_cache_hit_or_miss")?.detail?.cache
  const urlOk = new URL(page.url()).pathname === href
  const rows = await page.locator(TURN_ROW_SELECTOR).count()
  const ui = await page.evaluate(() => ({
    duration: (
      window as ChatUiWindow
    ).__chatUiPerf?.values.threadSwitchToFrameMs?.at(-1),
    hidden: (window as ChatUiWindow).__chatUiPerf?.hidden ?? true,
  }))

  let detail: string | undefined
  if (ui.hidden) detail = "tab became hidden"
  else if (!painted) detail = "destination DOM/frame observation missing"
  else if (!urlOk) detail = `url ${new URL(page.url()).pathname} != ${href}`
  else if (rows === 0) detail = "no message row rendered"

  return {
    navToPaintedMs: painted ? ui.duration : undefined,
    intentToCommitMs:
      intent && committed && committed.startTime >= intent.startTime
        ? round2(committed.startTime - intent.startTime)
        : undefined,
    commitToFirstContentMs:
      committed && firstContent && firstContent.startTime >= committed.startTime
        ? round2(firstContent.startTime - committed.startTime)
        : undefined,
    firstContentToPaintedMs:
      painted && firstContent && paintedMark
        ? round2(paintedMark.startTime - firstContent.startTime)
        : undefined,
    cache:
      cacheDetail === "hit" || cacheDetail === "miss" ? cacheDetail : undefined,
    querySetAdds: querySet.adds() - addsBefore,
    ok: detail === undefined,
    detail,
  }
}

async function sampleHeap(cdp: CDPSession): Promise<number | undefined> {
  // Forced GC first, so the sample reads retained state, not garbage.
  await cdp.send("HeapProfiler.collectGarbage").catch(() => undefined)
  return readHeap(cdp)
}

function summarizePass(pass: PassAccumulator): ThreadSwitchPassResult {
  const numeric = (pick: (sample: SwitchSample) => number | undefined) =>
    pass.samples
      .map(pick)
      .filter((value): value is number => Number.isFinite(value))
  return {
    kind: pass.kind,
    switches: pass.samples.length,
    samples: pass.samples,
    navToThreadPaintedMs: summarize(numeric((sample) => sample.navToPaintedMs)),
    intentToRouteCommitMs: summarize(
      numeric((sample) => sample.intentToCommitMs)
    ),
    commitToFirstContentMs: summarize(
      numeric((sample) => sample.commitToFirstContentMs)
    ),
    firstContentToPaintedMs: summarize(
      numeric((sample) => sample.firstContentToPaintedMs)
    ),
    cacheHits: pass.samples.filter((sample) => sample.cache === "hit").length,
    cacheMisses: pass.samples.filter((sample) => sample.cache === "miss")
      .length,
    querySetAddsPerSwitch: summarize(numeric((sample) => sample.querySetAdds)),
  }
}

export async function runThreadSwitch(
  browser: Browser,
  baseUrl: string,
  authState: Awaited<ReturnType<BrowserContext["storageState"]>>,
  options: ThreadSwitchOptions
): Promise<ThreadSwitchResult> {
  const { log } = options
  if (options.chatCount < 2) {
    // A same-row click is not a navigation, so the visited pass needs a
    // second chat to switch to.
    throw new Error("thread-switch needs THREAD_SWITCH_CHATS >= 2")
  }
  const context: BrowserContext = process.env.PERF_CDP_URL
    ? browser.contexts()[0]
    : await browser.newContext({
        viewport: { width: 1440, height: 900 },
        storageState: authState,
      })
  const passes: Record<ThreadSwitchPassResult["kind"], PassAccumulator> = {
    "unvisited-click": { kind: "unvisited-click", samples: [] },
    "unvisited-hover": { kind: "unvisited-hover", samples: [] },
    visited: { kind: "visited", samples: [] },
  }
  const heapSamples: ThreadSwitchResult["heapSamples"] = []
  const failures: string[] = []

  try {
    const fixturePage = await context.newPage()
    await fixturePage.bringToFront()
    const hrefs = await ensureChats(
      fixturePage,
      baseUrl,
      options.chatCount,
      log
    )
    await fixturePage.close()
    log(`  fixtures: ${hrefs.length} sidebar chats`)

    // Unvisited passes: each fresh document opens every chat exactly once —
    // half by plain click, half by hover-then-click.
    const half = Math.floor(hrefs.length / 2)
    for (let document = 0; document < options.documents; document++) {
      const page = await context.newPage()
      await page.addInitScript(installChatUiObserver)
      await page.bringToFront()
      const querySet = installQuerySetCounter(page)
      await page.goto(baseUrl, { waitUntil: "domcontentloaded" })
      await waitForRows(page, hrefs.length, 15_000)
      // Alternate which half is hovered so the row set does not bias a pass.
      const hoverFirst = document % 2 === 1
      for (let index = 0; index < hrefs.length; index++) {
        const hovered = hoverFirst ? index < half : index >= half
        const kind = hovered ? "unvisited-hover" : "unvisited-click"
        const sample = await switchTo(
          page,
          hrefs[index],
          hovered ? options.hoverMs : 0,
          querySet
        )
        passes[kind].samples.push(sample)
        if (!sample.ok) failures.push(`${kind} #${index}: ${sample.detail}`)
      }
      log(
        `  document ${document + 1}/${options.documents}: ${hrefs.length} unvisited switches`
      )
      await page.close()
    }

    // Visited pass: one document, every chat opened once, then
    // `switchCount` switches cycling through them with heap samples.
    const page = await context.newPage()
    await page.addInitScript(installChatUiObserver)
    await page.bringToFront()
    const cdp = await context.newCDPSession(page)
    await cdp.send("Performance.enable")
    await cdp.send("HeapProfiler.enable")
    const querySet = installQuerySetCounter(page)
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" })
    await waitForRows(page, hrefs.length, 15_000)
    for (const href of hrefs) {
      const sample = await switchTo(page, href, 0, querySet)
      if (!sample.ok) failures.push(`visited warmup: ${sample.detail}`)
    }
    const heapAtStart = await sampleHeap(cdp)
    if (heapAtStart !== undefined) {
      heapSamples.push({ switches: 0, jsHeapUsedBytes: heapAtStart })
    }
    for (
      let switchIndex = 1;
      switchIndex <= options.switchCount;
      switchIndex++
    ) {
      // Cycle from the first row: the warm-up left the LAST one open, so no
      // switch (the first included) clicks the row already selected, which
      // is not a navigation.
      const href = hrefs[(switchIndex - 1) % hrefs.length]
      const sample = await switchTo(page, href, 0, querySet)
      passes.visited.samples.push(sample)
      if (!sample.ok) failures.push(`visited #${switchIndex}: ${sample.detail}`)
      if (options.heapSampleAt.includes(switchIndex)) {
        const heap = await sampleHeap(cdp)
        if (heap !== undefined) {
          heapSamples.push({ switches: switchIndex, jsHeapUsedBytes: heap })
        }
      }
    }
    log(`  visited: ${options.switchCount} switches`)
    await page.close()
  } finally {
    if (!process.env.PERF_CDP_URL) await context.close()
  }

  return {
    chatCount: options.chatCount,
    switchCount: options.switchCount,
    hoverMs: options.hoverMs,
    documents: options.documents,
    passes: [
      summarizePass(passes["unvisited-click"]),
      summarizePass(passes["unvisited-hover"]),
      summarizePass(passes.visited),
    ],
    heapSamples,
    correctnessOk: failures.length === 0,
    ...(failures.length > 0 ? { detail: failures.slice(0, 5).join("; ") } : {}),
  }
}

export function formatThreadSwitch(result: ThreadSwitchResult): string[] {
  const lines = [
    `thread-switch: ${result.chatCount} chats, ${result.documents} documents, ${result.switchCount} visited switches, correctness=${result.correctnessOk ? "OK" : "FAILED"}`,
  ]
  for (const pass of result.passes) {
    const paint = pass.navToThreadPaintedMs
    lines.push(
      `  ${pass.kind.padEnd(16)} n=${paint.n} navToPainted p50=${paint.p50}ms p95=${paint.p95}ms max=${paint.max}ms ` +
        `(commit p50=${pass.intentToRouteCommitMs.p50}ms, commit→rows p50=${pass.commitToFirstContentMs.p50}ms, rows→painted p50=${pass.firstContentToPaintedMs.p50}ms) ` +
        `cache hit/miss=${pass.cacheHits}/${pass.cacheMisses} querySetAdds p50=${pass.querySetAddsPerSwitch.p50}`
    )
  }
  lines.push(
    `  heap (MB after GC): ${result.heapSamples
      .map(
        (sample) =>
          `@${sample.switches}=${round2(sample.jsHeapUsedBytes / 1024 / 1024)}`
      )
      .join(" ")}`
  )
  if (result.detail) lines.push(`  detail: ${result.detail}`)
  return lines
}
