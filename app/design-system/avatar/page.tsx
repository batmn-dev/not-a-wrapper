import { ComponentPreview } from "@/app/design-system/_components/component-preview"
import {
  DsApiTable,
  DsPage,
  DsPageHeader,
  DsParagraph,
  DsSection,
} from "@/app/design-system/_components/ds-page"
import { readComponentSource } from "@/app/design-system/_lib/component-source"
import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
} from "@/components/ui/avatar"
import type { Metadata } from "next"

const sizesCode = `import { Avatar, AvatarBadge, AvatarFallback } from "@/components/ui/avatar"

export function AvatarSizes() {
  return (
    <div className="flex items-center gap-4">
      <Avatar size="sm">
        <AvatarFallback>AG</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarFallback>AG</AvatarFallback>
      </Avatar>
      <Avatar size="lg">
        <AvatarFallback>AG</AvatarFallback>
        <AvatarBadge />
      </Avatar>
    </div>
  )
}`

const groupCode = `import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
} from "@/components/ui/avatar"

export function AvatarGroupDemo() {
  return (
    <AvatarGroup>
      <Avatar>
        <AvatarFallback>AG</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarFallback>KT</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarFallback>SM</AvatarFallback>
      </Avatar>
      <AvatarGroupCount>+3</AvatarGroupCount>
    </AvatarGroup>
  )
}`

const apiRows = [
  {
    prop: "Avatar size",
    type: '"default" | "sm" | "lg"',
    defaultValue: '"default"',
    description:
      "Avatar diameter: sm is 24px, default is 32px, lg is 40px. Fallback text and badge scale with it.",
  },
  {
    prop: "AvatarImage src",
    type: "string",
    defaultValue: "—",
    description:
      "Image source. While it loads (or if it errors), the sibling AvatarFallback renders instead.",
  },
  {
    prop: "AvatarFallback",
    type: "ReactNode children",
    defaultValue: "—",
    description:
      "Initials or an icon shown until the image is ready, on a muted circle.",
  },
  {
    prop: "AvatarBadge",
    type: "span props",
    defaultValue: "—",
    description:
      "Status dot pinned to the bottom-right edge, ringed by the background. Can hold a tiny svg at default/lg sizes.",
  },
  {
    prop: "AvatarGroup",
    type: "div props",
    defaultValue: "—",
    description:
      "Overlapping row of avatars; each member gets a background ring and a -8px offset.",
  },
  {
    prop: "AvatarGroupCount",
    type: "div props",
    defaultValue: "—",
    description:
      "Trailing overflow chip (for example +3) that matches the group's avatar size.",
  },
] as const

export const metadata: Metadata = {
  title: "Avatar | Design System",
  description:
    "Documentation and visual variants for the Not A Wrapper Avatar component.",
}

export default function AvatarPage() {
  const avatarSource = readComponentSource("components/ui/avatar.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="avatar"
        title="Avatar"
        description="Base UI avatar with image loading fallback, three sizes, a status badge, and overlapping groups."
      />

      <DsSection
        id="sizes"
        title="Sizes"
        description="The three fixed diameters. AvatarBadge pins a status dot to the bottom-right edge and scales with the avatar."
      >
        <ComponentPreview code={sizesCode} sourceCode={avatarSource}>
          <div className="flex items-center gap-4">
            <Avatar size="sm">
              <AvatarFallback>AG</AvatarFallback>
            </Avatar>
            <Avatar>
              <AvatarFallback>AG</AvatarFallback>
            </Avatar>
            <Avatar size="lg">
              <AvatarFallback>AG</AvatarFallback>
              <AvatarBadge />
            </Avatar>
          </div>
        </ComponentPreview>
      </DsSection>

      <DsSection
        id="group"
        title="Group"
        description="AvatarGroup overlaps its members and rings each one with the background; AvatarGroupCount closes the row with an overflow chip."
      >
        <ComponentPreview code={groupCode} sourceCode={avatarSource}>
          <AvatarGroup>
            <Avatar>
              <AvatarFallback>AG</AvatarFallback>
            </Avatar>
            <Avatar>
              <AvatarFallback>KT</AvatarFallback>
            </Avatar>
            <Avatar>
              <AvatarFallback>SM</AvatarFallback>
            </Avatar>
            <AvatarGroupCount>+3</AvatarGroupCount>
          </AvatarGroup>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[22, 24, 14, 40]} rows={apiRows} />
        <DsParagraph className="mt-3">
          Avatar, AvatarImage, and AvatarFallback forward the remaining Base UI
          Avatar props; the group pieces are plain divs.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
