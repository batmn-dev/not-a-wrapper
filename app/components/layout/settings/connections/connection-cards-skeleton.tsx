import { Skeleton } from "@/components/ui/skeleton"

/** Shared loading body for independently resolved Connections sections. */
export function ConnectionCardsSkeleton({ cards = 2 }: { cards?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading connections">
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
