"use client"
import { RiCheckboxCircleLine, RiCloseCircleLine, RiErrorWarningLine, RiInformationLine, RiLoader4Line } from "@remixicon/react"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <RiCheckboxCircleLine size={16} />,
        info: <RiInformationLine size={16} />,
        warning: <RiErrorWarningLine size={16} />,
        error: <RiCloseCircleLine size={16} />,
        loading: <RiLoader4Line size={16} className="animate-spin" />,
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
