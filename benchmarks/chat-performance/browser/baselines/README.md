# Browser performance baselines

PR comparisons capture the merge-base product and candidate sequentially on the
same CI runner/browser, with identical measurement code, fixtures, dependencies,
and configuration. Scheduled/manual runs default to the first parent; manual
`comparison_ref` may select another ancestor, never the candidate itself.
Raw captures and source hashes live in CI artifacts, not committed JSON snapshots.
Missing or failed reference acquisition blocks comparison; there is no fallback.

Validity/compatibility, relative regression, and absolute targets are separate
results. Strict CLI mode is the default. Explicit `--regression-only` still fails
invalid evidence and regressions, but reports unchanged absolute targets
separately. A valid slow reference is permitted in that mode. Collection alone
never certifies regression protection. See ADR-0037 for the approved policy.

Comparability requires matching schema/measurement versions, exact browser,
CPU model/count, memory class, fixture hash, identity, build class, instrumentation,
typing cadence, replay/account-readiness policies, suite, scenario conditions,
and complete samples.
A personal-session Mac capture cannot seed isolated Linux CI comparisons.
Measurement changes require a reviewed overlay; never relabel older captures.

Current protocols include `dom-frame-v3`, 40 ms typing, `disabled-v1` replay,
`matching-account-v1` admission readiness, `publisher-frame-v1` streamed content,
`native-presentation-v1` scrolling, `activation-v1` menus, and
`late-typing-native-wheel-menu-v2` probe order. Older captures cannot be relabeled.
Send control enablement is distinct from simultaneous enabled/admitted readiness.
Scroll uses a complete, uniquely anchored native compositor presentation interval;
lost, missing, or ambiguous trace evidence fails. Native traces are retained as CI
artifacts in normal runs, without CPU profiling. DOM/frame proxies and Chromium
presentation signals do not establish physical pixel timing or INP.
CPU-profiled captures remain diagnostic and cannot certify a performance baseline.

External JSON paths and directories remain supported for inspecting reviewed
captures. Directory selection requires exactly one matching environment;
zero/duplicate matches or invalid JSON fail. Scenario coverage and budgets are
checked after selection. Never raise thresholds or remove slow samples.

```sh
# First evidence: correctness, coverage and strict targets; no relative comparison.
bun run benchmarks/chat-performance/browser/compare-results.ts --collect-baseline path/to/current.json

# Explicit relative policy, with absolute targets reported separately.
bun run benchmarks/chat-performance/browser/compare-results.ts --regression-only path/to/base.json path/to/current.json
```

Historical thread-switch captures: [9V74 baseline](https://github.com/darknightdesigner/not-a-wrapper/actions/runs/33958084155)
at `7026cbad`, [7763 collection](https://github.com/darknightdesigner/not-a-wrapper/actions/runs/33960196987)
at `36f21d1b`, and [independent 9V74 comparison](https://github.com/darknightdesigner/not-a-wrapper/actions/runs/33966180716)
at `905f042f`. All retained slow long-chat samples remain part of that evidence.
The 7763 collection did not establish a passing independent comparison.

Heap evidence requires `forced-gc-v1` and successful GC/readings at every
checkpoint. Older unmarked latency captures have diagnostic-only heap readings.
The `905f042f` comparison recorded 25.253/26.012/38.970/27.125 MiB at
0/10/25/50 switches. Checkpoint 25 mounted the long chat; 10 and 50 mounted
the same short chat. This finite traversal is not proof against leaks.
See `docs/performance/2026-09-05-interaction-optimizations.md` for release evidence.
