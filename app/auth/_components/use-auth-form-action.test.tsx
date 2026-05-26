/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import type { AuthActionState } from "../_lib/schemas"
import { useAuthFormAction } from "./use-auth-form-action"

const authMocks = vi.hoisted(() => ({
  getAuth: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
}))

vi.mock("@workos-inc/authkit-nextjs/components", () => ({
  useAuth: () => ({ getAuth: authMocks.getAuth }),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: authMocks.refresh,
    replace: authMocks.replace,
  }),
}))

type AuthFormAction = (
  previousState: AuthActionState,
  formData: FormData
) => Promise<AuthActionState>

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve: Deferred<T>["resolve"] | undefined
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })

  if (!resolve) {
    throw new Error("Failed to create deferred promise")
  }

  return { promise, resolve }
}

function TestAuthForm({ action }: { action: AuthFormAction }) {
  const [state, formAction, isPending] = useAuthFormAction(action)

  return (
    <form action={formAction}>
      <input aria-label="Submission" name="submission" />
      <button type="submit">Submit</button>
      <div data-pending={isPending} data-status={state.status}>
        {state.message}
      </div>
    </form>
  )
}

function submitForm(container: HTMLElement, submission: string) {
  const input = container.querySelector(
    'input[name="submission"]'
  ) as HTMLInputElement | null
  const form = container.querySelector("form")

  if (!input || !form) {
    throw new Error("Test form was not mounted")
  }

  input.value = submission
  form.requestSubmit()
}

describe("useAuthFormAction", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeAll(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true
  })

  beforeEach(() => {
    authMocks.getAuth.mockResolvedValue(undefined)
    authMocks.refresh.mockReset()
    authMocks.replace.mockReset()
  })

  afterEach(() => {
    const mountedRoot = root
    if (mountedRoot) {
      act(() => {
        mountedRoot.unmount()
      })
    }
    container?.remove()
    container = null
    root = null
    vi.clearAllMocks()
  })

  it("serializes overlapping submissions through React action state", async () => {
    const first = createDeferred<AuthActionState>()
    const second = createDeferred<AuthActionState>()
    const action = vi.fn<AuthFormAction>((previousState, formData) => {
      const submission = formData.get("submission")
      return submission === "first" ? first.promise : second.promise
    })

    const mountedContainer = document.createElement("div")
    document.body.appendChild(mountedContainer)
    container = mountedContainer
    const mountedRoot = createRoot(mountedContainer)
    root = mountedRoot

    await act(async () => {
      mountedRoot.render(<TestAuthForm action={action} />)
    })

    act(() => {
      submitForm(mountedContainer, "first")
      submitForm(mountedContainer, "second")
    })

    expect(action).toHaveBeenCalledTimes(1)
    expect(action.mock.calls[0]?.[0]).toEqual({ status: "idle" })

    await act(async () => {
      first.resolve({ status: "error", message: "Wrong password." })
      await first.promise
    })

    expect(action).toHaveBeenCalledTimes(2)
    expect(action.mock.calls[1]?.[0]).toEqual({
      status: "error",
      message: "Wrong password.",
    })

    await act(async () => {
      second.resolve({ status: "authenticated", redirectTo: "/chat" })
      await second.promise
    })

    expect(authMocks.getAuth).toHaveBeenCalledWith({ ensureSignedIn: true })
    expect(authMocks.replace).toHaveBeenCalledWith("/chat")
    expect(authMocks.refresh).toHaveBeenCalledTimes(1)
  })
})
