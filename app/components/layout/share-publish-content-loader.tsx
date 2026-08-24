"use client"

import { createIntentPreloader } from "@/components/ui/intent-prefetch"
import dynamic from "next/dynamic"

const preloadSharePublishContent = createIntentPreloader(
  () => import("./share-publish-content")
)

const LazySharePublishContent = dynamic(() =>
  preloadSharePublishContent().then((module) => module.SharePublishContent)
)

export { LazySharePublishContent, preloadSharePublishContent }
