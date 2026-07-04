/** @vitest-environment jsdom */

import { toast } from "@/components/ui/toast"
import { checkFileUploadLimit, processFiles } from "@/lib/file-handling"
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { uploadFiles, useFileUpload } from "./use-file-upload"

vi.mock("@/components/ui/toast", () => ({
  toast: vi.fn(),
}))

vi.mock("@/lib/file-handling", () => ({
  checkFileUploadLimit: vi.fn(),
  processFiles: vi.fn(),
}))

const mockCheckFileUploadLimit = vi.mocked(checkFileUploadLimit)
const mockProcessFiles = vi.mocked(processFiles)

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

function createTestFile(name: string): File {
  return {
    name,
    size: 1024,
    type: "text/plain",
  } as unknown as File
}

describe("uploadFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("stops uploads when the daily file limit is reached", async () => {
    const limitError = {
      code: "DAILY_FILE_LIMIT_REACHED",
      message: "Daily file upload limit reached.",
    }
    mockCheckFileUploadLimit.mockRejectedValueOnce(limitError)

    const result = await uploadFiles(
      {} as Parameters<typeof uploadFiles>[0],
      [createTestFile("notes.txt")],
      "chat-1"
    )

    expect(result).toBeNull()
    expect(toast).toHaveBeenCalledWith({
      title: "Daily file upload limit reached.",
      status: "error",
    })
    expect(mockProcessFiles).not.toHaveBeenCalled()
  })

  it("logs unexpected limit check failures and continues to server-enforced upload", async () => {
    const convex = {} as Parameters<typeof uploadFiles>[0]
    const files = [createTestFile("notes.txt")]
    const unexpectedError = new Error("network failed")
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const attachments = [
      {
        name: "notes.txt",
        contentType: "text/plain",
        url: "https://files.example/notes.txt",
        attachmentId: "attachment-1",
      },
    ]

    mockCheckFileUploadLimit.mockRejectedValueOnce(unexpectedError)
    mockProcessFiles.mockResolvedValueOnce(attachments)

    const result = await uploadFiles(convex, files, "chat-1")

    expect(result).toEqual(attachments)
    expect(consoleWarn).toHaveBeenCalledWith(
      "File upload limit check failed; continuing with server-side enforcement:",
      unexpectedError
    )
    expect(mockProcessFiles).toHaveBeenCalledWith(files, "chat-1", convex, {
      onValidationError: expect.any(Function),
      onUploadError: expect.any(Function),
    })
    expect(toast).not.toHaveBeenCalled()
  })
})

describe("useFileUpload", () => {
  type FileUploadControls = ReturnType<typeof useFileUpload>

  let container: HTMLDivElement | null = null
  let root: Root | null = null
  let hookRef: React.RefObject<FileUploadControls | null> | null = null

  const Harness = React.forwardRef<FileUploadControls>(
    function Harness(_props, ref) {
      const fileUpload = useFileUpload()
      React.useImperativeHandle(ref, () => fileUpload, [fileUpload])
      return null
    }
  )

  function renderHook() {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    hookRef = React.createRef<FileUploadControls>()
    act(() => {
      root?.render(React.createElement(Harness, { ref: hookRef }))
    })
  }

  function controls() {
    expect(hookRef?.current).not.toBeNull()
    return hookRef!.current!
  }

  beforeEach(() => {
    renderHook()
  })

  afterEach(() => {
    const mountedRoot = root
    if (mountedRoot) {
      act(() => {
        mountedRoot.unmount()
      })
    }
    container?.remove()
    container = null
    root = null
    hookRef = null
  })

  it("restores submitted files when attachment state is untouched after clear", () => {
    const submitted = createTestFile("submitted.txt")
    let restoreToken = 0

    act(() => {
      controls().handleFileUpload([submitted])
    })
    expect(controls().files).toEqual([submitted])

    act(() => {
      restoreToken = controls().clearFiles()
    })
    expect(controls().files).toEqual([])

    act(() => {
      controls().restoreFiles([submitted], restoreToken)
    })

    expect(controls().files).toEqual([submitted])
  })

  it("does not restore stale files when in-flight attachment edits end empty", () => {
    const submitted = createTestFile("submitted.txt")
    const newFile = createTestFile("new.txt")
    let restoreToken = 0

    act(() => {
      controls().handleFileUpload([submitted])
    })
    act(() => {
      restoreToken = controls().clearFiles()
    })
    act(() => {
      controls().handleFileUpload([newFile])
    })
    expect(controls().files).toEqual([newFile])

    act(() => {
      controls().handleFileRemove(newFile)
    })
    expect(controls().files).toEqual([])

    act(() => {
      controls().restoreFiles([submitted], restoreToken)
    })

    expect(controls().files).toEqual([])
  })
})
