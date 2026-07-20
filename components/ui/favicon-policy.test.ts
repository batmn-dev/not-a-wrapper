import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = process.cwd()
const SOURCE_ROOTS = ["app", "components", "lib"]
const ALLOWED_GOOGLE_SOURCE = "app/api/favicon/route.ts"
const ALLOWED_PROXY_SOURCE = "components/ui/favicon.tsx"

function productionSourceFiles(directory: string): string[] {
  return readdirSync(path.join(ROOT, directory), {
    withFileTypes: true,
  }).flatMap((entry) => {
    const relativePath = path.join(directory, entry.name)
    if (entry.isDirectory()) return productionSourceFiles(relativePath)
    if (!/\.[cm]?[jt]sx?$/.test(entry.name)) return []
    if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) return []
    return [relativePath]
  })
}

describe("favicon policy", () => {
  it("keeps favicon retrieval behind the shared module", () => {
    const files = SOURCE_ROOTS.flatMap(productionSourceFiles)
    const directGoogleCallers = files.filter(
      (file) =>
        file.replace(/\\/g, "/") !== ALLOWED_GOOGLE_SOURCE &&
        readFileSync(path.join(ROOT, file), "utf8").includes(
          "google.com/s2/favicons"
        )
    )
    const directProxyCallers = files.filter(
      (file) =>
        file.replace(/\\/g, "/") !== ALLOWED_PROXY_SOURCE &&
        readFileSync(path.join(ROOT, file), "utf8").includes("/api/favicon?")
    )

    expect(directGoogleCallers).toEqual([])
    expect(directProxyCallers).toEqual([])
  })
})
