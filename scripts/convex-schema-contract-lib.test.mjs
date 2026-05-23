import { mkdirSync, writeFileSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  buildInlineCountQuery,
  checksFromManifests,
  diffSchemaContractions,
  evaluateSchemaContractions,
  loadMigrationManifests,
  parseConvexRunJson,
  parseSchemaFields,
} from "./convex-schema-contract-lib.mjs"
import {
  planPreflight,
  shouldRequireDiffBase,
  validatePreflightResults,
} from "./convex-schema-contract-preflight.mjs"

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

function contractedManifest(status = "contracted") {
  return {
    manifest: {
      kind: "convex-schema-contraction",
      id: "2026-05-22-multi-chat-field-removal",
      status,
      fields: [
        { table: "messages", field: "messageGroupId", expectedCount: 0 },
        { table: "messages", field: "model", expectedCount: 0 },
        { table: "userPreferences", field: "multiModelEnabled", expectedCount: 0 },
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
    expect(shouldRequireDiffBase({ requireDiffBase: true, dryRun: true })).toBe(true)
    expect(shouldRequireDiffBase({ dryRun: true })).toBe(false)
  })

  it("plans dry-run manifest checks even when no git base is available", () => {
    const plan = planPreflight({
      baseSource: null,
      currentSource: contractedSchema,
      manifests: [contractedManifest()],
    })

    expect(plan.errors).toEqual([])
    expect(plan.checks.map((check) => `${check.table}.${check.field}`)).toEqual([
      "messages.messageGroupId",
      "messages.model",
      "userPreferences.multiModelEnabled",
    ])
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
    const query = buildInlineCountQuery(checksFromManifests([contractedManifest()]))

    expect(query).toContain("count")
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
    const result = validatePreflightResults([check], [
      {
        table: check.table,
        field: check.field,
        count: 1,
        countIsCapped: false,
        expectedCount: check.expectedCount,
      },
    ])

    expect(result.failures).toEqual([
      "messages.messageGroupId count 1 does not match expected 0",
    ])
  })

  it("fails preflight results when a legacy field count is capped", () => {
    const [check] = checksFromManifests([contractedManifest()])
    const result = validatePreflightResults([check], [
      {
        table: check.table,
        field: check.field,
        count: 1000,
        countIsCapped: true,
        expectedCount: check.expectedCount,
      },
    ])

    expect(result.failures).toEqual([
      "messages.messageGroupId has at least 1000 legacy documents",
    ])
  })

  it("fails preflight results when Convex omits a requested field count", () => {
    const [check] = checksFromManifests([contractedManifest()])
    const result = validatePreflightResults([check], [])

    expect(result.failures).toEqual(["messages.messageGroupId did not return a count"])
  })

  it("fails preflight results when Convex returns malformed count data", () => {
    const [check] = checksFromManifests([contractedManifest()])

    expect(() =>
      validatePreflightResults([check], [
        {
          table: check.table,
          count: 0,
          countIsCapped: false,
          expectedCount: check.expectedCount,
        },
      ])
    ).toThrow("Convex verification returned an invalid count result")
  })
})
