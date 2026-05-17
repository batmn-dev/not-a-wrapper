import { withAuth } from "@workos-inc/authkit-nextjs"

export async function getWorkosSession() {
  return await withAuth()
}

export async function getAuthenticatedWorkosSession() {
  const auth = await withAuth()
  if (!auth.user || !auth.accessToken) return null

  return {
    user: auth.user,
    userId: auth.user.id,
    accessToken: auth.accessToken,
  }
}
