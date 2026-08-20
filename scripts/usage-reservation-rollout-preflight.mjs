#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"

export const AUTHORIZED_RESERVE_FUNCTION = "usageAllowance.js:reserveAuthorized"

export function validateAuthorizedReserveFunctionSpec(rawSpec) {
  let spec
  try {
    spec = JSON.parse(rawSpec)
  } catch {
    throw new Error("Could not parse the deployed Convex function spec")
  }
  const functions = Array.isArray(spec?.functions) ? spec.functions : []
  if (
    !functions.some(
      (fn) =>
        fn?.identifier === AUTHORIZED_RESERVE_FUNCTION &&
        fn?.visibility?.kind === "public"
    )
  ) {
    throw new Error(
      "Usage reservation contraction blocked: deploy and activate the expansion revision containing usageAllowance.reserveAuthorized before making legacy reserve fail closed"
    )
  }
}

export function runUsageReservationRolloutPreflight({
  env = process.env,
  runCommand = spawnSync,
} = {}) {
  const result = runCommand("convex", ["function-spec", "--prod"], {
    env,
    encoding: "utf8",
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      result.stderr?.trim() || "Could not inspect deployed Convex functions"
    )
  }
  validateAuthorizedReserveFunctionSpec(result.stdout)
}

function runCli() {
  runUsageReservationRolloutPreflight()
  console.log("Usage reservation expansion is active; contraction may deploy.")
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    runCli()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
