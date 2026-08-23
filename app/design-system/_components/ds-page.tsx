import { ComponentPager } from "@/app/design-system/_components/component-pager"
import { MainContent } from "@/components/ui/main-content"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import type { ReactNode } from "react"

/**
 * Shared layout vocabulary for design-system docs pages.
 *
 * Every piece of page text — the page heading, section headings, and prose —
 * shares one horizontal inset (--ds-align-spacer) so it all sits on the same
 * vertical line as the ComponentPreview tab labels. Full-bleed surfaces
 * (preview panels, API tables) keep the page's outer edge, but their first and
 * last columns pad their text by the same inset. Pages compose these instead
 * of hand-writing header/section/table markup so the inset can't drift.
 */

export function DsPage({ children }: { children: ReactNode }) {
  return (
    <MainContent
      id="main"
      className="w-full max-w-[960px] px-6 pt-10 pb-24 md:pt-28"
    >
      {children}
    </MainContent>
  )
}

type DsPageHeaderProps = {
  /** Catalog slug for the prev/next pager. */
  slug: string
  title: string
  description: ReactNode
}

export function DsPageHeader({ slug, title, description }: DsPageHeaderProps) {
  return (
    <header className="flex items-start justify-between gap-6 pl-(--ds-align-spacer)">
      <div>
        <h1 className="text-[28px] leading-8 font-semibold tracking-tight">
          {title}
        </h1>
        <p className="text-muted-foreground mt-2 text-base leading-6">
          {description}
        </p>
      </div>
      <ComponentPager slug={slug} />
    </header>
  )
}

/** Inset prose paragraph; use for section descriptions and footnotes. */
export function DsParagraph({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <p
      className={cn(
        "text-muted-foreground px-(--ds-align-spacer) text-sm leading-5",
        className
      )}
    >
      {children}
    </p>
  )
}

type DsSectionProps = {
  /** Section slug; the heading renders with id `${id}-heading`. */
  id: string
  title: string
  description?: ReactNode
  children: ReactNode
}

export function DsSection({
  id,
  title,
  description,
  children,
}: DsSectionProps) {
  const headingId = `${id}-heading`
  return (
    <section aria-labelledby={headingId} className="mt-16 first-of-type:mt-10">
      <h2
        id={headingId}
        className="px-(--ds-align-spacer) text-base font-semibold"
      >
        {title}
      </h2>
      {description ? (
        <DsParagraph className="mt-2">{description}</DsParagraph>
      ) : null}
      <div className="mt-3">{children}</div>
    </section>
  )
}

export type DsApiRow = {
  prop: string
  type: string
  defaultValue: string
  description: string
}

type DsApiTableProps = {
  /** Percentage width per column: [prop, type, default, description]. */
  columnWidths: [number, number, number, number]
  rows: readonly DsApiRow[]
}

/* The table surface is full-bleed, but its outermost text columns pad by the
   shared inset so the first/last column content sits on the page's text line. */
const apiCellEdgeClassNames = [
  "first:pl-(--ds-align-spacer)",
  "last:pr-(--ds-align-spacer)",
].join(" ")

export function DsApiTable({ columnWidths, rows }: DsApiTableProps) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <Table className="min-w-[38rem] table-fixed">
        <colgroup>
          {columnWidths.map((width, index) => (
            <col key={index} style={{ width: `${width}%` }} />
          ))}
        </colgroup>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={cn("px-3", apiCellEdgeClassNames)}>
              Prop
            </TableHead>
            <TableHead className="px-3">Type</TableHead>
            <TableHead className="px-3">Default</TableHead>
            <TableHead className={cn("px-3", apiCellEdgeClassNames)}>
              Description
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.prop} className="hover:bg-transparent">
              <TableCell
                className={cn(
                  "px-3 font-mono text-xs font-medium whitespace-normal",
                  apiCellEdgeClassNames
                )}
              >
                {row.prop}
              </TableCell>
              <TableCell className="px-3 font-mono text-xs whitespace-normal">
                {row.type}
              </TableCell>
              <TableCell className="px-3 font-mono text-xs whitespace-normal">
                {row.defaultValue}
              </TableCell>
              <TableCell
                className={cn("px-3 whitespace-normal", apiCellEdgeClassNames)}
              >
                {row.description}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
