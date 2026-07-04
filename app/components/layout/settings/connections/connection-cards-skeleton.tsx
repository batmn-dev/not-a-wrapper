import { Skeleton } from "@/components/ui/skeleton"

/**
 * The one loading presentation for the Connections tab sections (DESIGN.md
 * states guidance: `Skeleton`, one strategy per surface). Both section reads —
 * the MCP server list (Convex) and the developer-tools read (API route) —
 * resolve independently, so each section renders its own header above this
 * placeholder and swaps only its body when its read settles. That keeps the
 * three states distinct per section (loading → empty | loaded) and stops a
 * floating "Loading connections..." line under one section from reading as a
 * tab-level claim that contradicts a sibling's already-resolved empty state.
 */
export function ConnectionCardsSkeleton({ cards = 2 }: { cards?: number }) {
  return (
    <div
      className="space-y-3"
      role="status"
      aria-label="Loading connections"
    >
      {Array.from({ length: cards }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className="border-border rounded-lg border p-4"
        >
          <div className="space-y-2">
            <Skeleton className="h-4 w-40 max-w-full" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
        </div>
      ))}
    </div>
  )
}
