"use client"

import { headerActionButtonClassName } from "@/app/components/layout/header-action-button"
import { useBreakpoint } from "@/app/hooks/use-breakpoint"
import XIcon from "@/components/icons/x"
import { Button } from "@/components/ui/button"
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
import { Icon } from "@/components/ui/icon"
import { Input } from "@/components/ui/input"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useChatSession } from "@/lib/chat-store/session/provider"
import { APP_DOMAIN } from "@/lib/config"
import {
  RiCheckLine,
  RiFileCopyLine,
  RiLoader4Line,
  RiShare2Line,
} from "@remixicon/react"
import { useMutation } from "convex/react"
import type React from "react"
import { useState } from "react"

export function DialogPublish() {
  const [openDialog, setOpenDialog] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const { chatId } = useChatSession()
  const isMobile = useBreakpoint(768)
  const [copied, setCopied] = useState(false)

  const makePublicMutation = useMutation(api.chats.makePublic)

  if (!chatId) {
    return null
  }

  const publicLink = `${APP_DOMAIN}/share/${chatId}`

  const openPage = () => {
    setOpenDialog(false)
    window.open(publicLink, "_blank")
  }

  const shareOnX = () => {
    setOpenDialog(false)
    const X_TEXT = `Check out this conversation I shared with Not A Wrapper! ${publicLink}`
    window.open(`https://x.com/intent/tweet?text=${X_TEXT}`, "_blank")
  }

  const handlePublish = async () => {
    setIsLoading(true)

    try {
      await makePublicMutation({ chatId: chatId as Id<"chats"> })
      setOpenDialog(true)
    } catch (error) {
      console.error("Failed to make chat public:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const copyLink = () => {
    navigator.clipboard.writeText(publicLink)
    setCopied(true)
    setTimeout(() => {
      setCopied(false)
    }, 2000)
  }

  const trigger = (
    <Button
      variant="ghost"
      className={`${headerActionButtonClassName} px-2.5 py-1.5`}
      onClick={handlePublish}
      disabled={isLoading}
    >
      {isLoading ? (
        <Icon icon={RiLoader4Line} slotSize={20} className="animate-spin" />
      ) : (
        <Icon icon={RiShare2Line} slotSize={20} />
      )}
      <span>Share</span>
    </Button>
  )

  const content = (
    <>
      <div className="grid gap-4">
        <div className="grid gap-2">
          <div className="flex items-center gap-1">
            <div className="relative flex-1">
              <Input id="slug" value={publicLink} readOnly className="flex-1" />
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
    </>
  )

  if (isMobile) {
    return (
      <>
        {trigger}
        <Drawer open={openDialog} onOpenChange={setOpenDialog}>
          <DrawerContent className="bg-background border-border">
            <DrawerHeader>
              <DrawerTitle>Your conversation is now public!</DrawerTitle>
              <DrawerDescription>
                Anyone with the link can now view this conversation and may
                appear in community feeds, featured pages, or search results in
                the future.
              </DrawerDescription>
            </DrawerHeader>
            <div className="flex flex-col gap-4 px-4 pb-6">{content}</div>
          </DrawerContent>
        </Drawer>
      </>
    )
  }

  return (
    <>
      {trigger}
      <Dialog open={openDialog} onOpenChange={setOpenDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Your conversation is now public!</DialogTitle>
            <DialogDescription>
              Anyone with the link can now view this conversation and may appear
              in community feeds, featured pages, or search results in the
              future.
            </DialogDescription>
          </DialogHeader>
          {content}
        </DialogContent>
      </Dialog>
    </>
  )
}
