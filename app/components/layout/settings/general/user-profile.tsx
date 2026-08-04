"use client"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Icon } from "@/components/ui/icon"
import { Input } from "@/components/ui/input"
import { api } from "@/convex/_generated/api"
import { uploadBinaryWithProgress } from "@/lib/file-handling"
import { validateFile } from "@/lib/file/validation"
import { useUser } from "@/lib/user-store/provider"
import {
  RiArrowRightSLine,
  RiLoader4Line,
  RiPencilFill,
} from "@remixicon/react"
import { useMutation } from "convex/react"
import { useRef, useState, type ChangeEvent, type FormEvent } from "react"
import {
  SettingsField,
  SettingsFieldContent,
  SettingsFieldControl,
  SettingsFieldGroup,
  SettingsFieldLabel,
  SettingsFieldSurface,
  SettingsFieldValue,
} from "./settings-row"

function ProfileFields({
  displayName,
  email,
  profileImage,
}: {
  displayName: string
  email: string
  profileImage: string | null
}) {
  const { isLoading, updateUser } = useUser()
  const nameInputRef = useRef<HTMLInputElement>(null)
  const profileImageInputRef = useRef<HTMLInputElement>(null)
  const generateProfileImageUploadUrl = useMutation(
    api.users.generateProfileImageUploadUrl
  )
  const saveProfileImage = useMutation(api.users.saveProfileImage)
  const [nameDraft, setNameDraft] = useState(displayName)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isUploadingProfileImage, setIsUploadingProfileImage] = useState(false)
  const [profileImageError, setProfileImageError] = useState<string | null>(
    null
  )

  const handleProfileImageChange = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ""
    if (!file) return

    setProfileImageError(null)
    setIsUploadingProfileImage(true)

    try {
      const validation = await validateFile(file)
      if (!file.type.startsWith("image/") || !validation.isValid) {
        setProfileImageError(
          validation.error ?? "Choose a JPEG, PNG, GIF, or WebP image."
        )
        return
      }

      const uploadUrl = await generateProfileImageUploadUrl({})
      const storageId = await uploadBinaryWithProgress(uploadUrl, file)
      const profileImageUrl = await saveProfileImage({
        storageId:
          storageId as unknown as typeof api.users.saveProfileImage._args.storageId,
        fileType: file.type,
      })

      await updateUser({ profile_image: profileImageUrl })
    } catch {
      setProfileImageError("Your profile picture couldn't be saved. Try again.")
    } finally {
      setIsUploadingProfileImage(false)
    }
  }

  const saveDisplayName = async () => {
    if (isLoading) return

    const nextDisplayName = nameDraft.trim()

    if (!nextDisplayName) {
      setSaveError("Enter your full name.")
      return
    }

    if (nextDisplayName === displayName) {
      setNameDraft(displayName)
      setSaveError(null)
      return
    }

    try {
      await updateUser({ display_name: nextDisplayName })
      setNameDraft(nextDisplayName)
      setSaveError(null)
    } catch {
      setSaveError("Your name couldn't be saved. Try again.")
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void saveDisplayName()
  }

  const fallbackInitial = displayName.trim().charAt(0).toUpperCase() || "?"

  return (
    <SettingsFieldGroup aria-label="Profile settings">
      <SettingsField>
        <input
          ref={profileImageInputRef}
          id="settings-profile-image"
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          className="hidden"
          disabled={isLoading || isUploadingProfileImage}
          onChange={(event) => void handleProfileImageChange(event)}
        />
        <SettingsFieldSurface
          render={
            <button
              type="button"
              onClick={() => profileImageInputRef.current?.click()}
            />
          }
          data-interactive
          data-disabled={isLoading || isUploadingProfileImage ? "" : undefined}
          disabled={isLoading || isUploadingProfileImage}
          aria-label="Change profile picture"
          aria-describedby={
            profileImageError ? "settings-profile-image-error" : undefined
          }
        >
          <SettingsFieldContent>
            <SettingsFieldLabel>Profile picture</SettingsFieldLabel>
            {profileImageError ? (
              <p
                id="settings-profile-image-error"
                role="alert"
                className="text-destructive text-xs"
              >
                {profileImageError}
              </p>
            ) : null}
          </SettingsFieldContent>
          <SettingsFieldControl>
            <Avatar className="shadow-border size-8 overflow-hidden">
              {profileImage ? <AvatarImage src={profileImage} alt="" /> : null}
              <AvatarFallback className="text-base font-medium">
                {fallbackInitial}
              </AvatarFallback>
              <span className="bg-popover text-foreground pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 group-hover/settings-field-surface:opacity-100 group-focus-visible/settings-field-surface:opacity-100 group-active/settings-field-surface:opacity-100">
                <Icon
                  icon={isUploadingProfileImage ? RiLoader4Line : RiPencilFill}
                  slotSize={24}
                  glyphSize={24}
                  className={
                    isUploadingProfileImage ? "animate-spin" : undefined
                  }
                  aria-hidden="true"
                />
              </span>
            </Avatar>
          </SettingsFieldControl>
        </SettingsFieldSurface>
      </SettingsField>

      <SettingsField>
        <SettingsFieldSurface
          render={<a href={`mailto:${email}`} />}
          data-interactive
          aria-label={`Compose an email to ${email}`}
        >
          <SettingsFieldContent>
            <SettingsFieldLabel>Email</SettingsFieldLabel>
          </SettingsFieldContent>
          <SettingsFieldControl className="sm:max-w-96">
            <SettingsFieldValue
              title={email}
              className="group-hover/settings-field-surface:underline group-focus-visible/settings-field-surface:underline"
            >
              {email}
            </SettingsFieldValue>
            <Icon
              icon={RiArrowRightSLine}
              slotSize={18}
              className="shrink-0"
              aria-hidden="true"
            />
          </SettingsFieldControl>
        </SettingsFieldSurface>
      </SettingsField>

      <SettingsField render={<form onSubmit={handleSubmit} />}>
        <SettingsFieldSurface
          render={<label htmlFor="settings-full-name" />}
          data-interactive
          className="focus-within:bg-row-hover sm:pr-2.5"
          onClick={() => {
            if (!isLoading) nameInputRef.current?.focus()
          }}
        >
          <SettingsFieldContent>
            <SettingsFieldLabel>Full name</SettingsFieldLabel>
          </SettingsFieldContent>
          <SettingsFieldControl className="flex-col items-stretch sm:items-end">
            <Input
              ref={nameInputRef}
              id="settings-full-name"
              name="full-name"
              autoComplete="name"
              value={nameDraft}
              disabled={isLoading}
              aria-invalid={saveError ? true : undefined}
              aria-describedby={
                saveError ? "settings-full-name-error" : undefined
              }
              className="border-input-border bg-popover hover:border-foreground focus-visible:border-foreground aria-invalid:border-destructive aria-invalid:hover:border-destructive aria-invalid:focus-visible:border-destructive h-10 w-full rounded-lg border text-sm! shadow-none transition-none focus-visible:ring-2 aria-invalid:shadow-none sm:field-sizing-content sm:w-auto sm:max-w-96 sm:min-w-56"
              onChange={(event) => {
                setNameDraft(event.target.value)
                if (saveError) setSaveError(null)
              }}
              onBlur={() => void saveDisplayName()}
            />
            {saveError ? (
              <p
                id="settings-full-name-error"
                role="alert"
                className="text-destructive text-xs"
              >
                {saveError}
              </p>
            ) : null}
          </SettingsFieldControl>
        </SettingsFieldSurface>
      </SettingsField>
    </SettingsFieldGroup>
  )
}

export function UserProfile() {
  const { user } = useUser()

  if (!user) return null

  return (
    <ProfileFields
      key={user.id}
      displayName={user.display_name}
      email={user.email}
      profileImage={user.profile_image}
    />
  )
}
