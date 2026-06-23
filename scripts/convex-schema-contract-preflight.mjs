#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import {
  DEFAULT_BASE_REF,
  DEFAULT_MANIFEST_DIR,
  DEFAULT_SCHEMA_PATH,
  PRELAUNCH_DISPOSABLE_DB,
  buildInlineCountQuery,
  checksFromManifests,
  contractedManifestSchemaErrors,
  diffSchemaContractions,
  envValue,
  evaluateSchemaContractions,
  fetchBaseRef,
  fieldKey,
  formatCheck,
  loadMigrationManifests,
  mergeChecks,
  parseConvexRunJson,
} from "./convex-schema-contract-lib.mjs"

function parseArgs(argv) {
  const options = {
    baseRef: envValue(process.env.SCHEMA_GUARD_BASE_REF) ?? DEFAULT_BASE_REF,
    schemaPath: DEFAULT_SCHEMA_PATH,
    manifestDir: DEFAULT_MANIFEST_DIR,
    limit: 1000,
    convexCommand: process.env.CONVEX_SCHEMA_PREFLIGHT_CONVEX_COMMAND ?? "bunx convex",
    baseBranch: process.env.SCHEMA_GUARD_BASE_BRANCH,
    repoUrl: process.env.SCHEMA_GUARD_REPO_URL,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]

    if (arg === "--base") {
      options.baseRef = requireValue(arg, next)
      index += 1
    } else if (arg === "--base-branch") {
      options.baseBranch = requireValue(arg, next)
      index += 1
    } else if (arg === "--repo-url") {
      options.repoUrl = requireValue(arg, next)
      index += 1
    } else if (arg === "--schema") {
      options.schemaPath = requireValue(arg, next)
      index += 1
    } else if (arg === "--manifest-dir") {
      options.manifestDir = requireValue(arg, next)
      index += 1
    } else if (arg === "--deployment") {
      options.deployment = requireValue(arg, next)
      index += 1
    } else if (arg === "--convex-command") {
      options.convexCommand = requireValue(arg, next)
      index += 1
    } else if (arg === "--limit") {
      options.limit = Number(requireValue(arg, next))
      index += 1
    } else if (arg === "--prod") {
      options.prod = true
    } else if (arg === "--dry-run") {
      options.dryRun = true
    } else if (arg === "--require-diff-base") {
      options.requireDiffBase = true
    } else if (arg === "--fetch-base") {
      options.fetchBase = true
    } else if (arg === "--help" || arg === "-h") {
      options.help = true
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!Number.isInteger(options.limit) || options.limit < 1) {
    throw new Error("--limit must be a positive integer")
  }

  if (options.prod && options.deployment) {
    throw new Error("Use either --prod or --deployment, not both")
  }

  return options
}

function requireValue(name, value) {
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`)
  }

  return value
}

function readBaseSchema(baseRef, schemaPath) {
  return execFileSync("git", ["show", `${baseRef}:${schemaPath}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
}

function tryReadBaseSchema(baseRef, schemaPath) {
  try {
    return {
      source: readBaseSchema(baseRef, schemaPath),
      warning: null,
    }
  } catch (error) {
    const stderr = String(error.stderr ?? "").trim()
    const suffix = stderr ? ` ${stderr}` : ""
    return {
      source: null,
      warning: `Could not read ${schemaPath} from ${baseRef}; schema diff detection was skipped. Run with --fetch-base or set SCHEMA_GUARD_REPO_URL so the base ref can be prepared.${suffix}`,
    }
  }
}

function commandParts(command) {
  const parts = command.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) {
    throw new Error("Convex command cannot be empty")
  }

  return parts
}

function targetArgs(options) {
  if (options.prod) return ["--prod"]
  if (options.deployment) return ["--deployment", options.deployment]
  return []
}

function targetLabel(options) {
  if (options.prod) return "production (--prod)"
  if (options.deployment) return `deployment ${options.deployment}`
  return "Convex CLI default deployment"
}

function printHelp() {
  console.log(`Usage: node scripts/convex-schema-contract-preflight.mjs [options]

Runs read-only aggregate Convex checks for contracted schema fields before
convex deploy. Output is limited to table/field names and counts.

Options:
  --prod                    Run against the project's production deployment
  --deployment <name>       Run against a specific Convex deployment
  --base <ref>              Git ref to compare against (default: ${DEFAULT_BASE_REF})
  --fetch-base              Fetch the base branch into --base before comparing
  --base-branch <name>      Branch to fetch for --fetch-base (default: inferred from --base)
  --repo-url <url>          Repository URL for --fetch-base (or SCHEMA_GUARD_REPO_URL)
  --schema <path>           Schema file path (default: ${DEFAULT_SCHEMA_PATH})
  --manifest-dir <dir>      Manifest directory (default: ${DEFAULT_MANIFEST_DIR})
  --limit <n>               Positive-count cap per field (default: 1000)
  --convex-command <cmd>    Convex command prefix (default: bunx convex)
  --dry-run                 Validate and print planned checks without querying Convex
  --require-diff-base       Fail if the base schema ref cannot be read.
                            Non-dry-run --prod checks imply this.
  -h, --help                Show this help
`)
}

export function shouldRequireDiffBase(options) {
  const productionDeployment =
    options.prod ||
    options.deployment === "prod" ||
    options.deployment === "production"

  return Boolean(
    options.requireDiffBase || (!options.dryRun && productionDeployment)
  )
}

export function planPreflight({
  baseSource,
  currentSource,
  manifests,
  schemaPath = DEFAULT_SCHEMA_PATH,
}) {
  const removedFields = baseSource
    ? diffSchemaContractions(baseSource, currentSource, schemaPath)
    : []
  const diffEvaluation = evaluateSchemaContractions({ removedFields, manifests })
  const manifestSchemaErrors = contractedManifestSchemaErrors({
    currentSource,
    manifests,
    schemaPath,
  })
  const manifestChecks = checksFromManifests(manifests, { statuses: ["contracted"] })
  const checks = mergeChecks(manifestChecks, diffEvaluation.approved)

  return {
    removedFields,
    checks,
    errors: [...manifestSchemaErrors, ...diffEvaluation.errors],
  }
}

function runConvexChecks(checks, options) {
  const parts = commandParts(options.convexCommand)
  const executable = parts[0]
  const args = [
    ...parts.slice(1),
    "run",
    "--inline-query",
    buildInlineCountQuery(checks, { limit: options.limit }),
    "--typecheck",
    "disable",
    "--codegen",
    "disable",
    ...targetArgs(options),
  ]

  const result = spawnSync(executable, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })

  if (result.error) {
    throw new Error(`Could not run Convex CLI: ${result.error.message}`)
  }

  if (result.status !== 0) {
    const stderr = result.stderr.trim()
    throw new Error(
      `Convex read-only verification failed with exit code ${result.status}${stderr ? `: ${stderr}` : ""}`
    )
  }

  return parseConvexRunJson(result.stdout)
}

export function validatePreflightResults(checks, results) {
  if (!Array.isArray(results)) {
    throw new Error("Convex verification did not return an array of counts")
  }

  const resultsByKey = new Map()
  for (const result of results) {
    if (
      !result ||
      typeof result.table !== "string" ||
      typeof result.field !== "string" ||
      typeof result.count !== "number"
    ) {
      throw new Error("Convex verification returned an invalid count result")
    }

    resultsByKey.set(fieldKey(result), result)
  }

  const failures = []
  const orderedResults = []

  for (const check of checks) {
    const result = resultsByKey.get(fieldKey(check))
    if (!result) {
      failures.push(`${formatCheck(check)} did not return a count`)
      continue
    }

    orderedResults.push(result)

    if (result.countIsCapped) {
      failures.push(
        `${formatCheck(check)} has at least ${result.count} legacy documents`
      )
      continue
    }

    if (result.count !== check.expectedCount) {
      failures.push(
        `${formatCheck(check)} count ${result.count} does not match expected ${check.expectedCount}`
      )
    }
  }

  return { orderedResults, failures }
}

function printChecks(checks) {
  for (const check of checks) {
    console.log(
      `- ${formatCheck(check)} expected=${check.expectedCount} manifest=${check.manifestId}`
    )
  }
}

function runCli() {
  if (PRELAUNCH_DISPOSABLE_DB) {
    console.log(
      "Convex schema contraction preflight: dormant pre-launch (disposable DB) — skipping. See AGENTS.md."
    )
    return
  }

  const options = parseArgs(process.argv.slice(2))

  if (options.help) {
    printHelp()
    return
  }

  if (options.fetchBase) {
    const plan = fetchBaseRef({
      baseRef: options.baseRef,
      baseBranch: options.baseBranch,
      repoUrl: options.repoUrl,
    })
    console.log(
      `OK fetched ${plan.sourceRef} into ${plan.destinationRef} from ${plan.sourceLabel}`
    )
  }

  const { manifests, errors: manifestErrors } = loadMigrationManifests({
    manifestDir: options.manifestDir,
  })

  if (manifestErrors.length > 0) {
    console.error("Convex schema contraction preflight failed:")
    for (const error of manifestErrors) {
      console.error(`ERROR ${error}`)
    }
    process.exitCode = 1
    return
  }

  const base = tryReadBaseSchema(options.baseRef, options.schemaPath)
  if (base.warning && shouldRequireDiffBase(options)) {
    console.error(`Convex schema contraction preflight failed: ${base.warning}`)
    process.exitCode = 1
    return
  }

  if (base.warning) {
    console.warn(`WARN ${base.warning}`)
  }

  const currentSource = readFileSync(options.schemaPath, "utf8")
  const plan = planPreflight({
    baseSource: base.source,
    currentSource,
    manifests,
    schemaPath: options.schemaPath,
  })

  if (plan.errors.length > 0) {
    console.error("Convex schema contraction preflight failed:")
    for (const error of plan.errors) {
      console.error(`ERROR ${error}`)
    }
    process.exitCode = 1
    return
  }

  if (plan.checks.length === 0) {
    console.log("OK no contracted Convex schema fields require preflight checks")
    return
  }

  console.log(`Convex schema contraction preflight target: ${targetLabel(options)}`)
  console.log("Read-only aggregate checks:")
  printChecks(plan.checks)

  if (options.dryRun) {
    console.log("OK dry run completed without querying Convex")
    return
  }

  let verification
  try {
    const results = runConvexChecks(plan.checks, options)
    verification = validatePreflightResults(plan.checks, results)
  } catch (error) {
    console.error(`Convex schema contraction preflight failed: ${error.message}`)
    console.error(
      "Deploy blocked: legacy-field aggregate counts were not verified. Treat Convex query or result-shape failures as not verified, not as zero counts."
    )
    process.exitCode = 1
    return
  }

  const { orderedResults, failures } = verification

  console.log("Results:")
  for (const result of orderedResults) {
    const count = result.countIsCapped ? `>=${result.count}` : String(result.count)
    console.log(
      `- ${formatCheck(result)} count=${count} expected=${result.expectedCount}`
    )
  }

  if (failures.length > 0) {
    console.error("\nConvex schema contraction preflight failed:")
    for (const failure of failures) {
      console.error(`ERROR ${failure}`)
    }
    console.error(
      "\nRollback: redeploy the expand/compat schema, run the cleanup migration, verify zero counts, then retry the strict schema deploy."
    )
    process.exitCode = 1
    return
  }

  console.log("OK all contracted Convex schema fields matched expected zero counts")
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCli()
  } catch (error) {
    console.error(`Convex schema contraction preflight failed: ${error.message}`)
    process.exitCode = 1
  }
}
