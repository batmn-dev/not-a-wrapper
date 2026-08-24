"use client"

import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { LazySharePublishContent } from "./share-publish-content-loader"

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
        <div className="px-4 pb-6">
          <LazySharePublishContent
            chatId={chatId}
            onClose={() => onOpenChange(false)}
          />
        </div>
      </DrawerContent>
    </Drawer>
  )
}
