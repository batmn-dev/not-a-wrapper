"use client"

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { Icon } from "@/components/ui/icon"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { RiCloseLine } from "@remixicon/react"
import Image from "next/image"
import { useEffect, useState } from "react"

type FileItemProps = {
  file: File
  onRemove: (file: File) => void
}

export function FileItem({ file, onRemove }: FileItemProps) {
  const isImage = file.type.includes("image")
  const [isRemoving, setIsRemoving] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  // Lazy initializer — URL available on first render (no flash)
  const [imageUrl, setImageUrl] = useState<string | null>(() =>
    isImage ? URL.createObjectURL(file) : null
  )
  const [prevFile, setPrevFile] = useState(file)

  // Adjust state during render when file changes
  // React-approved pattern: https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  if (file !== prevFile) {
    setPrevFile(file)
    const newUrl = isImage ? URL.createObjectURL(file) : null
    setImageUrl(newUrl)
  }

  // Revoke object URL on cleanup (when imageUrl changes or unmount)
  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl)
    }
  }, [imageUrl])

  const handleRemove = () => {
    setIsRemoving(true)
    onRemove(file)
  }

  return (
    <div className="relative mr-2 mb-0 flex items-center">
      <HoverCard open={isImage ? isOpen : false} onOpenChange={setIsOpen}>
        <HoverCardTrigger className="w-full">
          <div className="bg-background hover:bg-accent border-input flex w-full items-center gap-3 rounded-2xl border p-2 pr-3 transition-colors">
            <div className="bg-accent-foreground flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-md">
              {isImage && imageUrl ? (
                <Image
                  src={imageUrl}
                  alt={file.name}
                  width={40}
                  height={40}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="text-center text-xs text-gray-400">
                  {file.name.split(".").pop()?.toUpperCase()}
                </div>
              )}
            </div>
            <div className="flex flex-col overflow-hidden">
              <span className="truncate text-xs font-medium">{file.name}</span>
              <span className="text-xs text-gray-500">
                {(file.size / 1024).toFixed(2)}kB
              </span>
            </div>
          </div>
        </HoverCardTrigger>
        {isImage && imageUrl ? (
          <HoverCardContent side="top">
            <Image
              src={imageUrl}
              alt={file.name}
              width={200}
              height={200}
              className="h-full w-full object-cover"
            />
          </HoverCardContent>
        ) : null}
      </HoverCard>
      {!isRemoving ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={handleRemove}
                className="border-background absolute top-1 right-1 z-10 inline-flex size-6 translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[3px] bg-black text-white shadow-none transition-colors"
                aria-label="Remove file"
              />
            }
          >
            <Icon icon={RiCloseLine} slotSize={12} />
          </TooltipTrigger>
          <TooltipContent side="bottom" hideArrow>
            Remove file
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )
}
