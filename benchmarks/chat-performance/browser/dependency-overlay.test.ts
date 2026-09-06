import { describe, expect, it } from "vitest"
import { validateDependencyOverlay } from "./dependency-overlay"

const base = {
  dependencies: { react: "19" },
  scripts: { build: "next build" },
}
const head = { ...base, dependencies: { ...base.dependencies, redis: "6" } }
const lock = (dependencies: Record<string, string>, packages: Record<string, unknown>) => ({
  lockfileVersion: 1,
  workspaces: { "": { name: "app", dependencies } },
  packages,
})
const baseLock = lock(base.dependencies, { react: ["react@19", "integrity"] })
const headLock = lock(head.dependencies, { ...baseLock.packages, redis: ["redis@6", "integrity"] })
const input = () => ({
  baseManifest: JSON.stringify(base), headManifest: JSON.stringify(head),
  baseLock: JSON.stringify(baseLock), headLock: JSON.stringify(headLock),
})

describe("paired dependency overlay", () => {
  it("accepts additive packages while retaining all existing resolutions", () => {
    expect(validateDependencyOverlay(input())).toEqual({
      addedDependencies: ["redis"], addedPackages: ["redis"],
    })
  })

  it("accepts a new direct dependency already locked as a transitive dependency", () => {
    expect(validateDependencyOverlay({
      ...input(),
      baseLock: JSON.stringify({ ...baseLock, packages: headLock.packages }),
    })).toEqual({ addedDependencies: ["redis"], addedPackages: [] })
  })

  it.each([
    { headManifest: JSON.stringify({ ...head, scripts: { build: "different build" } }) },
    { headManifest: JSON.stringify({ ...head, dependencies: { redis: "6" } }) },
    { headLock: JSON.stringify(baseLock) },
    { headLock: JSON.stringify({ ...headLock, packages: baseLock.packages }) },
    { headLock: JSON.stringify({ ...headLock, packages: { ...headLock.packages, react: ["react@20", "integrity"] } }) },
    { headLock: JSON.stringify({ ...headLock, workspaces: { "": { name: "different", dependencies: head.dependencies } } }) },
  ])("rejects baseline changes instead of hiding them in the overlay", (change) => {
    expect(() => validateDependencyOverlay({ ...input(), ...change })).toThrow()
  })
})
