import { Children, type ReactNode } from "react"

type SidebarRowActionsProps = {
  strategy: "overlay" | "reflow"
  children: ReactNode
}

type SidebarRowEndSlotProps = {
  status?: ReactNode
  layout?: "compact" | "card"
  children: ReactNode
}

/**
 * The only placement primitive for compact-row actions.
 *
 * Both strategies share the same 34px control slots, 10px overlap, and 58px
 * rail. `overlay` is used by project rows; `reflow` is used by chat rows so the
 * primary title gives up the rail width when actions reveal.
 */
export function SidebarRowActions({
  strategy,
  children,
}: SidebarRowActionsProps) {
  return (
    <div
      className="sidebar-row-action-rail"
      data-sidebar-row-actions={strategy}
    >
      {Children.map(children, (child) => (
        <div className="sidebar-row-action-slot">{child}</div>
      ))}
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
  return (
    <div className="sidebar-row-end-slot" data-sidebar-row-end-slot={layout}>
      {status ? (
        <div className="sidebar-row-status-slot" data-sidebar-row-status-slot>
          {status}
        </div>
      ) : null}
      <SidebarRowActions strategy="reflow">{children}</SidebarRowActions>
    </div>
  )
}
