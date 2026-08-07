export type DesignSystemComponent = {
  name: string
  slug: string
  href: `/design-system/${string}`
}

export const designSystemComponents = [
  {
    name: "Button",
    slug: "button",
    href: "/design-system/button",
  },
  {
    name: "Sidebar Menu Item",
    slug: "sidebar-menu-item",
    href: "/design-system/sidebar-menu-item",
  },
  {
    name: "Sidebar Row",
    slug: "sidebar-row",
    href: "/design-system/sidebar-row",
  },
] as const satisfies readonly DesignSystemComponent[]

export function getAdjacentComponents(slug: string) {
  const currentIndex = designSystemComponents.findIndex(
    (component) => component.slug === slug
  )

  if (currentIndex === -1) {
    return { previous: undefined, next: undefined }
  }

  return {
    previous: designSystemComponents[currentIndex - 1],
    next: designSystemComponents[currentIndex + 1],
  }
}
