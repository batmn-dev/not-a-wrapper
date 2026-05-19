"use client"

import { Icon } from "@/components/ui/icon"
import {
  RiAlertLine,
  RiCheckboxCircleLine,
  RiInformationLine,
} from "@remixicon/react"
import { toast as sonnerToast } from "sonner"
import { Button } from "./button"

type ToastProps = {
  id: string | number
  title: string
  description?: string
  button?: {
    label: string
    onClick: () => void
  }
  status?: "error" | "info" | "success" | "warning"
}

function Toast({ title, description, button, id, status }: ToastProps) {
  return (
    <div className="bg-popover shadow-border-md flex items-center overflow-hidden rounded-xl p-4 backdrop-blur-xl">
      <div className="flex flex-1 items-center">
        {status === "error" ? (
          <Icon
            icon={RiAlertLine}
            slotSize={16}
            className="text-primary mr-3"
          />
        ) : null}
        {status === "info" ? (
          <Icon
            icon={RiInformationLine}
            slotSize={16}
            className="text-primary mr-3"
          />
        ) : null}
        {status === "success" ? (
          <Icon
            icon={RiCheckboxCircleLine}
            slotSize={16}
            className="text-primary mr-3"
          />
        ) : null}
        <div className="w-full">
          <p className="text-foreground text-sm font-medium">{title}</p>
          {description && (
            <p className="text-muted-foreground mt-1 text-sm">{description}</p>
          )}
        </div>
      </div>
      {button ? (
        <div className="shrink-0">
          <Button
            size="sm"
            onClick={() => {
              button?.onClick()
              sonnerToast.dismiss(id)
            }}
            type="button"
            variant="secondary"
          >
            {button?.label}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function toast(toast: Omit<ToastProps, "id">) {
  return sonnerToast.custom(
    (id) => (
      <Toast
        id={id}
        title={toast.title}
        description={toast?.description}
        button={toast?.button}
        status={toast?.status}
      />
    ),
    {
      position: "top-center",
    }
  )
}

export { toast }
