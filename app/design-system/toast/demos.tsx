"use client"

import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"
import { toast as sonnerToast } from "sonner"

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

export function ToastActionDemo() {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={() =>
        toast({
          title: "Project deleted",
          button: {
            label: "Undo",
            onClick: () => toast({ title: "Project restored" }),
          },
        })
      }
    >
      Delete project
    </Button>
  )
}

export function SonnerPresetsDemo() {
  return (
    <div className="flex items-center gap-6">
      <Button
        type="button"
        variant="outline"
        onClick={() => sonnerToast.success("Settings saved")}
      >
        Success
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={() => sonnerToast.info("A new version is available")}
      >
        Info
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={() => sonnerToast.error("Something went wrong")}
      >
        Error
      </Button>
    </div>
  )
}
