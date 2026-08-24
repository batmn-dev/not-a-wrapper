import type {
  PromptInputActionQuery,
  PromptInputEditorHandle,
} from "@/components/ui/prompt-input"
import { toast } from "@/components/ui/toast"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { usePerUserQuery } from "@/lib/convex/use-per-user-query"
import { useMutation } from "convex/react"
import { useCallback, useMemo, type RefObject } from "react"
import type { ComposerMenuConnector } from "./composer-menu-items"

/**
 * MCP connectors surface in the @ menu the way ChatGPT surfaces its
 * connectors; activation toggles the server the runtime already consults
 * per turn. `undefined` while the per-user query resolves drives the
 * menu's skeleton rows.
 */
function useComposerConnectors({
  isUserAuthenticated,
  editorRef,
}: {
  isUserAuthenticated: boolean
  editorRef: RefObject<PromptInputEditorHandle | null>
}) {
  const { data: mcpServers } = usePerUserQuery(
    api.mcpServers.list,
    isUserAuthenticated ? {} : "skip"
  )
  const connectors = useMemo<
    readonly ComposerMenuConnector[] | undefined
  >(() => {
    if (!isUserAuthenticated) return []
    if (mcpServers === undefined) return undefined
    return mcpServers.map((server) => {
      let host = ""
      try {
        host = new URL(server.url).host
      } catch {
        host = server.url
      }
      return {
        id: server._id,
        name: server.name,
        description: host,
        enabled: server.enabled,
      }
    })
  }, [isUserAuthenticated, mcpServers])

  const toggleMcpServer = useMutation(api.mcpServers.toggleEnabled)
  const toggleConnector = useCallback(
    (connectorId: string) => {
      void toggleMcpServer({
        serverId: connectorId as Id<"mcpServers">,
      }).catch(() => {
        toast({ title: "Couldn’t update the connector", status: "error" })
      })
    },
    [toggleMcpServer]
  )
  const activateConnector = useCallback(
    (connectorId: string, query: PromptInputActionQuery) => {
      const editor = editorRef.current
      if (!editor) return false
      if (!editor.replaceActionQuery(query)) return false
      toggleConnector(connectorId)
      return true
    },
    [editorRef, toggleConnector]
  )

  return { connectors, activateConnector, toggleConnector }
}

export { useComposerConnectors }
