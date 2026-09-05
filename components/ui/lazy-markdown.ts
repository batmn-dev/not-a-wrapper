"use client"

import dynamic from "next/dynamic"
import { createIntentPreloader } from "./intent-prefetch"

export let preloadMarkdown: () => Promise<typeof import("./markdown").Markdown>

// Share Next's transformed loader while keeping its inline import for SSR preloads.
export const LazyMarkdown = dynamic(
  (preloadMarkdown = createIntentPreloader(() =>
    import("./markdown").then((module) => module.Markdown)
  ))
)
