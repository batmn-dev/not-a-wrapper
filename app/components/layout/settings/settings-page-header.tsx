"use client"

import { Button } from "@/components/ui/button"
import { DialogClose } from "@/components/ui/dialog"
import { Icon } from "@/components/ui/icon"
import { RiCloseLargeLine } from "@remixicon/react"

type SettingsPageHeaderProps = {
  title: string
}

export function SettingsCloseButton() {
  return (
    <DialogClose
      render={
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close settings"
          className="bg-popover"
        />
      }
    >
      <Icon icon={RiCloseLargeLine} slotSize={16} />
    </DialogClose>
  )
}

export function SettingsPageHeader({ title }: SettingsPageHeaderProps) {
  return (
    <header className="bg-popover sticky top-0 z-20 flex min-h-15 shrink-0 items-center py-3 pr-3 pl-4 [box-shadow:var(--sharp-edge-top-shadow-placeholder)] group-data-[scrolled-from-top]/settings-scrollport:[box-shadow:var(--sharp-edge-top-shadow)]">
      <div className="w-full min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="min-w-0 text-lg font-normal">
            <span className="block truncate select-none">{title}</span>
          </h3>
        </div>
      </div>
      <SettingsCloseButton />
    </header>
  )
}
