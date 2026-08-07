import type { ReactNode } from "react"

export function SidebarDemoColumn({ children }: { children: ReactNode }) {
  return (
    <div className="bg-sidebar w-(--sidebar-width) max-w-full rounded-lg py-1">
      {children}
    </div>
  )
}
