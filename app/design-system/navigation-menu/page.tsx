import { ComponentPreview } from "@/app/design-system/_components/component-preview"
import {
  DsApiTable,
  DsPage,
  DsPageHeader,
  DsParagraph,
  DsSection,
} from "@/app/design-system/_components/ds-page"
import { readComponentSource } from "@/app/design-system/_lib/component-source"
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu"
import type { Metadata } from "next"

const defaultCode = `import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu"

export function NavigationMenuDefault() {
  return (
    <NavigationMenu>
      <NavigationMenuList>
        <NavigationMenuItem>
          <NavigationMenuTrigger>Product</NavigationMenuTrigger>
          <NavigationMenuContent>
            <ul className="grid w-56 gap-1">
              <li>
                <NavigationMenuLink href="#">
                  <div className="font-medium">Chat</div>
                  <div className="text-muted-foreground">
                    Talk to any model.
                  </div>
                </NavigationMenuLink>
              </li>
              <li>
                <NavigationMenuLink href="#">
                  <div className="font-medium">Projects</div>
                  <div className="text-muted-foreground">
                    Group chats and files.
                  </div>
                </NavigationMenuLink>
              </li>
            </ul>
          </NavigationMenuContent>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <NavigationMenuTrigger>Resources</NavigationMenuTrigger>
          <NavigationMenuContent>
            <ul className="grid w-48 gap-1">
              <li>
                <NavigationMenuLink href="#">Docs</NavigationMenuLink>
              </li>
              <li>
                <NavigationMenuLink href="#">Changelog</NavigationMenuLink>
              </li>
            </ul>
          </NavigationMenuContent>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <NavigationMenuLink href="#" className={navigationMenuTriggerStyle()}>
            Pricing
          </NavigationMenuLink>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  )
}`

const apiRows = [
  {
    prop: "NavigationMenu viewport",
    type: "boolean",
    defaultValue: "true",
    description:
      "Renders panels in one shared popup that resizes between items; false gives each item its own popup under its trigger.",
  },
  {
    prop: "NavigationMenu value / onValueChange",
    type: "any / (value, eventDetails) => void",
    defaultValue: "—",
    description:
      "Controlled open item on the Base UI root. Use defaultValue when uncontrolled.",
  },
  {
    prop: "NavigationMenuTrigger",
    type: "Base UI Trigger props",
    defaultValue: "—",
    description:
      "Opens its item's content on hover or focus, with a chevron that rotates while open.",
  },
  {
    prop: "NavigationMenuContent",
    type: "Base UI Content props",
    defaultValue: "—",
    description: "The panel shown for its item, with a 200ms opacity fade.",
  },
  {
    prop: "NavigationMenuLink active",
    type: "boolean",
    defaultValue: "false",
    description:
      "Marks the link as the current page; drives the data-active styling.",
  },
  {
    prop: "NavigationMenuLink closeOnClick",
    type: "boolean",
    defaultValue: "false",
    description: "Closes the menu when the link is clicked.",
  },
  {
    prop: "navigationMenuTriggerStyle",
    type: "() => string",
    defaultValue: "—",
    description:
      "Class factory that gives plain links the same look as triggers.",
  },
] as const

export const metadata: Metadata = {
  title: "Navigation Menu | Design System",
  description:
    "Documentation and usage examples for the Not A Wrapper Navigation Menu component.",
}

export default function NavigationMenuPage() {
  const navigationMenuSource = readComponentSource(
    "components/ui/navigation-menu.tsx"
  )

  return (
    <DsPage>
      <DsPageHeader
        slug="navigation-menu"
        title="Navigation Menu"
        description="Base UI navigation menu for site headers: hoverable triggers reveal link panels inside one shared viewport popup."
      />

      <DsSection
        id="default"
        title="Default"
        description="Hover or focus a trigger to open its panel; the shared viewport animates size between panels. A plain link can borrow the trigger look via navigationMenuTriggerStyle."
      >
        <ComponentPreview code={defaultCode} sourceCode={navigationMenuSource}>
          <NavigationMenu>
            <NavigationMenuList>
              <NavigationMenuItem>
                <NavigationMenuTrigger>Product</NavigationMenuTrigger>
                <NavigationMenuContent>
                  <ul className="grid w-56 gap-1">
                    <li>
                      <NavigationMenuLink href="#">
                        <div className="font-medium">Chat</div>
                        <div className="text-muted-foreground">
                          Talk to any model.
                        </div>
                      </NavigationMenuLink>
                    </li>
                    <li>
                      <NavigationMenuLink href="#">
                        <div className="font-medium">Projects</div>
                        <div className="text-muted-foreground">
                          Group chats and files.
                        </div>
                      </NavigationMenuLink>
                    </li>
                  </ul>
                </NavigationMenuContent>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuTrigger>Resources</NavigationMenuTrigger>
                <NavigationMenuContent>
                  <ul className="grid w-48 gap-1">
                    <li>
                      <NavigationMenuLink href="#">Docs</NavigationMenuLink>
                    </li>
                    <li>
                      <NavigationMenuLink href="#">
                        Changelog
                      </NavigationMenuLink>
                    </li>
                  </ul>
                </NavigationMenuContent>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuLink
                  href="#"
                  className={navigationMenuTriggerStyle()}
                >
                  Pricing
                </NavigationMenuLink>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenu>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[26, 26, 12, 36]} rows={apiRows} />
        <DsParagraph className="mt-3">
          Remaining Base UI Navigation Menu props (delay, closeDelay,
          orientation) are forwarded from the root wrapper.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
