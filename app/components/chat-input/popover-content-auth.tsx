"use client"

import { AuthModal } from "@/app/auth/_components/auth-modal"
import { Button } from "@/components/ui/button"
import { PopoverContent } from "@/components/ui/popover"
import { APP_NAME } from "@/lib/config"
import { cn } from "@/lib/utils"
import Image from "next/image"
import { useState, type ComponentProps } from "react"

type PopoverContentAuthProps = ComponentProps<typeof PopoverContent>

export function PopoverContentAuth({
  className,
  side = "top",
  align = "start",
  ...props
}: PopoverContentAuthProps = {}) {
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false)

  return (
    <>
      <PopoverContent
        className={cn("w-[300px] overflow-hidden rounded-2xl p-0", className)}
        side={side}
        align={align}
        {...props}
      >
        <Image
          src="/banner_forest.jpg"
          alt={`calm paint generate by ${APP_NAME}`}
          width={300}
          height={128}
          className="h-32 w-full object-cover"
        />
        <div className="p-3">
          <p className="text-primary mb-1 text-base font-medium">
            Login to try more features for free
          </p>
          <p className="text-muted-foreground mb-5 text-base">
            Add files, use more models, BYOK, and more.
          </p>
          <Button
            variant="secondary"
            className="w-full text-base"
            size="lg"
            onClick={() => setIsAuthModalOpen(true)}
          >
            <span>Log in or sign up</span>
          </Button>
        </div>
      </PopoverContent>
      <AuthModal open={isAuthModalOpen} onOpenChange={setIsAuthModalOpen} />
    </>
  )
}
