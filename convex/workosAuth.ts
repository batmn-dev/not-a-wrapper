import { AuthKit, type AuthFunctions } from "@convex-dev/workos-authkit"
import { components, internal } from "./_generated/api"
import type { DataModel } from "./_generated/dataModel"
import {
  softDeleteAppUserFromWorkOS,
  upsertAppUserFromWorkOS,
} from "./userSync"

const authFunctions: AuthFunctions = internal.workosAuth

export const authKit = new AuthKit<DataModel>(components.workOSAuthKit, {
  authFunctions,
})

export const { authKitEvent } = authKit.events({
  "user.created": async (ctx, event) => {
    await upsertAppUserFromWorkOS(ctx, {
      workosUserId: event.data.id,
      email: event.data.email,
      firstName: event.data.firstName,
      lastName: event.data.lastName,
      profileImage: event.data.profilePictureUrl,
      workosUpdatedAt: event.data.updatedAt,
    })
  },
  "user.updated": async (ctx, event) => {
    await upsertAppUserFromWorkOS(ctx, {
      workosUserId: event.data.id,
      email: event.data.email,
      firstName: event.data.firstName,
      lastName: event.data.lastName,
      profileImage: event.data.profilePictureUrl,
      workosUpdatedAt: event.data.updatedAt,
    })
  },
  "user.deleted": async (ctx, event) => {
    await softDeleteAppUserFromWorkOS(ctx, {
      workosUserId: event.data.id,
      workosUpdatedAt: event.data.updatedAt,
    })
  },
})

export const { backfillUsers } = authKit.utils()
