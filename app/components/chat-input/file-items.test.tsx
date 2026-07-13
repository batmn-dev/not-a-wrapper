/** @vitest-environment jsdom */

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
import { FileTile } from "./file-items"
import { FileList } from "./file-list"
import {
  createGeneratedLargePasteAttachment,
  createSelectedFileAttachment,
  markAttachmentFailed,
  markAttachmentReady,
  type PendingAttachment,
} from "./pending-attachment"

vi.mock("next/image", () => ({
  default: ({
    fill: _fill,
    unoptimized: _unoptimized,
    ...props
  }: Record<string, unknown>) => React.createElement("img", props),
}))

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

describe("FileTile family", () => {
  let container: HTMLDivElement
  let root: Root
  const onRemove = vi.fn()
  const onRestore = vi.fn()
  const onRetry = vi.fn()

  function render(node: React.ReactNode) {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root.render(node))
    return container
  }

  function renderItem(
    attachment: PendingAttachment,
    index = 0,
    isLocked = false
  ) {
    return render(
      <FileTile
        attachment={attachment}
        index={index}
        isLocked={isLocked}
        onRemove={onRemove}
        onRestoreLargePaste={onRestore}
        onRetry={onRetry}
      />
    )
  }

  function readyFile(file: File) {
    return markAttachmentReady(createSelectedFileAttachment(file), {
      name: file.name,
      contentType: file.type,
      url: `/api/files/${encodeURIComponent(file.name)}/preview`,
      attachmentId: `attachment-${file.name}`,
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:attachment-preview"),
      revokeObjectURL: vi.fn(),
    })
  })

  afterEach(() => {
    if (root) act(() => root.unmount())
    container?.remove()
    vi.unstubAllGlobals()
  })

  it("renders generated text with shared wide responsive geometry and restore action", () => {
    const attachment = createGeneratedLargePasteAttachment(
      "A generated paste preview that truncates",
      1
    )
    renderItem(attachment)

    const tile = container.querySelector(
      '[data-attachment-tile="generated-text"]'
    )
    expect(tile?.className).toContain("h-[58px]")
    expect(tile?.className).toContain("w-60")
    expect(tile?.className).toContain("md:w-80")
    expect(tile?.textContent).toContain("A generated paste pr…")

    const restore = container.querySelector(
      'button[aria-label="Show in text field"]'
    ) as HTMLButtonElement
    act(() => restore.click())
    expect(onRestore).toHaveBeenCalledWith(attachment)
  })

  it("renders a PDF in the wide shell and opens and closes its named dialog", async () => {
    const attachment = readyFile(
      new File(["pdf"], "full-report.pdf", { type: "application/pdf" })
    )
    renderItem(attachment)

    const tile = container.querySelector('[data-attachment-tile="document"]')
    expect(tile?.className).toContain("w-60")
    expect(tile?.textContent).toContain("full-report.pdf")
    expect(tile?.textContent).toContain("PDF")

    const open = container.querySelector(
      'button[aria-label="full-report.pdf"]'
    ) as HTMLButtonElement
    open.focus()
    await act(async () => open.click())
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog?.getAttribute("aria-label")).toBe("full-report.pdf")
    expect(dialog?.querySelector("h2")?.textContent).toBe("full-report.pdf")
    expect(
      dialog?.querySelector('iframe[title="full-report.pdf"]')
    ).toBeTruthy()

    const close = dialog?.querySelector(
      'button[data-slot="dialog-close"]'
    ) as HTMLButtonElement
    await act(async () => {
      close.click()
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve())
      )
    })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(open)
  })

  it("renders an image as a compact preview tile and opens its accessible lightbox", async () => {
    const attachment = readyFile(
      new File(["image"], "photo.jpg", { type: "image/jpeg" })
    )
    renderItem(attachment)

    const tile = container.querySelector('[data-attachment-tile="image"]')
    expect(tile?.className).toContain("w-14")
    expect(tile?.className).toContain("h-[58px]")
    expect(tile?.textContent).not.toContain("photo.jpg")

    const open = container.querySelector(
      'button[aria-label="Open image: photo.jpg"]'
    ) as HTMLButtonElement
    await act(async () => open.click())
    expect(
      document.querySelector('[role="dialog"] img[alt="photo.jpg"]')
    ).toBeTruthy()

    const close = document.querySelector(
      '[role="dialog"] button[data-slot="dialog-close"]'
    ) as HTMLButtonElement
    await act(async () => {
      close.click()
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve())
      )
    })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(open)
  })

  it("uses a 16px indexed remove action with a 32px hit target and tooltip", () => {
    const attachment = readyFile(
      new File(["image"], "photo.webp", { type: "image/webp" })
    )
    renderItem(attachment, 2)

    const remove = container.querySelector(
      'button[aria-label="Remove file 3: photo.webp"]'
    ) as HTMLButtonElement
    expect(remove.className).toContain("size-4")
    expect(remove.className).toContain("attachment-remove-button")
    expect(remove.querySelector("svg")?.getBoundingClientRect).toBeTruthy()
    expect(remove.getAttribute("data-slot")).toBe("tooltip-trigger")
    act(() => remove.click())
    expect(onRemove).toHaveBeenCalledWith(attachment)
  })

  it("disables removal while a ready attachment is being sent", () => {
    const attachment = readyFile(
      new File(["image"], "sending.webp", { type: "image/webp" })
    )
    renderItem(attachment, 0, true)

    const remove = container.querySelector(
      'button[aria-label="Sending file 1: sending.webp"]'
    ) as HTMLButtonElement
    expect(remove.disabled).toBe(true)
    act(() => remove.click())
    expect(onRemove).not.toHaveBeenCalled()
  })

  it("renders uploading and failed states and emits an attachment-specific retry", () => {
    const retry = vi.fn()
    const attachment = createSelectedFileAttachment(
      new File(["pdf"], "retry.pdf", { type: "application/pdf" })
    )
    const failed = markAttachmentFailed(attachment, 1, "Network unavailable")
    const renderStatus = (status: "uploading" | "failed") => (
      <FileTile
        attachment={status === "uploading" ? attachment : failed}
        index={0}
        onRemove={vi.fn()}
        onRestoreLargePaste={vi.fn()}
        onRetry={retry}
      />
    )
    const { rerender } = (() => {
      render(renderStatus("uploading"))
      return {
        rerender: (status: "uploading" | "failed") =>
          act(() => root.render(renderStatus(status))),
      }
    })()

    expect(
      container.querySelector(
        '[role="status"][aria-label="Uploading retry.pdf"]'
      )
    ).toBeTruthy()
    rerender("failed")
    expect(container.textContent).toContain("Network unavailable")
    const retryButton = container.querySelector(
      'button[aria-label="Retry file 1: retry.pdf"]'
    ) as HTMLButtonElement
    act(() => retryButton.click())
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it("contains long errors and hides retry for non-retryable failures", () => {
    const attachment = createSelectedFileAttachment(
      new File(["pdf"], "quota.pdf", { type: "application/pdf" })
    )
    const failed = markAttachmentFailed(
      attachment,
      1,
      "Daily file upload limit reached.",
      false
    )
    renderItem(failed)

    const error = Array.from(container.querySelectorAll("span")).find(
      (element) =>
        element.textContent === "Daily file upload limit reached."
    )
    expect(error?.className).toContain("truncate")
    expect(
      container.querySelector('button[aria-label^="Retry file"]')
    ).toBeNull()
  })

  it("keeps mixed duplicate filenames in one non-wrapping horizontal row with stable ids", () => {
    const first = createSelectedFileAttachment(
      new File(["pdf-a"], "duplicate.pdf", { type: "application/pdf" })
    )
    const second = createSelectedFileAttachment(
      new File(["pdf-b"], "duplicate.pdf", { type: "application/pdf" })
    )
    const image = createSelectedFileAttachment(
      new File(["image"], "photo.png", { type: "image/png" })
    )
    render(
      <FileList
        attachments={[first, second, image]}
        onFileRemove={onRemove}
        onRestoreLargePaste={onRestore}
        onRetry={onRetry}
      />
    )

    const row = container.querySelector('[data-testid="attachment-row"]')
    expect(row?.className).toContain("flex-nowrap")
    expect(row?.className).toContain("gap-2")
    expect(row?.className).toContain("overflow-x-auto")
    const secondRemove = container.querySelector(
      'button[aria-label="Cancel upload 2: duplicate.pdf"]'
    ) as HTMLButtonElement
    act(() => secondRemove.click())
    expect(onRemove).toHaveBeenCalledWith(second)
    expect(first.id).not.toBe(second.id)
  })

  it("shows scroll fades only for content available in each direction", () => {
    const attachments = ["one", "two", "three"].map((name) =>
      createSelectedFileAttachment(
        new File([name], `${name}.pdf`, { type: "application/pdf" })
      )
    )
    render(
      <FileList
        attachments={attachments}
        onFileRemove={onRemove}
        onRestoreLargePaste={onRestore}
        onRetry={onRetry}
      />
    )
    const row = container.querySelector(
      '[data-testid="attachment-row"]'
    ) as HTMLDivElement
    Object.defineProperties(row, {
      clientWidth: { configurable: true, value: 300 },
      scrollWidth: { configurable: true, value: 700 },
    })

    act(() => row.dispatchEvent(new Event("scroll", { bubbles: true })))
    expect(container.querySelector('[data-scroll-fade="left"]')).toBeNull()
    expect(container.querySelector('[data-scroll-fade="right"]')).toBeTruthy()

    row.scrollLeft = 200
    act(() => row.dispatchEvent(new Event("scroll", { bubbles: true })))
    expect(container.querySelector('[data-scroll-fade="left"]')).toBeTruthy()
    expect(container.querySelector('[data-scroll-fade="right"]')).toBeTruthy()

    row.scrollLeft = 400
    act(() => row.dispatchEvent(new Event("scroll", { bubbles: true })))
    expect(container.querySelector('[data-scroll-fade="left"]')).toBeTruthy()
    expect(container.querySelector('[data-scroll-fade="right"]')).toBeNull()
  })
})
