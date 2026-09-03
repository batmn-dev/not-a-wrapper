#!/usr/bin/env bun
/**
 * QA capture helper — deterministic UI screenshots and video for review.
 *
 * Drives the installed Google Chrome through Playwright (the same
 * `channel: "chrome"` path the perf harness uses) and writes artifacts to
 * /opt/cursor/artifacts, where Cloud Agents auto-upload them for the user.
 * Use it for before/after visual QA and short end-to-end demo clips without
 * hijacking a desktop session.
 *
 * Screenshot:
 *   bun scripts/qa-capture.ts screenshot --url http://localhost:3000 --name home_before
 *   bun scripts/qa-capture.ts screenshot --url http://localhost:3000 --name home_after --full-page
 *
 * Video (records until --duration-ms elapses, after an optional --wait-for):
 *   bun scripts/qa-capture.ts video --url http://localhost:3000 --name home_demo --duration-ms 6000
 *
 * Options:
 *   --url <url>            Required. Page to open.
 *   --name <name>          Required. Artifact base name (extension added if missing).
 *   --viewport <WxH>       Default 1280x800.
 *   --wait-for <selector>  Wait for this selector before capturing.
 *   --wait-ms <n>          Extra settle time. Default 1500 (screenshot).
 *   --duration-ms <n>      Recording length for video. Default 5000.
 *   --full-page            Screenshot the full scrollable page.
 *   --out-dir <dir>        Default /opt/cursor/artifacts.
 *   --auth                 Log in via /auth/login before capturing (needs
 *                          PERF_AUTH_PASSWORD; see scripts/lib/agent-auth.ts).
 *   --storage-state <file> Load a saved session instead of logging in
 *                          (e.g. the file written by `bun run agent:login`).
 *
 * Capturing the real app needs it running (bun run dev) with the usual
 * secrets; any reachable URL works for pure UI capture.
 */
import { mkdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { parseArgs } from "node:util"
import { chromium, type Browser, type Page } from "playwright"
import { signInWithPassword } from "./lib/agent-auth"

const DEFAULT_OUT_DIR = "/opt/cursor/artifacts"
const SYSTEM_CHROME = "/usr/local/bin/google-chrome"

type Viewport = { width: number; height: number }

function fail(message: string): never {
  console.error(`qa-capture: ${message}`)
  process.exit(1)
}

function parseViewport(value: string | undefined): Viewport {
  if (!value) return { width: 1280, height: 800 }
  const match = /^(\d+)x(\d+)$/.exec(value.trim())
  if (!match) fail(`--viewport must look like 1280x800, got "${value}"`)
  return { width: Number(match[1]), height: Number(match[2]) }
}

/** Adds the extension only when the caller didn't already provide it. */
function withExtension(name: string, extension: `.${string}`): string {
  const base = path.basename(name.trim())
  if (!base) fail("--name must not be empty")
  return base.endsWith(extension) ? base : `${base}${extension}`
}

/**
 * Prefers the installed Chrome (present in the Cloud Agent image, and the
 * channel the perf harness standardizes on); falls back to its explicit path.
 */
async function launchChrome(): Promise<Browser> {
  try {
    return await chromium.launch({ channel: "chrome", args: ["--no-sandbox"] })
  } catch {
    return await chromium.launch({
      executablePath: SYSTEM_CHROME,
      args: ["--no-sandbox"],
    })
  }
}

type CommonOptions = {
  url: string
  name: string
  viewport: Viewport
  waitFor?: string
  outDir: string
  auth: boolean
  storageState?: string
}

async function settle(
  page: Page,
  waitFor: string | undefined,
  waitMs: number
): Promise<void> {
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 30_000 })
  if (waitMs > 0) await page.waitForTimeout(waitMs)
}

/** Interactive login when --auth is set and no saved session is loaded. */
async function maybeSignIn(page: Page, options: CommonOptions): Promise<void> {
  if (options.auth && !options.storageState) {
    await signInWithPassword(page, new URL(options.url).origin)
  }
}

async function captureScreenshot(
  options: CommonOptions & { fullPage: boolean; waitMs: number }
): Promise<string> {
  const target = path.join(options.outDir, withExtension(options.name, ".png"))
  const browser = await launchChrome()
  try {
    const context = await browser.newContext({
      viewport: options.viewport,
      ...(options.storageState ? { storageState: options.storageState } : {}),
    })
    const page = await context.newPage()
    await maybeSignIn(page, options)
    // domcontentloaded, not networkidle: the app holds a live Convex
    // WebSocket, so the network never goes idle. settle() gates readiness.
    await page.goto(options.url, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    })
    await settle(page, options.waitFor, options.waitMs)
    await page.screenshot({ path: target, fullPage: options.fullPage })
  } finally {
    await browser.close()
  }
  return target
}

async function captureVideo(
  options: CommonOptions & { durationMs: number }
): Promise<string> {
  const target = path.join(options.outDir, withExtension(options.name, ".webm"))
  const browser = await launchChrome()
  // Playwright names the file itself; record into a temp dir, then copy the
  // finished clip (available after context close) to the requested name.
  const scratch = path.join(os.tmpdir(), `qa-video-${process.pid}`)
  await mkdir(scratch, { recursive: true })
  try {
    const context = await browser.newContext({
      viewport: options.viewport,
      recordVideo: { dir: scratch, size: options.viewport },
      ...(options.storageState ? { storageState: options.storageState } : {}),
    })
    const page = await context.newPage()
    await maybeSignIn(page, options)
    // domcontentloaded, not networkidle (live Convex WebSocket never idles).
    await page.goto(options.url, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    })
    await settle(page, options.waitFor, 0)
    await page.waitForTimeout(options.durationMs)
    const video = page.video()
    await context.close()
    if (!video) fail("no video was recorded")
    // saveAs copies across filesystems and waits until the clip is flushed.
    await video.saveAs(target)
  } finally {
    await browser.close()
    await rm(scratch, { recursive: true, force: true })
  }
  return target
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      url: { type: "string" },
      name: { type: "string" },
      viewport: { type: "string" },
      "wait-for": { type: "string" },
      "wait-ms": { type: "string" },
      "duration-ms": { type: "string" },
      "full-page": { type: "boolean", default: false },
      "out-dir": { type: "string", default: DEFAULT_OUT_DIR },
      auth: { type: "boolean", default: false },
      "storage-state": { type: "string" },
    },
  })

  const command = positionals[0]
  if (command !== "screenshot" && command !== "video") {
    fail(`expected "screenshot" or "video" as the first argument`)
  }
  if (!values.url) fail("--url is required")
  if (!values.name) fail("--name is required")

  const outDir = values["out-dir"] ?? DEFAULT_OUT_DIR
  await mkdir(outDir, { recursive: true })

  const common: CommonOptions = {
    url: values.url,
    name: values.name,
    viewport: parseViewport(values.viewport),
    waitFor: values["wait-for"],
    outDir,
    auth: values.auth ?? false,
    storageState: values["storage-state"],
  }

  const written =
    command === "screenshot"
      ? await captureScreenshot({
          ...common,
          fullPage: values["full-page"] ?? false,
          waitMs: values["wait-ms"] ? Number(values["wait-ms"]) : 1500,
        })
      : await captureVideo({
          ...common,
          durationMs: values["duration-ms"]
            ? Number(values["duration-ms"])
            : 5000,
        })

  console.log(`qa-capture: wrote ${written}`)
}

void main()
