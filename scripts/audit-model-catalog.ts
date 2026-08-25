#!/usr/bin/env bun
import {
  auditLogicalModelPriorities,
  LOGICAL_MODELS,
} from "@/lib/models/catalog"

const asOf = new Date()
const issues = auditLogicalModelPriorities(LOGICAL_MODELS, asOf)

if (issues.length === 0) {
  console.log("Model priority audit: no stale recommendation lanes.")
  process.exit(0)
}

console.log(
  `Model priority audit: ${issues.length} recommendation lane(s) need review.`
)
for (const issue of issues) {
  console.log(
    `- ${issue.laneId}: ${issue.modelId} trails ${issue.newestVendorModelId} ` +
      `by ${issue.releaseGapDays} days`
  )
}

console.log("Age requests review; it never changes model classification.")
