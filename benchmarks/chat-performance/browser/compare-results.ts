import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import {
  assessComparison,
  checkBudgets,
  ENVIRONMENT_FIELDS,
  resultContract,
  validateCoverage,
  UI_BUDGETS,
  type ComparableResult,
} from "./result-contract"

const args = process.argv.slice(2)
const regressionOnly = args.includes("--regression-only")
const paths = args.filter((arg) => arg !== "--regression-only")
const [baselinePath, currentPath] = paths
let measurementErrors: string[] = []
let regressions: string[] | null = null
let targetFailures: string[] | null = null
let targetsApplicable = true

try {
  if (paths.length !== 2 || !baselinePath || !currentPath)
    throw new Error(
      "usage: compare-results.ts [--regression-only] <baseline.json|baseline-directory|--collect-baseline> <current.json>"
    )
  const current = resultContract.parse(JSON.parse(readFileSync(currentPath, "utf8")))
  measurementErrors = validateCoverage(current).map((error) => `current: ${error}`)
  if (!measurementErrors.length) {
    targetFailures = checkBudgets(current)
    targetsApplicable = current.scenarios.some((scenario) =>
      scenario.cpuThrottle === 1 && scenario.network === "unthrottled" &&
      scenario.runs.some((run) => Object.keys(UI_BUDGETS).some((metric) => run.ui?.[metric]?.length))
    )
  }

  if (baselinePath !== "--collect-baseline") {
    if (!existsSync(baselinePath))
      throw new Error(
        `Missing baseline: ${baselinePath}. Performance regression protection is NOT armed. Use explicit --collect-baseline to review a first capture.`
      )
    const readBaseline = (path: string) => {
      try {
        return resultContract.parse(JSON.parse(readFileSync(path, "utf8")))
      } catch (error) {
        throw new Error(`Invalid baseline ${path}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    let baseline: ComparableResult
    if (statSync(baselinePath).isDirectory()) {
      const matches = readdirSync(baselinePath, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((entry) => ({ path: join(baselinePath, entry.name), result: readBaseline(join(baselinePath, entry.name)) }))
        .filter(({ result }) => ENVIRONMENT_FIELDS.every((field) => result[field] === current[field]))
      if (matches.length !== 1) {
        const environment = Object.fromEntries(ENVIRONMENT_FIELDS.map((field) => [field, current[field]]))
        throw new Error(
          matches.length === 0
            ? `No matching baseline in ${baselinePath} for ${JSON.stringify(environment)}. Performance regression protection is NOT armed. Collect and review this exact environment.`
            : `Multiple matching baselines in ${baselinePath}: ${matches.map((match) => match.path).join(", ")}. Keep exactly one reviewed baseline per environment.`
        )
      }
      baseline = matches[0].result
      console.log(`[compare-results] selected baseline: ${matches[0].path}`)
    } else {
      baseline = readBaseline(baselinePath)
    }
    const report = assessComparison(baseline, current)
    measurementErrors = report.measurementErrors
    regressions = report.regressions
  }
} catch (error) {
  measurementErrors.push(error instanceof Error ? error.message : String(error))
}

function reportCategory(name: string, failures: string[] | null) {
  console.log(`[compare-results] ${name}: ${failures === null ? "NOT EVALUATED" : failures.length ? "FAIL" : "PASS"}`)
  for (const failure of failures ?? []) console.error(`[compare-results] ${failure}`)
}
reportCategory("measurement validity and comparison compatibility", measurementErrors)
reportCategory("relative regression", regressions)
if (targetsApplicable) reportCategory("responsiveness targets", targetFailures)
else console.log("[compare-results] responsiveness targets: NOT APPLICABLE (no eligible target samples)")

const failed = measurementErrors.length > 0 || (regressions?.length ?? 0) > 0 ||
  (!regressionOnly && (targetFailures?.length ?? 0) > 0)
console.log(`[compare-results] ${regressionOnly ? "regression-only" : "strict"} policy: ${failed ? "FAIL" : "PASS"}`)
if (baselinePath === "--collect-baseline")
  console.log("[compare-results] baseline collection only; no relative regression comparison performed")
if (regressionOnly)
  console.log("[compare-results] responsiveness targets reported separately; policy success does not certify target compliance")
if (failed) process.exitCode = 1
