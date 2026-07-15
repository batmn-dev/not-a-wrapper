import { Favicon } from "@/components/ui/favicon"
import { Icon } from "@/components/ui/icon"
import { isExternalHttpHref } from "@/lib/markdown/remark-link-presentation"
import { cn } from "@/lib/utils"
import { RiArrowRightUpLine, RiGlobalLine } from "@remixicon/react"
import { Children, cloneElement, isValidElement, type ReactNode } from "react"

export type LinkMarkdownPresentation = "inline" | "pill"

export type LinkMarkdownProps = React.ComponentProps<"a"> & {
  presentation?: LinkMarkdownPresentation
}

function getChildText(node: unknown): string {
  if (typeof node === "string") return node
  if (typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(getChildText).join("")
  if (node && typeof node === "object" && "props" in node) {
    return getChildText(
      (node as { props: { children?: unknown } }).props.children
    )
  }
  return ""
}

function getExternalDomain(href: string): string {
  if (!isExternalHttpHref(href)) return ""

  const url = new URL(href.startsWith("//") ? `https:${href}` : href)
  return url.hostname.replace(/^www\./, "")
}

function ExternalLinkIcon() {
  return (
    <Icon
      icon={RiArrowRightUpLine}
      data-slot="external-link-icon"
      slotSize="0.75em"
      className="ms-0.5 inline-flex align-middle leading-none"
    />
  )
}

function appendIconToText(text: string): ReactNode {
  const wordMatch = text.match(/^([\s\S]*\s)?(\S+)(\s*)$/)
  const characters = Array.from(text)

  if (
    characters.length <= 24 ||
    (wordMatch?.[1] && Array.from(wordMatch[2]).length <= 24)
  ) {
    const prefix = wordMatch?.[1] ?? ""
    const suffix = wordMatch ? `${wordMatch[2]}${wordMatch[3]}` : text

    return (
      <>
        {prefix}
        <span className="whitespace-nowrap">
          {suffix}
          <ExternalLinkIcon />
        </span>
      </>
    )
  }

  const suffix = characters.pop()
  return (
    <>
      {characters.join("")}
      <span className="whitespace-nowrap">
        {suffix}
        <ExternalLinkIcon />
      </span>
    </>
  )
}

function appendExternalIcon(children: ReactNode): ReactNode {
  const childArray = Children.toArray(children)
  const lastChild = childArray.pop()

  if (typeof lastChild === "string" || typeof lastChild === "number") {
    return (
      <>
        {childArray}
        {appendIconToText(String(lastChild))}
      </>
    )
  }

  if (
    isValidElement<{ children?: ReactNode }>(lastChild) &&
    typeof lastChild.type === "string" &&
    ["del", "em", "strong"].includes(lastChild.type) &&
    lastChild.props.children !== undefined
  ) {
    return (
      <>
        {childArray}
        {cloneElement(
          lastChild,
          undefined,
          appendExternalIcon(lastChild.props.children)
        )}
      </>
    )
  }

  return (
    <>
      {childArray}
      <span className="whitespace-nowrap">
        {lastChild}
        <ExternalLinkIcon />
      </span>
    </>
  )
}

export function LinkMarkdown({
  href,
  children,
  className,
  presentation = "inline",
  target,
  rel,
  ...props
}: LinkMarkdownProps) {
  if (!href)
    return (
      <span
        className={className}
        data-link-presentation={presentation}
        {...props}
      >
        {children}
      </span>
    )

  const isExternal = isExternalHttpHref(href)
  const resolvedTarget = isExternal ? "_blank" : target
  const resolvedRel = isExternal ? "noopener noreferrer" : rel

  if (presentation === "pill") {
    const domain = getExternalDomain(href)
    const childText = getChildText(children).trim()
    const isUrlLike =
      !childText ||
      childText === href ||
      childText === domain ||
      isExternalHttpHref(childText)

    return (
      <a
        {...props}
        href={href}
        target={resolvedTarget}
        rel={resolvedRel}
        data-link-presentation="pill"
        data-external={isExternal ? "true" : undefined}
        className={cn(
          "bg-muted text-muted-foreground hover:bg-muted-bg-hover hover:text-foreground focus-visible:ring-focus-ring inline-flex h-5 max-w-48 items-center gap-1 overflow-hidden rounded-full py-0 pr-2 pl-0.5 text-xs leading-none text-ellipsis whitespace-nowrap no-underline outline-none focus-visible:ring-3",
          className
        )}
      >
        {isExternal && (
          <span aria-hidden="true" className="inline-flex shrink-0">
            <Favicon
              url={href}
              alt=""
              className="size-3.5"
              fallback={
                <Icon
                  icon={RiGlobalLine}
                  data-slot="favicon-placeholder"
                  slotSize={14}
                  glyphInset={0}
                />
              }
              fallbackOnMissing
              loading="lazy"
              decoding="async"
            />
          </span>
        )}
        <span className="overflow-hidden leading-4 font-normal text-ellipsis whitespace-nowrap">
          {isUrlLike && domain ? domain : children}
        </span>
      </a>
    )
  }

  return (
    <a
      {...props}
      href={href}
      target={resolvedTarget}
      rel={resolvedRel}
      data-link-presentation="inline"
      data-external={isExternal ? "true" : undefined}
      className={cn(
        "text-foreground decoration-foreground/60 hover:text-link hover:decoration-link focus-visible:ring-focus-ring rounded-sm [font-weight:inherit] underline decoration-dotted underline-offset-2 outline-none hover:decoration-solid focus-visible:ring-3",
        className
      )}
    >
      {isExternal ? appendExternalIcon(children) : children}
    </a>
  )
}
