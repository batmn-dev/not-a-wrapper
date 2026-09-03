import { chromium, type Browser } from "playwright"

const SYSTEM_CHROME = "/usr/local/bin/google-chrome"

/**
 * Prefers Playwright's `chrome` channel (Cloud Agent image + perf harness);
 * falls back to the system binary when the channel is not installed.
 */
export async function launchChrome(): Promise<Browser> {
  try {
    return await chromium.launch({ channel: "chrome", args: ["--no-sandbox"] })
  } catch {
    return await chromium.launch({
      executablePath: SYSTEM_CHROME,
      args: ["--no-sandbox"],
    })
  }
}
