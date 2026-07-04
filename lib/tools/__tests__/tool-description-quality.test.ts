import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { getContentExtractionTools, getThirdPartyTools } from "../third-party"

vi.mock("exa-js", () => {
  class MockExa {
    async searchAndContents() {
      return { results: [] }
    }

    async getContents() {
      return { results: [], statuses: [] }
    }
  }

  return { default: MockExa }
})

type ToolDescriptor = {
  description?: unknown
  inputSchema?: unknown
  inputExamples?: unknown
}

function getToolDescriptor(
  tools: Record<string, unknown>,
  name: string
): ToolDescriptor {
  const descriptor = tools[name]
  if (!descriptor || typeof descriptor !== "object") {
    throw new Error(`Tool "${name}" not found`)
  }
  return descriptor as ToolDescriptor
}

function getTopLevelShape(schema: unknown): Record<string, z.ZodTypeAny> {
  if (!(schema instanceof z.ZodObject)) {
    throw new Error("Expected tool inputSchema to be a ZodObject")
  }
  return schema.shape
}

function hasPlaceholderText(text: string): boolean {
  return /todo|tbd|placeholder|lorem ipsum|generic description|insert description|replace me/i.test(
    text
  )
}

function assertDescriptionQuality(
  toolName: string,
  description: unknown
): void {
  expect(typeof description).toBe("string")
  const text = (description as string).trim()

  expect(
    text.length,
    `${toolName} description should not be empty`
  ).toBeGreaterThan(0)

  // Low-signal placeholders or generic filler should fail fast.
  expect(
    hasPlaceholderText(text),
    `${toolName} description contains low-signal placeholder text`
  ).toBe(false)
}

function assertFieldDescriptions(toolName: string, schema: unknown): void {
  const shape = getTopLevelShape(schema)
  for (const [fieldName, fieldSchema] of Object.entries(shape)) {
    const fieldDescription = fieldSchema.description?.trim() ?? ""
    if (fieldDescription.length === 0) continue
    expect(
      hasPlaceholderText(fieldDescription),
      `${toolName}.${fieldName} has low-signal description text`
    ).toBe(false)
  }
}

function assertInputExamples(
  toolName: string,
  inputSchema: unknown,
  inputExamples: unknown
): void {
  expect(
    Array.isArray(inputExamples),
    `${toolName} must define inputExamples`
  ).toBe(true)
  const examples = inputExamples as unknown[]
  expect(
    examples.length,
    `${toolName} should provide at least one example`
  ).toBeGreaterThan(0)

  if (!(inputSchema instanceof z.ZodType)) {
    throw new Error(`${toolName} inputSchema is not a Zod schema`)
  }

  for (const [index, example] of examples.entries()) {
    expect(
      typeof example === "object" && example !== null && "input" in example,
      `${toolName} inputExamples[${index}] must include an input object`
    ).toBe(true)

    const input = (example as { input: unknown }).input
    const result = inputSchema.safeParse(input)
    expect(
      result.success,
      `${toolName} inputExamples[${index}].input must match schema`
    ).toBe(true)
  }
}

describe("custom tool description quality gates", () => {
  it("enforces quality for third-party and content extraction tools", async () => {
    const { tools: thirdPartyTools, metadata: thirdPartyMetadata } =
      await getThirdPartyTools({
        exaKey: "exa_test_key",
        skipSearch: false,
      })
    const { tools: contentTools, metadata: contentMetadata } =
      await getContentExtractionTools({
        exaKey: "exa_test_key",
      })

    const webSearch = getToolDescriptor(
      thirdPartyTools as unknown as Record<string, unknown>,
      "web_search"
    )
    const extractContent = getToolDescriptor(
      contentTools as unknown as Record<string, unknown>,
      "extract_content"
    )

    assertDescriptionQuality("web_search", webSearch.description)
    assertDescriptionQuality("extract_content", extractContent.description)
    assertFieldDescriptions("web_search", webSearch.inputSchema)
    assertFieldDescriptions("extract_content", extractContent.inputSchema)
    expect(thirdPartyMetadata.get("web_search")?.openWorld).toBe(true)
    expect(contentMetadata.get("extract_content")?.openWorld).toBe(true)
  })
})

describe("custom tool inputExamples", () => {
  it("validates inputExamples against each complex tool schema", async () => {
    const { tools: thirdPartyTools } = await getThirdPartyTools({
      exaKey: "exa_test_key",
      skipSearch: false,
    })
    const { tools: contentTools } = await getContentExtractionTools({
      exaKey: "exa_test_key",
    })

    const webSearch = getToolDescriptor(
      thirdPartyTools as unknown as Record<string, unknown>,
      "web_search"
    )
    const extractContent = getToolDescriptor(
      contentTools as unknown as Record<string, unknown>,
      "extract_content"
    )

    assertInputExamples(
      "web_search",
      webSearch.inputSchema,
      webSearch.inputExamples
    )
    assertInputExamples(
      "extract_content",
      extractContent.inputSchema,
      extractContent.inputExamples
    )
  })
})
