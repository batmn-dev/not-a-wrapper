"use client"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Icon } from "@/components/ui/icon"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/components/ui/toast"
import { api } from "@/convex/_generated/api"
import { usePerUserQuery } from "@/lib/convex/use-per-user-query"
import {
  RiAddLine,
  RiDeleteBinLine,
  RiPlugLine,
  RiSettings3Line,
} from "@remixicon/react"
import { useMutation } from "convex/react"
import { useState } from "react"
import { ConnectionCardsSkeleton } from "./connection-cards-skeleton"
import { McpServerForm } from "./mcp-server-form"
import { McpToolApprovals } from "./mcp-tool-approvals"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function maskUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`
  } catch {
    return url
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function McpServers() {
  const { data, isLoading } = usePerUserQuery(api.mcpServers.list)
  const servers = data ?? []
  const toggleEnabled = useMutation(api.mcpServers.toggleEnabled)
  const removeServer = useMutation(api.mcpServers.remove)

  // UI state
  const [formOpen, setFormOpen] = useState(false)
  const [editingServer, setEditingServer] = useState<
    (typeof servers)[number] | null
  >(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [serverToDelete, setServerToDelete] = useState<
    (typeof servers)[number] | null
  >(null)
  const [expandedServer, setExpandedServer] = useState<string | null>(null)

  // Handlers
  const handleAdd = () => {
    setEditingServer(null)
    setFormOpen(true)
  }

  const handleEdit = (server: (typeof servers)[number]) => {
    setEditingServer(server)
    setFormOpen(true)
  }

  const handleDeleteClick = (server: (typeof servers)[number]) => {
    setServerToDelete(server)
    setDeleteDialogOpen(true)
  }

  const handleConfirmDelete = async () => {
    if (!serverToDelete) return
    try {
      await removeServer({ serverId: serverToDelete._id })
      toast({
        title: "Server deleted",
        description: `${serverToDelete.name} has been removed.`,
      })
    } catch (error) {
      console.error("Failed to delete MCP server:", error)
      toast({ title: "Failed to delete server", status: "error" })
    }
    setDeleteDialogOpen(false)
    setServerToDelete(null)
  }

  const handleToggle = async (server: (typeof servers)[number]) => {
    try {
      await toggleEnabled({ serverId: server._id })
    } catch (error) {
      console.error("Failed to toggle MCP server:", error)
      toast({ title: "Failed to toggle server", status: "error" })
    }
  }

  const handleToggleExpand = (serverId: string) => {
    setExpandedServer((prev) => (prev === serverId ? null : serverId))
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="mb-1 text-lg font-medium text-balance">MCP Servers</h3>
          <p className="text-muted-foreground text-sm text-pretty">
            Connect external tool servers to enhance AI capabilities.
          </p>
        </div>
        <Button size="sm" onClick={handleAdd}>
          <Icon icon={RiAddLine} slotSize={16} className="mr-1" />
          Add Server
        </Button>
      </div>

      {/* Loading state */}
      {isLoading && <ConnectionCardsSkeleton />}

      {/* Empty state */}
      {!isLoading && servers.length === 0 && (
        <div className="py-8 text-center">
          <Icon
            icon={RiPlugLine}
            slotSize={48}
            className="text-muted-foreground mx-auto mb-2"
          />
          <h4 className="mb-1 text-sm font-medium text-balance">
            No MCP servers configured
          </h4>
          <p className="text-muted-foreground mb-4 text-sm text-pretty">
            Add an MCP server to give your AI conversations access to external
            tools.
          </p>
          <Button size="sm" variant="outline" onClick={handleAdd}>
            <Icon icon={RiAddLine} slotSize={16} className="mr-1" />
            Add your first server
          </Button>
        </div>
      )}

      {/* Server list */}
      {servers.length > 0 && (
        <div className="space-y-3">
          {servers.map((server) => (
            <Card key={server._id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <h4 className="truncate font-medium text-balance">
                        {server.name}
                      </h4>
                      {server.lastError ? (
                        <Badge variant="destructive" className="text-xs">
                          Error
                        </Badge>
                      ) : server.lastConnectedAt ? (
                        <Badge variant="secondary" className="text-xs">
                          Connected
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">
                          Not tested
                        </Badge>
                      )}
                      {!server.enabled && (
                        <Badge
                          variant="outline"
                          className="text-muted-foreground text-xs"
                        >
                          Disabled
                        </Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground truncate text-sm">
                      {maskUrl(server.url)}
                    </p>
                    {server.lastError && (
                      <p className="mt-1 truncate text-xs text-red-600 dark:text-red-400">
                        {server.lastError}
                      </p>
                    )}
                    {server.lastConnectedAt && !server.lastError && (
                      <p className="text-muted-foreground mt-1 text-xs">
                        Last connected {formatTimeAgo(server.lastConnectedAt)}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <Switch
                      checked={server.enabled}
                      onCheckedChange={() => handleToggle(server)}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEdit(server)}
                    >
                      <Icon icon={RiSettings3Line} slotSize={16} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteClick(server)}
                    >
                      <Icon icon={RiDeleteBinLine} slotSize={16} />
                    </Button>
                  </div>
                </div>

                {/* Expandable tool approvals */}
                <div className="mt-3 border-t pt-3">
                  <button
                    type="button"
                    onClick={() => handleToggleExpand(server._id)}
                    className="text-muted-foreground hover:text-foreground text-xs transition-colors"
                  >
                    {expandedServer === server._id
                      ? "▾ Hide tools"
                      : "▸ Show tools"}
                  </button>
                  {expandedServer === server._id && (
                    <McpToolApprovals serverId={server._id} />
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add/Edit Form Dialog */}
      <McpServerForm
        key={editingServer?._id ?? "new"}
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open)
          if (!open) setEditingServer(null)
        }}
        server={editingServer}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete MCP Server</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{serverToDelete?.name}
              &quot;? This will remove the server and all associated tool
              approvals. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
