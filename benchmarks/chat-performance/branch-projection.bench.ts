/**
 * Branch-projection benchmark (plan PR 0a, step 2).
 *
 * Reproduces the supplied branch finding in a repository-owned harness:
 * the current `convex/domain/message_branches.ts` helpers rebuild their
 * context per call, so full projection cost grows superlinearly with row
 * count. PR 1 registers its shared-context candidate in IMPLEMENTATIONS;
 * until then the current implementation is both legacy and candidate.
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
  currentBranchImplementation,
  describeBenchEnvironment,
  NAMED_BRANCH_FIXTURES,
  type BranchProjectionImplementation,
} from "./fixtures"

const IMPLEMENTATIONS: BranchProjectionImplementation[] = [
  currentBranchImplementation,
]

const tree575 = buildDeterministicBranchTree(575)
const tree1150 = buildDeterministicBranchTree(1150)
const namedFixtures = Object.entries(NAMED_BRANCH_FIXTURES).map(
  ([name, build]) => [name, build()] as const
)
const randomTrees = buildRandomBranchTreeSeeds(200).map((seed) =>
  buildRandomBranchTree(seed)
)

// Environment + equivalence recorded once per run: every registered
// implementation must produce identical output hashes before timing means
// anything.
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
    // The large trees are slow on the current implementation (~hundreds of
    // ms/op); fixed low iteration counts keep one bench run bounded.
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
