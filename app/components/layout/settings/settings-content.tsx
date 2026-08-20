"use client"

import { useScrollAttributes } from "@/app/hooks/use-scroll-attributes"
import { Icon } from "@/components/ui/icon"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useBreakpoint } from "@/hooks/use-breakpoint"
import { cn, isDev } from "@/lib/utils"
import {
  RiBox3Line,
  RiBrushLine,
  RiCloseLine,
  RiKeyLine,
  RiPlugLine,
  RiSearchLine,
  RiSettings3Line,
} from "@remixicon/react"
import { useRef, useState } from "react"
import { SidebarLeadingIcon } from "../sidebar/sidebar-leading-icon"
import { ByokSection } from "./apikeys/byok-section"
import { InteractionPreferences } from "./appearance/interaction-preferences"
import { LayoutSettings } from "./appearance/layout-settings"
import { ThemeSelection } from "./appearance/theme-selection"
import { DeveloperTools } from "./connections/developer-tools"
import { McpServers } from "./connections/mcp-servers"
import { SettingsSignOutButton } from "./general/account-management"
import { UsageSection } from "./general/usage-section"
import { UserProfile } from "./general/user-profile"
import { ModelsSettings } from "./models/models-settings"
import { SettingsCloseButton, SettingsPageHeader } from "./settings-page-header"
import { ToolKeys } from "./tools/tool-keys"

const SETTINGS_TABS = [
  { value: "general", label: "General", icon: RiSettings3Line },
  { value: "appearance", label: "Appearance", icon: RiBrushLine },
  { value: "apikeys", label: "API Keys", icon: RiKeyLine },
  { value: "models", label: "Models", icon: RiBox3Line },
  { value: "connections", label: "Connections", icon: RiPlugLine },
] as const

type TabType = (typeof SETTINGS_TABS)[number]["value"]

export function SettingsContent() {
  const isMobile = useBreakpoint(768)
  const contentScrollRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [activeTab, setActiveTab] = useState<TabType>("general")
  const [searchQuery, setSearchQuery] = useState("")
  useScrollAttributes(contentScrollRef, { threshold: 0 })
  const normalizedQuery = searchQuery.trim().toLowerCase()
  const matchingTabs = normalizedQuery
    ? SETTINGS_TABS.filter((tab) =>
        tab.label.toLowerCase().includes(normalizedQuery)
      )
    : SETTINGS_TABS
  const activeTabLabel =
    SETTINGS_TABS.find((tab) => tab.value === activeTab)?.label ?? "Settings"
  const clearSearch = () => {
    setSearchQuery("")
    searchInputRef.current?.focus()
  }

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => setActiveTab(value as TabType)}
      orientation={isMobile ? "horizontal" : "vertical"}
      className={cn(
        "relative min-h-0 w-full flex-1 gap-0",
        isMobile ? "flex-col" : "flex-row"
      )}
    >
      {isMobile ? (
        <div className="absolute top-3 right-3 z-30">
          <SettingsCloseButton />
        </div>
      ) : null}

      {isMobile ? (
        <div className="bg-popover border-border flex shrink-0 border-b pt-3 pr-12 pb-2 pl-3">
          <TabsList
            variant="line"
            className="group-data-horizontal/tabs:h-8 w-full [scrollbar-width:none] justify-start overflow-x-auto rounded-none p-0 [&::-webkit-scrollbar]:hidden"
          >
            {SETTINGS_TABS.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="h-8 flex-none px-2.5 py-1"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      ) : (
        <nav
          aria-label="Settings"
          className="bg-popover border-border flex w-48 shrink-0 flex-col border-r"
        >
          <div className="px-3 pt-3">
            <form
              role="search"
              autoComplete="off"
              className="relative"
              onSubmit={(event) => event.preventDefault()}
            >
              <Icon
                icon={RiSearchLine}
                slotSize={16}
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2"
              />
              <input
                ref={searchInputRef}
                type="search"
                name="settings-search"
                autoComplete="off"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search"
                aria-label="Search settings"
                className={cn(
                  "border-input-border bg-popover placeholder:text-muted-foreground focus-visible:ring-focus-ring h-8 w-full rounded-md border py-1 pr-2.5 pl-8 text-sm outline-none focus-visible:ring-1",
                  searchQuery && "pr-8"
                )}
              />
              {searchQuery ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={clearSearch}
                  className="text-muted-foreground hover:bg-interactive-hover focus-visible:bg-interactive-hover focus-visible:ring-focus-ring absolute end-0.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md outline-none focus-visible:ring-1"
                >
                  <Icon icon={RiCloseLine} slotSize={18} glyphInset={0} />
                </button>
              ) : null}
            </form>
          </div>

          <div className="mt-3 min-h-0 flex-1 overflow-x-clip overflow-y-auto px-3 pb-3">
            <TabsList className="flex h-auto w-full flex-col items-stretch justify-start rounded-none bg-transparent p-0 [--sidebar-row-outer-inset:0px]">
              {SETTINGS_TABS.map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  style={
                    tab.value === activeTab
                      ? {
                          backgroundColor:
                            "var(--sidebar-row-active-background)",
                        }
                      : undefined
                  }
                  className={cn(
                    "sidebar-row sidebar-menu-row sidebar-row-content sidebar-row-primary-control menu-item-hoverable text-foreground hover:text-foreground data-active:text-foreground dark:text-foreground flex-none justify-start gap-0 text-left font-normal hover:bg-[var(--sidebar-row-active-background)] focus-visible:shadow-none! focus-visible:ring-0! active:bg-[var(--sidebar-row-active-background)] group-data-[variant=default]/tabs-list:data-active:shadow-none!",
                    tab.value !== activeTab &&
                      !matchingTabs.some(
                        (matchingTab) => matchingTab.value === tab.value
                      ) &&
                      "hidden"
                  )}
                >
                  <SidebarLeadingIcon icon={tab.icon} />
                  <span>{tab.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
            {matchingTabs.length === 0 && (
              <p className="text-muted-foreground px-2 py-2 text-xs">
                No matching settings found
              </p>
            )}

            <div className="border-border mt-3 border-t pt-3 [--sidebar-row-outer-inset:0px]">
              <SettingsSignOutButton />
            </div>
          </div>
        </nav>
      )}

      <div className="bg-popover flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          ref={contentScrollRef}
          className="group/settings-scrollport relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
        >
          {!isMobile ? <SettingsPageHeader title={activeTabLabel} /> : null}

          <div className="p-4">
            <TabsContent value="general" className="mt-0 space-y-6">
              <UserProfile />
              <UsageSection />
              {isMobile ? (
                <div className="[--sidebar-row-outer-inset:0px]">
                  <SettingsSignOutButton />
                </div>
              ) : null}
            </TabsContent>

            <TabsContent value="appearance" className="mt-0 space-y-6">
              <ThemeSelection />
              <LayoutSettings />
              <InteractionPreferences />
            </TabsContent>

            <TabsContent value="apikeys" className="mt-0 space-y-6">
              <ByokSection />
              <ToolKeys />
            </TabsContent>

            <TabsContent value="models" className="mt-0 space-y-6">
              <ModelsSettings />
            </TabsContent>

            <TabsContent value="connections" className="mt-0 space-y-6">
              <McpServers />
              {isDev && <DeveloperTools />}
            </TabsContent>
          </div>
        </div>
      </div>
    </Tabs>
  )
}
