#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"

const PREFLIGHT_SCRIPT = "scripts/convex-schema-contract-preflight.mjs"
const PREFLIGHT_DEPLOY_KEY_ENV = "CONVEX_SCHEMA_PREFLIGHT_DEPLOY_KEY"
const CONVEX_DEPLOY_KEY_ENV = "CONVEX_DEPLOY_KEY"
const BASE_DEPLOY_ARGS = [
  "deploy",
  "--cmd-url-env-var-name",
  "NEXT_PUBLIC_CONVEX_URL",
  "--cmd",
  "next build",
  "--yes",
]

export function deployPreflightMode(env = process.env) {
  const configured = env.CONVEX_SCHEMA_PREFLIGHT_MODE?.trim()
  if (configured) {
    if (configured === "prod" || configured === "dry-run") {
      return configured
    }

    throw new Error(
      "CONVEX_SCHEMA_PREFLIGHT_MODE must be either prod or dry-run"
    )
  }

  if (env.VERCEL_ENV && env.VERCEL_ENV !== "production") {
    return "dry-run"
  }

  return "prod"
}

export function preflightArgsForDeployEnv(env = process.env) {
  const mode = deployPreflightMode(env)
  const args = [PREFLIGHT_SCRIPT, "--fetch-base", "--require-diff-base"]

  if (mode === "prod") {
    args.push("--prod")
  } else {
    args.push("--dry-run")
  }

  return args
}

function envValue(value) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function preflightEnvForDeployEnv(env = process.env) {
  const preflightDeployKey = envValue(env[PREFLIGHT_DEPLOY_KEY_ENV])

  if (!preflightDeployKey) {
    return env
  }

  return {
    ...env,
    [CONVEX_DEPLOY_KEY_ENV]: preflightDeployKey,
  }
}

export function convexDeployArgs(extraArgs = []) {
  return [...BASE_DEPLOY_ARGS, ...extraArgs]
}

export function deployPlanForEnv({ env = process.env, extraArgs = [] } = {}) {
  const mode = deployPreflightMode(env)

  return {
    mode,
    preflightArgs: preflightArgsForDeployEnv(env),
    deployArgs: convexDeployArgs(extraArgs),
  }
}

function runOrExit(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    env,
    stdio: "inherit",
  })

  if (result.error) {
    console.error(`Failed to run ${command}: ${result.error.message}`)
    process.exit(1)
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

export function runDeploy({
  env = process.env,
  extraArgs = [],
  log = console.log,
  runCommand = runOrExit,
} = {}) {
  const plan = deployPlanForEnv({ env, extraArgs })

  log(`Convex schema contraction preflight mode: ${plan.mode}`)
  runCommand(
    process.execPath,
    plan.preflightArgs,
    preflightEnvForDeployEnv(env)
  )
  runCommand("convex", plan.deployArgs, env)
}

function runCli() {
  runDeploy({ extraArgs: process.argv.slice(2) })
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    runCli()
  } catch (error) {
    console.error(`Convex deploy failed: ${error.message}`)
    process.exitCode = 1
  }
}
