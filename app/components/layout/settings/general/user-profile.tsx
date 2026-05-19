"use client"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Icon } from "@/components/ui/icon"
import { useUser } from "@/lib/user-store/provider"
import { RiUserLine } from "@remixicon/react"

export function UserProfile() {
  const { user } = useUser()

  if (!user) return null

  return (
    <div>
      <h3 className="mb-3 text-sm font-medium text-balance">Profile</h3>
      <div className="flex items-center space-x-4">
        <div className="bg-muted flex items-center justify-center overflow-hidden rounded-full">
          {user?.profile_image ? (
            <Avatar className="size-12">
              <AvatarImage src={user.profile_image} className="object-cover" />
              <AvatarFallback>{user?.display_name?.charAt(0)}</AvatarFallback>
            </Avatar>
          ) : (
            <Icon
              icon={RiUserLine}
              slotSize={48}
              className="text-muted-foreground"
            />
          )}
        </div>
        <div>
          <h4 className="text-sm font-medium text-balance">
            {user?.display_name}
          </h4>
          <p className="text-muted-foreground text-sm">{user?.email}</p>
        </div>
      </div>
    </div>
  )
}
