import { getAdjacentComponents } from "@/app/design-system/_lib/catalog"
import { buttonVariants } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/utils"
import { RiArrowLeftLine, RiArrowRightLine } from "@remixicon/react"
import Link from "next/link"

type ComponentPagerProps = {
  slug: string
}

export function ComponentPager({ slug }: ComponentPagerProps) {
  const { previous, next } = getAdjacentComponents(slug)

  return (
    <nav aria-label="Component pagination" className="flex items-center gap-1">
      {previous ? (
        <Link
          href={previous.href}
          aria-label={`Previous: ${previous.name}`}
          className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
        >
          <Icon icon={RiArrowLeftLine} slotSize={16} />
        </Link>
      ) : (
        <button
          type="button"
          disabled
          aria-label="Previous component"
          className={cn(
            buttonVariants({ variant: "ghost", size: "icon-sm" }),
            "opacity-40"
          )}
        >
          <Icon icon={RiArrowLeftLine} slotSize={16} />
        </button>
      )}

      {next ? (
        <Link
          href={next.href}
          aria-label={`Next: ${next.name}`}
          className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
        >
          <Icon icon={RiArrowRightLine} slotSize={16} />
        </Link>
      ) : (
        <button
          type="button"
          disabled
          aria-label="Next component"
          className={cn(
            buttonVariants({ variant: "ghost", size: "icon-sm" }),
            "opacity-40"
          )}
        >
          <Icon icon={RiArrowRightLine} slotSize={16} />
        </button>
      )}
    </nav>
  )
}
