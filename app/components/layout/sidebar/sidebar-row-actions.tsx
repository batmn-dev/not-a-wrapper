import { Children, type ReactNode } from "react"

type SidebarRowActionsProps = {
  layout?: "compact" | "card"
  children: ReactNode
}

type SidebarRowEndSlotProps = {
  status?: ReactNode
  layout?: "compact" | "card"
  children: ReactNode
}

/**
 * The only placement primitive for sidebar row actions.
 *
 * Compact rows mirror ChatGPT's trailing markup: one trailing flex item with a
 * 4px inner gap and direct 34×36 button children. The buttons' negative inline
 * margins make the revealed item contribute exactly 44px to row layout while
 * preserving the full hit targets.
 */
export function SidebarRowActions({
  layout = "compact",
  children,
}: SidebarRowActionsProps) {
  if (layout === "card") {
    return (
      <div className="sidebar-row-action-rail" data-sidebar-row-actions="card">
        {Children.map(children, (child) => (
          <div className="sidebar-row-action-slot">{child}</div>
        ))}
      </div>
    )
  }

  return (
    <div className="sidebar-row-action-rail" data-sidebar-row-actions="compact">
      <div className="sidebar-row-action-group">
        {Children.map(children, (child) => child)}
      </div>
    </div>
  )
}

/**
 * Chat-row end composition. Resting status and revealed actions share the same
 * right-hand geometry instead of maintaining independent trailing offsets.
 */
export function SidebarRowEndSlot({
  status,
  layout = "compact",
  children,
}: SidebarRowEndSlotProps) {
  const contents = (
    <>
      {status ? (
        <div className="sidebar-row-status-slot" data-sidebar-row-status-slot>
          {status}
        </div>
      ) : null}
      <SidebarRowActions layout={layout}>{children}</SidebarRowActions>
    </>
  )

  if (layout === "compact") return contents

  return (
    <div className="sidebar-row-end-slot" data-sidebar-row-end-slot="card">
      {contents}
    </div>
  )
}
