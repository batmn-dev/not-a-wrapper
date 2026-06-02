---
name: sentry-p2-operations
description: Maintain and operate Sentry P2 observability assets for chat reliability. Use when tuning alert thresholds, editing Sentry query packs/templates, changing release guardrails, or adjusting provider/model/tool reliability dimensions.
---

# Sentry P2 Operations

Operate Sentry P2 observability assets without drifting from the canonical runbooks in `docs/observability/`.

## Source of Truth

- Canonical docs and templates live in `docs/observability/`.
- This skill standardizes workflow and safety checks; it does not replace canonical documentation.

## When to Use This Skill

Use for:
- alert threshold tuning
- adding or changing Sentry queries
- release regression guardrail changes
- provider/model/tool reliability tuning (`chat_provider`, `chat_model`, `chat_error_type`, `chat_tool_outcome`)

## Required Inputs

Collect these before making edits:
- target environment: `staging` or `production`
- intended SLO/threshold changes (current -> proposed)
- impacted dimensions (provider/model/tool/error class/latency bucket)
- incident context (ticket, alert link, timeframe, blast radius), if any

## Mandatory Preflight Checklist

Do all steps before editing files:

1. Read repository constraints:
   - `AGENTS.md`
   - `CLAUDE.md`
2. Read canonical observability docs:
   - `docs/observability/sentry-p2-reliability.md`
   - `docs/observability/sentry-p2-alerts.md`
   - `docs/observability/sentry-p2-queries.md`
   - `docs/observability/sentry-p2-alerts.json`
3. Inspect current instrumentation fields and taxonomy:
   - `app/api/chat/route.ts`
   - `lib/observability/chat-error-taxonomy.ts`
   - `lib/observability/sentry-tracing.ts`
   - `lib/observability/sentry-scrubbing.ts`
4. Validate low-cardinality policy:
   - keep identifiers like `chatId`/`requestId` in context/extra, not tags
   - only bounded enums/buckets in tags (`chat_error_type`, `chat_tool_outcome`, latency buckets)
5. Confirm privacy guardrails remain intact:
   - scrubbing hooks stay wired in Sentry init files
   - no unsafe prompt/tool input/output logging
6. Run targeted context sweep before non-trivial changes:
   - search: `observability|sentry|telemetry|gen_ai|tracesSampler|chat_error_type|chat_tool_outcome`
   - review relevant matches in source, `docs/observability/`, and any user-provided external context

If preflight finds conflicting guidance, pause and reconcile with canonical docs first.

## Workflow

1. **Assess scope**
   - classify change: threshold-only, query semantics, telemetry contract, or guardrail policy
   - identify affected artifacts (docs, JSON templates, instrumentation)
2. **Update canonical docs first**
   - if behavior, semantics, or thresholds change, edit `docs/observability/*.md` first
   - document rationale and intended operational effect
3. **Update alert templates**
   - apply matching edits to `docs/observability/sentry-p2-alerts.json`
   - keep query fields, formula/aggregate, windows, and thresholds aligned with docs
4. **Verify doc/template consistency**
   - ensure thresholds and query logic are identical across reliability/queries/alerts docs and JSON
   - ensure dimensions referenced by queries exist in route instrumentation and taxonomy
5. **Produce rollout + rollback notes**
   - rollout: environment, order, and monitoring window
   - rollback: exact fields/thresholds/queries to revert

## Guardrails

- Avoid high-cardinality tags.
- Do not log secrets, tokens, raw prompts, or unsafe tool payloads.
- Preserve `lib/observability/sentry-scrubbing.ts` protections and init wiring.
- Do not alter unrelated Sentry config or non-observability subsystems.
- Keep diffs focused to observability artifacts requested by the task.

## Validation Checklist

- **If code changed**: run
  - `bun run lint`
  - `bun run typecheck`
- Docs consistency:
  - thresholds in docs match `sentry-p2-alerts.json`
  - query semantics match between `sentry-p2-queries.md` and JSON templates
- Alert template sanity:
  - required query fields exist (`query` or `queries`)
  - formula/aggregate/anomaly/guardrail blocks are present where expected
  - environment and dedupe identifiers are still coherent

## Output Contract

Always return:
- files changed
- exact thresholds changed (old -> new)
- query deltas (old -> new)
- residual risks / assumptions
- post-deploy verification steps (what to check in Sentry, and for how long)
