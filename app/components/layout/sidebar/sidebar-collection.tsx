import { cn } from "@/lib/utils"
import type { ComponentProps } from "react"

function SidebarCollection({ className, ...props }: ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-collection"
      className={cn("m-0 list-none p-0", className)}
      {...props}
    />
  )
}

function SidebarCollectionItem({ className, ...props }: ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-collection-item"
      className={cn("list-none", className)}
      {...props}
    />
  )
}

export { SidebarCollection, SidebarCollectionItem }
