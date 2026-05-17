import { AuthKit, type AuthFunctions } from "@convex-dev/workos-authkit"
import type { Event as WorkOSEvent } from "@workos-inc/node"
import { components, internal } from "./_generated/api"
import type { DataModel } from "./_generated/dataModel"
import {
  softDeleteAppUserFromWorkOS,
  upsertAppUserFromWorkOS,
} from "./userSync"

type WorkOSUserEventData = Extract<
  WorkOSEvent,
  { event: "user.created" | "user.updated" }
>["data"]

const authFunctions: AuthFunctions = internal.workosAuth

export const authKit = new AuthKit<DataModel>(components.workOSAuthKit, {
  authFunctions,
})

function appUserSyncInputFromWorkOSUser(user: WorkOSUserEventData) {
  return {
    workosUserId: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    profileImage: user.profilePictureUrl,
    workosUpdatedAt: user.updatedAt,
  }
}

export const { authKitEvent } = authKit.events({
  "user.created": async (ctx, event) => {
    await upsertAppUserFromWorkOS(
      ctx,
      appUserSyncInputFromWorkOSUser(event.data)
    )
  },
  "user.updated": async (ctx, event) => {
    await upsertAppUserFromWorkOS(
      ctx,
      appUserSyncInputFromWorkOSUser(event.data)
    )
  },
  "user.deleted": async (ctx, event) => {
    await softDeleteAppUserFromWorkOS(ctx, {
      workosUserId: event.data.id,
      email: event.data.email,
      firstName: event.data.firstName,
      lastName: event.data.lastName,
      profileImage: event.data.profilePictureUrl,
      workosUpdatedAt: event.data.updatedAt,
    })
  },
})

export const { backfillUsers } = authKit.utils()
