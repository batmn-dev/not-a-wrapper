"use client"

import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"

export function ToastStatusDemo() {
  return (
    <div className="flex items-center gap-6">
      <Button
        type="button"
        variant="outline"
        onClick={() =>
          toast({
            title: "Chat renamed",
            description: "The new title is visible in the sidebar.",
            status: "success",
          })
        }
      >
        Show toast
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={() =>
          toast({
            title: "Could not save changes",
            description: "Check your connection and try again.",
            status: "error",
          })
        }
      >
        Show error
      </Button>
    </div>
  )
}
