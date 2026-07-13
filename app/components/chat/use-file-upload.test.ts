/** @vitest-environment jsdom */

import { toast } from "@/components/ui/toast"
import {
  checkFileUploadLimit,
  deleteUploadedAttachment,
  uploadStagedFile,
  type UploadFileOptions,
} from "@/lib/file-handling"
import { validateFile } from "@/lib/file/validation"
import type { ConvexReactClient } from "convex/react"
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
import { useFilePickerState } from "./use-file-upload"

vi.mock("@/components/ui/toast", () => ({ toast: vi.fn() }))
vi.mock("@/lib/file/validation", () => ({ validateFile: vi.fn() }))
vi.mock("@/lib/file-handling", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/file-handling")>()
  return {
    ...actual,
    checkFileUploadLimit: vi.fn(),
    uploadStagedFile: vi.fn(),
    deleteUploadedAttachment: vi.fn(),
  }
})

type Picker = ReturnType<typeof useFilePickerState>
type UploadCall = {
  file: File
  options: UploadFileOptions
  resolve: (value: { fileUrl: string; attachmentId: string }) => void
  reject: (error: unknown) => void
}

const convex = {} as ConvexReactClient
const uploadCalls: UploadCall[] = []

function file(name: string, body = name, lastModified = 1) {
  return new File([body], name, { type: "text/plain", lastModified })
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

describe("useFilePickerState immediate upload lifecycle", () => {
  let container: HTMLDivElement
  let root: Root
  let ref: React.RefObject<Picker | null>

  const Harness = React.forwardRef<Picker>(
    function Harness(_props, forwardedRef) {
      const picker = useFilePickerState({ convex, uploadGeneratedPastes: true })
      React.useImperativeHandle(forwardedRef, () => picker, [picker])
      return null
    }
  )

  function controls() {
    return ref.current!
  }

  beforeEach(() => {
    vi.clearAllMocks()
    uploadCalls.length = 0
    vi.mocked(checkFileUploadLimit).mockResolvedValue({
      count: 0,
      limit: 5,
      canUpload: true,
    })
    vi.mocked(validateFile).mockResolvedValue({ isValid: true })
    vi.mocked(uploadStagedFile).mockImplementation(
      (_convex, nextFile, options = {}) =>
        new Promise((resolve, reject) => {
          uploadCalls.push({ file: nextFile, options, resolve, reject })
        })
    )

    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    ref = React.createRef<Picker>()
    act(() => root.render(React.createElement(Harness, { ref })))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it("starts on selection, reports real progress, and promotes the same stable item", async () => {
    const selected = file("notes.txt")
    act(() => controls().handleFileUpload([selected]))
    await flush()

    expect(uploadCalls).toHaveLength(1)
    const id = controls().attachments[0]?.id
    expect(controls().attachments[0]).toMatchObject({
      status: "uploading",
      file: selected,
    })

    act(() =>
      uploadCalls[0]?.options.onProgress?.({
        loaded: 5,
        total: 10,
        percent: 50,
      })
    )
    expect(controls().attachments[0]).toMatchObject({
      id,
      status: "uploading",
      progress: 50,
    })

    await act(async () => {
      uploadCalls[0]?.resolve({
        fileUrl: "/api/files/a/preview",
        attachmentId: "a",
      })
      await Promise.resolve()
    })
    expect(controls().attachments[0]).toMatchObject({
      id,
      status: "ready",
      uploaded: { attachmentId: "a" },
    })
  })

  it("keeps selection order when uploads finish out of order", async () => {
    act(() => controls().handleFileUpload([file("one.txt"), file("two.txt")]))
    await flush()
    const ids = controls().attachments.map((attachment) => attachment.id)

    await act(async () => {
      uploadCalls[1]?.resolve({ fileUrl: "/two", attachmentId: "two" })
      await Promise.resolve()
    })
    await act(async () => {
      uploadCalls[0]?.resolve({ fileUrl: "/one", attachmentId: "one" })
      await Promise.resolve()
    })
    expect(controls().attachments.map((attachment) => attachment.id)).toEqual(
      ids
    )
  })

  it("fails and retries only the affected file", async () => {
    act(() => controls().handleFileUpload([file("retry.txt")]))
    await flush()
    await act(async () => {
      uploadCalls[0]?.reject(new Error("offline"))
      await Promise.resolve()
    })
    const failed = controls().attachments[0]!
    expect(failed).toMatchObject({
      status: "failed",
      error: "offline",
      attemptId: 1,
    })

    act(() => controls().retryAttachment(failed))
    expect(controls().attachments[0]).toMatchObject({
      status: "uploading",
      attemptId: 2,
    })
    expect(uploadCalls).toHaveLength(2)
  })

  it("shows a clean non-retryable failure when the server reports the daily quota", async () => {
    act(() => controls().handleFileUpload([file("over-limit.txt")]))
    await flush()
    await act(async () => {
      uploadCalls[0]?.reject(
        new Error(
          "[CONVEX M(files:generateUploadUrl)] Server Error\nUncaught Error: Daily file upload limit reached (5 files per day)"
        )
      )
      await Promise.resolve()
    })

    const failed = controls().attachments[0]!
    expect(failed).toMatchObject({
      status: "failed",
      error: "Daily file upload limit reached.",
      retryable: false,
    })
    expect(toast).toHaveBeenCalledWith({
      title: "Daily file upload limit reached.",
      status: "error",
    })

    act(() => controls().retryAttachment(failed))
    expect(uploadCalls).toHaveLength(1)
  })

  it("cancels removal and deletes a completion that arrives stale", async () => {
    act(() => controls().handleFileUpload([file("cancel.txt")]))
    await flush()
    const pending = controls().attachments[0]!
    act(() => controls().handleFileRemove(pending))
    expect(uploadCalls[0]?.options.signal?.aborted).toBe(true)
    expect(controls().attachments).toEqual([])

    await act(async () => {
      uploadCalls[0]?.resolve({ fileUrl: "/stale", attachmentId: "stale" })
      await Promise.resolve()
    })
    expect(deleteUploadedAttachment).toHaveBeenCalledWith(convex, "stale")
    expect(controls().attachments).toEqual([])
  })

  it("locks a submitted attachment against removal until dispatch settles", async () => {
    act(() => controls().handleFileUpload([file("sent.txt")]))
    await flush()
    await act(async () => {
      uploadCalls[0]?.resolve({ fileUrl: "/sent", attachmentId: "sent" })
      await Promise.resolve()
    })
    const ready = controls().attachments[0]!

    act(() => {
      expect(controls().lockAttachments([ready.id])).toBe(true)
    })
    expect(controls().lockedAttachmentIds.has(ready.id)).toBe(true)
    expect(controls().handleFileRemove(ready)).toBe(false)
    expect(controls().attachments).toEqual([ready])
    expect(deleteUploadedAttachment).not.toHaveBeenCalled()

    act(() => controls().unlockAttachments([ready.id]))
    expect(controls().lockedAttachmentIds.has(ready.id)).toBe(false)
    act(() => {
      expect(controls().handleFileRemove(ready)).toBe(true)
    })
    expect(deleteUploadedAttachment).toHaveBeenCalledWith(convex, "sent")
    expect(controls().attachments).toEqual([])
  })

  it("rejects an exact metadata duplicate but accepts the same filename with different contents", async () => {
    const original = file("same.txt", "a", 10)
    act(() => controls().handleFileUpload([original]))
    await flush()

    act(() => controls().handleFileUpload([file("same.txt", "a", 10)]))
    await flush()
    expect(uploadCalls).toHaveLength(1)
    expect(controls().announcement).toContain("already attached")

    act(() => controls().handleFileUpload([file("same.txt", "different", 11)]))
    await flush()
    expect(uploadCalls).toHaveLength(2)
  })

  it("rejects validation and daily capacity before enqueueing", async () => {
    vi.mocked(validateFile).mockResolvedValueOnce({
      isValid: false,
      error: "bad type",
    })
    act(() => controls().handleFileUpload([file("bad.txt")]))
    await flush()
    expect(controls().attachments).toEqual([])
    expect(uploadCalls).toEqual([])

    vi.mocked(checkFileUploadLimit).mockResolvedValueOnce({
      count: 5,
      limit: 5,
      canUpload: false,
    })
    act(() => controls().handleFileUpload([file("over.txt")]))
    await flush()
    expect(uploadCalls).toEqual([])
    expect(controls().announcement).toContain("limit")
  })

  it("uses indeterminate state until transport progress exists", async () => {
    act(() => controls().handleFileUpload([file("indeterminate.txt")]))
    await flush()
    expect(controls().attachments[0]).toMatchObject({ status: "uploading" })
    expect(controls().attachments[0]).not.toHaveProperty("progress")
  })

  it("preserves generated paste source through failure and retry", async () => {
    let generated!: ReturnType<Picker["handleLargePaste"]>
    act(() => {
      generated = controls().handleLargePaste("complete source text")
    })
    await act(async () => {
      uploadCalls[0]?.reject(new Error("failed"))
      await Promise.resolve()
    })
    const failed = controls().attachments[0]!
    expect(failed).toMatchObject({
      status: "failed",
      text: "complete source text",
    })
    act(() => controls().retryAttachment(failed))
    expect(controls().attachments[0]).toMatchObject({
      status: "uploading",
      text: generated.text,
    })
  })
})
