import { validateFile } from "@/lib/file/validation"
import type { ConvexReactClient } from "convex/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { processFiles } from "./file-handling"

vi.mock("@/lib/file/validation", () => ({
  ACCEPTED_FILE_PICKER_TYPES: "",
  validateFile: vi.fn(),
}))

function createTestFile(name: string): File {
  return {
    name,
    size: 1024,
    type: "image/png",
  } as unknown as File
}

function createConvexClient(): ConvexReactClient {
  return {
    mutation: vi
      .fn()
      .mockResolvedValueOnce("https://uploads.example/file")
      .mockResolvedValueOnce(undefined),
    query: vi.fn().mockResolvedValue("https://files.example/good.png"),
  } as unknown as ConvexReactClient
}

describe("file handling", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("reports validation read failures per file and continues processing the batch", async () => {
    const unreadableFile = createTestFile("unreadable.png")
    const validFile = createTestFile("good.png")
    const convex = createConvexClient()
    const onValidationError = vi.fn()
    const onUploadError = vi.fn()
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ storageId: "storage-1" }),
    }))
    vi.stubGlobal("fetch", fetchMock)

    vi.mocked(validateFile)
      .mockRejectedValueOnce(new Error("file read failed"))
      .mockResolvedValueOnce({ isValid: true })

    const attachments = await processFiles(
      [unreadableFile, validFile],
      "chat-1",
      convex,
      {
        onValidationError,
        onUploadError,
      }
    )

    expect(validateFile).toHaveBeenCalledTimes(2)
    expect(onValidationError).toHaveBeenCalledWith({
      file: unreadableFile,
      validation: {
        isValid: false,
        error: "Failed to read file for validation",
      },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onUploadError).not.toHaveBeenCalled()
    expect(attachments).toEqual([
      {
        name: "good.png",
        contentType: "image/png",
        url: "https://files.example/good.png",
      },
    ])
  })
})
