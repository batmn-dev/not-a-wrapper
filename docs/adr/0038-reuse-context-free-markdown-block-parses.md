# 38. Reuse context-free Markdown block parses

- Status: proposed; parity and hosted performance validation pending
- Date: 2026-09-05
- Amends: ADR-0016's projection/render boundary

## Context

The standard slab capture passes content correctness but misses the 50 ms
arrival-to-content budget. A diagnostic trace shows repeated parsing in the
projection and in ReactMarkdown: each 4 KB arrival prepares dozens of renderer
pipelines. Later slabs have less than 1 ms of style recalculation, so the
separate Activity-host selector correction cannot explain away that work.

## Approach under validation

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

The proposed narrow reuse keeps existing dependencies and transformation
ownership. It will be retained only if canonical DOM parity and avoided parsing
are demonstrated, followed by fresh unprofiled measurements. Retaining syntax
trees increases memory; the existing navigation/heap evidence must account for
that cost. No failed capture becomes an accepted baseline.
