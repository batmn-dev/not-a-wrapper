"use client"

import { Favicon } from "@/components/ui/favicon"
import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/utils"
import { RiArrowDownSLine, RiLink } from "@remixicon/react"
import type { SourceUrlUIPart } from "ai"
import { AnimatePresence, motion } from "motion/react"
import { useState } from "react"
import { addUTM, formatUrl } from "./utils"

type SourcesListProps = {
  sources: SourceUrlUIPart[]
  className?: string
}

const TRANSITION = {
  type: "spring",
  duration: 0.2,
  bounce: 0,
} as const

export function SourcesList({ sources, className }: SourcesListProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <div className={cn("my-4", className)}>
      <div className="border-border flex flex-col gap-0 overflow-hidden rounded-md border">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          type="button"
          className="hover:bg-accent flex w-full flex-row items-center rounded-t-md px-3 py-2 transition-colors"
        >
          <div className="flex flex-1 flex-row items-center gap-2 text-left text-sm">
            Sources
            <div className="flex -space-x-1">
              {sources?.map((source, index) => (
                <Favicon
                  key={`${source.url}-${index}`}
                  url={source.url}
                  alt={`Favicon for ${source.title}`}
                  shape="rounded"
                  className="border-background size-4 border"
                />
              ))}
              {sources.length > 3 && (
                <span className="text-muted-foreground ml-1 text-xs">
                  +{sources.length - 3}
                </span>
              )}
            </div>
          </div>
          <Icon
            icon={RiArrowDownSLine}
            slotSize={16}
            className={cn(
              "h-4 w-4 transition-transform",
              isExpanded ? "rotate-180 transform" : ""
            )}
          />
        </button>

        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={TRANSITION}
              className="overflow-hidden"
            >
              <ul className="space-y-2 px-3 pt-3 pb-3">
                {sources.map((source) => (
                  <li
                    key={source.sourceId}
                    className="flex items-center text-sm"
                  >
                    <div className="min-w-0 flex-1 overflow-hidden">
                      <a
                        href={addUTM(source.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary group line-clamp-1 flex items-center gap-1 hover:underline"
                      >
                        <Favicon
                          url={source.url}
                          alt={`Favicon for ${source.title}`}
                          shape="rounded"
                          className="size-4 flex-shrink-0"
                        />
                        <span className="truncate">{source.title}</span>
                        <Icon
                          icon={RiLink}
                          slotSize={12}
                          className="flex-shrink-0 opacity-70 transition-opacity group-hover:opacity-100"
                        />
                      </a>
                      <div className="text-muted-foreground line-clamp-1 text-xs">
                        {formatUrl(source.url)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
