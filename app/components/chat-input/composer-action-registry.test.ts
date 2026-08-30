import { describe, expect, it } from "vitest"
import { RiAttachmentLine, RiGlobalLine } from "@remixicon/react"
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
      description: "Find real-time news and info",
      icon: RiGlobalLine,
      iconClassName: "text-[var(--web-search-icon-foreground)]",
      keywords: expect.arrayContaining(["internet", "search"]),
      label: "Web search",
    })
    expect(getComposerAction("add-files")).toMatchObject({
      description: "Upload from computer",
      icon: RiAttachmentLine,
      label: "Add photos & files",
    })
  })

  it("returns the default @ actions and filters their searchable text", () => {
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

  it("matches multi-word queries as one ordered substring", () => {
    expect(
      getComposerActionQueryMatches("add photos").map(({ id }) => id)
    ).toEqual(["add-files"])
    expect(
      getComposerActionQueryMatches("ADD PHOTOS").map(({ id }) => id)
    ).toEqual(["add-files"])
    expect(
      getComposerActionQueryMatches("files upload").map(({ id }) => id)
    ).toEqual(["add-files"])
    expect(getComposerActionQueryMatches("photos add")).toEqual([])
  })
})
