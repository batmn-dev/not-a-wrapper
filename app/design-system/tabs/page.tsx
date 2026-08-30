import { ComponentPreview } from "@/app/design-system/_components/component-preview"
import {
  DsApiTable,
  DsPage,
  DsPageHeader,
  DsParagraph,
  DsSection,
} from "@/app/design-system/_components/ds-page"
import { readComponentSource } from "@/app/design-system/_lib/component-source"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { Metadata } from "next"

const defaultCode = `import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export function TabsDefault() {
  return (
    <Tabs defaultValue="account" className="w-72">
      <TabsList>
        <TabsTrigger value="account">Account</TabsTrigger>
        <TabsTrigger value="password">Password</TabsTrigger>
      </TabsList>
      <TabsContent value="account">Account settings live here.</TabsContent>
      <TabsContent value="password">Change your password here.</TabsContent>
    </Tabs>
  )
}`

const lineCode = `import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export function TabsLine() {
  return (
    <Tabs defaultValue="preview" className="w-72">
      <TabsList variant="line">
        <TabsTrigger value="preview">Preview</TabsTrigger>
        <TabsTrigger value="code">Code</TabsTrigger>
      </TabsList>
      <TabsContent value="preview">The rendered result.</TabsContent>
      <TabsContent value="code">The code behind it.</TabsContent>
    </Tabs>
  )
}`

const ghostCode = `import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export function TabsGhost() {
  return (
    <Tabs defaultValue="usage" className="w-72">
      <TabsList variant="ghost">
        <TabsTrigger value="usage">Usage</TabsTrigger>
        <TabsTrigger value="source">Source</TabsTrigger>
      </TabsList>
      <TabsContent value="usage">The copy-paste snippet.</TabsContent>
      <TabsContent value="source">The verbatim component source.</TabsContent>
    </Tabs>
  )
}`

const apiRows = [
  {
    prop: "defaultValue",
    type: "string",
    defaultValue: "—",
    description: "Initially active tab when uncontrolled.",
  },
  {
    prop: "value / onValueChange",
    type: "string / (value) => void",
    defaultValue: "—",
    description:
      "Controlled active tab and its change handler, on the Tabs root.",
  },
  {
    prop: "orientation",
    type: '"horizontal" | "vertical"',
    defaultValue: '"horizontal"',
    description:
      "Layout axis. Drives the data-horizontal/data-vertical styling hooks and arrow-key direction.",
  },
  {
    prop: "TabsList variant",
    type: '"default" | "line" | "ghost" | "pill"',
    defaultValue: '"default"',
    description:
      "Segmented list, underline list, muted-pill list, or bordered selected pill row.",
  },
  {
    prop: "TabsTrigger value",
    type: "string",
    defaultValue: "—",
    description: "Identifies the panel this trigger activates.",
  },
  {
    prop: "TabsTrigger disabled",
    type: "boolean",
    defaultValue: "false",
    description: "Prevents selecting the tab.",
  },
  {
    prop: "TabsContent value",
    type: "string",
    defaultValue: "—",
    description: "Matches the trigger that reveals this panel.",
  },
] as const

export const metadata: Metadata = {
  title: "Tabs | Design System",
  description:
    "Base UI tabs with segmented, underline, and pill variants used across the app and this registry.",
}

export default function TabsPage() {
  const tabsSource = readComponentSource("components/ui/tabs.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="tabs"
        title="Tabs"
        description="Base UI tabs behind every tab switcher in the app, with segmented, underline, muted-pill, and bordered-pill variants."
      />

      <DsSection
        id="default"
        title="Default"
        description="The segmented pill list. Use it for view switchers inside a surface, like the Usage/Source toggle in this registry's code panels."
      >
        <ComponentPreview code={defaultCode} sourceCode={tabsSource}>
          <Tabs defaultValue="account" className="w-72">
            <TabsList>
              <TabsTrigger value="account">Account</TabsTrigger>
              <TabsTrigger value="password">Password</TabsTrigger>
            </TabsList>
            <TabsContent
              value="account"
              className="text-muted-foreground px-1 py-2"
            >
              Account settings live here.
            </TabsContent>
            <TabsContent
              value="password"
              className="text-muted-foreground px-1 py-2"
            >
              Change your password here.
            </TabsContent>
          </Tabs>
        </ComponentPreview>
      </DsSection>

      <DsSection
        id="line"
        title="Line"
        description="The transparent list with an active-tab underline. Use it for page-level view switchers, like the Preview/Code tabs on this page and the mobile settings tab bar."
      >
        <ComponentPreview code={lineCode} sourceCode={tabsSource}>
          <Tabs defaultValue="preview" className="w-72">
            <TabsList variant="line">
              <TabsTrigger value="preview">Preview</TabsTrigger>
              <TabsTrigger value="code">Code</TabsTrigger>
            </TabsList>
            <TabsContent
              value="preview"
              className="text-muted-foreground px-1 py-2"
            >
              The rendered result.
            </TabsContent>
            <TabsContent
              value="code"
              className="text-muted-foreground px-1 py-2"
            >
              The code behind it.
            </TabsContent>
          </Tabs>
        </ComponentPreview>
      </DsSection>

      <DsSection
        id="ghost"
        title="Ghost"
        description="The transparent list whose active trigger carries a muted pill. Use it for compact switchers inside chrome that already has its own border, like the Usage/Source toggle in this registry's code panels."
      >
        <ComponentPreview code={ghostCode} sourceCode={tabsSource}>
          <Tabs defaultValue="usage" className="w-72">
            <TabsList variant="ghost">
              <TabsTrigger value="usage">Usage</TabsTrigger>
              <TabsTrigger value="source">Source</TabsTrigger>
            </TabsList>
            <TabsContent
              value="usage"
              className="text-muted-foreground px-1 py-2"
            >
              The copy-paste snippet.
            </TabsContent>
            <TabsContent
              value="source"
              className="text-muted-foreground px-1 py-2"
            >
              The verbatim component source.
            </TabsContent>
          </Tabs>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[24, 26, 14, 36]} rows={apiRows} />
        <DsParagraph className="mt-3">
          Remaining Base UI Tabs props are forwarded from each wrapper. The
          data-horizontal/data-vertical utilities used by the wrapper are mapped
          to data-orientation in globals.css.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
