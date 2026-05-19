"use client"

import { Icon } from "@/components/ui/icon"
import {
  RiCheckboxCircleLine,
  RiCloseCircleLine,
  RiErrorWarningLine,
  RiInformationLine,
  RiLoader4Line,
} from "@remixicon/react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <Icon icon={RiCheckboxCircleLine} slotSize={16} />,
        info: <Icon icon={RiInformationLine} slotSize={16} />,
        warning: <Icon icon={RiErrorWarningLine} slotSize={16} />,
        error: <Icon icon={RiCloseCircleLine} slotSize={16} />,
        loading: (
          <Icon icon={RiLoader4Line} slotSize={16} className="animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
