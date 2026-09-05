import { afterEach, describe, expect, it, vi } from "vitest"
import { getPerfAuthPassword } from "./ensure-auth-user"

const originalPassword = process.env.PERF_AUTH_PASSWORD

const workosMocks = vi.hoisted(() => ({
  createUser: vi.fn(async () => ({ id: "test-created-user" })),
  listUsers: vi.fn(async () => ({ data: [{ id: "existing-user" }] })),
  authenticateWithPassword: vi.fn(async () => ({})),
  updateUser: vi.fn(async () => ({})),
}))

vi.mock("@workos-inc/node", () => ({
  WorkOS: class {
    userManagement = workosMocks
  },
}))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.resetModules()
  if (originalPassword === undefined) {
    delete process.env.PERF_AUTH_PASSWORD
  } else {
    process.env.PERF_AUTH_PASSWORD = originalPassword
  }
})

describe("benchmark identity isolation", () => {
  it("creates a fresh CI identity even with a configured shared email", async () => {
    vi.stubEnv("CI", "true")
    vi.stubEnv("PERF_AUTH_EMAIL", "benchmark@example.com")
    vi.stubEnv("PERF_AUTH_PASSWORD", "test-only-password")
    vi.stubEnv("WORKOS_API_KEY", "test-only-key")
    vi.stubEnv("WORKOS_CLIENT_ID", "test-only-client")
    vi.spyOn(console, "log").mockImplementation(() => {})
    vi.resetModules()
    const first = await import("./ensure-auth-user")
    vi.resetModules()
    const second = await import("./ensure-auth-user")
    expect(first.PERF_AUTH_EMAIL).toMatch(
      /^benchmark\+[a-f0-9-]{36}@example\.com$/
    )
    expect(first.PERF_AUTH_EMAIL).not.toBe(second.PERF_AUTH_EMAIL)
    await first.ensurePerfAuthUser()
    expect(workosMocks.createUser).toHaveBeenCalledWith({
      email: first.PERF_AUTH_EMAIL,
      password: "test-only-password",
      emailVerified: true,
      firstName: "Perf",
      lastName: "Harness",
    })
    expect(workosMocks.listUsers).not.toHaveBeenCalled()
    expect(workosMocks.updateUser).not.toHaveBeenCalled()
    workosMocks.createUser.mockRejectedValueOnce(new Error("creation failed"))
    await expect(second.ensurePerfAuthUser()).rejects.toThrow("creation failed")
    expect(workosMocks.authenticateWithPassword).not.toHaveBeenCalled()
  })

  it("preserves the configured local identity and password verification", async () => {
    vi.stubEnv("CI", "")
    vi.stubEnv("PERF_AUTH_EMAIL", "existing@example.com")
    vi.stubEnv("PERF_AUTH_PASSWORD", "test-only-password")
    vi.stubEnv("WORKOS_API_KEY", "test-only-key")
    vi.stubEnv("WORKOS_CLIENT_ID", "test-only-client")
    vi.spyOn(console, "log").mockImplementation(() => {})
    vi.resetModules()
    const local = await import("./ensure-auth-user")
    expect(local.PERF_AUTH_EMAIL).toBe("existing@example.com")
    await local.ensurePerfAuthUser()
    expect(workosMocks.listUsers).toHaveBeenCalledWith({
      email: "existing@example.com",
    })
    expect(workosMocks.authenticateWithPassword).toHaveBeenCalledWith({
      clientId: "test-only-client",
      email: "existing@example.com",
      password: "test-only-password",
    })
    expect(workosMocks.createUser).not.toHaveBeenCalled()
  })
})

describe("getPerfAuthPassword", () => {
  it("rejects a missing benchmark credential", () => {
    delete process.env.PERF_AUTH_PASSWORD

    expect(() => getPerfAuthPassword()).toThrow("PERF_AUTH_PASSWORD missing")
  })

  it("returns the configured benchmark credential", () => {
    process.env.PERF_AUTH_PASSWORD = "test-only-password"

    expect(getPerfAuthPassword()).toBe("test-only-password")
  })
})
