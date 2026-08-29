/**
 * Branch-projection benchmark.
 *
 * Compares the per-call adapters with the production single-context path.
 *
 * Run with: bun run bench:chat
 * Record results per docs/measurements/2026-07-22-chat-performance-baseline.md.
 */
import { bench, describe } from "vitest"
import {
  assertProjectionEquivalence,
  buildDeterministicBranchTree,
  buildRandomBranchTree,
  buildRandomBranchTreeSeeds,
  arrayAdapterBranchImplementation,
  describeBenchEnvironment,
  NAMED_BRANCH_FIXTURES,
  singlePassBranchImplementation,
  type BranchProjectionImplementation,
} from "./fixtures"

const IMPLEMENTATIONS: BranchProjectionImplementation[] = [
  arrayAdapterBranchImplementation,
  singlePassBranchImplementation,
]

const tree575 = buildDeterministicBranchTree(575)
const tree1150 = buildDeterministicBranchTree(1150)
const namedFixtures = Object.entries(NAMED_BRANCH_FIXTURES).map(
  ([name, build]) => [name, build()] as const
)
const randomTrees = buildRandomBranchTreeSeeds(200).map((seed) =>
  buildRandomBranchTree(seed)
)

// Every implementation must produce identical output before timing matters.
console.log(
  "[chat-performance] environment:",
  JSON.stringify(await describeBenchEnvironment())
)
console.log(
  "[chat-performance] 575-row projection hash:",
  assertProjectionEquivalence(IMPLEMENTATIONS, tree575, "575-row tree")
)
console.log(
  "[chat-performance] 1150-row projection hash:",
  assertProjectionEquivalence(IMPLEMENTATIONS, tree1150, "1150-row tree")
)

for (const implementation of IMPLEMENTATIONS) {
  describe(`branch projection — ${implementation.name}`, () => {
    // The adapter baseline is slow on large trees, so keep runs bounded.
    bench(
      "575-row branched tree",
      () => {
        implementation.project(tree575)
      },
      { warmupIterations: 2, iterations: 5, time: 0, warmupTime: 0 }
    )

    bench(
      "1,150-row branched tree",
      () => {
        implementation.project(tree1150)
      },
      { warmupIterations: 2, iterations: 5, time: 0, warmupTime: 0 }
    )

    for (const [name, fixture] of namedFixtures) {
      bench(
        `named fixture: ${name}`,
        () => {
          implementation.project(fixture)
        },
        { warmupIterations: 5, iterations: 20, time: 0, warmupTime: 0 }
      )
    }

    bench(
      "200 seeded randomized trees (sweep)",
      () => {
        for (const tree of randomTrees) implementation.project(tree)
      },
      { warmupIterations: 1, iterations: 3, time: 0, warmupTime: 0 }
    )
  })
}
