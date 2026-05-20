"use client"

import { useBreakpoint } from "@/app/hooks/use-breakpoint"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { Icon } from "@/components/ui/icon"
import { APP_NAME } from "@/lib/config"
import { RiInformationLine } from "@remixicon/react"
import Image from "next/image"
import { AppInfoContent } from "./app-info-content"

export function AppInfoMenuItem({ onClick }: { onClick: () => void }) {
  return (
    <DropdownMenuItem onClick={onClick}>
      <Icon icon={RiInformationLine} slotSize={16} />
      <span>About {APP_NAME}</span>
    </DropdownMenuItem>
  )
}

export function AppInfoDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const isMobile = useBreakpoint(768)

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="bg-background border-border">
          <DrawerHeader>
            <Image
              src="/banner_ocean.jpg"
              alt={`calm paint generate by ${APP_NAME}`}
              width={400}
              height={128}
              className="h-32 w-full object-cover"
            />
            <DrawerTitle className="hidden">{APP_NAME}</DrawerTitle>
            <DrawerDescription className="hidden">
              Your minimalist AI chat companion
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-6">
            <AppInfoContent />
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="[&>button:last-child]:bg-background gap-0 overflow-hidden rounded-3xl p-0 sm:max-w-md [&>button:last-child]:rounded-full [&>button:last-child]:p-1">
        <DialogHeader className="p-0">
          <Image
            src="/banner_ocean.jpg"
            alt={`calm paint generate by ${APP_NAME}`}
            width={400}
            height={128}
            className="h-32 w-full object-cover"
          />
          <DialogTitle className="hidden">{APP_NAME}</DialogTitle>
          <DialogDescription className="hidden">
            Your minimalist AI chat companion
          </DialogDescription>
        </DialogHeader>
        <div className="p-4">
          <AppInfoContent />
        </div>
      </DialogContent>
    </Dialog>
  )
}
