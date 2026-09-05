# 38. Reuse context-free Markdown block parses

- Status: accepted; correctness and bounded heap validated, delivery budgets remain unmet
- Date: 2026-09-05
- Amends: ADR-0016's projection/render boundary

## Context

The standard slab capture passes content correctness but misses the 50 ms
arrival-to-content budget. A diagnostic trace shows repeated parsing in the
projection and in ReactMarkdown: each 4 KB arrival prepares dozens of renderer
pipelines. Later slabs have less than 1 ms of style recalculation, so the
separate Activity-host selector correction cannot explain away that work.

## Decision

Keep the existing projection parser and ReactMarkdown renderer. Retain an
eligible block's parser result alongside its exact source. For stable,
context-free blocks, supply an isolated, cloned syntax tree through a public
remark parser plugin. All existing remark transforms, rehype transforms, URL
handling, and app components still run. The projection's tree remains immutable
across rendering and abandoned React work.

Growing or mended content, custom renderers, and any parse window containing
reference, definition, footnote, or HTML semantics keep canonical parsing.
Indented starts, overlapping spans, and code-carried contexts also fall back.
Node positions must match isolated-source coordinates; optimization must not
silently change component or plugin inputs. Existing source, block identity,
settlement verification, and fallback behavior remain authoritative.

## Alternatives

- Keep duplicate parsing: simplest, but the captured slab failures remain.
- Group blocks: fewer renderer pipelines, but changes reference scope and can
  remount existing content as groups change.
- Replace ReactMarkdown or move parsing to a worker: potentially larger gains,
  but adds a new rendering or scheduling boundary with broader parity risk.

The narrow reuse keeps existing dependencies and transformation ownership.
Canonical DOM parity and avoided parsing are demonstrated, and fresh unprofiled
measurements plus a confirmed-GC navigation capture bound its current footprint.
Retaining syntax trees increases active-message memory. This optimization does
not meet every delivery budget; no failed capture becomes an accepted baseline.

## Correctness evidence

The implementation at `d3400af7` passes 144 focused Markdown/projection tests.
An independent review compared 5,978 eligible blocks across 5,418 parse windows
with isolated canonical ASTs, including node positions, with zero remaining
mismatches. The two discovered definition-carrier/overlapping-span cases fall
back. A mutation test confirms that disabling reuse restores the redundant
renderer parses. This establishes semantics and skipped work, not a latency
improvement or acceptable retained heap.

## Hosted evidence and limits

The unprofiled standard capture at `8ed2237d` has 65 ms slab median versus
78.5 ms in the earlier same-environment capture; intervening CSS changes prevent
attributing the entire difference to syntax reuse. Fourteen of fifteen slab
observations still exceed 50 ms. A fresh profile confirms retained-block renderer
parsing is a small remaining cost; canonical projection and real transforms
still consume time.

The `905f042f` navigation capture passes its exact-environment comparison and
records successful forced GC at all checkpoints. The mounted long answer uses
38.970 MiB; the later short-chat checkpoint uses 27.125 MiB. This is bounded
workload evidence, not proof against leaks or a causal comparison with older
GC-unverified heap readings. Detailed artifacts and limitations are recorded in
`docs/performance/2026-09-05-interaction-optimizations.md`.
