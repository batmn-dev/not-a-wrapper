import { describe, expect, it } from "vitest"
import { createLargePasteFixture } from "./fixtures/large-paste.fixture"
import {
  coordinateComposerPaste,
  LARGE_PASTE_CHARACTER_THRESHOLD,
} from "./large-paste-policy"

describe("coordinateComposerPaste", () => {
  it("keeps 9,999 characters inline at the current live boundary", () => {
    expect(
      coordinateComposerPaste({
        text: createLargePasteFixture(LARGE_PASTE_CHARACTER_THRESHOLD - 1),
        imageFiles: [],
        isAuthenticated: true,
      })
    ).toEqual({ type: "allow-native-text" })
  })

  it("creates a generated attachment at exactly 10,000 characters", () => {
    const text = createLargePasteFixture(LARGE_PASTE_CHARACTER_THRESHOLD)
    expect(
      coordinateComposerPaste({
        text,
        imageFiles: [],
        isAuthenticated: true,
      })
    ).toEqual({ type: "attach-large-paste", text })
  })

  it("keeps existing image paste behavior and rejects anonymous image paste accessibly", () => {
    const image = new File(["image"], "pasted.png", { type: "image/png" })
    expect(
      coordinateComposerPaste({
        text: "",
        imageFiles: [image],
        isAuthenticated: true,
      })
    ).toEqual({ type: "attach-images", files: [image] })
    expect(
      coordinateComposerPaste({
        text: "",
        imageFiles: [image],
        isAuthenticated: false,
      })
    ).toEqual({ type: "reject", message: "Sign in to paste images." })
  })
})
