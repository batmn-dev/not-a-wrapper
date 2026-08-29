import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const root = new URL("../../", import.meta.url)

function read(path: string) {
  return readFileSync(new URL(path, root), "utf8")
}

describe("floating surface ownership", () => {
  it("keeps menu primitives on the shared recipes", () => {
    const primitives = [
      [
        "components/ui/dropdown-menu.tsx",
        "floatingSurfaceClassName",
      ],
      ["components/ui/context-menu.tsx", "floatingSurfaceClassName"],
      ["components/ui/combobox.tsx", "floatingSurfaceClassName"],
      ["components/ui/select.tsx", "floatingSelectSurfaceClassName"],
    ] as const

    for (const [path, surfaceRecipe] of primitives) {
      const source = read(path)
      expect(source).toContain(surfaceRecipe)
      expect(source).toContain("floatingMenuContentClassName")
      expect(source).toContain("floatingMenuItemClassName")
      expect(source).toContain("floatingMenuSeparatorClassName")
    }
  })
})
