import { Icon } from "@/components/ui/icon"
import { RiArrowLeftLine } from "@remixicon/react"
import Link from "next/link"

export function HeaderGoBack({ href = "/" }: { href?: string }) {
  return (
    <header className="p-4">
      <Link
        href={href}
        prefetch
        className="text-foreground hover:bg-muted inline-flex items-center gap-1 rounded-md px-2 py-1"
      >
        <Icon
          icon={RiArrowLeftLine}
          slotSize={20}
          className="text-foreground"
        />
        <span className="font-base ml-2 hidden text-sm sm:inline-block">
          Back to Chat
        </span>
      </Link>
    </header>
  )
}
