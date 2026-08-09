"use client"

import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"

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
