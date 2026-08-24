import { describe, expect, it } from "vitest"
import {
  composerActionRegistry,
  getComposerAction,
  getComposerActionQueryMatches,
} from "./composer-action-registry"

describe("Composer action registry", () => {
  it("owns unique searchable action definitions", () => {
    expect(composerActionRegistry.map(({ id }) => id)).toEqual([
      "add-files",
      "web-search",
    ])
    expect(new Set(composerActionRegistry.map(({ id }) => id)).size).toBe(
      composerActionRegistry.length
    )
    expect(getComposerAction("web-search")).toMatchObject({
      behavior: "toggle",
      compactLabel: "Web search",
      description: "Find real-time news and info",
      keywords: expect.arrayContaining(["internet", "search"]),
      label: "Web search",
    })
    expect(getComposerAction("add-files")).toMatchObject({
      compactLabel: "Files",
      description: "Upload from computer",
      label: "Add photos & files",
    })
  })

  it("matches ChatGPT's @ action discovery defaults and filtering", () => {
    expect(getComposerActionQueryMatches("").map(({ id }) => id)).toEqual([
      "add-files",
      "web-search",
    ])
    expect(getComposerActionQueryMatches("w").map(({ id }) => id)).toEqual([
      "web-search",
    ])
    expect(getComposerActionQueryMatches("upload").map(({ id }) => id)).toEqual(
      ["add-files"]
    )
    expect(getComposerActionQueryMatches("zzzzzzzz")).toEqual([])
  })
})
