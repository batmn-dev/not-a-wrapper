import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { Popover, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { RiGlobalLine } from "@remixicon/react"
import React from "react"
import { PopoverContentAuth } from "./popover-content-auth"

type ButtonSearchProps = {
  isSelected?: boolean
  onToggle?: (isSelected: boolean) => void
  isAuthenticated: boolean
}

export function ButtonSearch({
  isSelected = false,
  onToggle,
  isAuthenticated,
}: ButtonSearchProps) {
  const handleClick = () => {
    const newState = !isSelected
    onToggle?.(newState)
  }

  if (!isAuthenticated) {
    return (
      <Popover>
        <PopoverTrigger
          render={<Button variant="ghost" className="rounded-full" />}
        >
          <Icon icon={RiGlobalLine} slotSize={20} />
          Search
        </PopoverTrigger>
        <PopoverContentAuth />
      </Popover>
    )
  }

  return (
    <Button
      variant="ghost"
      className={cn(
        "rounded-full transition-all duration-150 has-[>[data-slot=icon]]:px-1.75 md:has-[>[data-slot=icon]]:px-3",
        // TODO: Create a dedicated color variable for the search-selected state instead of reusing chart-1
        isSelected && "text-chart-1"
      )}
      onClick={handleClick}
    >
      <Icon icon={RiGlobalLine} slotSize={20} />
      <span className="hidden md:block">Search</span>
    </Button>
  )
}
