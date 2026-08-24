"use client"

import { headerActionButtonClassName } from "@/app/components/layout/header-action-button"
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
import { useIntentPrefetch } from "@/components/ui/intent-prefetch"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useBreakpoint } from "@/hooks/use-breakpoint"
import { useChatSession } from "@/lib/chat-store/session/provider"
import { RiLoader4Line, RiShare2Line } from "@remixicon/react"
import { useMutation } from "convex/react"
import { startTransition, useState } from "react"
import { sharePublishedChat } from "./public-chat-share"
import {
  LazySharePublishContent,
  preloadSharePublishContent,
} from "./share-publish-content-loader"

export function DialogPublish() {
  const [openDialog, setOpenDialog] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const { chatId } = useChatSession()
  const isMobile = useBreakpoint(768)
  const prefetchShareRef = useIntentPrefetch<HTMLButtonElement>(
    preloadSharePublishContent
  )
  const makePublicMutation = useMutation(api.chats.makePublic)

  if (!chatId) {
    return null
  }

  const handlePublish = async () => {
    setIsLoading(true)
    void preloadSharePublishContent()

    try {
      await sharePublishedChat({
        chatId,
        publish: () => makePublicMutation({ chatId: chatId as Id<"chats"> }),
        openFallback: () => startTransition(() => setOpenDialog(true)),
      })
    } catch (error) {
      console.error("Failed to make chat public:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const trigger = (
    <Button
      ref={prefetchShareRef}
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
    <LazySharePublishContent
      chatId={chatId}
      onClose={() => setOpenDialog(false)}
    />
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
            <div className="px-4 pb-6">{content}</div>
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
