import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

async function collectTypeScriptFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        return collectTypeScriptFiles(entryPath)
      }
      if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        return [entryPath]
      }
      return []
    })
  )

  return files.flat()
}

describe("model catalog runtime boundary", () => {
  it("keeps lib/models free of provider runtime imports", async () => {
    const modelFiles = await collectTypeScriptFiles(
      path.join(process.cwd(), "lib/models")
    )
    const forbiddenImports = [
      "@/lib/openproviders",
      "@ai-sdk/",
      "@openrouter/ai-sdk-provider",
    ]

    const violations: string[] = []
    for (const file of modelFiles) {
      const source = await readFile(file, "utf8")
      for (const forbiddenImport of forbiddenImports) {
        if (source.includes(forbiddenImport)) {
          violations.push(
            `${path.relative(process.cwd(), file)} imports ${forbiddenImport}`
          )
        }
      }
    }

    expect(violations).toEqual([])
  })
})
