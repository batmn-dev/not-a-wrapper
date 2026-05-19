"use client"

import XIcon from "@/components/icons/x"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Icon } from "@/components/ui/icon"
import { Input } from "@/components/ui/input"
import { APP_DOMAIN } from "@/lib/config"
import { RiCheckLine, RiFileCopyLine } from "@remixicon/react"
import { useState } from "react"

type SharePublishDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  chatId: string
}

export function SharePublishDrawer({
  open,
  onOpenChange,
  chatId,
}: SharePublishDrawerProps) {
  const [copied, setCopied] = useState(false)
  const publicLink = `${APP_DOMAIN}/share/${chatId}`

  const openPage = () => {
    onOpenChange(false)
    window.open(publicLink, "_blank")
  }

  const shareOnX = () => {
    onOpenChange(false)
    const text = `Check out this conversation I shared with Not A Wrapper! ${publicLink}`
    const encodedText = encodeURIComponent(text)
    window.open(`https://x.com/intent/tweet?text=${encodedText}`, "_blank")
  }

  const copyLink = () => {
    navigator.clipboard.writeText(publicLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="bg-background border-border">
        <DrawerHeader>
          <DrawerTitle>Your conversation is now public!</DrawerTitle>
          <DrawerDescription>
            Anyone with the link can now view this conversation and may appear
            in community feeds, featured pages, or search results in the future.
          </DrawerDescription>
        </DrawerHeader>
        <div className="flex flex-col gap-4 px-4 pb-6">
          <div className="grid gap-4">
            <div className="grid gap-2">
              <div className="flex items-center gap-1">
                <div className="relative flex-1">
                  <Input
                    id="share-link"
                    value={publicLink}
                    readOnly
                    className="flex-1"
                  />
                  <Button
                    variant="outline"
                    onClick={copyLink}
                    className="bg-background hover:bg-background absolute top-0 right-0 rounded-l-none transition-colors"
                  >
                    {copied ? (
                      <Icon icon={RiCheckLine} slotSize={16} />
                    ) : (
                      <Icon icon={RiFileCopyLine} slotSize={16} />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={openPage} className="flex-1">
              View Page
            </Button>
            <Button onClick={shareOnX} className="flex-1">
              Share on <XIcon className="text-primary-foreground size-4" />
            </Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
