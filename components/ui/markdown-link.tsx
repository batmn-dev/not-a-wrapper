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

export function LinkMarkdown({
  href,
  children,
  ...props
}: React.ComponentProps<"a">) {
  if (!href) return <span {...props}>{children}</span>

  let domain = ""
  try {
    const url = new URL(href)
    domain = url.hostname
  } catch {
    domain = href.split("/").pop() || href
  }

  const cleanDomain = domain.replace("www.", "")
  const childText = getChildText(children).trim()
  const isUrlLike =
    !childText ||
    childText === href ||
    childText === domain ||
    childText === cleanDomain ||
    /^https?:\/\//.test(childText)

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="bg-muted text-muted-foreground hover:bg-muted-foreground/30 hover:text-primary inline-flex h-5 max-w-48 items-center gap-1 overflow-hidden rounded-full py-0 pr-2 pl-0.5 text-xs leading-none overflow-ellipsis whitespace-nowrap no-underline transition-colors duration-150"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- Dynamic external favicon, optimization not beneficial */}
      <img
        src={`https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(href)}`}
        alt="favicon"
        width={14}
        height={14}
        className="size-3.5 rounded-full"
      />
      <span className="overflow-hidden font-normal text-ellipsis whitespace-nowrap">
        {isUrlLike ? cleanDomain : childText}
      </span>
    </a>
  )
}
