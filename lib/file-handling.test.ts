import type { ConvexReactClient } from "convex/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { FileUploadLimitError, uploadStagedFile } from "./file-handling"

function createTestFile(name: string): File {
  return {
    name,
    size: 1024,
    type: "image/png",
  } as unknown as File
}

describe("file handling", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("turns an upload URL quota denial into a client-side limit error", async () => {
    const convex = {
      mutation: vi.fn().mockResolvedValue(null),
    } as unknown as ConvexReactClient

    await expect(
      uploadStagedFile(convex, createTestFile("over-limit.png"))
    ).rejects.toBeInstanceOf(FileUploadLimitError)
  })

  it("turns a staged attachment quota race into a client-side limit error", async () => {
    const convex = {
      mutation: vi
        .fn()
        .mockResolvedValueOnce("https://uploads.example/file")
        .mockResolvedValueOnce(null),
    } as unknown as ConvexReactClient
    class MockXMLHttpRequest extends EventTarget {
      status = 200
      response = { storageId: "storage-1" }
      responseType = ""
      upload = new EventTarget()
      open = vi.fn()
      setRequestHeader = vi.fn()
      abort = vi.fn(() => this.dispatchEvent(new Event("abort")))
      send = vi.fn(() => this.dispatchEvent(new Event("load")))
    }
    vi.stubGlobal("XMLHttpRequest", MockXMLHttpRequest)

    await expect(
      uploadStagedFile(convex, createTestFile("raced.png"))
    ).rejects.toBeInstanceOf(FileUploadLimitError)
  })
})
