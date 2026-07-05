#!/usr/bin/env bun
/**
 * Live smoke test for the OpenRouter integration.
 *
 * Exercises the REAL production construction path — catalog entry →
 * `createLanguageModel(config, apiKey)` → Provider strategy →
 * `@openrouter/ai-sdk-provider` `.chat(id, { reasoning })` → real streamText —
 * against the live OpenRouter API, and checks the live catalog for drift
 * (the 2026-07-04 delisting incident class: `:free` ids vanish and pools
 * saturate; see lib/models/data/openrouter.ts header).
 *
 * Run:  bun run smoke:openrouter                       (keyless: catalog checks)
 *       bun run smoke:openrouter -- --model <id>       (target one entry)
 *       bun run smoke:openrouter -- --paid             (keyed: include paid models)
 * Key:  OPENROUTER_API_KEY from the shell or .env.local. The key is always
 *       passed explicitly into createLanguageModel — the same arm production
 *       uses for both BYOK and env-resolved keys. Set SMOKE_OPENROUTER_KEY to
 *       try a different key (e.g. a user's) without touching .env.local.
 *
 * Cost: keyed mode generates against `:free` entries only ($0.00; counts
 *       against the free-tier daily cap) unless --paid is passed. --paid
 *       prints an estimated cost table first (≈60 input + ≤600 output tokens
 *       per model at catalog prices — the whole paid set is well under
 *       $0.25/run) and caps generations at 600 output tokens.
 *
 * Not wired into CI: it needs a live key and the free pool saturates at peak
 * hours — treat failures here as diagnosis input, not build health.
 */
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { openrouterModels } from "@/lib/models/data/openrouter"
import { createLanguageModel } from "@/lib/openproviders/create-language-model"
import { streamText } from "ai"

const MODELS_ENDPOINT = "https://openrouter.ai/api/v1/models"
const PER_MODEL_TIMEOUT_MS = 60_000

type Verdict = {
  model: string
  status: "OK" | "FAIL"
  detail: string
}

function loadDotEnvLocal(): void {
  const envPath = fileURLToPath(new URL("../.env.local", import.meta.url))
  if (!existsSync(envPath)) return
  for (const rawLine of readFileSync(envPath, "utf8").split("\n")) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq <= 0) continue
    const key = line
      .slice(0, eq)
      .replace(/^export\s+/, "")
      .trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

function classifyFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()
  if (lower.includes("no endpoints")) {
    return `DELISTED or blocked by account data policy — refresh the catalog (lib/models/data/openrouter.ts) and add a succession in model-id-migration.ts, or check openrouter.ai/settings/privacy. (${message})`
  }
  if (lower.includes("rate limit") || lower.includes("429")) {
    return `Free pool saturated or free-tier daily cap hit (50/day under $10 lifetime credits) — retry off-peak. (${message})`
  }
  if (lower.includes("401") || lower.includes("unauthorized")) {
    return `Key rejected — verify OPENROUTER_API_KEY / the saved BYOK key. (${message})`
  }
  if (lower.includes("timeout") || lower.includes("abort")) {
    return `Timed out after ${PER_MODEL_TIMEOUT_MS}ms — likely pool congestion. (${message})`
  }
  return message
}

async function checkLiveCatalog(
  models: readonly (typeof openrouterModels)[number][]
): Promise<Verdict[]> {
  const verdicts: Verdict[] = []
  const response = await fetch(MODELS_ENDPOINT, {
    signal: AbortSignal.timeout(PER_MODEL_TIMEOUT_MS),
  })
  if (!response.ok) {
    return models.map((config) => ({
      model: config.id,
      status: "FAIL",
      detail: `${MODELS_ENDPOINT} returned ${response.status} — cannot verify listing`,
    }))
  }
  const body = (await response.json()) as {
    data: Array<{ id: string; supported_parameters?: string[] }>
  }
  const liveById = new Map(body.data.map((entry) => [entry.id, entry]))

  for (const config of models) {
    const bareId = config.id.replace(/^openrouter:/, "")
    const live = liveById.get(bareId)
    if (!live) {
      verdicts.push({
        model: config.id,
        status: "FAIL",
        detail:
          "Not in the live /api/v1/models listing — delisted. Refresh the catalog and add a succession in model-id-migration.ts.",
      })
      continue
    }
    if (
      config.reasoningText &&
      !(live.supported_parameters ?? []).includes("reasoning")
    ) {
      verdicts.push({
        model: config.id,
        status: "FAIL",
        detail:
          "Catalog says reasoningText:true but live supported_parameters no longer includes 'reasoning' — catalog drift.",
      })
      continue
    }
    verdicts.push({ model: config.id, status: "OK", detail: "listed live" })
  }
  return verdicts
}

async function smokeModel(
  config: (typeof openrouterModels)[number],
  apiKey: string,
  options: { maxOutputTokens?: number } = {}
): Promise<Verdict> {
  try {
    const result = streamText({
      model: createLanguageModel(config, apiKey),
      prompt: "Smoke test: reply with exactly one word: ok",
      abortSignal: AbortSignal.timeout(PER_MODEL_TIMEOUT_MS),
      // Paid mode caps spend while leaving room for reasoning tokens so
      // reasoning models still produce text after thinking.
      ...(options.maxOutputTokens
        ? { maxOutputTokens: options.maxOutputTokens }
        : {}),
    })

    let sawReasoningDelta = false
    for await (const part of result.fullStream) {
      if (part.type === "reasoning-delta") sawReasoningDelta = true
      if (part.type === "error") throw part.error
    }

    const [text, finishReason, usage] = await Promise.all([
      result.text,
      result.finishReason,
      result.totalUsage,
    ])

    const problems: string[] = []
    if (finishReason !== "stop") {
      problems.push(`finishReason "${finishReason}" (expected "stop")`)
    }
    if (!text.trim()) problems.push("empty text")
    if (!usage.outputTokens || usage.outputTokens <= 0) {
      problems.push("no output-token usage reported")
    }
    // The V3-shim seam: construction-time reasoning config must actually
    // produce reasoning deltas (ai@7's unified per-call reasoning option is
    // silently ignored by the V3 OpenRouter provider — provider-strategy.ts).
    if (config.reasoning && !sawReasoningDelta) {
      problems.push(
        "construction-time reasoning configured but no reasoning-delta arrived (V3 shim seam regression?)"
      )
    }

    if (problems.length > 0) {
      return { model: config.id, status: "FAIL", detail: problems.join("; ") }
    }
    return {
      model: config.id,
      status: "OK",
      detail:
        `"${text.trim().slice(0, 40)}" · ${usage.inputTokens ?? "?"}in/` +
        `${usage.outputTokens ?? "?"}out` +
        `${sawReasoningDelta ? " · reasoning ✓" : ""}`,
    }
  } catch (error) {
    return { model: config.id, status: "FAIL", detail: classifyFailure(error) }
  }
}

const ESTIMATED_INPUT_TOKENS = 60
const PAID_MAX_OUTPUT_TOKENS = 600

function isFreeModel(config: (typeof openrouterModels)[number]): boolean {
  return (config.inputCost ?? 0) === 0 && (config.outputCost ?? 0) === 0
}

function estimatedCostUsd(config: (typeof openrouterModels)[number]): number {
  return (
    (ESTIMATED_INPUT_TOKENS / 1_000_000) * (config.inputCost ?? 0) +
    (PAID_MAX_OUTPUT_TOKENS / 1_000_000) * (config.outputCost ?? 0)
  )
}

async function main(): Promise<void> {
  loadDotEnvLocal()
  const args = process.argv.slice(2)
  const paidMode = args.includes("--paid")
  const modelFlagIndex = args.indexOf("--model")
  const targetModelId = modelFlagIndex >= 0 ? args[modelFlagIndex + 1] : null
  if (modelFlagIndex >= 0 && !targetModelId) {
    console.error("--model requires a catalog id argument")
    process.exit(1)
  }

  const selectedModels = targetModelId
    ? openrouterModels.filter((config) => config.id === targetModelId)
    : openrouterModels
  if (targetModelId && selectedModels.length === 0) {
    console.error(
      `Unknown catalog id "${targetModelId}". Valid ids:\n` +
        openrouterModels.map((config) => `  ${config.id}`).join("\n")
    )
    process.exit(1)
  }

  const apiKey =
    process.env.SMOKE_OPENROUTER_KEY || process.env.OPENROUTER_API_KEY
  const keySource = process.env.SMOKE_OPENROUTER_KEY
    ? "SMOKE_OPENROUTER_KEY override"
    : "OPENROUTER_API_KEY"

  // Explicitly targeting a paid entry with --model is a request to actually
  // exercise it; without --paid the generation would be silently skipped and
  // the run would exit 0 having generated nothing — reading as "verified" to a
  // human or a CI wrapper. Fail loudly instead.
  if (apiKey && targetModelId && !paidMode && !isFreeModel(selectedModels[0]!)) {
    console.error(
      `"${targetModelId}" is a paid model; a keyed run skips it without --paid, ` +
        `so nothing would be generated. Re-run with --paid to spend real ` +
        `credits on a live generation:\n` +
        `  SMOKE_OPENROUTER_KEY=… bun run smoke:openrouter -- --paid --model ${targetModelId}`
    )
    process.exit(1)
  }

  console.log(
    `OpenRouter smoke — ${
      apiKey ? `key present (${keySource})` : "NO KEY (catalog checks only)"
    }, ${selectedModels.length} catalog model(s)${paidMode ? ", PAID mode" : ""}\n`
  )

  console.log("1) Live catalog listing")
  const catalogVerdicts = await checkLiveCatalog(selectedModels)
  for (const verdict of catalogVerdicts) {
    console.log(
      `   ${verdict.status === "OK" ? "✓" : "✗"} ${verdict.model} — ${verdict.detail}`
    )
  }

  const generationVerdicts: Verdict[] = []
  if (apiKey) {
    // Keyed generation spends real money on paid entries — default to the
    // `:free` set; --paid opts into the full selection with a cost preview.
    const generationModels = paidMode
      ? selectedModels
      : selectedModels.filter(isFreeModel)
    const skippedPaidCount = selectedModels.length - generationModels.length

    if (paidMode) {
      const paidModels = generationModels.filter(
        (config) => !isFreeModel(config)
      )
      if (paidModels.length > 0) {
        console.log(
          `\n   Estimated cost (≈${ESTIMATED_INPUT_TOKENS} input + ≤${PAID_MAX_OUTPUT_TOKENS} output tokens each):`
        )
        let total = 0
        for (const config of paidModels) {
          const cost = estimatedCostUsd(config)
          total += cost
          console.log(`     $${cost.toFixed(4)}  ${config.id}`)
        }
        console.log(`     $${total.toFixed(4)}  TOTAL`)
      }
    }

    console.log("\n2) Live streamed generation through the production factory")
    if (skippedPaidCount > 0) {
      console.log(
        `   (skipping ${skippedPaidCount} paid model(s) — pass --paid to include them)`
      )
    }
    for (const config of generationModels) {
      const verdict = await smokeModel(
        config,
        apiKey,
        paidMode ? { maxOutputTokens: PAID_MAX_OUTPUT_TOKENS } : {}
      )
      generationVerdicts.push(verdict)
      console.log(
        `   ${verdict.status === "OK" ? "✓" : "✗"} ${verdict.model} — ${verdict.detail}`
      )
    }
  } else {
    console.log(
      "\n2) SKIPPED live generation — no key in the shell or .env.local.\n" +
        "   The app resolves OpenRouter via a BYOK key stored in Convex, which\n" +
        "   this script cannot decrypt. Run the full smoke with your key:\n" +
        "     SMOKE_OPENROUTER_KEY=your-openrouter-key bun run smoke:openrouter\n" +
        "   or add OPENROUTER_API_KEY to .env.local."
    )
  }

  const failures = [...catalogVerdicts, ...generationVerdicts].filter(
    (verdict) => verdict.status === "FAIL"
  )
  console.log(
    `\n${failures.length === 0 ? "All checks passed." : `${failures.length} check(s) failed.`}`
  )
  process.exit(failures.length === 0 ? 0 : 1)
}

void main()
