import { describe, expect, it } from "vitest"
import {
  parseComposerShellHint,
  serializeComposerShellHint,
} from "./composer-shell-hint"

const GEMMA = "openrouter:google/gemma-4-26b-a4b-it:free"

describe("parseComposerShellHint", () => {
  it("round-trips a catalog model with an offered level and drops what it cannot render", () => {
    expect(
      parseComposerShellHint(
        serializeComposerShellHint({ modelId: GEMMA, effort: "high" })
      )
    ).toEqual({ modelId: GEMMA, effort: "high" })
    // Already URL-decoded (next/headers) parses the same.
    expect(parseComposerShellHint(`{"m":"${GEMMA}"}`)).toEqual({
      modelId: GEMMA,
    })

    // A forged or stale cookie can never paint an invalid label.
    expect(parseComposerShellHint(`{"m":"not-a-model","e":"high"}`)).toBeNull()
    expect(parseComposerShellHint(`{"m":"${GEMMA}","e":"max"}`)).toEqual({
      modelId: GEMMA,
    })
    expect(parseComposerShellHint(`{"m":"${GEMMA}","e":"turbo"}`)).toEqual({
      modelId: GEMMA,
    })
    expect(parseComposerShellHint("not json")).toBeNull()
    expect(parseComposerShellHint(undefined)).toBeNull()
  })
})
