import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import ts from "typescript"

export const DEFAULT_SCHEMA_PATH = "convex/schema.ts"
export const DEFAULT_MANIFEST_DIR = "convex/migrations"
export const DEFAULT_BASE_REF = "origin/main"
export const DEFAULT_BASE_BRANCH = "main"

// Pre-launch: this project has no users and no production data, so the schema
// contraction discipline (manifests, guard, preflight) is dormant. While this is
// true the guard and deploy preflight no-op, so editing convex/schema.ts —
// including removing fields — never blocks a build or CI. Flip to false and
// restore the manifest workflow when the app has real users.
// See AGENTS.md -> "Pre-Launch: The Database Is Disposable".
export const PRELAUNCH_DISPOSABLE_DB = true

const VALID_STATUSES = new Set(["expand", "migrate", "contracted"])
const VALID_KIND = "convex-schema-contraction"
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/
const GITHUB_REPO_PART = /^[A-Za-z0-9_.-]+$/

function isIdentifierName(node) {
  return ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)
}

function propertyNameText(name) {
  if (!isIdentifierName(name)) return null
  return name.text
}

function isIdentifierCall(node, name) {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === name
  )
}

function findDefineTableCall(node) {
  if (ts.isParenthesizedExpression(node)) {
    return findDefineTableCall(node.expression)
  }

  if (!ts.isCallExpression(node)) return null

  if (isIdentifierCall(node, "defineTable")) {
    return node
  }

  if (ts.isPropertyAccessExpression(node.expression)) {
    return findDefineTableCall(node.expression.expression)
  }

  return null
}

function findDefineSchemaObject(sourceFile) {
  let schemaObject = null

  function visit(node) {
    if (
      !schemaObject &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "defineSchema" &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      schemaObject = node.arguments[0]
      return
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return schemaObject
}

export function parseSchemaFields(source, fileName = DEFAULT_SCHEMA_PATH) {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )
  const schemaObject = findDefineSchemaObject(sourceFile)

  if (!schemaObject) {
    throw new Error(`Could not find defineSchema({...}) in ${fileName}`)
  }

  const tables = new Map()

  for (const tableProperty of schemaObject.properties) {
    if (!ts.isPropertyAssignment(tableProperty)) continue

    const tableName = propertyNameText(tableProperty.name)
    if (!tableName) continue

    const defineTableCall = findDefineTableCall(tableProperty.initializer)
    const tableShape = defineTableCall?.arguments[0]
    if (!tableShape || !ts.isObjectLiteralExpression(tableShape)) continue

    const fields = new Set()
    for (const fieldProperty of tableShape.properties) {
      if (!ts.isPropertyAssignment(fieldProperty)) continue

      const fieldName = propertyNameText(fieldProperty.name)
      if (fieldName) fields.add(fieldName)
    }

    tables.set(tableName, fields)
  }

  return tables
}

export function diffSchemaContractions(baseSource, currentSource, schemaPath = DEFAULT_SCHEMA_PATH) {
  const baseTables = parseSchemaFields(baseSource, `${schemaPath}:base`)
  const currentTables = parseSchemaFields(currentSource, `${schemaPath}:current`)
  const removed = []

  for (const [table, baseFields] of baseTables) {
    const currentFields = currentTables.get(table)
    if (!currentFields) continue

    for (const field of baseFields) {
      if (!currentFields.has(field)) {
        removed.push({ table, field })
      }
    }
  }

  return removed.sort(compareFieldCheck)
}

export function fieldKey(check) {
  return `${check.table}.${check.field}`
}

export function compareFieldCheck(a, b) {
  return fieldKey(a).localeCompare(fieldKey(b))
}

function manifestPathForMessage(rootDir, filePath) {
  return relative(rootDir, filePath) || filePath
}

function validateFieldCheck(check, pathForMessage, index) {
  const prefix = `${pathForMessage} fields[${index}]`
  const errors = []

  if (!check || typeof check !== "object" || Array.isArray(check)) {
    return [`${prefix} must be an object`]
  }

  if (typeof check.table !== "string" || !IDENTIFIER.test(check.table)) {
    errors.push(`${prefix}.table must be a Convex table identifier`)
  }

  if (typeof check.field !== "string" || !IDENTIFIER.test(check.field)) {
    errors.push(`${prefix}.field must be a Convex field identifier`)
  }

  if (check.expectedCount !== 0) {
    errors.push(`${prefix}.expectedCount must be 0`)
  }

  return errors
}

export function validateManifest(manifest, pathForMessage) {
  const errors = []

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return [`${pathForMessage} must contain a JSON object`]
  }

  if (manifest.kind !== VALID_KIND) {
    errors.push(`${pathForMessage} kind must be ${VALID_KIND}`)
  }

  if (typeof manifest.id !== "string" || manifest.id.trim().length === 0) {
    errors.push(`${pathForMessage} id is required`)
  }

  if (!VALID_STATUSES.has(manifest.status)) {
    errors.push(
      `${pathForMessage} status must be one of ${Array.from(VALID_STATUSES).join(", ")}`
    )
  }

  if (!Array.isArray(manifest.fields) || manifest.fields.length === 0) {
    errors.push(`${pathForMessage} fields must be a non-empty array`)
  } else {
    manifest.fields.forEach((check, index) => {
      errors.push(...validateFieldCheck(check, pathForMessage, index))
    })
  }

  for (const key of ["cleanupFunction", "verifier", "rollback"]) {
    if (typeof manifest[key] !== "string" || manifest[key].trim().length === 0) {
      errors.push(`${pathForMessage} ${key} is required`)
    }
  }

  return errors
}

export function loadMigrationManifests({
  cwd = process.cwd(),
  manifestDir = DEFAULT_MANIFEST_DIR,
} = {}) {
  const resolvedDir = resolve(cwd, manifestDir)
  const manifests = []
  const errors = []

  if (!existsSync(resolvedDir)) {
    return {
      manifests,
      errors: [`${manifestDir} does not exist; add a schema contraction manifest`],
    }
  }

  for (const entry of readdirSync(resolvedDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue

    const filePath = join(resolvedDir, entry.name)
    const pathForMessage = manifestPathForMessage(cwd, filePath)

    try {
      const manifest = JSON.parse(readFileSync(filePath, "utf8"))
      const manifestErrors = validateManifest(manifest, pathForMessage)
      if (manifestErrors.length > 0) {
        errors.push(...manifestErrors)
        continue
      }

      manifests.push({ manifest, path: pathForMessage })
    } catch (error) {
      errors.push(`${pathForMessage} is not valid JSON: ${error.message}`)
    }
  }

  if (manifests.length === 0 && errors.length === 0) {
    errors.push(`${manifestDir} does not contain any schema contraction manifests`)
  }

  return { manifests, errors }
}

export function checksFromManifests(manifests, { statuses = ["contracted"] } = {}) {
  const allowedStatuses = new Set(statuses)
  const checksByKey = new Map()

  for (const entry of manifests) {
    if (!allowedStatuses.has(entry.manifest.status)) continue

    for (const field of entry.manifest.fields) {
      const check = {
        table: field.table,
        field: field.field,
        expectedCount: field.expectedCount,
        manifestId: entry.manifest.id,
        manifestPath: entry.path,
        status: entry.manifest.status,
      }
      checksByKey.set(fieldKey(check), check)
    }
  }

  return Array.from(checksByKey.values()).sort(compareFieldCheck)
}

export function contractedManifestSchemaErrors({
  currentSource,
  manifests,
  schemaPath = DEFAULT_SCHEMA_PATH,
}) {
  const currentTables = parseSchemaFields(currentSource, `${schemaPath}:current`)
  const conflicts = []

  for (const entry of manifests) {
    if (entry.manifest.status !== "contracted") continue

    for (const field of entry.manifest.fields) {
      if (!currentTables.get(field.table)?.has(field.field)) continue

      conflicts.push({
        table: field.table,
        field: field.field,
        path: entry.path,
      })
    }
  }

  return conflicts.sort(compareFieldCheck).map(
    (conflict) =>
      `${fieldKey(conflict)} is listed as contracted in ${conflict.path}, but ${schemaPath} still defines it; update the manifest if the field is live again or remove the schema field after cleanup`
  )
}

export function evaluateSchemaContractions({ removedFields, manifests }) {
  const manifestFields = new Map()

  for (const entry of manifests) {
    for (const field of entry.manifest.fields) {
      manifestFields.set(fieldKey(field), {
        manifest: entry.manifest,
        path: entry.path,
        field,
      })
    }
  }

  const approved = []
  const errors = []

  for (const removedField of removedFields) {
    const match = manifestFields.get(fieldKey(removedField))

    if (!match) {
      errors.push(
        `${fieldKey(removedField)} was removed from ${DEFAULT_SCHEMA_PATH} without a matching migration manifest`
      )
      continue
    }

    if (match.manifest.status !== "contracted") {
      errors.push(
        `${fieldKey(removedField)} is listed in ${match.path}, but status is ${match.manifest.status}; schema removal requires status contracted`
      )
      continue
    }

    approved.push({
      ...removedField,
      expectedCount: match.field.expectedCount,
      manifestId: match.manifest.id,
      manifestPath: match.path,
      status: match.manifest.status,
    })
  }

  return { approved, errors }
}

export function mergeChecks(...checkLists) {
  const checksByKey = new Map()

  for (const checks of checkLists) {
    for (const check of checks) {
      checksByKey.set(fieldKey(check), check)
    }
  }

  return Array.from(checksByKey.values()).sort(compareFieldCheck)
}

export function envValue(value) {
  if (typeof value !== "string") return null

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readOriginRemoteUrl() {
  const result = spawnSync("git", ["remote", "get-url", "origin"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })

  if (result.status !== 0) return null

  return envValue(result.stdout)
}

function vercelGitHubRepoUrl(env) {
  if (envValue(env.VERCEL_GIT_PROVIDER) !== "github") return null

  const owner = envValue(env.VERCEL_GIT_REPO_OWNER)
  const slug = envValue(env.VERCEL_GIT_REPO_SLUG)
  if (!owner || !slug) return null

  if (!GITHUB_REPO_PART.test(owner) || !GITHUB_REPO_PART.test(slug)) {
    throw new Error(
      "VERCEL_GIT_REPO_OWNER and VERCEL_GIT_REPO_SLUG must be valid GitHub path parts"
    )
  }

  return `https://github.com/${owner}/${slug}.git`
}

function shouldUseVercelGitHubFallback(env) {
  return envValue(env.SCHEMA_GUARD_ALLOW_VERCEL_GITHUB_FALLBACK) === "1"
}

function assertFetchableRefPart(value, label) {
  if (
    value.startsWith("-") ||
    value.includes("..") ||
    value.includes("@{") ||
    /[\s:\\]/.test(value)
  ) {
    throw new Error(`${label} is not a safe git ref value: ${value}`)
  }
}

export function inferBaseBranch(baseRef = DEFAULT_BASE_REF) {
  if (baseRef.startsWith("refs/remotes/")) {
    const remoteAndBranch = baseRef.slice("refs/remotes/".length)
    const slashIndex = remoteAndBranch.indexOf("/")
    if (slashIndex !== -1) {
      return remoteAndBranch.slice(slashIndex + 1) || DEFAULT_BASE_BRANCH
    }
  }

  if (baseRef.startsWith("refs/heads/")) {
    return baseRef.slice("refs/heads/".length) || DEFAULT_BASE_BRANCH
  }

  const slashIndex = baseRef.indexOf("/")
  if (slashIndex !== -1) {
    return baseRef.slice(slashIndex + 1) || DEFAULT_BASE_BRANCH
  }

  return baseRef || DEFAULT_BASE_BRANCH
}

export function baseRefToFetchDestination(baseRef = DEFAULT_BASE_REF) {
  if (baseRef.startsWith("refs/")) return baseRef

  if (baseRef.includes("/")) {
    return `refs/remotes/${baseRef}`
  }

  throw new Error(
    "--fetch-base requires --base to be a remote-tracking ref like origin/main or a full refs/... ref"
  )
}

export function resolveBaseFetchPlan({
  baseRef = DEFAULT_BASE_REF,
  baseBranch,
  repoUrl,
  env = process.env,
  originRemoteUrl,
} = {}) {
  const resolvedBaseBranch =
    envValue(baseBranch) ??
    envValue(env.SCHEMA_GUARD_BASE_BRANCH) ??
    inferBaseBranch(baseRef)
  const destinationRef = baseRefToFetchDestination(baseRef)

  assertFetchableRefPart(resolvedBaseBranch, "base branch")
  assertFetchableRefPart(destinationRef, "base destination ref")

  const explicitRepoUrl = envValue(repoUrl) ?? envValue(env.SCHEMA_GUARD_REPO_URL)
  if (explicitRepoUrl) {
    return {
      baseRef,
      baseBranch: resolvedBaseBranch,
      sourceRef: `refs/heads/${resolvedBaseBranch}`,
      destinationRef,
      target: explicitRepoUrl,
      sourceLabel: "SCHEMA_GUARD_REPO_URL",
    }
  }

  const detectedOriginUrl =
    originRemoteUrl === undefined ? readOriginRemoteUrl() : envValue(originRemoteUrl)
  if (detectedOriginUrl) {
    return {
      baseRef,
      baseBranch: resolvedBaseBranch,
      sourceRef: `refs/heads/${resolvedBaseBranch}`,
      destinationRef,
      target: "origin",
      sourceLabel: "origin remote",
    }
  }

  const vercelRepoUrl = shouldUseVercelGitHubFallback(env)
    ? vercelGitHubRepoUrl(env)
    : null
  if (vercelRepoUrl) {
    return {
      baseRef,
      baseBranch: resolvedBaseBranch,
      sourceRef: `refs/heads/${resolvedBaseBranch}`,
      destinationRef,
      target: vercelRepoUrl,
      sourceLabel: "Vercel public GitHub repository metadata",
    }
  }

  throw new Error(
    "Could not determine a repository URL for the schema diff base. Set SCHEMA_GUARD_REPO_URL, run in a checkout with an origin remote, or set SCHEMA_GUARD_ALLOW_VERCEL_GITHUB_FALLBACK=1 for a public GitHub repository."
  )
}

function redactGitSecrets(value) {
  return value.replace(/(https?:\/\/)([^/@\s]+)@/g, "$1[redacted]@")
}

export function fetchBaseRef(options = {}) {
  const plan = resolveBaseFetchPlan(options)
  const result = spawnSync(
    "git",
    [
      "fetch",
      "--no-tags",
      "--depth=1",
      plan.target,
      `+${plan.sourceRef}:${plan.destinationRef}`,
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  )

  if (result.error) {
    throw new Error(`Could not run git fetch: ${result.error.message}`)
  }

  if (result.status !== 0) {
    const detail = redactGitSecrets(
      [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n")
    )
    throw new Error(
      `Could not fetch ${plan.sourceRef} into ${plan.destinationRef} from ${plan.sourceLabel}.${detail ? `\n${detail}` : ""}`
    )
  }

  return plan
}

export function buildInlineCountQuery(checks, { limit = 1000 } = {}) {
  const safeChecks = checks.map((check) => ({
    table: check.table,
    field: check.field,
    expectedCount: check.expectedCount,
  }))

  // A zero result proves Convex scanned the whole table successfully. Positive
  // results are capped only to avoid returning large aggregate payloads.
  return `const checks = ${JSON.stringify(safeChecks)};
const limit = ${Number(limit)};
const results = [];
for (const check of checks) {
  const docs = await ctx.db
    .query(check.table)
    .filter((q) => q.neq(q.field(check.field), undefined))
    .take(limit + 1);
  results.push({
    table: check.table,
    field: check.field,
    count: docs.length > limit ? limit : docs.length,
    countIsCapped: docs.length > limit,
    expectedCount: check.expectedCount,
  });
}
return results;`
}

export function parseConvexRunJson(output) {
  const trimmed = output.trim()
  if (!trimmed) {
    throw new Error("Convex returned no output")
  }

  try {
    return JSON.parse(trimmed)
  } catch {
    const lines = trimmed.split(/\r?\n/)
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index].trim()
      if (!line.startsWith("[") && !line.startsWith("{")) continue

      try {
        return JSON.parse(lines.slice(index).join("\n"))
      } catch {
        // Keep scanning for the start of the JSON payload.
      }
    }
  }

  throw new Error("Could not parse Convex JSON output")
}

export function formatCheck(check) {
  return `${check.table}.${check.field}`
}
