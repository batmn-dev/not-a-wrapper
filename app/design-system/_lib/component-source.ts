import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Reads a component's source file verbatim so registry pages show the exact
 * code that ships instead of a hand-maintained copy that drifts. Server-only
 * by construction: pages call this at render time, and importing it from a
 * client component fails the build (node:fs has no browser shim).
 */
export function readComponentSource(repoRelativePath: string): string {
  return readFileSync(join(process.cwd(), repoRelativePath), "utf8").trimEnd()
}
