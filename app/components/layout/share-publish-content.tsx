"use client"

import XIcon from "@/components/icons/x"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { Input } from "@/components/ui/input"
import { RiCheckLine, RiFileCopyLine } from "@remixicon/react"
import { useId, useState } from "react"
import { getPublicChatShareDetails } from "./public-chat-share"

type SharePublishContentProps = {
  chatId: string
  onClose: () => void
}

/** One custom share body for the desktop Dialog and mobile Drawer adapters. */
export function SharePublishContent({
  chatId,
  onClose,
}: SharePublishContentProps) {
  const [copied, setCopied] = useState(false)
  const inputId = useId()
  const { publicLink, xIntentUrl } = getPublicChatShareDetails(chatId)

  const openPage = () => {
    onClose()
    window.open(publicLink, "_blank", "noopener")
  }

  const shareOnX = () => {
    onClose()
    window.open(xIntentUrl, "_blank", "noopener")
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicLink)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4">
        <div className="grid gap-2">
          <div className="flex items-center gap-1">
            <div className="relative flex-1">
              <label className="sr-only" htmlFor={inputId}>
                Public conversation link
              </label>
              <Input
                id={inputId}
                value={publicLink}
                readOnly
                className="flex-1"
              />
              <Button
                variant="outline"
                onClick={() => void copyLink()}
                aria-label={copied ? "Copied" : "Copy link"}
                className="bg-background hover:bg-background absolute top-0 right-0 rounded-l-none transition-colors"
              >
                <Icon
                  icon={copied ? RiCheckLine : RiFileCopyLine}
                  slotSize={16}
                />
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
  )
}
