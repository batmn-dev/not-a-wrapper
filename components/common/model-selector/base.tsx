"use client"

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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useModel } from "@/lib/model-store/provider"
import {
  filterAndSortModels,
  isModelSelectableForAuthState,
} from "@/lib/model-store/utils"
import { getModelInfo } from "@/lib/models"
import { ModelConfig } from "@/lib/models/types"
import { getVendorIcon } from "@/lib/provider-icons"
import { useUserPreferences } from "@/lib/user-preference-store/provider"
import { cn } from "@/lib/utils"
import { RiArrowDownSLine, RiSearchLine, RiStarLine } from "@remixicon/react"
import { useRef, useState } from "react"
import { ProModelDialog } from "./pro-dialog"

type ModelSelectorProps = {
  className?: string
  isUserAuthenticated?: boolean
  selectedModelId: string | null
  setSelectedModelId: (modelId: string) => void
  onLockedGuestModelSelect?: (modelId: string) => void
  disabled?: boolean
  /** Composer pill matches ChatGPT reference: content width, max-w-40 label, asymmetric padding. */
  variant?: "default" | "composer"
}

function getModelRouteLabel(model: ModelConfig | null | undefined) {
  return model?.providerId === "openrouter" ? "OpenRouter" : null
}

export function ModelSelector({
  className,
  isUserAuthenticated = true,
  selectedModelId,
  setSelectedModelId,
  onLockedGuestModelSelect,
  disabled = false,
  variant = "default",
}: ModelSelectorProps) {
  const isComposerVariant = variant === "composer"
  const { models, isLoading: isLoadingModels, favoriteModels } = useModel()
  const { isModelHidden } = useUserPreferences()
  const isMobile = useBreakpoint(768)

  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [isProDialogOpen, setIsProDialogOpen] = useState(false)
  const [selectedProModel, setSelectedProModel] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const searchInputRef = useRef<HTMLInputElement>(null)

  const currentModel = selectedModelId
    ? (models.find((model) => model.id === selectedModelId) ??
      getModelInfo(selectedModelId))
    : null

  useKeyShortcut(
    (e) => (e.key === "p" || e.key === "P") && e.metaKey && e.shiftKey,
    () => {
      if (disabled) return

      if (isMobile) {
        setIsDrawerOpen((prev) => !prev)
      } else {
        setIsDropdownOpen((prev) => !prev)
      }
    }
  )

  const handleSelect = (modelId: string, isLocked: boolean) => {
    if (disabled) return

    if (isLocked) {
      setSelectedProModel(modelId)
      if (!isUserAuthenticated) {
        if (isMobile) {
          setIsDrawerOpen(false)
        } else {
          setIsDropdownOpen(false)
        }
        onLockedGuestModelSelect?.(modelId)
        return
      }

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
    isUserAuthenticated ? favoriteModels || [] : [],
    searchQuery,
    isUserAuthenticated ? isModelHidden : () => false
  )

  const renderModelItem = (model: ModelConfig) => {
    const isLocked = !isModelSelectableForAuthState(model, isUserAuthenticated)
    const VendorIcon = getVendorIcon(model.icon ?? "openrouter")
    const routeLabel = getModelRouteLabel(model)

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
          <VendorIcon className="size-5" />
          <div className="flex flex-col gap-0">
            <span className="text-sm">{model.name}</span>
            {/* Dual-route disambiguation: wrapped entries can share a name and
                vendor icon with their direct sibling (e.g. GPT-5.5). */}
            {routeLabel && (
              <span className="text-muted-foreground text-xs">
                {routeLabel}
              </span>
            )}
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
      className={cn(
        "min-w-0 shrink overflow-hidden font-normal",
        isComposerVariant
          ? "cant-hover:ps-4 text-muted-foreground h-9 max-w-none justify-start gap-1.5 rounded-full py-0 ps-3.5 pe-3 text-sm active:scale-100 active:bg-black/5 aria-expanded:bg-black/5 dark:active:bg-white/10 dark:aria-expanded:bg-white/10 pointer-fine:hover:bg-black/5 dark:pointer-fine:hover:bg-white/10"
          : "max-w-full justify-between rounded-lg text-lg",
        className
      )}
      disabled={disabled || isLoadingModels}
      aria-label={`Select model, current model ${currentModel?.name || "unknown"}`}
    >
      <span className={cn("min-w-0 truncate", isComposerVariant && "max-w-40")}>
        {currentModel?.name || "Select model"}
      </span>
      <Icon
        icon={RiArrowDownSLine}
        slotSize={isComposerVariant ? 14 : 16}
        glyphSize={isComposerVariant ? 14 : undefined}
        className={cn(
          "shrink-0",
          isComposerVariant ? "text-muted-foreground -me-0.5" : "opacity-50"
        )}
      />
    </Button>
  )

  if (isMobile) {
    return (
      <>
        {isUserAuthenticated ? (
          <ProModelDialog
            isOpen={isProDialogOpen}
            setIsOpen={setIsProDialogOpen}
            currentModel={selectedProModel || ""}
          />
        ) : null}
        <Drawer
          open={isDrawerOpen}
          onOpenChange={(open) => {
            if (disabled && open) return
            setIsDrawerOpen(open)
          }}
        >
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
      {isUserAuthenticated ? (
        <ProModelDialog
          isOpen={isProDialogOpen}
          setIsOpen={setIsProDialogOpen}
          currentModel={selectedProModel || ""}
        />
      ) : null}
      <DropdownMenu
        open={isDropdownOpen}
        onOpenChange={(open) => {
          if (disabled && open) return
          setIsDropdownOpen(open)
          if (!open) {
            setSearchQuery("")
          }
        }}
      >
        {isComposerVariant ? (
          <Tooltip disableHoverablePopup>
            <TooltipTrigger
              render={<span className="inline-flex min-w-0" />}
            >
              <DropdownMenuTrigger render={trigger} />
            </TooltipTrigger>
            <TooltipContent side="bottom" hideArrow>
              Select model
            </TooltipContent>
          </Tooltip>
        ) : (
          <DropdownMenuTrigger render={trigger} />
        )}
        <DropdownMenuContent
          className="w-[300px] overflow-hidden [--model-selector-fixed-height:3rem] [--model-selector-list-max-height:18rem]"
          align={isComposerVariant ? "end" : "start"}
          sideOffset={4}
          animated={false}
          side={isComposerVariant ? "bottom" : "top"}
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
                className="border-input/60 bg-muted/60 dark:border-input dark:bg-muted/40 h-9 rounded-xl border pl-8 shadow-none focus-visible:ring-0"
                value={searchQuery}
                onChange={handleSearchChange}
                onClick={(e) => e.stopPropagation()}
                onFocus={(e) => e.stopPropagation()}
                onKeyDown={handleSearchKeyDown}
              />
            </div>
          </div>
          <div className="before:from-popover after:from-popover relative mt-[2px] rounded-xl before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-10 before:h-3 before:bg-gradient-to-b before:to-transparent before:content-[''] after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:z-10 after:h-4 after:bg-gradient-to-t after:to-transparent after:content-['']">
            <div className="[&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 max-h-[min(var(--model-selector-list-max-height),max(0px,calc(var(--available-height)-var(--model-selector-fixed-height))))] scroll-py-2 [scrollbar-width:thin] [scrollbar-color:color-mix(in_oklab,var(--muted-foreground)_35%,transparent)_transparent] [scrollbar-gutter:stable] overflow-x-hidden overflow-y-auto overscroll-contain py-1 pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent">
              {isLoadingModels ? (
                <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                  <p className="text-muted-foreground mb-2 text-sm">
                    Loading models...
                  </p>
                </div>
              ) : filteredModels.length > 0 ? (
                filteredModels.map((model) => {
                  const isLocked = !isModelSelectableForAuthState(
                    model,
                    isUserAuthenticated
                  )
                  const isSelected = selectedModelId === model.id
                  const VendorIcon = getVendorIcon(model.icon ?? "openrouter")
                  const routeLabel = getModelRouteLabel(model)

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
                        <VendorIcon className="size-5 shrink-0" />
                        <span className="truncate text-sm">{model.name}</span>
                        {/* Dual-route disambiguation: wrapped entries can share
                            a name and vendor icon with their direct sibling
                            (e.g. GPT-5.5). */}
                        {routeLabel && (
                          <span className="text-muted-foreground shrink-0 text-xs">
                            {routeLabel}
                          </span>
                        )}
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
