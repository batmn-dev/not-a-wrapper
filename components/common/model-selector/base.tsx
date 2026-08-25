"use client"

import { useKeyShortcut } from "@/app/hooks/use-key-shortcut"
import { Button } from "@/components/ui/button"
import { ComposerControl } from "@/components/ui/composer-control"
import {
  Drawer,
  DrawerContent,
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
  groupModelsForSelector,
  isModelSelectableForAuthState,
} from "@/lib/model-store/utils"
import { getModelInfo } from "@/lib/models"
import { resolveModelSelection } from "@/lib/models/catalog"
import { ModelConfig } from "@/lib/models/types"
import { getModelIcon } from "@/lib/provider-icons"
import { useUserPreferences } from "@/lib/user-preference-store/provider"
import { cn } from "@/lib/utils"
import {
  RiArrowDownSLine,
  RiCheckLine,
  RiSearchLine,
  RiStarLine,
} from "@remixicon/react"
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
  /** Composer pill uses content width, a max-w-40 label, and symmetric padding. */
  variant?: "default" | "composer"
}

// The responsive selector is one surface presented through two primitives.
// Keep its color recipe shared so the mobile drawer and desktop menu cannot drift.
const modelSelectorSurfaceClassName =
  "bg-floating-surface text-floating-surface-foreground"

function ModelOptionContent({
  model,
  isLocked,
  isMobile,
  isSelected,
}: {
  model: ModelConfig
  isLocked: boolean
  isMobile: boolean
  isSelected: boolean
}) {
  // The icon is the model MAKER's vendor identity; execution routes never
  // surface in the ordinary selector row (ADR-0020) — route details live in
  // API-key and model settings.
  return (
    <>
      <div
        className={cn(
          "flex min-w-0 items-center",
          isMobile ? "gap-3" : "gap-2"
        )}
      >
        <Icon
          icon={getModelIcon(model)}
          slotSize={isMobile ? 24 : 20}
          glyphSize={isMobile ? 24 : undefined}
          data-slot="model-option-icon"
          className="shrink-0"
        />
        <span
          data-slot="model-name"
          className={cn("truncate", isMobile ? "text-base" : "text-sm")}
        >
          {model.name}
        </span>
      </div>
      {isLocked || isSelected ? (
        <div className="flex shrink-0 items-center gap-2">
          {isLocked ? (
            <div className="border-input-border bg-muted text-muted-foreground flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium">
              <Icon icon={RiStarLine} slotSize={8} />
              <span>Locked</span>
            </div>
          ) : null}
          {isSelected ? (
            <Icon
              icon={RiCheckLine}
              slotSize={isMobile ? 20 : 16}
              glyphSize={isMobile ? 20 : 16}
              data-slot="selected-model-check"
            />
          ) : null}
        </div>
      ) : null}
    </>
  )
}

function ModelSelectorRows({
  models,
  isMobile,
  isUserAuthenticated,
  selectedModelId,
  onSelect,
}: {
  models: ModelConfig[]
  isMobile: boolean
  isUserAuthenticated: boolean
  selectedModelId: string | null
  onSelect: (modelId: string, isLocked: boolean) => void
}) {
  return models.map((model, index) => {
    const isLocked = !isModelSelectableForAuthState(model, isUserAuthenticated)
    const isSelected = selectedModelId === model.id
    const className = cn(
      "flex w-full items-center justify-between gap-2",
      isMobile ? "relative h-14 px-4 py-3" : "h-9 rounded-lg px-2 py-1.5",
      isMobile &&
        index > 0 &&
        "before:bg-floating-menu-divider/60 before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:content-['']",
      isSelected && "bg-interactive-selected"
    )
    const content = (
      <ModelOptionContent
        model={model}
        isLocked={isLocked}
        isMobile={isMobile}
        isSelected={isSelected}
      />
    )

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
        geometry="custom"
        className={className}
        onClick={() => onSelect(model.id, isLocked)}
      >
        {content}
      </DropdownMenuItem>
    )
  })
}

function ModelSelectorList({
  favorites,
  others,
  isLoading,
  isMobile,
  isUserAuthenticated,
  selectedModelId,
  onSelect,
}: {
  favorites: ModelConfig[]
  others: ModelConfig[]
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

  if (favorites.length === 0 && others.length === 0) {
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

  const rowProps = { isMobile, isUserAuthenticated, selectedModelId, onSelect }
  const sectionLabelClassName = cn(
    "text-muted-foreground text-xs font-medium",
    isMobile ? "px-3 pt-2 pb-1" : "px-2 pt-1.5 pb-1"
  )

  if (isMobile) {
    const sections = [
      { label: "Favorites", models: favorites },
      { label: "All models", models: others },
    ].filter(({ models }) => models.length > 0)

    return (
      <div className="flex flex-col gap-5 pb-2">
        {sections.map(({ label, models: sectionModels }) => (
          <div
            key={label}
            data-slot="model-section"
            role="group"
            aria-label={label}
          >
            <div
              data-slot="model-section-label"
              className="text-muted-foreground px-3 pb-2 text-sm font-medium"
            >
              {label}
            </div>
            <div
              data-slot="model-section-container"
              className="bg-muted/50 dark:bg-muted/80 overflow-hidden rounded-3xl"
            >
              <ModelSelectorRows models={sectionModels} {...rowProps} />
            </div>
          </div>
        ))}
      </div>
    )
  }

  // Favorites rank; every other model stays reachable beneath them.
  if (favorites.length === 0) {
    return <ModelSelectorRows models={others} {...rowProps} />
  }

  return (
    <>
      <div className={sectionLabelClassName}>Favorites</div>
      <ModelSelectorRows models={favorites} {...rowProps} />
      {others.length > 0 && (
        <>
          <div className={sectionLabelClassName}>All models</div>
          <ModelSelectorRows models={others} {...rowProps} />
        </>
      )}
    </>
  )
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

  // A persisted selection may be a legacy routed id; the trigger shows the
  // logical model identity either way.
  const normalizedSelectedModelId = selectedModelId
    ? resolveModelSelection(selectedModelId).modelId
    : null
  const currentModel = normalizedSelectedModelId
    ? (models.find((model) => model.id === normalizedSelectedModelId) ??
      getModelInfo(normalizedSelectedModelId))
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

  const { favorites, others } = groupModelsForSelector(
    models,
    isUserAuthenticated ? favoriteModels || [] : [],
    searchQuery,
    isUserAuthenticated ? isModelHidden : () => false
  )

  const TriggerControl = isComposerVariant ? ComposerControl : Button
  const trigger = (
    <TriggerControl
      {...(!isComposerVariant && { variant: "ghost" as const })}
      className={cn(
        "min-w-0 shrink font-normal",
        isComposerVariant
          ? "text-muted-foreground can-hover:relative can-hover:after:absolute can-hover:after:-inset-x-1 can-hover:after:inset-y-0 can-hover:after:content-[''] h-9 max-w-none justify-start gap-1.5 overflow-visible rounded-full px-3 py-0 text-sm"
          : "max-w-full justify-between overflow-hidden rounded-lg text-lg",
        className
      )}
      disabled={disabled || isLoadingModels}
      aria-label={`Select model, current model ${currentModel?.name || "unknown"}`}
    >
      {isComposerVariant && currentModel ? (
        <Icon
          icon={getModelIcon(currentModel)}
          slotSize={16}
          glyphSize={16}
          data-slot="selected-model-icon"
          className="text-foreground shrink-0 opacity-100"
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
    </TriggerControl>
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
          <DrawerContent
            className={cn(
              modelSelectorSurfaceClassName,
              "dark:bg-floating-surface/80 overflow-hidden [--model-selector-mobile-header-height:5rem] data-[vaul-drawer-direction=bottom]:rounded-t-[2rem] dark:backdrop-blur-[10px]"
            )}
            handleClassName="bg-muted-foreground/60 absolute top-2 left-1/2 z-20 mt-0 h-1 w-11 -translate-x-1/2"
            handleHitAreaClassName="pointer-events-auto absolute inset-x-0 top-0 z-20 h-5 touch-none"
          >
            <DrawerTitle className="sr-only">Select Model</DrawerTitle>
            <div
              data-slot="model-selector-mobile-search"
              className="from-floating-surface/80 to-floating-surface/0 pointer-events-none absolute inset-x-0 top-0 z-10 h-20 bg-gradient-to-b px-4 pt-5"
            >
              <div className="pointer-events-auto relative">
                <Icon
                  icon={RiSearchLine}
                  slotSize={20}
                  glyphSize={20}
                  data-slot="model-selector-search-icon"
                  className="text-muted-foreground absolute top-1/2 left-4 z-10 -translate-y-1/2"
                />
                <Input
                  ref={searchInputRef}
                  placeholder="Search models..."
                  className="border-input-border bg-floating-surface/70 h-12 rounded-full border pl-10 shadow-none backdrop-blur-md focus-visible:ring-0"
                  value={searchQuery}
                  onChange={handleSearchChange}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            </div>
            <div
              data-slot="model-selector-mobile-scroll"
              className="flex h-full min-h-0 flex-col space-y-0 overflow-y-auto overscroll-contain px-4 pt-(--model-selector-mobile-header-height) pb-6"
            >
              <ModelSelectorList
                favorites={favorites}
                others={others}
                isLoading={isLoadingModels}
                isMobile
                isUserAuthenticated={isUserAuthenticated}
                selectedModelId={normalizedSelectedModelId}
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
          <Tooltip disableHoverablePopup disabled={isDropdownOpen}>
            <TooltipTrigger render={<DropdownMenuTrigger render={trigger} />} />
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
          geometry="custom"
          className={cn(
            modelSelectorSurfaceClassName,
            "w-[300px] overflow-hidden rounded-(--floating-menu-radius) p-1.5 [--model-selector-fixed-height:3rem] [--model-selector-list-max-height:18rem]"
          )}
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
          <div className="before:from-floating-surface after:from-floating-surface relative mt-[2px] rounded-xl before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-10 before:h-3 before:bg-gradient-to-b before:to-transparent before:content-[''] after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:z-10 after:h-4 after:bg-gradient-to-t after:to-transparent after:content-['']">
            <div
              data-scrollable-surface=""
              className="max-h-[min(var(--model-selector-list-max-height),max(0px,calc(var(--available-height)-var(--model-selector-fixed-height))))] scroll-py-2 [scrollbar-gutter:stable] overflow-x-hidden overflow-y-auto overscroll-contain py-1 pr-1"
            >
              <ModelSelectorList
                favorites={favorites}
                others={others}
                isLoading={isLoadingModels}
                isMobile={false}
                isUserAuthenticated={isUserAuthenticated}
                selectedModelId={normalizedSelectedModelId}
                onSelect={handleSelect}
              />
            </div>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
