#!/usr/bin/env node
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import {
  DEFAULT_BASE_REF,
  DEFAULT_MANIFEST_DIR,
  DEFAULT_SCHEMA_PATH,
  diffSchemaContractions,
  envValue,
  evaluateSchemaContractions,
  fetchBaseRef,
  fieldKey,
  formatCheck,
  loadMigrationManifests,
} from "./convex-schema-contract-lib.mjs"

function parseArgs(argv) {
  const options = {
    baseRef: envValue(process.env.SCHEMA_GUARD_BASE_REF) ?? DEFAULT_BASE_REF,
    schemaPath: DEFAULT_SCHEMA_PATH,
    manifestDir: DEFAULT_MANIFEST_DIR,
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
    } else if (arg === "--fetch-base") {
      options.fetchBase = true
    } else if (arg === "--help" || arg === "-h") {
      options.help = true
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
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
  try {
    return execFileSync("git", ["show", `${baseRef}:${schemaPath}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
  } catch (error) {
    const stderr = String(error.stderr ?? "").trim()
    const suffix = stderr ? `\n${stderr}` : ""
    throw new Error(
      `Could not read ${schemaPath} from ${baseRef}. Run this guard with --fetch-base or set SCHEMA_GUARD_REPO_URL so the base ref can be prepared.${suffix}`
    )
  }
}

function printHelp() {
  console.log(`Usage: node scripts/convex-schema-contract-guard.mjs [options]

Detects field removals from convex/schema.ts and requires matching contracted
Convex schema-contraction manifests. This guard never queries production data.

Options:
  --base <ref>           Git ref to compare against (default: ${DEFAULT_BASE_REF})
  --fetch-base           Fetch the base branch into --base before comparing
  --base-branch <name>   Branch to fetch for --fetch-base (default: inferred from --base)
  --repo-url <url>       Repository URL for --fetch-base (or SCHEMA_GUARD_REPO_URL)
  --schema <path>        Schema file path (default: ${DEFAULT_SCHEMA_PATH})
  --manifest-dir <dir>   Manifest directory (default: ${DEFAULT_MANIFEST_DIR})
  -h, --help             Show this help
`)
}

export function runGuard({
  baseSource,
  currentSource,
  manifests,
  schemaPath = DEFAULT_SCHEMA_PATH,
}) {
  const removedFields = diffSchemaContractions(baseSource, currentSource, schemaPath)
  const result = evaluateSchemaContractions({ removedFields, manifests })

  return {
    removedFields,
    approved: result.approved,
    errors: result.errors,
  }
}

function runCli() {
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

  const baseSource = readBaseSchema(options.baseRef, options.schemaPath)
  const currentSource = readFileSync(options.schemaPath, "utf8")
  const { manifests, errors: manifestErrors } = loadMigrationManifests({
    manifestDir: options.manifestDir,
  })

  if (manifestErrors.length > 0) {
    console.error("Convex schema contraction guard failed:")
    for (const error of manifestErrors) {
      console.error(`ERROR ${error}`)
    }
    process.exitCode = 1
    return
  }

  const result = runGuard({
    baseSource,
    currentSource,
    manifests,
    schemaPath: options.schemaPath,
  })

  if (result.removedFields.length === 0) {
    console.log(
      `OK no Convex schema field removals detected against ${options.baseRef}`
    )
    return
  }

  console.log("Convex schema contraction guard detected removed fields:")
  for (const field of result.removedFields) {
    console.log(`- ${formatCheck(field)}`)
  }

  if (result.errors.length > 0) {
    console.error("\nConvex schema contraction guard failed:")
    for (const error of result.errors) {
      console.error(`ERROR ${error}`)
    }
    console.error(
      "\nUse expand/migrate/contract: keep removed fields optional, clean existing documents, verify zero aggregate counts, then remove the schema fields with a contracted manifest."
    )
    process.exitCode = 1
    return
  }

  const manifestsByField = new Map(
    result.approved.map((check) => [fieldKey(check), check])
  )

  console.log("\nOK matching contracted manifests found:")
  for (const field of result.removedFields) {
    const check = manifestsByField.get(fieldKey(field))
    console.log(`- ${formatCheck(field)} via ${check.manifestId}`)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCli()
  } catch (error) {
    console.error(`Convex schema contraction guard failed: ${error.message}`)
    process.exitCode = 1
  }
}
