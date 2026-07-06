import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it } from "vitest"
import { createPinnedMcpFetch } from "../pinned-fetch"
import type { ResolvedMcpUrl } from "../url-validation"

type RequestHandler = (
  request: IncomingMessage,
  response: ServerResponse
) => void

const openServers: Server[] = []

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
        })
    )
  )
})

async function listen(handler: RequestHandler): Promise<{ port: number }> {
  const server = createServer(handler)
  openServers.push(server)

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve)
  })

  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address")
  }

  return { port: (address as AddressInfo).port }
}

function resolvedTarget(port: number): ResolvedMcpUrl {
  return {
    originalUrl: new URL(`http://mcp.example.test:${port}/mcp`),
    hostname: "mcp.example.test",
    addresses: [{ address: "127.0.0.1", family: 4 }],
  }
}

describe("createPinnedMcpFetch", () => {
  it("connects through the pinned address while preserving the configured host", async () => {
    let observedHost: string | undefined

    const { port } = await listen((request, response) => {
      observedHost = request.headers.host
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify({ ok: true }))
    })

    const pinnedFetch = createPinnedMcpFetch(resolvedTarget(port))
    const response = await pinnedFetch(`http://mcp.example.test:${port}/mcp`, {
      method: "POST",
      body: "{}",
    })

    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(observedHost).toBe(`mcp.example.test:${port}`)
  })

  it("refuses requests outside the resolved MCP origin", async () => {
    const pinnedFetch = createPinnedMcpFetch(resolvedTarget(1234))

    await expect(
      pinnedFetch("http://other.example.test:1234/mcp")
    ).rejects.toThrow(/cross-origin request/)
  })
})
