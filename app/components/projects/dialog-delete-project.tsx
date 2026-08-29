"use client"

import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useMutation } from "convex/react"
import { usePathname, useRouter } from "next/navigation"
import { useState } from "react"

type Project = {
  _id: Id<"projects">
  name: string
}

type DialogDeleteProjectProps = {
  isOpen: boolean
  setIsOpen: (isOpen: boolean) => void
  project: Project
}

export function DialogDeleteProject({
  isOpen,
  setIsOpen,
  project,
}: DialogDeleteProjectProps) {
  const [isPending, setIsPending] = useState(false)
  const router = useRouter()
  const pathname = usePathname()
  const deleteProject = useMutation(api.projects.remove)

  const handleConfirmDelete = async () => {
    setIsPending(true)
    try {
      await deleteProject({ projectId: project._id })
      setIsOpen(false)

      if (pathname.startsWith(`/p/${project._id}`)) {
        router.push("/")
      }
    } catch {
      toast({ title: "Failed to delete project", status: "error" })
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Project</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete &quot;{project.name}&quot;? This
            action cannot be undone and will also delete all conversations in
            this project.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setIsOpen(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirmDelete}
            disabled={isPending}
          >
            {isPending ? "Deleting..." : "Delete Project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
