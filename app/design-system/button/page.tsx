import { ComponentPager } from "@/app/design-system/_components/component-pager"
import { ComponentPreview } from "@/app/design-system/_components/component-preview"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { Metadata } from "next"

const variantsCode = `import { Button } from "@/components/ui/button"

export function ButtonVariants() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button>Default</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="destructive">Destructive</Button>
      <Button variant="link">Link</Button>
    </div>
  )
}`

const apiRows = [
  {
    prop: "variant",
    type: '"default" | "outline" | "secondary" | "ghost" | "destructive" | "link"',
    defaultValue: '"default"',
    description: "Visual style of the button.",
  },
  {
    prop: "size",
    type: '"default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg"',
    defaultValue: '"default"',
    description: "Size of the button.",
  },
  {
    prop: "render",
    type: "ReactElement | render function",
    defaultValue: "—",
    description: "Replaces the rendered element or composes another component.",
  },
  {
    prop: "disabled",
    type: "boolean",
    defaultValue: "false",
    description: "Prevents interaction with the button.",
  },
] as const

export const metadata: Metadata = {
  title: "Button | Design System",
  description:
    "Documentation and visual variants for the Not A Wrapper Button component.",
}

export default function ButtonPage() {
  return (
    <main id="main" className="w-full max-w-[680px] px-6 pt-10 pb-24 md:pt-28">
      <header className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-[28px] leading-8 font-semibold tracking-tight">
            Button
          </h1>
          <p className="text-muted-foreground mt-2 text-sm leading-5">
            Versatile button with visual variants, multiple sizes, and custom
            render support.
          </p>
        </div>
        <ComponentPager slug="button" />
      </header>

      <section aria-labelledby="variants-heading" className="mt-10">
        <h2 id="variants-heading" className="text-base font-semibold">
          Variants
        </h2>
        <div className="mt-3">
          <ComponentPreview code={variantsCode}>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button type="button">Default</Button>
              <Button type="button" variant="outline">
                Outline
              </Button>
              <Button type="button" variant="secondary">
                Secondary
              </Button>
              <Button type="button" variant="ghost">
                Ghost
              </Button>
              <Button type="button" variant="destructive">
                Destructive
              </Button>
              <Button type="button" variant="link">
                Link
              </Button>
            </div>
          </ComponentPreview>
        </div>
      </section>

      <section aria-labelledby="api-heading" className="mt-16">
        <h2 id="api-heading" className="text-base font-semibold">
          API Reference
        </h2>
        <div className="mt-3 overflow-hidden rounded-xl border">
          <Table className="min-w-[38rem] table-fixed">
            <colgroup>
              <col className="w-[14%]" />
              <col className="w-[34%]" />
              <col className="w-[16%]" />
              <col className="w-[36%]" />
            </colgroup>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-3">Prop</TableHead>
                <TableHead className="px-3">Type</TableHead>
                <TableHead className="px-3">Default</TableHead>
                <TableHead className="px-3">Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {apiRows.map((row) => (
                <TableRow key={row.prop} className="hover:bg-transparent">
                  <TableCell className="px-3 font-mono text-xs font-medium">
                    {row.prop}
                  </TableCell>
                  <TableCell className="px-3 font-mono text-xs whitespace-normal">
                    {row.type}
                  </TableCell>
                  <TableCell className="px-3 font-mono text-xs whitespace-normal">
                    {row.defaultValue}
                  </TableCell>
                  <TableCell className="px-3 whitespace-normal">
                    {row.description}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-muted-foreground mt-3 text-sm leading-5">
          All standard button attributes and Base UI Button props are forwarded
          to the rendered element.
        </p>
      </section>
    </main>
  )
}
