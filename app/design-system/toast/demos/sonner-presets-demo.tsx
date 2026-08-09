"use client"

import { Button } from "@/components/ui/button"
import { toast as sonnerToast } from "sonner"

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
