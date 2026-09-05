"use client"

import dynamic from "next/dynamic"
import { createIntentPreloader } from "./intent-prefetch"

// Keep the import inside dynamic so Next can preload the renderer for SSR content.
export const LazyMarkdown = dynamic(() =>
  import("./markdown").then((module) => module.Markdown)
)

// Intent warming and rendering share the same chunk; warming never gates input or Send.
export const preloadMarkdown = createIntentPreloader(() => import("./markdown"))
