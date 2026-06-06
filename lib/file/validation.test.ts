import * as fileType from "file-type"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  ACCEPTED_FILE_PICKER_TYPES,
  MAX_FILE_SIZE,
  validateFile,
} from "./validation"

vi.mock("file-type", () => ({
  fileTypeFromBuffer: vi.fn(),
}))

function createTestFile({
  size = 1024,
  arrayBuffer = vi.fn(async () => new ArrayBuffer(16)),
}: {
  size?: number
  arrayBuffer?: () => Promise<ArrayBuffer>
} = {}): File {
  return {
    size,
    arrayBuffer,
  } as unknown as File
}

describe("file validation", () => {
  beforeEach(() => {
    vi.mocked(fileType.fileTypeFromBuffer).mockReset()
  })

  it("keeps file picker accept types in sync with MIME types and extensions", () => {
    expect(ACCEPTED_FILE_PICKER_TYPES).toContain("image/png")
    expect(ACCEPTED_FILE_PICKER_TYPES).toContain(".png")
    expect(ACCEPTED_FILE_PICKER_TYPES).toContain("application/pdf")
    expect(ACCEPTED_FILE_PICKER_TYPES).toContain(".pdf")
  })

  it("rejects files larger than the existing 10MB limit before reading bytes", async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(16))
    const file = createTestFile({
      size: MAX_FILE_SIZE + 1,
      arrayBuffer,
    })

    await expect(validateFile(file)).resolves.toEqual({
      isValid: false,
      error: "File size exceeds 10MB limit",
    })
    expect(arrayBuffer).not.toHaveBeenCalled()
    expect(fileType.fileTypeFromBuffer).not.toHaveBeenCalled()
  })

  it("rejects unsupported or undetectable file types with the existing message", async () => {
    vi.mocked(fileType.fileTypeFromBuffer).mockResolvedValue(undefined)

    await expect(validateFile(createTestFile())).resolves.toEqual({
      isValid: false,
      error: "File type not supported or doesn't match its extension",
    })
  })

  it("accepts detected MIME types from the allowed list", async () => {
    vi.mocked(fileType.fileTypeFromBuffer).mockResolvedValue({
      ext: "png",
      mime: "image/png",
    })

    await expect(validateFile(createTestFile())).resolves.toEqual({
      isValid: true,
    })
  })
})
