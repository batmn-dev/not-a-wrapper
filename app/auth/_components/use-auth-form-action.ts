"use client"

import { useAuth } from "@workos-inc/authkit-nextjs/components"
import { useRouter } from "next/navigation"
import { useActionState } from "react"
import {
  initialAuthActionState,
  type AuthActionState,
} from "../_lib/schemas"

type AuthFormAction = (
  previousState: AuthActionState,
  formData: FormData
) => Promise<AuthActionState>

export function useAuthFormAction(
  action: AuthFormAction,
  initialState: AuthActionState = initialAuthActionState
) {
  const router = useRouter()
  const { getAuth } = useAuth()
  const [state, formAction, isPending] = useActionState(
    async (previousState: AuthActionState, formData: FormData) => {
      const nextState = await action(previousState, formData)

      if (nextState.status === "authenticated") {
        await getAuth({ ensureSignedIn: true })
        router.replace(nextState.redirectTo ?? "/")
        router.refresh()
      }

      return nextState
    },
    initialState
  )

  return [state, formAction, isPending] as const
}
