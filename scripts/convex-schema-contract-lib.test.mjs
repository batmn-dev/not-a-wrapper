import { mkdirSync, writeFileSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  convexDeployArgs,
  deployPlanForEnv,
  deployPreflightMode,
  preflightArgsForDeployEnv,
  preflightEnvForDeployEnv,
  runDeploy,
} from "./convex-deploy.mjs"
import {
  baseRefToFetchDestination,
  buildInlineCountQuery,
  checksFromManifests,
  contractedManifestSchemaErrors,
  diffSchemaContractions,
  envValue,
  evaluateSchemaContractions,
  inferBaseBranch,
  loadMigrationManifests,
  parseConvexRunJson,
  parseSchemaFields,
  resolveBaseFetchPlan,
  shouldSkipSchemaContractionChecks,
} from "./convex-schema-contract-lib.mjs"
import {
  convexRunEnvForPreflight,
  planPreflight,
  shouldRequireDiffBase,
  validatePreflightResults,
} from "./convex-schema-contract-preflight.mjs"
import { validateAuthorizedReserveFunctionSpec } from "./usage-reservation-rollout-preflight.mjs"

const baseSchema = `
import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

export default defineSchema({
  messages: defineTable({
    chatId: v.id("chats"),
    messageGroupId: v.optional(v.string()),
    model: v.optional(v.string()),
    content: v.optional(v.string()),
  }).index("by_chat", ["chatId"]),
  userPreferences: defineTable({
    userId: v.id("users"),
    multiModelEnabled: v.optional(v.boolean()),
    hiddenModels: v.optional(v.array(v.string())),
  }),
})
`

const contractedSchema = `
import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

export default defineSchema({
  messages: defineTable({
    chatId: v.id("chats"),
    content: v.optional(v.string()),
  }).index("by_chat", ["chatId"]),
  userPreferences: defineTable({
    userId: v.id("users"),
    hiddenModels: v.optional(v.array(v.string())),
  }),
})
`

const reintroducedModelSchema = `
import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

export default defineSchema({
  messages: defineTable({
    chatId: v.id("chats"),
    model: v.optional(v.string()),
    content: v.optional(v.string()),
  }).index("by_chat", ["chatId"]),
  userPreferences: defineTable({
    userId: v.id("users"),
    hiddenModels: v.optional(v.array(v.string())),
  }),
})
`

function contractedManifest(status = "contracted") {
  return {
    manifest: {
      kind: "convex-schema-contraction",
      id: "2026-05-22-multi-chat-field-removal",
      status,
      fields: [
        { table: "messages", field: "messageGroupId", expectedCount: 0 },
        { table: "messages", field: "model", expectedCount: 0 },
        {
          table: "userPreferences",
          field: "multiModelEnabled",
          expectedCount: 0,
        },
      ],
      cleanupFunction: "historical:cleanup",
      verifier: "bun run convex:schema-preflight",
      rollback: "redeploy expand schema",
    },
    path: "convex/migrations/2026-05-22-multi-chat-field-removal.json",
  }
}

describe("Convex schema contraction helpers", () => {
  it("extracts top-level fields from defineTable calls", () => {
    const fields = parseSchemaFields(baseSchema)

    expect(Array.from(fields.get("messages")).sort()).toEqual([
      "chatId",
      "content",
      "messageGroupId",
      "model",
    ])
    expect(Array.from(fields.get("userPreferences")).sort()).toEqual([
      "hiddenModels",
      "multiModelEnabled",
      "userId",
    ])
  })

  it("detects removed schema fields without treating additions as contractions", () => {
    const removed = diffSchemaContractions(baseSchema, contractedSchema)

    expect(removed).toEqual([
      { table: "messages", field: "messageGroupId" },
      { table: "messages", field: "model" },
      { table: "userPreferences", field: "multiModelEnabled" },
    ])
    expect(diffSchemaContractions(contractedSchema, baseSchema)).toEqual([])
  })

  it("requires removed fields to have contracted manifests", () => {
    const removedFields = diffSchemaContractions(baseSchema, contractedSchema)
    const result = evaluateSchemaContractions({
      removedFields,
      manifests: [contractedManifest("migrate")],
    })

    expect(result.approved).toEqual([])
    expect(result.errors).toEqual([
      "messages.messageGroupId is listed in convex/migrations/2026-05-22-multi-chat-field-removal.json, but status is migrate; schema removal requires status contracted",
      "messages.model is listed in convex/migrations/2026-05-22-multi-chat-field-removal.json, but status is migrate; schema removal requires status contracted",
      "userPreferences.multiModelEnabled is listed in convex/migrations/2026-05-22-multi-chat-field-removal.json, but status is migrate; schema removal requires status contracted",
    ])
  })

  it("fails removed schema fields without matching manifests", () => {
    const removedFields = diffSchemaContractions(baseSchema, contractedSchema)
    const result = evaluateSchemaContractions({
      removedFields,
      manifests: [],
    })

    expect(result.approved).toEqual([])
    expect(result.errors).toEqual([
      "messages.messageGroupId was removed from convex/schema.ts without a matching migration manifest",
      "messages.model was removed from convex/schema.ts without a matching migration manifest",
      "userPreferences.multiModelEnabled was removed from convex/schema.ts without a matching migration manifest",
    ])
  })

  it("fails closed on missing diff base for production preflight, but not dry-run exploration", () => {
    expect(shouldRequireDiffBase({ prod: true })).toBe(true)
    expect(shouldRequireDiffBase({ prod: true, dryRun: true })).toBe(false)
    expect(shouldRequireDiffBase({ deployment: "prod" })).toBe(true)
    expect(shouldRequireDiffBase({ requireDiffBase: true, dryRun: true })).toBe(
      true
    )
    expect(shouldRequireDiffBase({ dryRun: true })).toBe(false)
  })

  it("plans dry-run manifest checks even when no git base is available", () => {
    const plan = planPreflight({
      baseSource: null,
      currentSource: contractedSchema,
      manifests: [contractedManifest()],
    })

    expect(plan.errors).toEqual([])
    expect(plan.checks.map((check) => `${check.table}.${check.field}`)).toEqual(
      [
        "messages.messageGroupId",
        "messages.model",
        "userPreferences.multiModelEnabled",
      ]
    )
  })

  it("fails dry-run when a contracted manifest field is present in the current schema", () => {
    const errors = contractedManifestSchemaErrors({
      currentSource: reintroducedModelSchema,
      manifests: [contractedManifest()],
    })

    expect(errors).toEqual([
      "messages.model is listed as contracted in convex/migrations/2026-05-22-multi-chat-field-removal.json, but convex/schema.ts still defines it; update the manifest if the field is live again or remove the schema field after cleanup",
    ])

    const plan = planPreflight({
      baseSource: null,
      currentSource: reintroducedModelSchema,
      manifests: [contractedManifest()],
    })

    expect(plan.errors).toEqual(errors)
  })

  it("prefers an existing origin remote over Vercel GitHub metadata", () => {
    const plan = resolveBaseFetchPlan({
      baseRef: "origin/main",
      env: {
        VERCEL_GIT_PROVIDER: "github",
        VERCEL_GIT_REPO_OWNER: "darknightdesigner",
        VERCEL_GIT_REPO_SLUG: "not-a-wrapper",
      },
      originRemoteUrl: "git@github.com:private/fork.git",
    })

    expect(plan).toMatchObject({
      baseBranch: "main",
      sourceRef: "refs/heads/main",
      destinationRef: "refs/remotes/origin/main",
      target: "origin",
      sourceLabel: "origin remote",
    })
  })

  it("uses Vercel public GitHub metadata only when explicitly allowed and no origin remote exists", () => {
    const plan = resolveBaseFetchPlan({
      baseRef: "origin/main",
      env: {
        SCHEMA_GUARD_ALLOW_VERCEL_GITHUB_FALLBACK: "1",
        VERCEL_GIT_PROVIDER: "github",
        VERCEL_GIT_REPO_OWNER: "darknightdesigner",
        VERCEL_GIT_REPO_SLUG: "not-a-wrapper",
      },
      originRemoteUrl: null,
    })

    expect(plan).toMatchObject({
      baseBranch: "main",
      sourceRef: "refs/heads/main",
      destinationRef: "refs/remotes/origin/main",
      target: "https://github.com/darknightdesigner/not-a-wrapper.git",
      sourceLabel: "Vercel public GitHub repository metadata",
    })
  })

  it("does not derive a public GitHub URL from Vercel metadata without opt-in", () => {
    expect(() =>
      resolveBaseFetchPlan({
        baseRef: "origin/main",
        env: {
          VERCEL_GIT_PROVIDER: "github",
          VERCEL_GIT_REPO_OWNER: "private-owner",
          VERCEL_GIT_REPO_SLUG: "private-repo",
        },
        originRemoteUrl: null,
      })
    ).toThrow("SCHEMA_GUARD_REPO_URL")
  })

  it("lets SCHEMA_GUARD_REPO_URL override Vercel and origin fetch sources", () => {
    const plan = resolveBaseFetchPlan({
      baseRef: "refs/remotes/schema-guard/main",
      env: {
        SCHEMA_GUARD_REPO_URL: "https://example.com/repo.git",
        VERCEL_GIT_PROVIDER: "github",
        VERCEL_GIT_REPO_OWNER: "darknightdesigner",
        VERCEL_GIT_REPO_SLUG: "not-a-wrapper",
      },
      originRemoteUrl: "git@github.com:darknightdesigner/not-a-wrapper.git",
    })

    expect(plan).toMatchObject({
      sourceRef: "refs/heads/main",
      destinationRef: "refs/remotes/schema-guard/main",
      target: "https://example.com/repo.git",
      sourceLabel: "SCHEMA_GUARD_REPO_URL",
    })
  })

  it("requires an explicit repo source when fetch-base has no origin or Vercel metadata", () => {
    expect(() =>
      resolveBaseFetchPlan({
        baseRef: "origin/main",
        env: {},
        originRemoteUrl: null,
      })
    ).toThrow("SCHEMA_GUARD_REPO_URL")
  })

  it("requires an explicit repo source for non-GitHub Vercel builds without origin", () => {
    expect(() =>
      resolveBaseFetchPlan({
        baseRef: "origin/main",
        env: {
          VERCEL_GIT_PROVIDER: "gitlab",
          VERCEL_GIT_REPO_OWNER: "private",
          VERCEL_GIT_REPO_SLUG: "not-a-wrapper",
        },
        originRemoteUrl: null,
      })
    ).toThrow("SCHEMA_GUARD_REPO_URL")
  })

  it("selects production aggregate preflight except for Vercel previews", () => {
    expect(deployPreflightMode({})).toBe("prod")
    expect(deployPreflightMode({ VERCEL_ENV: "production" })).toBe("prod")
    expect(deployPreflightMode({ VERCEL_ENV: "preview" })).toBe("dry-run")
    expect(deployPreflightMode({ VERCEL_ENV: "development" })).toBe("dry-run")
    expect(
      deployPreflightMode({
        VERCEL_ENV: "preview",
        CONVEX_SCHEMA_PREFLIGHT_MODE: "prod",
      })
    ).toBe("prod")
    expect(() =>
      deployPreflightMode({ CONVEX_SCHEMA_PREFLIGHT_MODE: "skip" })
    ).toThrow("CONVEX_SCHEMA_PREFLIGHT_MODE")
  })

  it("keeps deploy preflight fail-closed on the git base in every mode", () => {
    expect(preflightArgsForDeployEnv({ VERCEL_ENV: "production" })).toEqual([
      "scripts/convex-schema-contract-preflight.mjs",
      "--fetch-base",
      "--require-diff-base",
      "--prod",
    ])
    expect(preflightArgsForDeployEnv({ VERCEL_ENV: "preview" })).toEqual([
      "scripts/convex-schema-contract-preflight.mjs",
      "--fetch-base",
      "--require-diff-base",
      "--dry-run",
    ])
  })

  it("uses a separate query-capable key for production preflight runs", () => {
    const env = {
      CONVEX_DEPLOY_KEY: "deploy-key",
      CONVEX_SCHEMA_PREFLIGHT_DEPLOY_KEY: "query-key",
    }

    expect(
      convexRunEnvForPreflight({ env, options: { prod: true } })
    ).toMatchObject({
      CONVEX_DEPLOY_KEY: "query-key",
      CONVEX_SCHEMA_PREFLIGHT_DEPLOY_KEY: "query-key",
    })
    expect(env.CONVEX_DEPLOY_KEY).toBe("deploy-key")
  })

  it("fails production preflight queries without a query-capable key", () => {
    expect(() =>
      convexRunEnvForPreflight({
        env: { CONVEX_DEPLOY_KEY: "deploy-key" },
        options: { prod: true },
      })
    ).toThrow("CONVEX_SCHEMA_PREFLIGHT_DEPLOY_KEY")
  })

  it("keeps dry-run and production schema checks active while pre-launch", () => {
    expect(shouldSkipSchemaContractionChecks({ dryRun: true, env: {} })).toBe(
      false
    )
    expect(
      shouldSkipSchemaContractionChecks({
        productionTarget: true,
        env: {},
      })
    ).toBe(false)
    expect(
      shouldSkipSchemaContractionChecks({
        productionTarget: true,
        env: { CONVEX_PROD_DB_DISPOSABLE: "true" },
      })
    ).toBe(true)
    expect(shouldSkipSchemaContractionChecks({ env: {} })).toBe(true)
  })

  it("plans the Convex deploy command without dropping extra CLI args", () => {
    expect(convexDeployArgs(["--preview-create", "branch-name"])).toEqual([
      "deploy",
      "--cmd-url-env-var-name",
      "NEXT_PUBLIC_CONVEX_URL",
      "--cmd",
      "next build",
      "--yes",
      "--preview-create",
      "branch-name",
    ])
  })

  it("plans preview deploys as required-base dry runs before Convex deploy", () => {
    expect(
      deployPlanForEnv({
        env: { VERCEL_ENV: "preview" },
        extraArgs: ["--preview-create", "branch-name"],
      })
    ).toEqual({
      mode: "dry-run",
      preflightArgs: [
        "scripts/convex-schema-contract-preflight.mjs",
        "--fetch-base",
        "--require-diff-base",
        "--dry-run",
      ],
      usageReservationRolloutPreflightArgs: null,
      deployArgs: [
        "deploy",
        "--cmd-url-env-var-name",
        "NEXT_PUBLIC_CONVEX_URL",
        "--cmd",
        "next build",
        "--yes",
        "--preview-create",
        "branch-name",
      ],
    })
  })

  it("passes the preflight deploy key only to the preflight subprocess", () => {
    const env = {
      VERCEL_ENV: "production",
      CONVEX_DEPLOY_KEY: "deploy-key",
      CONVEX_SCHEMA_PREFLIGHT_DEPLOY_KEY: "query-key",
    }

    expect(preflightEnvForDeployEnv(env)).toMatchObject({
      CONVEX_DEPLOY_KEY: "query-key",
      CONVEX_SCHEMA_PREFLIGHT_DEPLOY_KEY: "query-key",
    })

    const calls = []
    runDeploy({
      env,
      log: () => {},
      runCommand: (command, args, commandEnv) => {
        calls.push({ command, args, env: commandEnv })
      },
    })

    expect(calls[0].env.CONVEX_DEPLOY_KEY).toBe("query-key")
    expect(calls[1]).toMatchObject({
      command: process.execPath,
      args: ["scripts/usage-reservation-rollout-preflight.mjs"],
    })
    expect(calls[1].env.CONVEX_DEPLOY_KEY).toBe("deploy-key")
    expect(calls[2].env.CONVEX_DEPLOY_KEY).toBe("deploy-key")
  })

  it("blocks a reservation contraction until the authorized endpoint is deployed", () => {
    expect(() =>
      validateAuthorizedReserveFunctionSpec(
        JSON.stringify({
          functions: [
            {
              identifier: "usageAllowance.js:reserve",
              visibility: { kind: "public" },
            },
          ],
        })
      )
    ).toThrow("Usage reservation contraction blocked")

    expect(() =>
      validateAuthorizedReserveFunctionSpec(
        JSON.stringify({
          functions: [
            {
              identifier: "usageAllowance.js:reserveAuthorized",
              visibility: { kind: "public" },
            },
          ],
        })
      )
    ).not.toThrow()
  })

  it("runs preflight before Convex deploy using the selected deploy environment", () => {
    const calls = []
    const env = { VERCEL_ENV: "preview" }

    runDeploy({
      env,
      extraArgs: ["--preview-create", "branch-name"],
      log: () => {},
      runCommand: (command, args, commandEnv) => {
        calls.push({ command, args, env: commandEnv })
      },
    })

    expect(calls).toEqual([
      {
        command: process.execPath,
        args: [
          "scripts/convex-schema-contract-preflight.mjs",
          "--fetch-base",
          "--require-diff-base",
          "--dry-run",
        ],
        env,
      },
      {
        command: "convex",
        args: [
          "deploy",
          "--cmd-url-env-var-name",
          "NEXT_PUBLIC_CONVEX_URL",
          "--cmd",
          "next build",
          "--yes",
          "--preview-create",
          "branch-name",
        ],
        env,
      },
    ])
  })

  it("infers fetch branches and destinations from base refs", () => {
    expect(inferBaseBranch("origin/main")).toBe("main")
    expect(inferBaseBranch("origin/release/2026-05")).toBe("release/2026-05")
    expect(inferBaseBranch("refs/remotes/upstream/main")).toBe("main")
    expect(baseRefToFetchDestination("origin/main")).toBe(
      "refs/remotes/origin/main"
    )
    expect(baseRefToFetchDestination("refs/remotes/schema-guard/main")).toBe(
      "refs/remotes/schema-guard/main"
    )
  })

  it("treats empty environment values as unset", () => {
    expect(envValue(undefined)).toBe(null)
    expect(envValue("")).toBe(null)
    expect(envValue("   ")).toBe(null)
    expect(envValue(" origin/main ")).toBe("origin/main")
  })

  it("loads and validates manifest JSON files", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "convex-contract-"))
    const manifestDir = "convex/migrations"
    mkdirSync(join(cwd, manifestDir), { recursive: true })
    writeFileSync(
      join(cwd, manifestDir, "multi-chat.json"),
      JSON.stringify(contractedManifest().manifest)
    )

    const result = loadMigrationManifests({ cwd, manifestDir })

    expect(result.errors).toEqual([])
    expect(checksFromManifests(result.manifests)).toHaveLength(3)
  })

  it("reports malformed manifest files", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "convex-contract-"))
    const manifestDir = "convex/migrations"
    mkdirSync(join(cwd, manifestDir), { recursive: true })
    writeFileSync(
      join(cwd, manifestDir, "bad.json"),
      JSON.stringify({
        kind: "convex-schema-contraction",
        id: "bad",
        status: "contracted",
        fields: [{ table: "messages", field: "model", expectedCount: 1 }],
        cleanupFunction: "historical:cleanup",
        verifier: "bun run convex:schema-preflight",
        rollback: "redeploy expand schema",
      })
    )

    const result = loadMigrationManifests({ cwd, manifestDir })

    expect(result.manifests).toEqual([])
    expect(result.errors).toEqual([
      "convex/migrations/bad.json fields[0].expectedCount must be 0",
    ])
  })

  it("builds inline queries that return only aggregate counts", () => {
    const query = buildInlineCountQuery(
      checksFromManifests([contractedManifest()])
    )

    expect(query).toContain("count")
    expect(query).toContain("q.neq(q.field(check.field), undefined)")
    expect(query).toContain("take(limit + 1)")
    expect(query).not.toContain("return docs")
  })

  it("parses Convex JSON output with leading CLI text", () => {
    const parsed = parseConvexRunJson(`Preparing Convex query
[
  {"table":"messages","field":"model","count":0,"expectedCount":0}
]`)

    expect(parsed).toEqual([
      { table: "messages", field: "model", count: 0, expectedCount: 0 },
    ])
  })

  it("fails preflight results when a legacy field count is nonzero", () => {
    const [check] = checksFromManifests([contractedManifest()])
    const result = validatePreflightResults(
      [check],
      [
        {
          table: check.table,
          field: check.field,
          count: 1,
          countIsCapped: false,
          expectedCount: check.expectedCount,
        },
      ]
    )

    expect(result.failures).toEqual([
      "messages.messageGroupId count 1 does not match expected 0",
    ])
  })

  it("fails preflight results when a legacy field count is capped", () => {
    const [check] = checksFromManifests([contractedManifest()])
    const result = validatePreflightResults(
      [check],
      [
        {
          table: check.table,
          field: check.field,
          count: 1000,
          countIsCapped: true,
          expectedCount: check.expectedCount,
        },
      ]
    )

    expect(result.failures).toEqual([
      "messages.messageGroupId has at least 1000 legacy documents",
    ])
  })

  it("fails preflight results when Convex omits a requested field count", () => {
    const [check] = checksFromManifests([contractedManifest()])
    const result = validatePreflightResults([check], [])

    expect(result.failures).toEqual([
      "messages.messageGroupId did not return a count",
    ])
  })

  it("fails preflight results when Convex returns malformed count data", () => {
    const [check] = checksFromManifests([contractedManifest()])

    expect(() =>
      validatePreflightResults(
        [check],
        [
          {
            table: check.table,
            count: 0,
            countIsCapped: false,
            expectedCount: check.expectedCount,
          },
        ]
      )
    ).toThrow("Convex verification returned an invalid count result")
  })
})
