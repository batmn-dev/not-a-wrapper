"use client"

import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/components/ui/toast"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { usePerUserQuery } from "@/lib/convex/use-per-user-query"
import { useMutation } from "convex/react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type McpToolApprovalsProps = {
  serverId: Id<"mcpServers">
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Per-server expandable list of tool approvals.
 * Each tool shows its name and an approved/rejected toggle.
 *
 * Tools are populated via `mcpToolApprovals.bulkApprove` after a test
 * connection or the first chat request that discovers tools.
 */
export function McpToolApprovals({ serverId }: McpToolApprovalsProps) {
  const { data, isLoading } = usePerUserQuery(
    api.mcpToolApprovals.listByServer,
    {
      serverId,
    }
  )
  const approvals = data ?? []
  const toggleApproval = useMutation(api.mcpToolApprovals.toggleApproval)

  const handleToggle = async (approvalId: Id<"mcpToolApprovals">) => {
    try {
      await toggleApproval({ approvalId })
    } catch (error) {
      console.error("Failed to update tool approval:", error)
      toast({ title: "Failed to update tool approval", status: "error" })
    }
  }

  if (isLoading) {
    // Loading is its own state — rendering nothing here made the section pop
    // in as if it had resolved empty. Same Skeleton strategy as the tab's
    // section bodies (DESIGN.md states guidance).
    return (
      <div className="mt-2" role="status" aria-label="Loading tools">
        <Skeleton aria-hidden="true" className="h-3 w-56 max-w-full" />
      </div>
    )
  }

  if (approvals.length === 0) {
    return (
      <div className="text-muted-foreground mt-2 text-xs">
        No tools discovered yet. Use &quot;Test Connection&quot; in the edit
        dialog to discover available tools.
      </div>
    )
  }

  return (
    <div className="mt-2 space-y-2">
      <p className="text-muted-foreground text-xs">
        {approvals.filter((a) => a.approved).length} of {approvals.length} tools
        approved
      </p>
      {approvals.map((approval) => (
        <div
          key={approval._id}
          className="flex items-center justify-between rounded-md border px-3 py-2"
        >
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm">{approval.toolName}</span>
            {approval.approvedAt && (
              <Badge variant="secondary" className="text-[10px]">
                Auto-approved
              </Badge>
            )}
          </div>
          <Switch
            checked={approval.approved}
            onCheckedChange={() => handleToggle(approval._id)}
          />
        </div>
      ))}
    </div>
  )
}
