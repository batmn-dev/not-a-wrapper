# Chat performance baseline — PR 0a (2026-07-22)

Repository-owned reproduction of the supplied branch/Markdown/Shiki findings
(plan: `docs/gameplans/chat-responsiveness-performance-implementation-plan.md`,
PR 0a). This note records the commands, environment, and one baseline run.
Exact historical numbers from the supplied external benchmark are **not** a
gate — only direction and output-hash equivalence are (plan §3.3).

## Commands

```bash
bun run bench:chat   # branch-projection + render-stream benchmarks
bun run bench        # every vitest benchmark
bun run test         # includes benchmarks/chat-performance/fixtures.test.ts
```

Benchmarks live in `benchmarks/chat-performance/` and run through
`vitest bench` (config: `benchmark.include` in `vitest.config.ts`). They are
excluded from the normal test run; the deterministic fixture tests
(`fixtures.test.ts`) run in the normal suite.

## Recording protocol

Every recorded run must capture:

- The `[chat-performance] environment:` JSON line each bench file prints
  (platform, OS release, arch, CPU model/count, Node/Bun version).
- Warm-up and sample counts (printed per bench row; configured per bench in
  the bench files).
- Median (tinybench `mean`/`p75` rows; use the printed table) and worst-case
  percentiles per bench row.
- The `575-row projection hash` / `1150-row projection hash` lines — output
  hashes must be identical across implementations and across runs on the same
  fixture revision.
- Shiki highlighter initialization, printed separately from highlight cost.

Raw terminal output stays local (or in the PR description); traces containing
payload text are never attached to public issues.

## Baseline run (this machine)

Environment:

```json
{"platform":"darwin","release":"25.5.0","arch":"arm64","cpuModel":"Apple M4 Max","cpuCount":16,"nodeVersion":"v25.8.1","bunVersion":null}
```

Output hashes (fixture revision = this commit):

- 575-row projection hash: `4a062f446ff7b783`
- 1,150-row projection hash: `28eda0330f8c4e4e`

Branch projection (current implementation, warmup 2, samples 5 for the large
trees):

| Bench | Mean |
| --- | ---: |
| 575-row branched tree | ~21.6 ms/op |
| 1,150-row branched tree | ~85.0 ms/op |
| 200 seeded randomized trees (sweep) | ~13.8 ms/op |

Direction reproduced: doubling rows roughly quadruples projection cost
(repeated context rebuild per helper call — the PR 1 target). Absolute values
are far below the supplied ~243 ms / ~1,020 ms figures because this machine
differs; the superlinear growth is the preserved finding.

Markdown / Shiki / render (warm highlighter; Shiki init ~66 ms recorded
separately):

| Bench | Mean |
| --- | ---: |
| Markdown: split settled ~12 KB once | ~9.8 ms/op |
| Markdown: re-split across 41 growth states | ~193 ms/op (~4.7 ms/update) |
| React render settled payload once | ~35 ms/op |
| React render 10 growth states | ~197 ms/op |
| Shiki: settled 400-line highlight once | ~15.5 ms/op |
| Shiki: re-highlight across 45 growth states | ~357 ms/op (~7.9 ms/delta) |

Direction reproduced: streaming replay costs scale with accumulated payload
and dominate the settled-once cost (~20× for the splitter, ~23× for Shiki at
these sample counts; a full per-delta replay is proportionally larger).

## PR 1 gate hook

PR 1 registers its shared-context candidate in
`benchmarks/chat-performance/branch-projection.bench.ts` (`IMPLEMENTATIONS`)
and must show:

- identical projection hashes for legacy vs candidate on the 575/1,150-row
  trees, all named fixtures, and ≥200 seeded randomized trees;
- 1,150-row candidate ≈5 ms p95 after warm-up in this documented environment
  (blocking in the controlled benchmark environment, not on shared CI runners).
