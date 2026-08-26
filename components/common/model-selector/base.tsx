"use client"

import { useFavoriteModels } from "@/app/components/layout/settings/models/use-favorite-models"
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
import { PinActionGlyph } from "@/components/ui/pin-action-glyph"
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
import {
  resolveModelSelection,
  type LogicalModelView,
} from "@/lib/models/catalog"
import {
  getModelDisplayName,
  getModelSnapshotDateLabel,
} from "@/lib/models/presentation"
import {
  getModelIcon,
  getVendorIcon,
  type VendorIcon,
} from "@/lib/provider-icons"
import { getVendor } from "@/lib/provider-identity"
import { useUserPreferences } from "@/lib/user-preference-store/provider"
import { cn } from "@/lib/utils"
import {
  RiArrowDownSLine,
  RiCheckLine,
  RiLockLine,
  RiSearchLine,
} from "@remixicon/react"
import { useReducedMotion } from "motion/react"
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
const modelSelectorSearchOverlayClassName =
  "from-floating-surface/80 to-floating-surface/0 pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b"
const modelSelectorSearchInputClassName =
  "border-input-border bg-floating-surface/70 rounded-full border shadow-none backdrop-blur-md focus-visible:ring-0"
const modelSelectorPressKeyframes: Keyframe[] = [
  { transform: "scale(1)" },
  { transform: "scale(0.96)" },
]
const modelSelectorPressTiming: KeyframeAnimationOptions = {
  duration: 75,
  easing: "cubic-bezier(0.4, 0, 0.2, 1)",
  fill: "forwards",
}

type LegacyProviderOption = {
  providerId: string
  providerName: string
  icon: VendorIcon
  models: LogicalModelView[]
}

type ModelSelectorRow =
  | { type: "model"; model: LogicalModelView }
  | { type: "show-legacy"; provider: LegacyProviderOption }

type ModelListScrollSnapshot = {
  scrollSurface: HTMLElement
  scrollTop: number
  anchorKey?: string
  anchorOffset?: number
}

const modelSelectorRowSelector = "[data-model-selector-row]"

function captureModelListScroll(
  trigger: HTMLButtonElement
): ModelListScrollSnapshot | null {
  const scrollSurface = trigger.closest<HTMLElement>(
    "[data-scrollable-surface]"
  )
  if (!scrollSurface) return null

  const activeRow = trigger.closest<HTMLElement>(modelSelectorRowSelector)
  const surfaceRect = scrollSurface.getBoundingClientRect()
  const anchor = Array.from(
    scrollSurface.querySelectorAll<HTMLElement>(modelSelectorRowSelector)
  ).find((row) => {
    if (row === activeRow) return false
    const rect = row.getBoundingClientRect()
    return rect.bottom > surfaceRect.top && rect.top < surfaceRect.bottom
  })

  return {
    scrollSurface,
    scrollTop: scrollSurface.scrollTop,
    anchorKey: anchor?.dataset.modelSelectorRow,
    anchorOffset: anchor
      ? anchor.getBoundingClientRect().top - surfaceRect.top
      : undefined,
  }
}

function restoreModelListScroll(snapshot: ModelListScrollSnapshot) {
  const { scrollSurface, scrollTop, anchorKey, anchorOffset } = snapshot
  const anchor = anchorKey
    ? Array.from(
        scrollSurface.querySelectorAll<HTMLElement>(modelSelectorRowSelector)
      ).find((row) => row.dataset.modelSelectorRow === anchorKey)
    : undefined

  if (!anchor || anchorOffset === undefined) {
    scrollSurface.scrollTop = scrollTop
    return
  }

  const nextOffset =
    anchor.getBoundingClientRect().top -
    scrollSurface.getBoundingClientRect().top
  // Base UI may scroll while rows regroup, so compensate from its latest position.
  scrollSurface.scrollTop = scrollSurface.scrollTop + nextOffset - anchorOffset
}

function getModelSelectorRowClassName({
  isMobile,
  hasDivider,
  isSelected = false,
}: {
  isMobile: boolean
  hasDivider: boolean
  isSelected?: boolean
}) {
  return cn(
    "flex w-full items-center justify-between gap-2",
    isMobile ? "relative h-14 px-4 py-3" : "h-10 rounded-xl px-2 py-1.5",
    isMobile &&
      hasDivider &&
      "before:bg-floating-menu-divider/60 before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:content-['']",
    isSelected && "bg-interactive-selected"
  )
}

function getLegacyProviderOptions(
  models: readonly LogicalModelView[]
): LegacyProviderOption[] {
  const providers = new Map<string, LegacyProviderOption>()

  for (const model of models) {
    const provider = providers.get(model.baseProviderId)
    if (provider) {
      provider.models.push(model)
      continue
    }

    providers.set(model.baseProviderId, {
      providerId: model.baseProviderId,
      providerName: getVendor(model.baseProviderId)?.name ?? model.provider,
      icon:
        model.baseProviderId === "anthropic"
          ? getVendorIcon("claude")
          : getModelIcon(model),
      models: [model],
    })
  }

  return [...providers.values()]
}

function buildModelSelectorRows(
  models: readonly LogicalModelView[],
  legacyProviders: readonly LegacyProviderOption[],
  revealedLegacyProviders: ReadonlySet<string>
): ModelSelectorRow[] {
  const lastModelIndexByProvider = new Map<string, number>()
  models.forEach((model, index) => {
    lastModelIndexByProvider.set(model.baseProviderId, index)
  })

  const legacyProviderById = new Map<string, LegacyProviderOption>(
    legacyProviders.map((provider) => [provider.providerId, provider])
  )
  const rows: ModelSelectorRow[] = []

  const addLegacyRows = (provider: LegacyProviderOption) => {
    if (revealedLegacyProviders.has(provider.providerId)) {
      rows.push(
        ...provider.models.map((model): ModelSelectorRow => ({
          type: "model",
          model,
        }))
      )
    } else {
      rows.push({ type: "show-legacy", provider })
    }

    legacyProviderById.delete(provider.providerId)
  }

  models.forEach((model, index) => {
    rows.push({ type: "model", model })

    if (lastModelIndexByProvider.get(model.baseProviderId) !== index) return
    const legacyProvider = legacyProviderById.get(model.baseProviderId)
    if (!legacyProvider) return

    addLegacyRows(legacyProvider)
  })

  for (const provider of legacyProviders) {
    if (legacyProviderById.has(provider.providerId)) {
      addLegacyRows(provider)
    }
  }

  return rows
}

function ModelOptionLabel({
  icon,
  label,
  detail,
  isMobile,
  iconSlot,
  labelSlot,
  labelClassName,
}: {
  icon: VendorIcon
  label: string
  detail?: string
  isMobile: boolean
  iconSlot: string
  labelSlot: string
  labelClassName?: string
}) {
  return (
    <div
      className={cn("flex min-w-0 items-center", isMobile ? "gap-3" : "gap-2")}
    >
      <Icon
        icon={icon}
        slotSize={isMobile ? 24 : 20}
        glyphSize={isMobile ? 24 : undefined}
        data-slot={iconSlot}
        className="shrink-0"
      />
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span
          data-slot={labelSlot}
          className={cn("truncate text-base", labelClassName)}
        >
          {label}
        </span>
        {detail ? (
          <span
            data-slot="model-snapshot-date"
            className={cn(
              "text-muted-foreground shrink-0",
              isMobile ? "text-sm" : "text-xs"
            )}
          >
            {detail}
          </span>
        ) : null}
      </div>
    </div>
  )
}

function ModelOptionContent({
  model,
  isLocked,
  isMobile,
  isSelected,
  isPinned,
  canPin,
  onTogglePinned,
}: {
  model: LogicalModelView
  isLocked: boolean
  isMobile: boolean
  isSelected: boolean
  isPinned: boolean
  canPin: boolean
  onTogglePinned: (trigger: HTMLButtonElement) => void
}) {
  const snapshotDateLabel =
    model.classification === "legacy"
      ? getModelSnapshotDateLabel(model)
      : undefined

  // The icon is the model MAKER's vendor identity; execution routes never
  // surface in the ordinary selector row (ADR-0020) — route details live in
  // API-key and model settings.
  return (
    <>
      <ModelOptionLabel
        icon={getModelIcon(model)}
        label={getModelDisplayName(model)}
        detail={snapshotDateLabel}
        isMobile={isMobile}
        iconSlot="model-option-icon"
        labelSlot="model-name"
      />
      <div
        data-slot="model-option-right-slot"
        className={cn(
          "relative flex shrink-0 items-center justify-center",
          isMobile ? "size-6" : "size-[18px]"
        )}
      >
        {isLocked ? (
          <Icon
            icon={RiLockLine}
            slotSize={isMobile ? 20 : 18}
            glyphSize={isMobile ? 20 : 18}
            data-slot="locked-model-icon"
            aria-label="Locked"
            decorative={false}
            className={cn(
              canPin &&
                "group-focus-within/model-option:opacity-0 group-hover/model-option:opacity-0"
            )}
          />
        ) : isSelected ? (
          <Icon
            icon={RiCheckLine}
            slotSize={isMobile ? 20 : 18}
            glyphSize={isMobile ? 20 : 18}
            data-slot="selected-model-check"
            className={cn(
              canPin &&
                "group-focus-within/model-option:opacity-0 group-hover/model-option:opacity-0"
            )}
          />
        ) : null}
        {canPin ? (
          <Tooltip disableHoverablePopup>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="group/pin text-muted-foreground hover:text-foreground focus-visible:text-foreground pointer-events-none absolute -inset-2 flex items-center justify-center rounded-lg opacity-0 outline-none group-focus-within/model-option:pointer-events-auto group-focus-within/model-option:opacity-100 group-hover/model-option:pointer-events-auto group-hover/model-option:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
                  aria-label={`${isPinned ? "Unpin" : "Pin"} ${getModelDisplayName(model)}`}
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    onTogglePinned(event.currentTarget)
                  }}
                />
              }
            >
              <span className="relative flex size-6 items-center justify-center">
                <PinActionGlyph pinned={isPinned} />
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" variant="outline">
              {isPinned ? "Unpin model" : "Pin model"}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </>
  )
}

function ModelSelectorRows({
  models,
  legacyProviders = [],
  revealedLegacyProviders,
  isMobile,
  isUserAuthenticated,
  canPinModels,
  selectedModelId,
  pinnedModelIds,
  onSelect,
  onTogglePinned,
  onShowLegacy,
}: {
  models: LogicalModelView[]
  legacyProviders?: LegacyProviderOption[]
  revealedLegacyProviders: ReadonlySet<string>
  isMobile: boolean
  isUserAuthenticated: boolean
  canPinModels: boolean
  selectedModelId: string | null
  pinnedModelIds: ReadonlySet<string>
  onSelect: (modelId: string, isLocked: boolean) => void
  onTogglePinned: (modelId: string, trigger: HTMLButtonElement) => void
  onShowLegacy: (providerId: string) => void
}) {
  return buildModelSelectorRows(
    models,
    legacyProviders,
    revealedLegacyProviders
  ).map((row, index) => {
    if (row.type === "show-legacy") {
      const className = cn(
        getModelSelectorRowClassName({
          isMobile,
          hasDivider: index > 0,
        }),
        "group/show-legacy justify-start text-left"
      )
      const content = (
        <ModelOptionLabel
          icon={row.provider.icon}
          label="Show legacy models..."
          isMobile={isMobile}
          iconSlot="show-legacy-models-icon"
          labelSlot="show-legacy-models-label"
          labelClassName="opacity-40 group-hover/show-legacy:opacity-100"
        />
      )

      return isMobile ? (
        <button
          key={`show-legacy-${row.provider.providerId}`}
          type="button"
          data-testid="show-legacy-models"
          className={className}
          aria-label={`Show legacy models for ${row.provider.providerName}`}
          onClick={() => onShowLegacy(row.provider.providerId)}
        >
          {content}
        </button>
      ) : (
        <DropdownMenuItem
          key={`show-legacy-${row.provider.providerId}`}
          geometry="custom"
          closeOnClick={false}
          data-testid="show-legacy-models"
          data-model-selector-row={`legacy:${row.provider.providerId}`}
          className={className}
          aria-label={`Show legacy models for ${row.provider.providerName}`}
          onClick={() => onShowLegacy(row.provider.providerId)}
        >
          {content}
        </DropdownMenuItem>
      )
    }

    const { model } = row
    const isLocked = !isModelSelectableForAuthState(model, isUserAuthenticated)
    const isSelected = selectedModelId === model.id
    const className = cn(
      getModelSelectorRowClassName({
        isMobile,
        hasDivider: index > 0,
        isSelected,
      }),
      "group/model-option"
    )
    const content = (
      <ModelOptionContent
        model={model}
        isLocked={isLocked}
        isMobile={isMobile}
        isSelected={isSelected}
        isPinned={pinnedModelIds.has(model.id)}
        canPin={canPinModels && !isMobile}
        onTogglePinned={(trigger) => onTogglePinned(model.id, trigger)}
      />
    )

    return isMobile ? (
      <button
        key={model.id}
        type="button"
        data-testid="model-option"
        data-model-selector-row={`model:${model.id}`}
        className={className}
        onClick={() => onSelect(model.id, isLocked)}
      >
        {content}
      </button>
    ) : (
      <DropdownMenuItem
        key={model.id}
        geometry="custom"
        data-model-selector-row={`model:${model.id}`}
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
  legacyProviders,
  revealedLegacyProviders,
  isLoading,
  isMobile,
  isUserAuthenticated,
  canPinModels,
  selectedModelId,
  pinnedModelIds,
  onSelect,
  onTogglePinned,
  onShowLegacy,
}: {
  favorites: LogicalModelView[]
  others: LogicalModelView[]
  legacyProviders: LegacyProviderOption[]
  revealedLegacyProviders: ReadonlySet<string>
  isLoading: boolean
  isMobile: boolean
  isUserAuthenticated: boolean
  canPinModels: boolean
  selectedModelId: string | null
  pinnedModelIds: ReadonlySet<string>
  onSelect: (modelId: string, isLocked: boolean) => void
  onTogglePinned: (modelId: string, trigger: HTMLButtonElement) => void
  onShowLegacy: (providerId: string) => void
}) {
  if (isLoading) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
        <p className="text-muted-foreground mb-2 text-sm">Loading models...</p>
      </div>
    )
  }

  if (
    favorites.length === 0 &&
    others.length === 0 &&
    legacyProviders.length === 0
  ) {
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

  const rowProps = {
    isMobile,
    isUserAuthenticated,
    canPinModels,
    selectedModelId,
    pinnedModelIds,
    onSelect,
    onTogglePinned,
    onShowLegacy,
    revealedLegacyProviders,
  }
  const sectionLabelClassName = cn(
    "text-muted-foreground text-xs font-medium",
    isMobile ? "px-3 pt-2 pb-1" : "px-2 pt-1.5 pb-1"
  )

  if (isMobile) {
    const sections = [
      { label: "Pinned", models: favorites, legacyProviders: [] },
      { label: "All models", models: others, legacyProviders },
    ].filter(
      ({ models, legacyProviders: sectionLegacyProviders }) =>
        models.length > 0 || sectionLegacyProviders.length > 0
    )

    return (
      <div className="flex flex-col gap-5 pb-2">
        {sections.map(({ label, models: sectionModels, legacyProviders }) => (
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
              <ModelSelectorRows
                models={sectionModels}
                legacyProviders={legacyProviders}
                {...rowProps}
              />
            </div>
          </div>
        ))}
      </div>
    )
  }

  // Favorites rank; every other model stays reachable beneath them.
  if (favorites.length === 0) {
    return (
      <ModelSelectorRows
        models={others}
        legacyProviders={legacyProviders}
        {...rowProps}
      />
    )
  }

  return (
    <>
      <div className={sectionLabelClassName}>Pinned</div>
      <ModelSelectorRows models={favorites} {...rowProps} />
      {(others.length > 0 || legacyProviders.length > 0) && (
        <>
          <div className={sectionLabelClassName}>All models</div>
          <ModelSelectorRows
            models={others}
            legacyProviders={legacyProviders}
            {...rowProps}
          />
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
  const { models, isLoading: isLoadingModels } = useModel()
  const { favoriteModels, updateFavoriteModels } = useFavoriteModels()
  const { isModelHidden } = useUserPreferences()
  const isMobile = useBreakpoint(768)
  const shouldReduceMotion = useReducedMotion()

  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [isProDialogOpen, setIsProDialogOpen] = useState(false)
  const [selectedProModel, setSelectedProModel] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [revealedLegacyProviders, setRevealedLegacyProviders] = useState(
    () => new Set<string>()
  )
  const searchInputRef = useRef<HTMLInputElement>(null)
  const desktopAnchorRef = useRef<HTMLDivElement>(null)
  const pressAnimationRef = useRef<Animation | null>(null)
  const pressEndCleanupRef = useRef<(() => void) | null>(null)
  const selectionCommittedRef = useRef(false)

  const resetModelList = () => {
    setSearchQuery("")
    setRevealedLegacyProviders(new Set<string>())
  }

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
        const nextOpen = !isDrawerOpen
        setIsDrawerOpen(nextOpen)
        if (!nextOpen) resetModelList()
      } else {
        const nextOpen = !isDropdownOpen
        setIsDropdownOpen(nextOpen)
        if (!nextOpen) resetModelList()
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
        resetModelList()
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
    resetModelList()
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

  const handleShowLegacy = (providerId: string) => {
    setRevealedLegacyProviders((current) => {
      const next = new Set(current)
      next.add(providerId)
      return next
    })
  }

  const handlePressPointerDown = (
    event: React.PointerEvent<HTMLDivElement>
  ) => {
    if (event.button !== 0 || !event.isPrimary) return

    pressEndCleanupRef.current?.()
    pressAnimationRef.current?.cancel()
    pressAnimationRef.current = null

    if (shouldReduceMotion) return

    // Start before Base UI's mousedown open so menu work cannot delay the press.
    const pressSurface = event.currentTarget
    const animation = pressSurface.animate(
      modelSelectorPressKeyframes,
      modelSelectorPressTiming
    )
    pressAnimationRef.current = animation

    let isReleased = false
    let hasReachedPressedScale = false
    let isReturning = false

    const startReturnAnimation = () => {
      if (isReturning || pressAnimationRef.current !== animation) return
      isReturning = true

      const returnAnimation = pressSurface.animate(
        [...modelSelectorPressKeyframes].reverse(),
        modelSelectorPressTiming
      )
      animation.cancel()
      pressAnimationRef.current = returnAnimation
      returnAnimation.onfinish = () => {
        if (pressAnimationRef.current !== returnAnimation) return
        returnAnimation.cancel()
        pressAnimationRef.current = null
      }
    }

    animation.onfinish = () => {
      if (pressAnimationRef.current !== animation) return
      hasReachedPressedScale = true
      if (isReleased) startReturnAnimation()
    }

    const ownerWindow = pressSurface.ownerDocument.defaultView
    if (!ownerWindow) return

    const pointerId = event.pointerId

    function cleanupPointerEnd() {
      ownerWindow?.removeEventListener("pointerup", handlePointerEnd, true)
      ownerWindow?.removeEventListener("pointercancel", handlePointerEnd, true)
      if (pressEndCleanupRef.current === cleanupPointerEnd) {
        pressEndCleanupRef.current = null
      }
    }

    function handlePointerEnd(endEvent: PointerEvent) {
      if (endEvent.pointerId !== pointerId) return
      cleanupPointerEnd()
      isReleased = true
      if (hasReachedPressedScale) startReturnAnimation()
    }

    pressEndCleanupRef.current = cleanupPointerEnd
    ownerWindow.addEventListener("pointerup", handlePointerEnd, true)
    ownerWindow.addEventListener("pointercancel", handlePointerEnd, true)
  }

  const handleTogglePinned = (modelId: string, trigger: HTMLButtonElement) => {
    const scrollSnapshot = captureModelListScroll(trigger)
    const nextPinnedModels = favoriteModels.includes(modelId)
      ? favoriteModels.filter((pinnedModelId) => pinnedModelId !== modelId)
      : [...favoriteModels, modelId]

    // The action moves with its row during regrouping. Letting it retain focus
    // makes the menu scroll the moved row back into view.
    trigger.blur()
    updateFavoriteModels(nextPinnedModels)

    if (scrollSnapshot) {
      window.setTimeout(() => {
        restoreModelListScroll(scrollSnapshot)
      }, 0)
    }
  }

  const selectedLegacyModelId =
    isComposerVariant &&
    models.some(
      (model) =>
        model.id === normalizedSelectedModelId &&
        model.classification === "legacy"
    )
      ? normalizedSelectedModelId
      : null
  const { favorites, others } = groupModelsForSelector(
    models.filter(
      (model) =>
        model.classification === "current" || model.id === selectedLegacyModelId
    ),
    isUserAuthenticated ? favoriteModels || [] : [],
    searchQuery,
    isUserAuthenticated ? isModelHidden : () => false
  )
  const { others: legacyModels } = groupModelsForSelector(
    models.filter(
      (model) =>
        model.classification === "legacy" && model.id !== selectedLegacyModelId
    ),
    [],
    searchQuery,
    isUserAuthenticated ? isModelHidden : () => false
  )
  const legacyProviders = getLegacyProviderOptions(legacyModels)
  const pinnedModelIds = new Set(favoriteModels)
  const usesGesturePress = isComposerVariant && !isMobile
  const effectiveRevealedLegacyProviders = searchQuery
    ? new Set(legacyProviders.map((provider) => provider.providerId))
    : revealedLegacyProviders

  const TriggerControl = isComposerVariant ? ComposerControl : Button
  const currentModelFullName = currentModel
    ? getModelDisplayName(currentModel)
    : "unknown"
  const trigger = (
    <TriggerControl
      {...(!isComposerVariant && { variant: "ghost" as const })}
      className={cn(
        "min-w-0 shrink font-normal",
        isComposerVariant
          ? "text-muted-foreground can-hover:relative can-hover:after:absolute can-hover:after:-inset-x-1 can-hover:after:inset-y-0 can-hover:after:content-[''] h-9 max-w-full justify-start gap-1.5 overflow-visible rounded-full py-0 ps-3.5 pe-3 text-base leading-[26px]"
          : "max-w-full justify-between overflow-hidden rounded-lg text-lg",
        usesGesturePress && "transition-none active:scale-100",
        className
      )}
      disabled={disabled || isLoadingModels}
      aria-label={`Select model, current model ${currentModelFullName}`}
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
      <span
        className={cn(
          "min-w-0 truncate",
          isComposerVariant && "text-foreground"
        )}
      >
        {currentModel
          ? getModelDisplayName(
              currentModel,
              isComposerVariant ? "compact" : "full"
            )
          : "Select model"}
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
            if (!open) resetModelList()
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
              className={cn(
                modelSelectorSearchOverlayClassName,
                "h-20 px-4 pt-5"
              )}
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
                  className={cn(
                    modelSelectorSearchInputClassName,
                    "h-12 pl-10"
                  )}
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
                legacyProviders={legacyProviders}
                revealedLegacyProviders={effectiveRevealedLegacyProviders}
                isLoading={isLoadingModels}
                isMobile
                isUserAuthenticated={isUserAuthenticated}
                canPinModels={isUserAuthenticated && !disabled}
                selectedModelId={normalizedSelectedModelId}
                pinnedModelIds={pinnedModelIds}
                onSelect={handleSelect}
                onTogglePinned={handleTogglePinned}
                onShowLegacy={handleShowLegacy}
              />
            </div>
          </DrawerContent>
        </Drawer>
      </>
    )
  }

  return (
    <div ref={desktopAnchorRef} data-slot="model-selector-desktop-anchor">
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
            resetModelList()
          }
        }}
        onOpenChangeComplete={(open) => {
          if (open || !selectionCommittedRef.current) return
          selectionCommittedRef.current = false
          onSelectionCommitted?.()
        }}
      >
        {isComposerVariant ? (
          <div
            data-slot="model-selector-press-surface"
            className="inline-flex"
            tabIndex={-1}
            onPointerDown={handlePressPointerDown}
          >
            <Tooltip disableHoverablePopup disabled={isDropdownOpen}>
              <TooltipTrigger
                render={<DropdownMenuTrigger render={trigger} />}
              />
              <TooltipContent side="bottom" hideArrow>
                <TooltipShortcut label="Select model">
                  <Kbd label="Control">⌃</Kbd>
                  <Kbd label="Shift">⇧</Kbd>
                  <Kbd>M</Kbd>
                </TooltipShortcut>
              </TooltipContent>
            </Tooltip>
          </div>
        ) : (
          <DropdownMenuTrigger render={trigger} />
        )}
        <DropdownMenuContent
          anchor={isComposerVariant ? desktopAnchorRef : undefined}
          geometry="custom"
          className={cn(
            modelSelectorSurfaceClassName,
            "relative w-[300px] overflow-hidden rounded-3xl p-1.5 [--model-selector-fixed-height:3rem] [--model-selector-list-max-height:19rem]"
          )}
          align={isComposerVariant ? "end" : "start"}
          sideOffset={4}
          animated={false}
          side={isComposerVariant ? "bottom" : "top"}
        >
          <div
            data-slot="model-selector-desktop-search"
            className={cn(
              modelSelectorSearchOverlayClassName,
              "h-14 px-1.5 pt-1.5"
            )}
          >
            <div className="pointer-events-auto relative">
              <Icon
                icon={RiSearchLine}
                slotSize={18}
                className="text-foreground absolute top-1/2 left-2.5 z-10 -translate-y-1/2"
              />
              <Input
                ref={searchInputRef}
                placeholder="Search models..."
                className={cn(modelSelectorSearchInputClassName, "h-10 pl-8")}
                value={searchQuery}
                onChange={handleSearchChange}
                onClick={(e) => e.stopPropagation()}
                onFocus={(e) => e.stopPropagation()}
                onKeyDown={handleSearchKeyDown}
              />
            </div>
          </div>
          <div className="after:from-floating-surface relative rounded-xl after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:z-10 after:h-4 after:bg-gradient-to-t after:to-transparent after:content-['']">
            <div
              data-scrollable-surface=""
              className="max-h-[min(calc(var(--model-selector-list-max-height)+var(--model-selector-fixed-height)),max(0px,calc(var(--available-height)-0.75rem)))] scroll-pt-[calc(var(--model-selector-fixed-height)+0.5rem)] scroll-pb-2 [scrollbar-width:none] overflow-x-hidden overflow-y-auto overscroll-contain pt-(--model-selector-fixed-height) [&::-webkit-scrollbar]:hidden"
            >
              <ModelSelectorList
                favorites={favorites}
                others={others}
                legacyProviders={legacyProviders}
                revealedLegacyProviders={effectiveRevealedLegacyProviders}
                isLoading={isLoadingModels}
                isMobile={false}
                isUserAuthenticated={isUserAuthenticated}
                canPinModels={isUserAuthenticated && !disabled}
                selectedModelId={normalizedSelectedModelId}
                pinnedModelIds={pinnedModelIds}
                onSelect={handleSelect}
                onTogglePinned={handleTogglePinned}
                onShowLegacy={handleShowLegacy}
              />
            </div>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
