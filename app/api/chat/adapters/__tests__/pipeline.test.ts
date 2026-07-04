import type { ModelMessage } from "ai"
import { convertToModelMessages } from "ai"
import { describe, expect, it } from "vitest"
import { hasProviderLinkedResponseIds } from "../../utils"
import { adaptHistoryForProvider } from "../index"
import {
  abortedToolConversation,
  crossProviderConversation,
  heavyToolUseConversation,
} from "./fixtures"

const providers = [
  "openai",
  "anthropic",
  "google",
  "xai",
  "mistral",
  "perplexity",
] as const

const modelByProvider: Record<(typeof providers)[number], string> = {
  openai: "gpt-5.2",
  anthropic: "claude-4.5-sonnet",
  google: "gemini-3-pro",
  xai: "grok-4",
  mistral: "mistral-large",
  perplexity: "sonar-pro",
}

// Phase 4B references this fixture name. Current fixtures export it as heavyToolUseConversation.
const multiStepToolConversation = heavyToolUseConversation

type ModelContentPart = Record<string, unknown> & {
  type?: string
  toolCallId?: string
}

function toContentParts(message: ModelMessage): ModelContentPart[] {
  if (!("content" in message)) return []
  const content = message.content
  return Array.isArray(content) ? (content as ModelContentPart[]) : []
}

function isToolCallPart(part: ModelContentPart): boolean {
  const type = typeof part.type === "string" ? part.type : ""
  if (type === "tool-call") return true
  if (type.startsWith("tool-") && type !== "tool-result") return true
  return "input" in part
}

function isToolResultPart(part: ModelContentPart): boolean {
  const type = typeof part.type === "string" ? part.type : ""
  if (type === "tool-result") return true
  return "output" in part || "result" in part
}

function assertStructuralValidity(messages: ModelMessage[]): void {
  expect(Array.isArray(messages)).toBe(true)
  for (const message of messages) {
    expect(message).toBeDefined()
    expect(typeof message.role).toBe("string")
    if ("content" in message && Array.isArray(message.content)) {
      expect(message.content.length).toBeGreaterThan(0)
    }
  }
}

function assertNoProviderLinkedIds(messages: ModelMessage[]): void {
  expect(hasProviderLinkedResponseIds(messages)).toBe(false)
  expect(JSON.stringify(messages)).not.toMatch(/\bfc_[a-zA-Z0-9]+\b/)
}

function assertToolCallsHaveResults(messages: ModelMessage[]): void {
  const callCounts = new Map<string, number>()
  const resultCounts = new Map<string, number>()

  for (const message of messages) {
    for (const part of toContentParts(message)) {
      const toolCallId =
        typeof part.toolCallId === "string" ? part.toolCallId : null
      if (!toolCallId) continue
      if (isToolCallPart(part)) {
        callCounts.set(toolCallId, (callCounts.get(toolCallId) ?? 0) + 1)
      }
      if (isToolResultPart(part)) {
        resultCounts.set(toolCallId, (resultCounts.get(toolCallId) ?? 0) + 1)
      }
    }
  }

  for (const [toolCallId, count] of callCounts) {
    expect(count).toBeGreaterThan(0)
    expect(resultCounts.get(toolCallId) ?? 0).toBe(count)
  }
}

function assertNoEmptyContentArrays(messages: ModelMessage[]): void {
  for (const message of messages) {
    if (!("content" in message)) continue
    if (!Array.isArray(message.content)) continue
    expect(message.content.length).toBeGreaterThan(0)
  }
}

for (const provider of providers) {
  describe(`${provider} adapter -> convertToModelMessages pipeline`, () => {
    it("produces structurally valid ModelMessage[] for multi-step tool history", async () => {
      const adapted = await adaptHistoryForProvider(
        multiStepToolConversation,
        provider,
        {
          targetModelId: modelByProvider[provider],
          hasTools: true,
        }
      )

      const modelMessages = await convertToModelMessages(adapted.messages, {
        ignoreIncompleteToolCalls: true,
      })

      assertStructuralValidity(modelMessages)
      assertNoProviderLinkedIds(modelMessages)
      assertToolCallsHaveResults(modelMessages)
      assertNoEmptyContentArrays(modelMessages)
    })

    it("keeps cross-provider history replay-safe after conversion", async () => {
      const adapted = await adaptHistoryForProvider(
        crossProviderConversation,
        provider,
        {
          targetModelId: modelByProvider[provider],
          hasTools: true,
        }
      )

      const modelMessages = await convertToModelMessages(adapted.messages, {
        ignoreIncompleteToolCalls: true,
      })

      assertStructuralValidity(modelMessages)
      assertNoProviderLinkedIds(modelMessages)
      assertToolCallsHaveResults(modelMessages)
      assertNoEmptyContentArrays(modelMessages)
    })

    it("drops aborted/incomplete tool states without breaking conversion invariants", async () => {
      const adapted = await adaptHistoryForProvider(
        abortedToolConversation,
        provider,
        {
          targetModelId: modelByProvider[provider],
          hasTools: true,
        }
      )

      const modelMessages = await convertToModelMessages(adapted.messages, {
        ignoreIncompleteToolCalls: true,
      })

      assertStructuralValidity(modelMessages)
      assertNoProviderLinkedIds(modelMessages)
      assertToolCallsHaveResults(modelMessages)
      assertNoEmptyContentArrays(modelMessages)
    })

    it("supports source-provider A -> target-provider B cross-provider adaptation", async () => {
      for (const sourceProvider of providers) {
        if (sourceProvider === provider) continue

        const adapted = await adaptHistoryForProvider(
          crossProviderConversation,
          provider,
          {
            targetModelId: modelByProvider[provider],
            hasTools: true,
            sourceProviderHint: sourceProvider,
          }
        )

        const modelMessages = await convertToModelMessages(adapted.messages, {
          ignoreIncompleteToolCalls: true,
        })

        assertStructuralValidity(modelMessages)
        assertNoProviderLinkedIds(modelMessages)
        assertToolCallsHaveResults(modelMessages)
        assertNoEmptyContentArrays(modelMessages)
      }
    })
  })
}
