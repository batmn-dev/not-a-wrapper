"use client"

import { Favicon } from "@/components/ui/favicon"
import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/utils"
import { RiLink } from "@remixicon/react"
import type { SourceUrlUIPart } from "ai"
import { DisclosureCard } from "./disclosure-card"
import { addUTM, formatUrl } from "./utils"

type SourcesListProps = {
  sources: SourceUrlUIPart[]
  className?: string
}

export function SourcesList({ sources, className }: SourcesListProps) {
  return (
    <div className={cn("my-4", className)}>
      <DisclosureCard
        header={
          <>
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
          </>
        }
      >
        <ul className="space-y-2">
          {sources.map((source) => (
            <li key={source.sourceId} className="flex items-center text-sm">
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
      </DisclosureCard>
    </div>
  )
}
