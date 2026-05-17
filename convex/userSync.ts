import type { MutationCtx } from "./_generated/server"

type AppUserSyncInput = {
  workosUserId: string
  email: string
  firstName?: string | null
  lastName?: string | null
  displayName?: string
  profileImage?: string | null
  workosUpdatedAt?: string | null
  markActive?: boolean
}

function displayNameFromWorkOSUser(user: {
  email: string
  firstName?: string | null
  lastName?: string | null
  displayName?: string | null
}) {
  if (user.displayName?.trim()) {
    return user.displayName.trim()
  }

  const fullName = [user.firstName, user.lastName]
    .filter(Boolean)
    .join(" ")
    .trim()
  if (fullName) return fullName

  const [localPart] = user.email.split("@")
  return localPart || user.email
}

function isOlderWorkOSUpdate(
  existingUpdatedAt?: string,
  incomingUpdatedAt?: string | null
) {
  if (!existingUpdatedAt || !incomingUpdatedAt) return false

  const existingTime = Date.parse(existingUpdatedAt)
  const incomingTime = Date.parse(incomingUpdatedAt)
  if (Number.isNaN(existingTime) || Number.isNaN(incomingTime)) return false

  return incomingTime < existingTime
}

export async function upsertAppUserFromWorkOS(
  ctx: MutationCtx,
  input: AppUserSyncInput
) {
  const existingUser = await ctx.db
    .query("users")
    .withIndex("by_workos_user_id", (q) =>
      q.eq("workosUserId", input.workosUserId)
    )
    .unique()

  if (
    existingUser &&
    isOlderWorkOSUpdate(existingUser.workosUpdatedAt, input.workosUpdatedAt)
  ) {
    return existingUser._id
  }

  const now = Date.now()
  const displayName = displayNameFromWorkOSUser(input)
  const profileImage = input.profileImage ?? undefined
  const workosUpdatedAt = input.workosUpdatedAt ?? existingUser?.workosUpdatedAt

  if (existingUser) {
    await ctx.db.patch(existingUser._id, {
      email: input.email,
      displayName,
      profileImage,
      workosUpdatedAt,
      lastSyncedFromWorkOSAt: now,
      ...(input.markActive ? { lastActiveAt: now } : {}),
      deletedAt: undefined,
      disabledAt: undefined,
    })
    return existingUser._id
  }

  return await ctx.db.insert("users", {
    workosUserId: input.workosUserId,
    email: input.email,
    displayName,
    profileImage,
    anonymous: false,
    premium: false,
    messageCount: 0,
    dailyMessageCount: 0,
    dailyProMessageCount: 0,
    lastSyncedFromWorkOSAt: now,
    workosUpdatedAt,
    ...(input.markActive ? { lastActiveAt: now } : {}),
  })
}

export async function softDeleteAppUserFromWorkOS(
  ctx: MutationCtx,
  input: Pick<AppUserSyncInput, "workosUserId" | "workosUpdatedAt">
) {
  const existingUser = await ctx.db
    .query("users")
    .withIndex("by_workos_user_id", (q) =>
      q.eq("workosUserId", input.workosUserId)
    )
    .unique()

  if (!existingUser) return null

  if (
    isOlderWorkOSUpdate(existingUser.workosUpdatedAt, input.workosUpdatedAt)
  ) {
    return existingUser._id
  }

  const now = Date.now()
  await ctx.db.patch(existingUser._id, {
    deletedAt: existingUser.deletedAt ?? now,
    disabledAt: existingUser.disabledAt ?? now,
    lastSyncedFromWorkOSAt: now,
    workosUpdatedAt: input.workosUpdatedAt ?? existingUser.workosUpdatedAt,
  })

  return existingUser._id
}
