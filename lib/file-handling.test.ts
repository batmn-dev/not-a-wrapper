import { validateFile } from "@/lib/file/validation"
import type { ConvexReactClient } from "convex/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  FileUploadLimitError,
  processFiles,
  uploadStagedFile,
} from "./file-handling"

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
      .mockResolvedValueOnce("attachment-1")
      .mockResolvedValueOnce([
        {
          name: "good.png",
          contentType: "image/png",
          url: "https://files.example/good.png",
          attachmentId: "attachment-1",
        },
      ]),
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
    const send = vi.fn()
    class MockXMLHttpRequest extends EventTarget {
      status = 200
      response = { storageId: "storage-1" }
      responseType = ""
      upload = new EventTarget()
      open = vi.fn()
      setRequestHeader = vi.fn()
      abort = vi.fn(() => this.dispatchEvent(new Event("abort")))
      send = vi.fn((body: unknown) => {
        send(body)
        this.dispatchEvent(new Event("load"))
      })
    }
    vi.stubGlobal("XMLHttpRequest", MockXMLHttpRequest)

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
    expect(send).toHaveBeenCalledTimes(1)
    expect(onUploadError).not.toHaveBeenCalled()
    expect(attachments).toEqual([
      {
        name: "good.png",
        contentType: "image/png",
        url: "https://files.example/good.png",
        attachmentId: "attachment-1",
      },
    ])
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
