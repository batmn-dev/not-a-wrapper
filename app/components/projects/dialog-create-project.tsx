"use client"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog"
import { Icon } from "@/components/ui/icon"
import { Input } from "@/components/ui/input"
import { toast } from "@/components/ui/toast"
import { api } from "@/convex/_generated/api"
import {
  MAX_PROJECT_NAME_LENGTH,
  PROJECT_NAME_TOO_LONG_MESSAGE,
} from "@/lib/projects/policy"
import { RiFolderLine, RiLightbulbLine } from "@remixicon/react"
import { useMutation } from "convex/react"
import { useRouter } from "next/navigation"
import { useId, useState } from "react"

type DialogCreateProjectProps = {
  isOpen: boolean
  setIsOpen: (isOpen: boolean) => void
}

export function DialogCreateProject({
  isOpen,
  setIsOpen,
}: DialogCreateProjectProps) {
  const [projectName, setProjectName] = useState("")
  const [isPending, setIsPending] = useState(false)
  const validationErrorId = useId()
  const router = useRouter()
  const createProject = useMutation(api.projects.create)
  // Validate the trimmed value: it is what handleSubmit sends and the server checks.
  const trimmedName = projectName.trim()
  const validationError =
    trimmedName.length > MAX_PROJECT_NAME_LENGTH
      ? PROJECT_NAME_TOO_LONG_MESSAGE
      : null
  const canSubmit = trimmedName.length > 0 && validationError === null

  const handleCreate = async (name: string) => {
    setIsPending(true)
    try {
      const projectId = await createProject({ name })
      router.push(`/p/${projectId}`)
      setProjectName("")
      setIsOpen(false)
    } catch (error) {
      console.error("Failed to create project:", error)
      toast({ title: "Failed to create project", status: "error" })
    } finally {
      setIsPending(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (canSubmit) {
      handleCreate(trimmedName)
    }
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setProjectName("")
    setIsOpen(nextOpen)
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        data-testid="modal-new-project-enhanced"
        showCloseButton={false}
        size="large"
        surface="centered"
        className="font-native group/dialog @container block overflow-hidden p-0 text-base"
      >
        <div className="flex w-[100cqw] max-w-lg shrink-0 flex-col overflow-hidden">
          <DialogHeader
            disableAutoFocusTitle
            disableCloseButtonAutoFocus
            title="Create project"
          />

          <form data-testid="create-new-project-form" onSubmit={handleSubmit}>
            <div className="px-4 pt-2">
              <div className="mb-2">
                <label
                  className="mb-2 block text-sm leading-5 font-normal"
                  htmlFor="project-name"
                >
                  Project name
                </label>
                <div className="grid grid-cols-[auto_minmax(0,1fr)]">
                  <Input
                    id="project-name"
                    name="projectName"
                    placeholder="Copenhagen Trip"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    autoComplete="off"
                    autoFocus
                    disabled={isPending}
                    aria-describedby={
                      validationError ? validationErrorId : undefined
                    }
                    aria-invalid={validationError ? true : undefined}
                    className="bg-modal-centered border-input-border focus-visible:border-foreground col-span-full row-start-1 h-9 resize-none overflow-y-auto rounded-lg border px-9 py-2 text-sm leading-5 shadow-none focus-visible:ring-0 aria-invalid:shadow-none aria-invalid:ring-0 dark:aria-invalid:ring-0"
                  />
                  <span
                    aria-hidden="true"
                    className="pointer-events-none col-start-1 row-start-1 inline-flex size-9 items-center justify-center text-[var(--text-tertiary)]"
                    data-testid="project-folder-icon"
                  >
                    <Icon icon={RiFolderLine} slotSize={20} glyphInset={0} />
                  </span>
                </div>
              </div>

              <aside className="mt-4 flex items-center rounded-xl bg-[var(--background-tertiary)] p-3">
                <div className="me-2 h-6 w-6">
                  <span className="text-muted-foreground relative flex h-full items-center justify-center">
                    <Icon icon={RiLightbulbLine} slotSize={20} glyphInset={0} />
                  </span>
                </div>
                <p className="text-muted-foreground text-xs leading-4 text-pretty">
                  Projects keep chats, files, and custom instructions in one
                  place. Use them for ongoing work, or just to keep things tidy.
                </p>
              </aside>

              {validationError ? (
                <div
                  id={validationErrorId}
                  className="interactive-label-danger-soft mb-4 text-sm leading-5"
                  role="alert"
                >
                  <div>{validationError}</div>
                </div>
              ) : null}
            </div>

            <DialogFooter
              className="p-4"
              primaryButton={
                <Button
                  type="submit"
                  disabled={!canSubmit}
                  disabledVariant="muted"
                  loading={isPending}
                  pressMotion="none"
                >
                  Create project
                </Button>
              }
            />
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
