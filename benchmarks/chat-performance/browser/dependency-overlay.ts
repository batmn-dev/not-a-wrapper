import { isDeepStrictEqual } from "node:util"
import { parseConfigFileTextToJson } from "typescript"
import { z } from "zod"

const record = z.record(z.string(), z.unknown())

function parseObject(text: string) {
  const parsed = parseConfigFileTextToJson("dependencies.json", text)
  if (parsed.error) throw new Error("Invalid dependency JSON")
  return record.parse(parsed.config)
}

function assertUnchanged(base: unknown, head: unknown, label: string) {
  if (!isDeepStrictEqual(base, head))
    throw new Error(`${label} changed; dependency overlay only permits additions`)
}

function additions(base: Record<string, unknown>, head: Record<string, unknown>, label: string) {
  for (const [name, value] of Object.entries(base))
    assertUnchanged(value, head[name], `${label}: ${name}`)
  return Object.keys(head).filter((name) => !Object.hasOwn(base, name)).sort()
}

/** Normalize additive dependencies across both builds without upgrading the baseline. */
export function validateDependencyOverlay(input: {
  baseManifest: string
  headManifest: string
  baseLock: string
  headLock: string
}) {
  const { dependencies: baseDeps, ...baseManifest } = parseObject(input.baseManifest)
  const { dependencies: headDeps, ...headManifest } = parseObject(input.headManifest)
  assertUnchanged(baseManifest, headManifest, "Package manifest outside dependencies")
  const addedDependencies = additions(record.parse(baseDeps), record.parse(headDeps), "Dependency")
  const { workspaces: baseWorkspaces, packages: basePackages, ...baseLock } = parseObject(input.baseLock)
  const { workspaces: headWorkspaces, packages: headPackages, ...headLock } = parseObject(input.headLock)
  assertUnchanged(baseLock, headLock, "Lockfile settings")
  const { "": baseRoot, ...baseOtherWorkspaces } = record.parse(baseWorkspaces)
  const { "": headRoot, ...headOtherWorkspaces } = record.parse(headWorkspaces)
  assertUnchanged(baseOtherWorkspaces, headOtherWorkspaces, "Other workspaces")
  const { dependencies: baseRootDeps, ...baseRootSettings } = record.parse(baseRoot)
  const { dependencies: headRootDeps, ...headRootSettings } = record.parse(headRoot)
  assertUnchanged(baseRootSettings, headRootSettings, "Root workspace settings")
  assertUnchanged(baseDeps, baseRootDeps, "Base manifest/lock dependency agreement")
  assertUnchanged(headDeps, headRootDeps, "Head manifest/lock dependency agreement")
  const addedPackages = additions(record.parse(basePackages), record.parse(headPackages), "Locked package")
  if (addedDependencies.length === 0 || addedPackages.length === 0)
    throw new Error("Dependency overlay requires added dependencies and locked packages")
  return { addedDependencies, addedPackages }
}
