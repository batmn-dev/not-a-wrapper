"use client"

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
import { Kbd } from "@/components/ui/kbd"
import {
  Tooltip,
  TooltipContent,
  TooltipShortcut,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useBreakpoint } from "@/hooks/use-breakpoint"
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
  /** Called after a desktop model selection closes so the owning surface can restore task focus. */
  onSelectionCommitted?: () => void
  disabled?: boolean
  /** Composer pill matches ChatGPT reference: content width, max-w-40 label, asymmetric padding. */
  variant?: "default" | "composer"
}

function getModelRouteLabel(model: ModelConfig | null | undefined) {
  return model?.providerId === "openrouter" ? "OpenRouter" : null
}

function ModelOptionContent({
  model,
  isLocked,
}: {
  model: ModelConfig
  isLocked: boolean
}) {
  const routeLabel = getModelRouteLabel(model)

  return (
    <>
      <div className="flex min-w-0 items-center gap-2">
        <Icon
          icon={getVendorIcon(model.icon)}
          slotSize={20}
          className="shrink-0"
        />
        <span className="truncate text-sm">{model.name}</span>
        {routeLabel && (
          <span className="text-muted-foreground shrink-0 text-xs">
            {routeLabel}
          </span>
        )}
      </div>
      {isLocked ? (
        <div className="border-input-border bg-muted text-muted-foreground flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium">
          <Icon icon={RiStarLine} slotSize={8} />
          <span>Locked</span>
        </div>
      ) : null}
    </>
  )
}

function ModelSelectorList({
  models,
  isLoading,
  isMobile,
  isUserAuthenticated,
  selectedModelId,
  onSelect,
}: {
  models: ModelConfig[]
  isLoading: boolean
  isMobile: boolean
  isUserAuthenticated: boolean
  selectedModelId: string | null
  onSelect: (modelId: string, isLocked: boolean) => void
}) {
  if (isLoading) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
        <p className="text-muted-foreground mb-2 text-sm">Loading models...</p>
      </div>
    )
  }

  if (models.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
        <p className="text-muted-foreground mb-1 text-sm">No results found.</p>
        <a
          href="https://github.com/batmn-dev/not-a-wrapper/issues/new?title=Model%20Request%3A%20"
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground text-sm underline"
        >
          Request a new model
        </a>
      </div>
    )
  }

  return models.map((model) => {
    const isLocked = !isModelSelectableForAuthState(model, isUserAuthenticated)
    const className = cn(
      "flex w-full items-center justify-between gap-2",
      isMobile ? "px-3 py-2" : "px-2",
      selectedModelId === model.id && "bg-interactive-selected"
    )
    const content = <ModelOptionContent model={model} isLocked={isLocked} />

    return isMobile ? (
      <button
        key={model.id}
        type="button"
        data-testid="model-option"
        className={className}
        onClick={() => onSelect(model.id, isLocked)}
      >
        {content}
      </button>
    ) : (
      <DropdownMenuItem
        key={model.id}
        className={className}
        onClick={() => onSelect(model.id, isLocked)}
      >
        {content}
      </DropdownMenuItem>
    )
  })
}

export function ModelSelector({
  className,
  isUserAuthenticated = true,
  selectedModelId,
  setSelectedModelId,
  onLockedGuestModelSelect,
  onSelectionCommitted,
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
  const selectionCommittedRef = useRef(false)

  const currentModel = selectedModelId
    ? (models.find((model) => model.id === selectedModelId) ??
      getModelInfo(selectedModelId))
    : null

  useKeyShortcut(
    (e) => (e.key === "m" || e.key === "M") && e.ctrlKey && e.shiftKey,
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
        setIsDrawerOpen(false)
        setIsDropdownOpen(false)
        setSearchQuery("")
        onLockedGuestModelSelect?.(modelId)
        return
      }

      setIsProDialogOpen(true)
      return
    }

    selectionCommittedRef.current = !isMobile
    setSelectedModelId(modelId)
    setIsDrawerOpen(false)
    setIsDropdownOpen(false)
    setSearchQuery("")
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

  const trigger = (
    <Button
      variant="ghost"
      className={cn(
        "min-w-0 shrink overflow-hidden font-normal",
        isComposerVariant
          ? "cant-hover:ps-4 text-muted-foreground active:bg-interactive-pressed aria-expanded:bg-interactive-selected pointer-fine:hover:bg-interactive-hover h-9 max-w-none justify-start gap-1.5 rounded-full py-0 ps-3.5 pe-3 text-sm active:scale-100"
          : "max-w-full justify-between rounded-lg text-lg",
        className
      )}
      disabled={disabled || isLoadingModels}
      aria-label={`Select model, current model ${currentModel?.name || "unknown"}`}
    >
      {isComposerVariant && currentModel ? (
        <Icon
          icon={getVendorIcon(currentModel.icon)}
          slotSize={16}
          glyphSize={16}
          data-slot="selected-model-icon"
          className="shrink-0"
        />
      ) : null}
      <span className={cn("min-w-0 truncate", isComposerVariant && "max-w-40")}>
        {currentModel?.name || "Select model"}
      </span>
      {!isComposerVariant ? (
        <Icon
          icon={RiArrowDownSLine}
          slotSize={16}
          className="shrink-0 opacity-50"
        />
      ) : null}
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
            if (!open) setSearchQuery("")
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
              <ModelSelectorList
                models={filteredModels}
                isLoading={isLoadingModels}
                isMobile
                isUserAuthenticated={isUserAuthenticated}
                selectedModelId={selectedModelId}
                onSelect={handleSelect}
              />
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
        onOpenChangeComplete={(open) => {
          if (open || !selectionCommittedRef.current) return
          selectionCommittedRef.current = false
          onSelectionCommitted?.()
        }}
      >
        {isComposerVariant ? (
          <Tooltip disableHoverablePopup>
            <TooltipTrigger render={<span className="inline-flex min-w-0" />}>
              <DropdownMenuTrigger render={trigger} />
            </TooltipTrigger>
            <TooltipContent side="bottom" hideArrow>
              <TooltipShortcut label="Select model">
                <Kbd label="Control">⌃</Kbd>
                <Kbd label="Shift">⇧</Kbd>
                <Kbd>M</Kbd>
              </TooltipShortcut>
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
                className="border-input-border bg-input-bg h-9 rounded-xl border pl-8 shadow-none focus-visible:ring-0"
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
              <ModelSelectorList
                models={filteredModels}
                isLoading={isLoadingModels}
                isMobile={false}
                isUserAuthenticated={isUserAuthenticated}
                selectedModelId={selectedModelId}
                onSelect={handleSelect}
              />
            </div>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
