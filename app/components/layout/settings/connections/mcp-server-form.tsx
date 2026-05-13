"use client"
import { RiLoader4Line } from "@remixicon/react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "@/components/ui/toast"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { fetchClient } from "@/lib/fetch"
import { useMutation } from "convex/react"
import { useCallback, useState } from "react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type McpServerData = {
  _id: Id<"mcpServers">
  name: string
  url: string
  transport: "http" | "sse"
  authType?: "none" | "bearer" | "header"
  encryptedAuthValue?: string
  headerName?: string
}

type TestResult = {
  success: boolean
  toolCount?: number
  toolNames?: string[]
  error?: string
}

type McpServerFormProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = create mode, defined = edit mode */
  server: McpServerData | null
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function McpServerForm({
  open,
  onOpenChange,
  server,
}: McpServerFormProps) {
  const isEditMode = !!server

  // Form state — initialized from server prop (or empty for create)
  const [name, setName] = useState(server?.name ?? "")
  const [url, setUrl] = useState(server?.url ?? "")
  const [transport, setTransport] = useState<"http" | "sse">(
    server?.transport ?? "http"
  )
  const [authType, setAuthType] = useState<"none" | "bearer" | "header">(
    server?.authType ?? "none"
  )
  const [authValue, setAuthValue] = useState("")
  const [headerName, setHeaderName] = useState(server?.headerName ?? "")

  // Async state
  const [isTesting, setIsTesting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)

  // Convex mutation for bulk-approving discovered tools
  const bulkApprove = useMutation(api.mcpToolApprovals.bulkApprove)

  const resetForm = useCallback(() => {
    setName(server?.name ?? "")
    setUrl(server?.url ?? "")
    setTransport(server?.transport ?? "http")
    setAuthType(server?.authType ?? "none")
    setAuthValue("")
    setHeaderName(server?.headerName ?? "")
    setTestResult(null)
  }, [server])

  const handleOpenChange = (open: boolean) => {
    if (!open) resetForm()
    onOpenChange(open)
  }

  // -------------------------------------------------------------------------
  // Test Connection
  // -------------------------------------------------------------------------

  const handleTestConnection = async () => {
    if (!url.trim()) return

    setIsTesting(true)
    setTestResult(null)

    try {
      const res = await fetchClient("/api/mcp-servers/test", {
        method: "POST",
        body: JSON.stringify({
          url: url.trim(),
          transport,
          authType,
          authValue: authValue || undefined,
          headerName: authType === "header" ? headerName : undefined,
        }),
      })

      const data = (await res.json()) as TestResult
      setTestResult(data)

      if (data.success) {
        toast({
          title: "Connection successful",
          description: `Discovered ${data.toolCount} tool${data.toolCount !== 1 ? "s" : ""}.`,
        })
      } else {
        toast({
          title: "Connection failed",
          description: data.error || "Unable to connect to the server.",
          status: "error",
        })
      }
    } catch (error) {
      console.error("Failed to test MCP connection:", error)
      setTestResult({ success: false, error: "Network error" })
      toast({
        title: "Connection failed",
        description: "Could not reach the test endpoint.",
        status: "error",
      })
    } finally {
      setIsTesting(false)
    }
  }

  // -------------------------------------------------------------------------
  // Save (Create or Update)
  // -------------------------------------------------------------------------

  const handleSave = async () => {
    if (!name.trim() || !url.trim()) {
      toast({ title: "Name and URL are required", status: "error" })
      return
    }

    setIsSaving(true)

    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        url: url.trim(),
        transport,
        authType,
      }

      if (authType === "header") {
        body.headerName = headerName
      }

      if (authValue && (authType === "bearer" || authType === "header")) {
        body.authValue = authValue
      }

      if (isEditMode && server) {
        body.serverId = server._id
      }

      const res = await fetchClient("/api/mcp-servers", {
        method: isEditMode ? "PATCH" : "POST",
        body: JSON.stringify(body),
      })

      const data = (await res.json()) as {
        success?: boolean
        error?: string
        serverId?: string
      }

      if (!res.ok) {
        throw new Error(data.error || "Failed to save server")
      }

      // Auto-approve discovered tools after successful save
      const servIdForApproval = isEditMode ? server?._id : data.serverId
      if (
        testResult?.success &&
        testResult.toolNames?.length &&
        servIdForApproval
      ) {
        try {
          await bulkApprove({
            serverId: servIdForApproval as Id<"mcpServers">,
            toolNames: testResult.toolNames,
          })
        } catch (e) {
          console.error("Failed to bulk approve tools:", e)
        }
      }

      toast({
        title: isEditMode ? "Server updated" : "Server added",
        description: isEditMode
          ? `${name} has been updated.`
          : `${name} has been added to your MCP servers.`,
      })

      handleOpenChange(false)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save"
      toast({ title: message, status: "error" })
    } finally {
      setIsSaving(false)
    }
  }

  const hasExistingAuth = isEditMode && !!server?.encryptedAuthValue

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {isEditMode ? "Edit MCP Server" : "Add MCP Server"}
          </DialogTitle>
          <DialogDescription>
            {isEditMode
              ? "Update your MCP server configuration."
              : "Connect an MCP server to add external tools to your AI conversations."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="mcp-name">Name</Label>
            <Input
              id="mcp-name"
              placeholder="My MCP Server"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isSaving}
            />
          </div>

          {/* URL */}
          <div className="space-y-2">
            <Label htmlFor="mcp-url">URL</Label>
            <Input
              id="mcp-url"
              type="url"
              placeholder="https://mcp.example.com/mcp"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={isSaving}
            />
            <p className="text-muted-foreground text-xs">
              The MCP server endpoint URL. Must be HTTPS in production.
            </p>
          </div>

          {/* Transport */}
          <div className="space-y-2">
            <Label>Transport</Label>
            <Select
              value={transport}
              onValueChange={(v) => setTransport(v as "http" | "sse")}
              disabled={isSaving}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="http">HTTP (recommended)</SelectItem>
                <SelectItem value="sse">SSE (legacy)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Auth Type */}
          <div className="space-y-2">
            <Label>Authentication</Label>
            <Select
              value={authType}
              onValueChange={(v) =>
                setAuthType(v as "none" | "bearer" | "header")
              }
              disabled={isSaving}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="bearer">Bearer Token</SelectItem>
                <SelectItem value="header">Custom Header</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Header Name (for custom header auth) */}
          {authType === "header" && (
            <div className="space-y-2">
              <Label htmlFor="mcp-header-name">Header Name</Label>
              <Input
                id="mcp-header-name"
                placeholder="X-API-Key"
                value={headerName}
                onChange={(e) => setHeaderName(e.target.value)}
                disabled={isSaving}
              />
            </div>
          )}

          {/* Auth Value (for bearer or custom header) */}
          {(authType === "bearer" || authType === "header") && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="mcp-auth-value">
                  {authType === "bearer" ? "Token" : "Header Value"}
                </Label>
                {hasExistingAuth && !authValue && (
                  <Badge variant="secondary" className="text-xs">
                    Configured
                  </Badge>
                )}
              </div>
              <Input
                id="mcp-auth-value"
                type="password"
                placeholder={
                  hasExistingAuth
                    ? "Enter new value to update"
                    : "Enter token or key"
                }
                value={authValue}
                onChange={(e) => setAuthValue(e.target.value)}
                disabled={isSaving}
              />
              {hasExistingAuth && (
                <p className="text-muted-foreground text-xs">
                  Leave blank to keep the existing value.
                </p>
              )}
            </div>
          )}

          {/* Test Connection */}
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleTestConnection}
              disabled={isTesting || isSaving || !url.trim()}
            >
              {isTesting ? (
                <>
                  <RiLoader4Line
                    size={14}
                    className="mr-1 animate-spin"
                  />
                  Testing...
                </>
              ) : (
                "Test Connection"
              )}
            </Button>
            {testResult && (
              <span
                className={`text-xs ${testResult.success ? "text-green-600 dark:text-green-400" : "text-destructive"}`}
              >
                {testResult.success
                  ? `${testResult.toolCount} tool${testResult.toolCount !== 1 ? "s" : ""} discovered`
                  : testResult.error || "Failed"}
              </span>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving || !name.trim() || !url.trim()}
          >
            {isSaving ? (
              <>
                <RiLoader4Line
                  size={14}
                  className="mr-1 animate-spin"
                />
                Saving...
              </>
            ) : isEditMode ? (
              "Update"
            ) : (
              "Add Server"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
