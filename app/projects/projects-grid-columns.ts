/**
 * Shared column template for the directory header row and every project row
 * The new-chat variant reserves 78px for the paired quick action + menu from
 * every breakpoint (`minmax(0,1fr) 160px 78px` from 640px up), so revealing
 * them never shifts or overlaps the truncated name. Lives here so the header
 * and rows stay column-aligned without a circular dependency.
 */
export const projectsGridColumnsClassName =
  "grid gap-4 grid-cols-[minmax(0,1fr)_78px] sm:grid-cols-[minmax(0,1fr)_160px_78px]"
