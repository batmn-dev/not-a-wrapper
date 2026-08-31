import { type UIMessage } from "ai"
import {
  getToolEvidenceName,
  isToolEvidencePart,
  type ToolEvidenceUIPart,
} from "./turn-evidence"

export { extractTextFromMessageParts } from "@/convex/domain/message_facts"

function serializeToolRenderValue(value: unknown): string {
  if (typeof value === "undefined") return "undefined"

  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function getToolRenderValueSignature(
  part: ToolEvidenceUIPart,
  key: "input" | "output"
): string {
  if (key === "input") return serializeToolRenderValue(part.input)
  if (part.state === "output-available") {
    return serializeToolRenderValue(part.output)
  }
  return ""
}

export function getToolRenderSignature(
  parts: UIMessage["parts"] | undefined
): string {
  if (!parts) return ""

  const signatures: Array<[string, string, string, string]> = []
  for (const part of parts) {
    if (isToolEvidencePart(part)) {
      signatures.push([
        getToolEvidenceName(part),
        part.state,
        getToolRenderValueSignature(part, "input"),
        getToolRenderValueSignature(part, "output"),
      ])
    }
  }

  return JSON.stringify(signatures)
}
