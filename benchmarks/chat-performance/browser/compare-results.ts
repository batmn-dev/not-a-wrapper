import { existsSync, readFileSync } from "node:fs"
import {
  checkBudgets,
  compareResults,
  resultContract,
  validateCoverage,
} from "./result-contract"

// Collection is explicit and never masquerades as a regression comparison.
const [baselinePath, currentPath] = process.argv.slice(2)
try {
  if (!baselinePath || !currentPath)
    throw new Error(
      "usage: compare-results.ts <baseline.json|--collect-baseline> <current.json>"
    )
  const current = resultContract.parse(
    JSON.parse(readFileSync(currentPath, "utf8"))
  )
  const errors =
    baselinePath === "--collect-baseline"
      ? [...validateCoverage(current), ...checkBudgets(current)]
      : (() => {
          if (!existsSync(baselinePath))
            throw new Error(
              `Missing baseline: ${baselinePath}. Performance regression protection is NOT armed. Use explicit --collect-baseline to review a first capture.`
            )
          const baseline = resultContract.parse(
            JSON.parse(readFileSync(baselinePath, "utf8"))
          )
          return compareResults(baseline, current)
        })()
  if (errors.length) throw new Error(errors.join("\n"))
  console.log(
    baselinePath === "--collect-baseline"
      ? "[compare-results] collection valid; no relative regression comparison performed"
      : "[compare-results] performance budgets and baseline comparison passed"
  )
} catch (error) {
  console.error(
    `[compare-results] ${error instanceof Error ? error.message : String(error)}`
  )
  process.exitCode = 1
}
