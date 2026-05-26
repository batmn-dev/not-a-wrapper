"use client"

import { PopoverContentAuth } from "@/app/components/chat-input/popover-content-auth"
import { useBreakpoint } from "@/app/hooks/use-breakpoint"
import { useKeyShortcut } from "@/app/hooks/use-key-shortcut"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Icon } from "@/components/ui/icon"
import { Input } from "@/components/ui/input"
import { Popover, PopoverTrigger } from "@/components/ui/popover"
import { useModel } from "@/lib/model-store/provider"
import { filterAndSortModels } from "@/lib/model-store/utils"
import { getModelInfo } from "@/lib/models"
import { ModelConfig } from "@/lib/models/types"
import { PROVIDERS } from "@/lib/providers"
import { useUserPreferences } from "@/lib/user-preference-store/provider"
import { cn } from "@/lib/utils"
import { RiArrowDownSLine, RiSearchLine, RiStarLine } from "@remixicon/react"
import { useRef, useState } from "react"
import { ProModelDialog } from "./pro-dialog"

type ModelSelectorProps = {
  className?: string
  isUserAuthenticated?: boolean
  selectedModelId: string
  setSelectedModelId: (modelId: string) => void
}

export function ModelSelector({
  className,
  isUserAuthenticated = true,
  selectedModelId,
  setSelectedModelId,
}: ModelSelectorProps) {
  const { models, isLoading: isLoadingModels, favoriteModels } = useModel()
  const { isModelHidden } = useUserPreferences()
  const isMobile = useBreakpoint(768)

  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [isProDialogOpen, setIsProDialogOpen] = useState(false)
  const [selectedProModel, setSelectedProModel] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const searchInputRef = useRef<HTMLInputElement>(null)

  const currentModel =
    models.find((model) => model.id === selectedModelId) ??
    getModelInfo(selectedModelId)

  useKeyShortcut(
    (e) => (e.key === "p" || e.key === "P") && e.metaKey && e.shiftKey,
    () => {
      if (isMobile) {
        setIsDrawerOpen((prev) => !prev)
      } else {
        setIsDropdownOpen((prev) => !prev)
      }
    }
  )

  const handleSelect = (modelId: string, isLocked: boolean) => {
    if (isLocked) {
      setSelectedProModel(modelId)
      setIsProDialogOpen(true)
      return
    }

    setSelectedModelId(modelId)
    if (isMobile) {
      setIsDrawerOpen(false)
    } else {
      setIsDropdownOpen(false)
    }
  }

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation()
    setSearchQuery(e.target.value)
  }

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" || e.key === "ArrowDown" || e.key === "ArrowUp") {
      return
    }

    e.stopPropagation()
  }

  const filteredModels = filterAndSortModels(
    models,
    favoriteModels || [],
    searchQuery,
    isModelHidden
  )

  const renderModelItem = (model: ModelConfig) => {
    const isLocked = !model.accessible
    const provider = PROVIDERS.find((provider) => provider.id === model.icon)

    return (
      <div
        key={model.id}
        className={cn(
          "flex w-full items-center justify-between px-3 py-2",
          selectedModelId === model.id && "bg-accent"
        )}
        onClick={() => handleSelect(model.id, isLocked)}
      >
        <div className="flex items-center gap-3">
          {provider?.icon && <provider.icon className="size-5" />}
          <div className="flex flex-col gap-0">
            <span className="text-sm">{model.name}</span>
          </div>
        </div>
        {isLocked && (
          <div className="border-input bg-accent text-muted-foreground flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium">
            <Icon icon={RiStarLine} slotSize={8} />
            <span>Locked</span>
          </div>
        )}
      </div>
    )
  }

  const trigger = (
    <Button
      variant="ghost"
      className={cn("justify-between rounded-lg text-lg font-normal", className)}
      disabled={isLoadingModels}
    >
      <span>{currentModel?.name || "Select model"}</span>
      <Icon icon={RiArrowDownSLine} slotSize={16} className="opacity-50" />
    </Button>
  )

  if (!isUserAuthenticated) {
    return (
      <Popover>
        <PopoverTrigger render={trigger} />
        <PopoverContentAuth />
      </Popover>
    )
  }

  if (isMobile) {
    return (
      <>
        <ProModelDialog
          isOpen={isProDialogOpen}
          setIsOpen={setIsProDialogOpen}
          currentModel={selectedProModel || ""}
        />
        <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
          <DrawerTrigger render={trigger} />
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Select Model</DrawerTitle>
            </DrawerHeader>
            <div className="px-4 pb-2">
              <div className="relative">
                <Icon
                  icon={RiSearchLine}
                  slotSize={16}
                  className="text-muted-foreground absolute top-2.5 left-2.5"
                />
                <Input
                  ref={searchInputRef}
                  placeholder="Search models..."
                  className="pl-8"
                  value={searchQuery}
                  onChange={handleSearchChange}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            </div>
            <div className="flex h-full flex-col space-y-0 overflow-y-auto px-4 pb-6">
              {isLoadingModels ? (
                <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                  <p className="text-muted-foreground mb-2 text-sm">
                    Loading models...
                  </p>
                </div>
              ) : filteredModels.length > 0 ? (
                filteredModels.map((model) => renderModelItem(model))
              ) : (
                <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                  <p className="text-muted-foreground mb-2 text-sm">
                    No results found.
                  </p>
                  <a
                    href="https://github.com/batmn-dev/not-a-wrapper/issues/new?title=Model%20Request%3A%20"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground text-sm underline"
                  >
                    Request a new model
                  </a>
                </div>
              )}
            </div>
          </DrawerContent>
        </Drawer>
      </>
    )
  }

  return (
    <div>
      <ProModelDialog
        isOpen={isProDialogOpen}
        setIsOpen={setIsProDialogOpen}
        currentModel={selectedProModel || ""}
      />
      <DropdownMenu
        open={isDropdownOpen}
        onOpenChange={(open) => {
          setIsDropdownOpen(open)
          if (!open) {
            setSearchQuery("")
          }
        }}
      >
        <DropdownMenuTrigger render={trigger} />
        <DropdownMenuContent
          className="[--model-selector-fixed-height:3rem] [--model-selector-list-max-height:18rem] w-[300px] overflow-hidden"
          align="start"
          sideOffset={4}
          animated={false}
          side="top"
        >
          <div className="shrink-0">
            <div className="relative">
              <Icon
                icon={RiSearchLine}
                slotSize={18}
                className="text-foreground absolute top-1/2 left-2.5 -translate-y-1/2"
              />
              <Input
                ref={searchInputRef}
                placeholder="Search models..."
                className="h-9 rounded-xl border border-input/60 bg-muted/60 pl-8 shadow-none focus-visible:ring-0 dark:border-input dark:bg-muted/40"
                value={searchQuery}
                onChange={handleSearchChange}
                onClick={(e) => e.stopPropagation()}
                onFocus={(e) => e.stopPropagation()}
                onKeyDown={handleSearchKeyDown}
              />
            </div>
          </div>
          <div className="relative mt-[2px] rounded-xl before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-10 before:h-3 before:bg-gradient-to-b before:from-popover before:to-transparent before:content-[''] after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:z-10 after:h-4 after:bg-gradient-to-t after:from-popover after:to-transparent after:content-['']">
            <div className="max-h-[min(var(--model-selector-list-max-height),max(0px,calc(var(--available-height)-var(--model-selector-fixed-height))))] scroll-py-2 overflow-x-hidden overflow-y-auto overscroll-contain py-1 pr-1 [scrollbar-color:color-mix(in_oklab,var(--muted-foreground)_35%,transparent)_transparent] [scrollbar-gutter:stable] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-track]:bg-transparent">
              {isLoadingModels ? (
                <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                  <p className="text-muted-foreground mb-2 text-sm">
                    Loading models...
                  </p>
                </div>
              ) : filteredModels.length > 0 ? (
                filteredModels.map((model) => {
                  const isLocked = !model.accessible
                  const isSelected = selectedModelId === model.id
                  const provider = PROVIDERS.find(
                    (provider) => provider.id === model.icon
                  )

                  return (
                    <DropdownMenuItem
                      key={model.id}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 px-2",
                        isSelected && "bg-accent"
                      )}
                      onClick={() => handleSelect(model.id, isLocked)}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        {provider?.icon && (
                          <provider.icon className="size-5 shrink-0" />
                        )}
                        <span className="truncate text-sm">{model.name}</span>
                      </div>
                      {isLocked ? (
                        <div className="border-input bg-accent text-muted-foreground flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium">
                          <Icon icon={RiStarLine} slotSize={8} />
                          <span>Locked</span>
                        </div>
                      ) : null}
                    </DropdownMenuItem>
                  )
                })
              ) : (
                <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                  <p className="text-muted-foreground mb-1 text-sm">
                    No results found.
                  </p>
                  <a
                    href="https://github.com/batmn-dev/not-a-wrapper/issues/new?title=Model%20Request%3A%20"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground text-sm underline"
                  >
                    Request a new model
                  </a>
                </div>
              )}
            </div>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
