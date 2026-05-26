"use client"

import { useAuth } from "@workos-inc/authkit-nextjs/components"
import { useRouter } from "next/navigation"
import { useCallback, useState } from "react"
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
  const [state, setState] = useState<AuthActionState>(initialState)
  const [isPending, setIsPending] = useState(false)

  const formAction = useCallback(
    async (formData: FormData) => {
      setIsPending(true)

      try {
        const nextState = await action(state, formData)

        if (nextState.status === "authenticated") {
          await getAuth({ ensureSignedIn: true })
          router.replace(nextState.redirectTo ?? "/")
          router.refresh()
          return
        }

        setState(nextState)
      } finally {
        setIsPending(false)
      }
    },
    [action, getAuth, router, state]
  )

  return [state, formAction, isPending] as const
}
