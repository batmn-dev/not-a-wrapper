import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const chatSource = readFileSync(new URL("./chat.tsx", import.meta.url), "utf8")

describe("composer surface boundary", () => {
  it("keeps route surfaces from overriding shared control transitions", () => {
    expect(chatSource).not.toMatch(/\[&_(?:a|button)\]:transition-none/)
  })
})
