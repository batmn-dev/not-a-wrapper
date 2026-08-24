"use client"

import { Button } from "@/components/ui/button"
import { ComposerControl } from "@/components/ui/composer-control"
import { ComposerIconButton } from "@/components/ui/composer-icon-button"
import { Icon } from "@/components/ui/icon"
import { RiAddLine, RiMicLine } from "@remixicon/react"
import { useTheme } from "next-themes"
import { useSyncExternalStore } from "react"

const themeOptions = ["light", "dark", "system"] as const
type ThemeOption = (typeof themeOptions)[number]

function readStoredTheme(): ThemeOption {
  const stored = localStorage.getItem("theme")
  return themeOptions.find((option) => option === stored) ?? "system"
}

function subscribeToTheme(onStoreChange: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === "theme") onStoreChange()
  }
  const observer = new MutationObserver(onStoreChange)
  observer.observe(document.documentElement, {
    attributeFilter: ["class"],
    attributes: true,
  })
  window.addEventListener("storage", handleStorage)
  return () => {
    observer.disconnect()
    window.removeEventListener("storage", handleStorage)
  }
}

function readServerTheme(): ThemeOption {
  return "system"
}

const states = [
  { label: "Rest", props: {} },
  { label: "Open", props: { "aria-expanded": true } },
  { label: "Disabled", props: { disabled: true } },
] as const

function ComposerControlMatrix() {
  const { setTheme } = useTheme()
  const theme = useSyncExternalStore(
    subscribeToTheme,
    readStoredTheme,
    readServerTheme
  )

  return (
    <div className="w-full max-w-xl">
      <div
        className="mb-6 flex justify-center gap-1"
        aria-label="Preview theme"
        role="group"
      >
        {themeOptions.map((option) => (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={theme === option ? "secondary" : "ghost"}
            aria-pressed={theme === option}
            onClick={() => setTheme(option)}
          >
            {option[0]?.toUpperCase()}
            {option.slice(1)}
          </Button>
        ))}
      </div>

      <div className="bg-background text-foreground rounded-xl p-5">
        <div className="grid gap-4">
          {states.map(({ label, props }) => (
            <div
              key={label}
              className="flex items-center justify-between gap-4"
            >
              <span className="text-muted-foreground text-xs">{label}</span>
              <div className="flex items-center gap-2">
                <ComposerIconButton
                  aria-label={`${label} add action`}
                  {...props}
                >
                  <Icon icon={RiAddLine} slotSize={20} />
                </ComposerIconButton>
                <ComposerControl className="h-9 gap-1.5 px-3" {...props}>
                  <Icon icon={RiMicLine} slotSize={16} />
                  Model
                </ComposerControl>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export { ComposerControlMatrix }
