import { MCP_CIRCUIT_BREAKER_THRESHOLD } from "@/lib/config"

/**
 * In-memory circuit breaker for MCP server connections.
 *
 * Tracks consecutive failures per server. When failures reach the threshold,
 * the server stays skipped for the warm process lifetime. A cold start clears
 * the state; tests may reset it explicitly.
 */

type CircuitState = {
  consecutiveFailures: number
  lastFailureAt: number
}

/** Survives across requests in a warm container. */
const circuits = new Map<string, CircuitState>()

export function isCircuitOpen(
  serverId: string,
  threshold: number = MCP_CIRCUIT_BREAKER_THRESHOLD
): boolean {
  const state = circuits.get(serverId)
  if (!state) return false
  return state.consecutiveFailures >= threshold
}

export function recordFailure(serverId: string): void {
  const state = circuits.get(serverId) ?? {
    consecutiveFailures: 0,
    lastFailureAt: 0,
  }
  state.consecutiveFailures++
  state.lastFailureAt = Date.now()
  circuits.set(serverId, state)
}

export function recordSuccess(serverId: string): void {
  circuits.delete(serverId)
}

export function getFailureCount(serverId: string): number {
  return circuits.get(serverId)?.consecutiveFailures ?? 0
}

/** Test-only reset; production state resets with the process. */
export function resetAllCircuits(): void {
  circuits.clear()
}
