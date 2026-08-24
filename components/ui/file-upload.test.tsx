/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { FileUpload, useFileUpload } from "./file-upload"

function PickerTrigger() {
  const { openFilePicker } = useFileUpload()

  return (
    <button type="button" onClick={openFilePicker}>
      Pick files
    </button>
  )
}

describe("FileUpload input ownership", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it("owns one stable picker input shared by imperative triggers", () => {
    const inputClick = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => {})

    act(() => {
      root.render(
        <FileUpload onFilesAdded={() => {}} accept="image/*" multiple>
          <PickerTrigger />
        </FileUpload>
      )
    })

    const [input] = container.querySelectorAll<HTMLInputElement>(
      'input[type="file"]'
    )
    expect(container.querySelectorAll('input[type="file"]')).toHaveLength(1)
    expect(input?.tabIndex).toBe(-1)
    expect(input?.multiple).toBe(true)
    expect(input?.getAttribute("accept")).toBe("image/*")

    act(() => {
      ;(container.querySelector("button") as HTMLButtonElement).click()
    })
    expect(inputClick).toHaveBeenCalledTimes(1)
  })
})
