# PR 1 results — single-pass branch context (2026-07-22)

Companion to `2026-07-22-chat-performance-baseline.md` (same machine, same
fixture revision, same commands). PR 1 registers the shared-context candidate
in `benchmarks/chat-performance/branch-projection.bench.ts`; both
implementations run in the same process after warm-up and are hash-asserted
equivalent before timing.

## Equivalence

- `assertProjectionEquivalence` passes for per-call adapters vs single-pass
  context on the 575/1,150-row trees (hashes `4a062f446ff7b783` /
  `28eda0330f8c4e4e`, unchanged from the baseline run), all six named
  fixtures, and the 200-seed sweep.
- `convex/domain/message_branches.property.test.ts`: every context operation
  (selected path, effective parents, sibling groups/order, next/missing
  branch indexes, descriptors, normalization patches) equals the verbatim
  pre-change implementation (`message_branches_legacy_fixture.ts`) over named
  fixtures, deterministic trees, and 200 seeded randomized trees — for both
  the adapter path and the shared-context path.
- `convex/domain/message_branch_writes.property.test.ts`: 60 seeded
  randomized writer sequences (select/edit/regenerate-shaped ops over empty,
  legacy-linear, and anomalous trees) produce the exact same ordered
  patch/insert log, patch sets, `updatedAt` bumps, outcomes/errors, and final
  table state as the pre-change writer, with `CHAT_SINGLE_PASS_BRANCH_CONTEXT`
  off and on.

## Benchmark (vitest bench, this machine)

Environment (same as baseline):

```json
{"platform":"darwin","release":"25.5.0","arch":"arm64","cpuModel":"Apple M4 Max","cpuCount":16,"nodeVersion":"v25.8.1","bunVersion":null}
```

| Bench | Per-call adapters (mean) | Single-pass context (mean) |
| --- | ---: | ---: |
| 575-row branched tree | ~21.1 ms/op | ~0.21 ms/op |
| 1,150-row branched tree | ~84.5 ms/op | ~0.42 ms/op |
| 200 seeded randomized trees (sweep) | ~12.8 ms | ~3.6 ms |

## Release gate (blocking in this controlled environment)

`CHAT_PERF_GATES=true bun run test benchmarks/chat-performance/branch-projection-gate.test.ts`
(warm-up 10, samples 50):

```
1150-row median=0.35ms p95=0.47ms; 575-row median=0.16ms p95=0.20ms
```

p95 0.47 ms ≪ the ≈5 ms gate (plan §8.1 #2). The hash-equivalence half of the
gate test is unconditional and runs in the normal suite.

## Rollout state

- `CHAT_SINGLE_PASS_BRANCH_CONTEXT` defaults **off** (per-call rebuild — the
  pre-PR-1 work pattern). Enable per plan §9.2 after the staging shadow soak.
- Shadow comparisons: `bunx convex run branchContextShadow:compareForChat
  '{"chatId": "<id>"}'` (internal, non-reactive, content-free output). Zero
  mismatches required before enabling the flag for mutation consumers.
