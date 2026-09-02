/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it } from "vitest"
import { AutosizeTextarea } from "./autosize-textarea"

it("applies caller sizing classes to both the textarea and its mirror", () => {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)

  act(() => {
    root.render(
      <AutosizeTextarea
        className="px-2 py-2 text-sm"
        value="hello"
        onChange={() => {}}
      />
    )
  })

  const textarea = container.querySelector("textarea")
  const mirror = textarea?.nextElementSibling

  for (const element of [textarea, mirror]) {
    const classes = new Set(element?.className.split(" "))
    expect(classes).toContain("px-2")
    expect(classes).toContain("py-2")
    expect(classes).toContain("text-sm")
  }
  expect(textarea?.className).toContain("resize-none overflow-hidden")
  expect(mirror?.className).toContain("invisible")
  expect(mirror?.className).toContain("whitespace-pre-wrap")
  expect(mirror?.className).toContain("wrap-anywhere")

  act(() => root.unmount())
  container.remove()
})
