import {
  SourcesGalleryItem,
  type SourcesGalleryItemProps,
} from "@/components/ui/source"
import { cn } from "@/lib/utils"
import { PanelSectionHeading } from "./panel-section-heading"

export type SourcesGallerySource = SourcesGalleryItemProps & {
  /** Stable source identity from AI SDK source-url parts. */
  sourceId: string
}

export type SourcesGalleryProps = {
  sources: SourcesGallerySource[]
  /** Heading count; defaults to `sources.length`. */
  count?: number
  className?: string
}

/**
 * SourcesGallery — the app-level "Sources · N" gallery for the Activity panel.
 * Lives app-side (not in `components/ui`) because it depends on the app-level
 * `PanelSectionHeading`, preserving the `components/ui` → app dependency
 * boundary (plan §5 commit 1, GA §6.1). Renders ONE `ul` of full-bleed
 * `SourcesGalleryItem` anchors. No `groups` until real grouped source data
 * exists; rows are NOT routed through the `Source` HoverCard trio.
 */
export function SourcesGallery({
  sources,
  count = sources.length,
  className,
}: SourcesGalleryProps) {
  if (sources.length === 0) return null

  return (
    <div className={cn("space-y-3", className)}>
      <PanelSectionHeading
        title="Sources"
        trailing={<>· {count}</>}
        className="justify-start gap-1 px-3"
      />
      <ul className="flex flex-col">
        {sources.map(({ sourceId, ...source }) => (
          <li
            key={sourceId}
            className="animate-[show_150ms_ease-in] motion-reduce:animate-none"
          >
            <SourcesGalleryItem {...source} />
          </li>
        ))}
      </ul>
    </div>
  )
}
