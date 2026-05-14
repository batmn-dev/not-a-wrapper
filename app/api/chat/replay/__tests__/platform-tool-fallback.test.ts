import { describe, expect, it } from "vitest"
import { synthesizePlatformToolFallback } from "../compilers/platform-tool-fallback"
import type { ReplayToolExchange } from "../types"

describe("synthesizePlatformToolFallback", () => {
  it("does not claim in-progress when terminal state is unknown", () => {
    const tool: ReplayToolExchange = {
      toolName: "pay_status",
      replayable: false,
      platformToolContext: {
        toolKey: "pay_status",
        jobId: "job_unknown_terminal",
        status: "processing",
        isTerminal: undefined,
      },
    }

    const fallback = synthesizePlatformToolFallback(tool)

    expect(fallback).toContain("Replay context: Purchase status check")
    expect(fallback).toContain("job_unknown_terminal")
    expect(fallback).toContain(": processing")
    expect(fallback).not.toContain("(in progress)")
    expect(fallback).not.toContain("(completed)")
  })
})
