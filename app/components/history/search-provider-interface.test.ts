import { describe, expect, it } from "vitest"
import { resolveSearchArgs } from "./search-provider-interface"

// The risky logic the plan calls out for commit 3: the search subscription must
// exist ONLY while the search UI is open AND a non-blank term is present, so the
// query never runs when the search UI is closed.
describe("resolveSearchArgs (search subscription lifecycle)", () => {
  it("skips while the search UI is closed, regardless of term", () => {
    expect(resolveSearchArgs(false, "weather")).toBe("skip")
    expect(resolveSearchArgs(false, "")).toBe("skip")
  })

  it("skips while open but the term is blank", () => {
    expect(resolveSearchArgs(true, "")).toBe("skip")
    expect(resolveSearchArgs(true, "   ")).toBe("skip")
  })

  it("subscribes with the trimmed term while open and non-blank", () => {
    expect(resolveSearchArgs(true, "weather")).toEqual({ term: "weather" })
    expect(resolveSearchArgs(true, "  weather  ")).toEqual({ term: "weather" })
  })
})
