const WIDTH_PATTERNS = [
  [100, 86, 100],
  [94, 92, 83],
  [88, 100, 91],
] as const

export function getSidebarPaginationSkeletonWidths(seed: number) {
  return WIDTH_PATTERNS[Math.abs(seed) % WIDTH_PATTERNS.length]
}

/**
 * Pagination-only history placeholder.
 *
 * This intentionally does not use the shared pulse Skeleton: ChatGPT's
 * pagination state is a three-row, text-only, 3s linear shimmer appended below
 * retained history. Initial sidebar loading remains a separate state.
 */
export function SidebarPaginationSkeleton({ seed }: { seed: number }) {
  const widths = getSidebarPaginationSkeletonWidths(seed)

  return (
    <ul
      aria-hidden="true"
      className="m-0 mb-5 list-none p-0"
      data-sidebar-pagination-skeleton=""
    >
      {widths.map((width, index) => (
        <li className="h-9 list-none" key={`${index}-${width}`}>
          <div className="mx-1.5 flex h-9 items-center rounded-[10px] py-1.5 ps-2.5 pe-8">
            <div
              className="h-4 rounded-[4px] bg-size-[200%_100%] motion-safe:animate-[shimmer_3s_infinite_linear]"
              data-sidebar-pagination-skeleton-bar=""
              style={{
                width: `${width}%`,
                backgroundImage:
                  "linear-gradient(to left, color-mix(in oklab, var(--sidebar), var(--foreground) 2%), color-mix(in oklab, var(--sidebar), var(--foreground) 7%), color-mix(in oklab, var(--sidebar), var(--foreground) 2%))",
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

export function SidebarPaginationState({
  isLoadingMore,
  seed,
}: {
  isLoadingMore: boolean
  seed: number
}) {
  return isLoadingMore ? <SidebarPaginationSkeleton seed={seed} /> : null
}
