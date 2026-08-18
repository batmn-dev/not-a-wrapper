"use client"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { MenuLeadingIcon } from "@/components/ui/menu-leading-icon"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useChats } from "@/lib/chat-store/chats/provider"
import { useMessages } from "@/lib/chat-store/messages/provider"
import { APP_DOMAIN } from "@/lib/config"
import { useUser } from "@/lib/user-store/provider"
import {
  RiBugLine,
  RiFileTextLine,
  RiLifebuoyLine,
  RiLogoutBoxRLine,
  RiPaletteLine,
  RiShieldLine,
} from "@remixicon/react"
import { useAuth } from "@workos-inc/authkit-nextjs/components"
import Link from "next/link"
import { useState } from "react"
import { AppInfoDialog, AppInfoMenuItem } from "./app-info/app-info-trigger"
import { FeedbackDialog, FeedbackMenuItem } from "./feedback/feedback-trigger"
import { SettingsDialog, SettingsMenuItem } from "./settings/settings-trigger"
import { signOutAndClearLocalState } from "./sign-out"

type UserMenuProps = {
  variant?: "header" | "sidebar" | "sidebar-collapsed"
}

export function UserMenu({ variant = "header" }: UserMenuProps) {
  const { user } = useUser()
  const { signOut } = useAuth()
  const { resetChats } = useChats()
  const { resetMessages } = useMessages()
  const [isMenuOpen, setMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [appInfoOpen, setAppInfoOpen] = useState(false)

  if (!user) return null

  const isSidebar = variant === "sidebar"
  const isSidebarCollapsed = variant === "sidebar-collapsed"

  const handleSignOut = async () => {
    await signOutAndClearLocalState({ resetMessages, resetChats, signOut })
  }

  const menuContent = (
    <>
      <DropdownMenuItem className="flex items-start gap-0 no-underline hover:bg-transparent focus:bg-transparent">
        <span className="text-muted-foreground max-w-full truncate">
          {user?.email}
        </span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem render={<Link href="/design-system" />}>
        <MenuLeadingIcon icon={RiPaletteLine} />
        <span>Design System</span>
      </DropdownMenuItem>
      <SettingsMenuItem onClick={() => setSettingsOpen(true)} />
      <DropdownMenuSeparator />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <MenuLeadingIcon icon={RiLifebuoyLine} />
          <span>Help</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-56">
          <AppInfoMenuItem onClick={() => setAppInfoOpen(true)} />
          <FeedbackMenuItem onClick={() => setFeedbackOpen(true)} />
          <DropdownMenuSeparator />
          <DropdownMenuItem
            render={
              <a
                href={`${APP_DOMAIN}/terms`}
                target="_blank"
                rel="noopener noreferrer"
              />
            }
          >
            <MenuLeadingIcon icon={RiFileTextLine} />
            <span>Terms of Service</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            render={
              <a
                href={`${APP_DOMAIN}/privacy`}
                target="_blank"
                rel="noopener noreferrer"
              />
            }
          >
            <MenuLeadingIcon icon={RiShieldLine} />
            <span>Privacy Policy</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            render={
              <a
                href="https://github.com/darknightdesigner/not-a-wrapper/issues/new"
                target="_blank"
                rel="noopener noreferrer"
              />
            }
          >
            <MenuLeadingIcon icon={RiBugLine} />
            <span>Report a bug</span>
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuItem onClick={handleSignOut}>
        <MenuLeadingIcon icon={RiLogoutBoxRLine} />
        <span>Log out</span>
      </DropdownMenuItem>
    </>
  )

  const dialogs = (
    <>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
      <AppInfoDialog open={appInfoOpen} onOpenChange={setAppInfoOpen} />
    </>
  )

  // Sidebar variant: keep trigger geometry stable across collapse state changes.
  if (isSidebar) {
    return (
      <>
        <DropdownMenu
          open={isMenuOpen}
          onOpenChange={setMenuOpen}
          modal={false}
        >
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                role="button"
                aria-label="Open profile menu"
                aria-haspopup="menu"
                aria-expanded={isMenuOpen}
                data-testid="accounts-profile-button"
                className="group/menu-item hover:bg-sidebar-row active:bg-sidebar-row flex h-(--sidebar-footer-row-height) w-full items-center gap-2 rounded-xl px-1.5 text-left text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
              />
            }
          >
            <Avatar className="size-6 bg-emerald-600">
              <AvatarImage src={user?.profile_image ?? undefined} />
              <AvatarFallback className="bg-emerald-600 text-xs text-white">
                {user?.display_name?.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-normal">{user?.display_name}</span>
              <span className="text-muted-foreground truncate text-xs">
                {user?.premium ? "Plus" : "Free"}
              </span>
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="start"
            animated={false}
            className="w-[calc(var(--sidebar-width)-0.75rem)]"
          >
            {menuContent}
          </DropdownMenuContent>
        </DropdownMenu>
        {dialogs}
      </>
    )
  }

  if (isSidebarCollapsed) {
    return (
      <>
        <DropdownMenu
          open={isMenuOpen}
          onOpenChange={setMenuOpen}
          modal={false}
        >
          <Tooltip disableHoverablePopup>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      role="button"
                      aria-label="Open profile menu"
                      aria-haspopup="menu"
                      aria-expanded={isMenuOpen}
                      data-testid="accounts-profile-button"
                      className="hover:bg-sidebar-row active:bg-sidebar-row mx-auto flex size-(--sidebar-footer-collapsed-button-size) items-center justify-center rounded-[10px] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                    />
                  }
                />
              }
            >
              <Avatar className="size-6 bg-emerald-600">
                <AvatarImage src={user?.profile_image ?? undefined} />
                <AvatarFallback className="bg-emerald-600 text-xs text-white">
                  {user?.display_name?.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </TooltipTrigger>
            <TooltipContent side="right">
              {user?.display_name || "Account"}
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent
            side="top"
            align="start"
            animated={false}
            className="w-[calc(var(--sidebar-width)-0.75rem)] [box-shadow:0_0_0_1px_#0000000a,0_2px_8px_#0000000a,0_4px_80px_8px_#00000006] dark:[box-shadow:var(--floating-surface-edge-shadow)]"
          >
            {menuContent}
          </DropdownMenuContent>
        </DropdownMenu>
        {dialogs}
      </>
    )
  }

  return (
    <>
      <DropdownMenu open={isMenuOpen} onOpenChange={setMenuOpen} modal={false}>
        <Tooltip>
          <TooltipTrigger render={<DropdownMenuTrigger />}>
            <Avatar className="bg-background hover:bg-muted">
              <AvatarImage src={user?.profile_image ?? undefined} />
              <AvatarFallback>{user?.display_name?.charAt(0)}</AvatarFallback>
            </Avatar>
          </TooltipTrigger>
          <TooltipContent>Profile</TooltipContent>
        </Tooltip>
        <DropdownMenuContent className="w-56" align="end">
          {menuContent}
        </DropdownMenuContent>
      </DropdownMenu>
      {dialogs}
    </>
  )
}
