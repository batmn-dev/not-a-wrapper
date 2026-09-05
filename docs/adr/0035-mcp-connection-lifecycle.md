# ADR-0035: One MCP connection lifecycle for chat and settings

Status: accepted

The **MCP connection** module (`lib/mcp/load-mcp-from-url.ts`) owns URL
validation, DNS-pinned transport creation, tool discovery, cancellation, and
idempotent cleanup. Chat and settings share one five-second preparation
deadline per server, including validation and discovery. Separate phase
timeouts were rejected because they compound the time a chat waits.

Servers prepare in parallel. Only fully prepared connections enter the Tool
runtime; a failed or timed-out server is skipped and recorded as a preparation
failure. Existing circuit-breaker policy applies to the complete preparation,
so discovery failure no longer resets its failure count. Naming, approvals,
tool caps, credential resolution, and connection-status writes remain with
their existing owners.

The module returns tools and a close operation, never the raw SDK client.
Failure cancels transport work and initiates cleanup without delaying the
caller; a late-created client is also closed. Successful preparation clears
its deadline, leaving the connection usable until the Tool runtime disposes it
after turn settlement or settings closes it after discovery. Closing gives the SDK's
session termination request a bounded best-effort window, then aborts the
transport. Remote session reclamation remains the server's responsibility if
that request fails.

ADR-0010's DNS pinning, redirect rejection, and credential ownership remain
intact. Tests exercise shared preparation and cancellation, including the real
AI SDK, plus parallel discovery with one unhealthy server.
