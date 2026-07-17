/**
 * Shared column template for the directory header row and every project row
 * The reference reserves one 36px action column. The optional new-chat quick
 * action expands left from that fixed slot on reveal, so resting rows, the pin
 * marker, and the header all retain the reference column geometry.
 */
export const projectsGridColumnsClassName =
  "grid gap-4 grid-cols-[minmax(0,1fr)_36px] sm:grid-cols-[minmax(0,1fr)_160px_36px]"
