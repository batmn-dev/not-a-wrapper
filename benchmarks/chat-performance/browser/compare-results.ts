import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import {
  checkBudgets,
  compareResults,
  ENVIRONMENT_FIELDS,
  resultContract,
  validateCoverage,
  type ComparableResult,
} from "./result-contract"

// Collection is explicit and never masquerades as a regression comparison.
const [baselinePath, currentPath] = process.argv.slice(2)
try {
  if (!baselinePath || !currentPath)
    throw new Error(
      "usage: compare-results.ts <baseline.json|baseline-directory|--collect-baseline> <current.json>"
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
              .map((entry) => ({
                path: join(baselinePath, entry.name),
                result: readBaseline(join(baselinePath, entry.name)),
              }))
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
