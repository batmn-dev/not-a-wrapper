"use client"
import { RiArrowDownSLine, RiCheckLine, RiSearchLine, RiStarLine } from "@remixicon/react"

import { PopoverContentAuth } from "@/app/components/chat-input/popover-content-auth"
import { useBreakpoint } from "@/app/hooks/use-breakpoint"
import { useKeyShortcut } from "@/app/hooks/use-key-shortcut"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
import { Input } from "@/components/ui/input"
import { Popover, PopoverTrigger } from "@/components/ui/popover"
import { getModelInfo } from "@/lib/models"
import { useModel } from "@/lib/model-store/provider"
import { filterAndSortModels } from "@/lib/model-store/utils"
import { ModelConfig } from "@/lib/models/types"
import { PROVIDERS } from "@/lib/providers"
import { useUserPreferences } from "@/lib/user-preference-store/provider"
import { cn } from "@/lib/utils"
import { AnimatePresence, motion } from "motion/react"
import { useRef, useState } from "react"
import { ProModelDialog } from "./pro-dialog"

type BaseModelSelectorProps = {
  className?: string
  isUserAuthenticated?: boolean
}

type SingleSelectProps = BaseModelSelectorProps & {
  mode: "single"
  selectedModelId: string
  setSelectedModelId: (modelId: string) => void
}

type MultiSelectProps = BaseModelSelectorProps & {
  mode: "multi"
  selectedModelIds: string[]
  setSelectedModelIds: (modelIds: string[]) => void
  maxModels?: number
}

type ModelSelectorProps = SingleSelectProps | MultiSelectProps

export function ModelSelector(props: ModelSelectorProps) {
  const { className, isUserAuthenticated = true, mode } = props

  const { models, isLoading: isLoadingModels, favoriteModels } = useModel()
  const { isModelHidden } = useUserPreferences()
  const isMobile = useBreakpoint(768)

  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [isProDialogOpen, setIsProDialogOpen] = useState(false)
  const [selectedProModel, setSelectedProModel] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Mode-specific derived values
  const currentModel =
    props.mode === "single"
      ? models.find((model) => model.id === props.selectedModelId) ??
        getModelInfo(props.selectedModelId)
      : undefined
  const selectedModels =
    props.mode === "multi"
      ? props.selectedModelIds
          .map((modelId) => models.find((model) => model.id === modelId) ?? getModelInfo(modelId))
          .filter((model): model is ModelConfig => Boolean(model))
      : []
  const selectedModelIds =
    props.mode === "multi" ? props.selectedModelIds : ([] as string[])
  const maxModels = props.mode === "multi" ? (props.maxModels ?? 5) : 0

  // Keyboard shortcut — ⌘⇧P for single, ⌘⇧M for multi
  useKeyShortcut(
    mode === "single"
      ? (e) => (e.key === "p" || e.key === "P") && e.metaKey && e.shiftKey
      : (e) => (e.key === "m" || e.key === "M") && e.metaKey && e.shiftKey,
    () => {
      if (isMobile) {
        setIsDrawerOpen((prev) => !prev)
      } else {
        setIsDropdownOpen((prev) => !prev)
      }
    }
  )

  // Selection handler — single closes on select, multi toggles without closing
  const handleSelect = (modelId: string, isLocked: boolean) => {
    if (isLocked) {
      setSelectedProModel(modelId)
      setIsProDialogOpen(true)
      return
    }

    if (props.mode === "single") {
      props.setSelectedModelId(modelId)
      if (isMobile) {
        setIsDrawerOpen(false)
      } else {
        setIsDropdownOpen(false)
      }
    } else {
      const isSelected = props.selectedModelIds.includes(modelId)
      if (isSelected) {
        if (props.selectedModelIds.length <= 1) return
        props.setSelectedModelIds(
          props.selectedModelIds.filter((id) => id !== modelId)
        )
      } else if (props.selectedModelIds.length < maxModels) {
        props.setSelectedModelIds([...props.selectedModelIds, modelId])
      }
    }
  }

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation()
    setSearchQuery(e.target.value)
  }

  const filteredModels = filterAndSortModels(
    models,
    favoriteModels || [],
    searchQuery,
    isModelHidden
  )

  // Mobile drawer model item renderer
  const renderModelItem = (model: ModelConfig) => {
    const isLocked = !model.accessible
    const provider = PROVIDERS.find((provider) => provider.id === model.icon)

    if (mode === "single") {
      return (
        <div
          key={model.id}
          className={cn(
            "flex w-full items-center justify-between px-3 py-2",
            props.mode === "single" &&
              props.selectedModelId === model.id &&
              "bg-accent"
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
              <RiStarLine size={8} className="size-2" />
              <span>Locked</span>
            </div>
          )}
        </div>
      )
    }

    // Multi mode
    const isSelected = selectedModelIds.includes(model.id)
    const isAtLimit = selectedModelIds.length >= maxModels
    const isLastSelected = isSelected && selectedModelIds.length <= 1

    return (
      <div
        key={model.id}
        className={cn(
          "hover:bg-accent/50 flex w-full cursor-pointer items-center justify-between px-3 py-2",
          isSelected && "bg-accent"
        )}
        onClick={() => handleSelect(model.id, isLocked)}
      >
        <div className="flex items-center gap-3">
          <Checkbox
            checked={isSelected}
            disabled={isLocked || isLastSelected || (!isSelected && isAtLimit)}
            onClick={(e) => e.stopPropagation()}
            onCheckedChange={() => handleSelect(model.id, isLocked)}
          />
          {provider?.icon && <provider.icon className="size-5" />}
          <div className="flex flex-col gap-0">
            <span className="text-sm">{model.name}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isLocked && (
            <div className="border-input bg-accent text-muted-foreground flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium">
              <RiStarLine size={8} className="size-2" />
              <span>Locked</span>
            </div>
          )}
          {!isSelected && isAtLimit && !isLocked && (
            <div className="border-input bg-muted text-muted-foreground flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium">
              <span>Limit</span>
            </div>
          )}
        </div>
      </div>
    )
  }

  // Trigger button — ghost for both modes, animated content for multi
  const trigger =
    mode === "single" ? (
      <Button
        variant="ghost"
        className={cn("justify-between text-lg font-normal", className)}
        disabled={isLoadingModels}
      >
        <span>{currentModel?.name || "Select model"}</span>
        <RiArrowDownSLine
          size={16}
          className="opacity-50"
        />
      </Button>
    ) : (
      <Button
        variant="ghost"
        className={cn("min-w-0 justify-between text-lg font-normal", className)}
        disabled={isLoadingModels}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <AnimatePresence mode="popLayout">
            {selectedModels.length === 0 ? (
              <motion.span
                key="placeholder"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                className="text-muted-foreground"
              >
                Select models
              </motion.span>
            ) : selectedModels.length === 1 ? (
              <motion.div
                key="single-model"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                className="flex items-center gap-2"
              >
                {(() => {
                  const provider = PROVIDERS.find(
                    (p) => p.id === selectedModels[0].icon
                  )
                  return provider?.icon ? (
                    <motion.div
                      initial={{ scale: 0, rotate: -180 }}
                      animate={{ scale: 1, rotate: 0 }}
                      exit={{ scale: 0, rotate: 180 }}
                      transition={{
                        type: "spring",
                        stiffness: 300,
                        damping: 20,
                      }}
                    >
                      <provider.icon className="size-5 flex-shrink-0" />
                    </motion.div>
                  ) : null
                })()}
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2 }}
                  className="truncate"
                >
                  {selectedModels[0].name}
                </motion.span>
              </motion.div>
            ) : (
              <motion.div
                key="multiple-models"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.1 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                className="flex min-w-0 flex-1 items-center gap-1"
              >
                <div className="flex flex-shrink-0 -space-x-1">
                  <AnimatePresence mode="popLayout">
                    {selectedModels.slice(0, 3).map((model, index) => {
                      const provider = PROVIDERS.find(
                        (p) => p.id === model.icon
                      )
                      return provider?.icon ? (
                        <motion.div
                          key={`${model.id}`}
                          layout="position"
                          layoutId={`${model.id}`}
                          initial={{
                            scale: 0,
                            rotate: -180,
                            x: -20,
                            opacity: 0,
                          }}
                          animate={{
                            scale: 1,
                            rotate: 0,
                            x: 0,
                            opacity: 1,
                          }}
                          exit={{
                            scale: 0,
                            rotate: 180,
                            x: 20,
                            opacity: 0,
                          }}
                          transition={{
                            type: "spring",
                            stiffness: 400,
                            damping: 25,
                            delay: index * 0.05,
                          }}
                          className="bg-background border-border flex size-5 items-center justify-center rounded-full border"
                          style={{ zIndex: 3 - index }}
                        >
                          <provider.icon className="size-3" />
                        </motion.div>
                      ) : null
                    })}
                  </AnimatePresence>
                </div>
                <span className="text-sm font-medium">
                  <AnimatePresence mode="wait">
                    <motion.span
                      key={selectedModels.length}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{
                        duration: 0.15,
                        ease: "easeOut",
                      }}
                      className="inline-block"
                    >
                      {selectedModels.length}
                    </motion.span>
                  </AnimatePresence>{" "}
                  model{selectedModels.length > 1 ? "s" : ""} selected
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <RiArrowDownSLine
          size={16}
          className="opacity-50"
        />
      </Button>
    )

  // Auth fallback — unauthenticated users see sign-in popover
  if (!isUserAuthenticated) {
    return (
      <Popover>
        <PopoverTrigger render={trigger} />
        <PopoverContentAuth />
      </Popover>
    )
  }

  // Mobile rendering
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
              <DrawerTitle>
                {mode === "single"
                  ? "Select Model"
                  : `Select Models (${selectedModelIds.length}/${maxModels})`}
              </DrawerTitle>
            </DrawerHeader>
            <div className="px-4 pb-2">
              <div className="relative">
                <RiSearchLine
                  size={16}
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
          className="flex max-h-55 w-[300px] flex-col space-y-0.5 overflow-visible p-0"
          align="start"
          sideOffset={4}
          animated={false}
          side="top"
        >
          <div className="bg-background sticky top-0 z-10 rounded-t-md border-b px-0 pt-0 pb-0">
            <div className="relative">
              <RiSearchLine
                size={16}
                className="text-muted-foreground absolute top-2.5 left-2.5"
              />
              <Input
                ref={searchInputRef}
                placeholder="Search models..."
                className="dark:bg-popover rounded-b-none border border-none pl-8 shadow-none focus-visible:ring-0"
                value={searchQuery}
                onChange={handleSearchChange}
                onClick={(e) => e.stopPropagation()}
                onFocus={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </div>
          </div>
          <div className="flex h-full flex-col space-y-0 overflow-y-auto px-1 pt-0 pb-0">
            {isLoadingModels ? (
              <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                <p className="text-muted-foreground mb-2 text-sm">
                  Loading models...
                </p>
              </div>
            ) : filteredModels.length > 0 ? (
              filteredModels.map((model) => {
                const isLocked = !model.accessible
                const isSelected =
                  mode === "single"
                    ? props.mode === "single" &&
                      props.selectedModelId === model.id
                    : selectedModelIds.includes(model.id)
                const provider = PROVIDERS.find(
                  (provider) => provider.id === model.icon
                )

                return (
                  <DropdownMenuItem
                    key={model.id}
                    className={cn(
                      "flex w-full items-center justify-between px-3 py-2",
                      isSelected && "bg-accent"
                    )}
                    closeOnClick={mode !== "multi"}
                    onClick={() => handleSelect(model.id, isLocked)}
                  >
                    <div className="flex items-center gap-3">
                      {provider?.icon && (
                        <provider.icon className="size-5" />
                      )}
                      <div className="flex flex-col gap-0">
                        <span className="text-sm">{model.name}</span>
                      </div>
                    </div>
                    {mode === "single" ? (
                      isLocked ? (
                        <div className="border-input bg-accent text-muted-foreground flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium">
                          <RiStarLine size={8} className="size-2" />
                          <span>Locked</span>
                        </div>
                      ) : null
                    ) : (
                      <div className="flex items-center gap-2">
                        {isSelected && (
                          <RiCheckLine size={16} />
                        )}
                        {isLocked && (
                          <div className="border-input bg-accent text-muted-foreground flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium">
                            <RiStarLine size={8} className="size-2" />
                            <span>Locked</span>
                          </div>
                        )}
                      </div>
                    )}
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
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
