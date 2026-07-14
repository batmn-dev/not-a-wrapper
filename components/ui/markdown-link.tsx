import { cn } from "@/lib/utils"
import { Icon } from "@/components/ui/icon"
import { RiArrowRightUpLine } from "@remixicon/react"

export function LinkMarkdown({
  href,
  children,
  className,
  ...props
}: React.ComponentProps<"a">) {
  if (!href)
    return (
      <span className={className} {...props}>
        {children}
      </span>
    )

  let isExternal = false
  try {
    const url = new URL(href)
    isExternal = ["http:", "https:"].includes(url.protocol)
  } catch {}

  return (
    <a
      {...props}
      href={href}
      target={isExternal ? "_blank" : undefined}
      rel={isExternal ? "noopener noreferrer" : undefined}
      className={cn(
        "text-foreground decoration-[var(--text-tertiary)] font-normal underline decoration-dotted underline-offset-2 hover:decoration-solid",
        className
      )}
    >
      {children}
      {isExternal && (
        <Icon
          icon={RiArrowRightUpLine}
          slotSize="0.75em"
          className="ms-0.5 inline-flex align-middle leading-none"
        />
      )}
    </a>
  )
}
