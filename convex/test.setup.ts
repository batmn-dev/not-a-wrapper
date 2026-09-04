/// <reference types="vite/client" />

// Module table for convex-test seam tests (ADR-0034). The Convex CLI never
// deploys this file: it skips any basename with more than one dot (the same
// rule that keeps *.test.ts out of a push), which is also why the glob
// excludes them.
export const modules = import.meta.glob("./**/!(*.*.*)*.*s")
