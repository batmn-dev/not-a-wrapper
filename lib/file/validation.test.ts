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
  headerBuffer = new ArrayBuffer(16),
  slice,
}: {
  size?: number
  headerBuffer?: ArrayBuffer
  slice?: File["slice"]
} = {}): File {
  return {
    size,
    slice:
      slice ??
      (() =>
        ({
          arrayBuffer: async () => headerBuffer,
        }) as Blob),
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
    const slice = vi.fn() as unknown as File["slice"]
    const file = createTestFile({
      size: MAX_FILE_SIZE + 1,
      slice,
    })

    await expect(validateFile(file)).resolves.toEqual({
      isValid: false,
      error: "File size exceeds 10MB limit",
    })
    expect(slice).not.toHaveBeenCalled()
    expect(fileType.fileTypeFromBuffer).not.toHaveBeenCalled()
  })

  it("sniffs a browser-compatible Uint8Array header slice", async () => {
    const headerBuffer = new ArrayBuffer(4)
    new Uint8Array(headerBuffer).set([0x89, 0x50, 0x4e, 0x47])
    const sliceArrayBuffer = vi.fn(async () => headerBuffer)
    const slice = vi.fn(
      () =>
        ({
          arrayBuffer: sliceArrayBuffer,
        }) as unknown as Blob
    ) as unknown as File["slice"]
    vi.mocked(fileType.fileTypeFromBuffer).mockResolvedValue({
      ext: "png",
      mime: "image/png",
    })

    await expect(validateFile(createTestFile({ slice }))).resolves.toEqual({
      isValid: true,
    })

    expect(slice).toHaveBeenCalledWith(0, 4100)
    expect(sliceArrayBuffer).toHaveBeenCalledTimes(1)
    const [header] = vi.mocked(fileType.fileTypeFromBuffer).mock.calls[0] ?? []
    expect(header).toBeInstanceOf(Uint8Array)
    expect(header).toHaveLength(4)
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
