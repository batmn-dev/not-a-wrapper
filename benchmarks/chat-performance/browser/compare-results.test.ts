import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

function scenario(
  name = "text-only",
  metrics: Record<string, { p50: number }> = {}
) {
  return {
    scenario: name,
    action: "complete",
    viewport: "desktop",
    cpuThrottle: 1,
    correctnessOk: true,
    metrics,
  }
}

function compare(
  baselineScenarios: ReturnType<typeof scenario>[],
  currentScenarios: ReturnType<typeof scenario>[]
) {
  const directory = mkdtempSync(join(tmpdir(), "chat-perf-comparison-"))
  const baselinePath = join(directory, "baseline.json")
  const currentPath = join(directory, "current.json")

  try {
    writeFileSync(
      baselinePath,
      JSON.stringify({ schemaVersion: 1, scenarios: baselineScenarios })
    )
    writeFileSync(
      currentPath,
      JSON.stringify({ schemaVersion: 1, scenarios: currentScenarios })
    )

    return spawnSync(
      "bun",
      [
        "run",
        "benchmarks/chat-performance/browser/compare-results.ts",
        baselinePath,
        currentPath,
      ],
      { encoding: "utf8" }
    )
  } finally {
    rmSync(directory, { recursive: true })
  }
}

describe("browser benchmark comparison", () => {
  it("rejects current results that omit a baseline scenario", () => {
    const result = compare([scenario()], [])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      "baseline scenario(s) missing from current results: text-only/complete/desktop/x1"
    )
  })

  it("rejects a missing current p50 that exists in the baseline", () => {
    const result = compare(
      [scenario("text-only", { sendToFirstVisibleTextMs: { p50: 100 } })],
      [scenario()]
    )

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      "baseline metric p50(s) missing from current results: text-only/complete/desktop/x1 sendToFirstVisibleTextMs"
    )
  })

  it("continues to skip new current scenarios without a baseline", () => {
    const result = compare([scenario()], [scenario(), scenario("new-scenario")])

    expect(result.status).toBe(0)
    expect(result.stdout).toContain(
      "new-scenario/complete/desktop/x1: not in baseline — skipped"
    )
  })
})
