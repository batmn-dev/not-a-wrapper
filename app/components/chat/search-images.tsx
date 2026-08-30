import { Favicon } from "@/components/ui/favicon"
import { resolveSourceLinkDestination } from "@/lib/url-safety"
import Image from "next/image"
import { useState } from "react"

type ImageResult = {
  title: string
  imageUrl: string
  sourceUrl: string
}

export function SearchImages({ results }: { results: ImageResult[] }) {
  const [hiddenIndexes, setHiddenIndexes] = useState<Set<number>>(new Set())

  const handleError = (index: number) => {
    setHiddenIndexes((prev) => new Set(prev).add(index))
  }

  if (!results?.length) return null

  return (
    <div className="my-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
      {results.map((img, i) => {
        if (hiddenIndexes.has(i)) return null

        const destination = resolveSourceLinkDestination(img.sourceUrl)
        const content = (
          <>
            <Image
              src={img.imageUrl}
              alt={img.title}
              onError={() => handleError(i)}
              onLoad={(e) => e.currentTarget.classList.remove("opacity-0")}
              className="h-full max-h-48 min-h-40 w-full object-cover opacity-0 transition-opacity duration-150 ease-out"
            />
            <div className="bg-primary absolute right-0 bottom-0 left-0 flex flex-col gap-0.5 px-2.5 py-1.5 opacity-0 transition-opacity duration-100 ease-out group-hover/image:opacity-100">
              <div className="flex items-center gap-1">
                <Favicon
                  url={img.sourceUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
                <span className="text-secondary line-clamp-1 text-xs">
                  {destination?.url.hostname.replace(/^www\./, "") ??
                    img.sourceUrl}
                </span>
              </div>
              <span className="text-secondary line-clamp-1 text-xs">
                {img.title}
              </span>
            </div>
          </>
        )

        const className =
          "group/image relative block overflow-hidden rounded-xl"

        return destination ? (
          <a
            key={i}
            href={destination.href}
            target={destination.target}
            rel={destination.rel}
            className={className}
          >
            {content}
          </a>
        ) : (
          <div key={i} className={className}>
            {content}
          </div>
        )
      })}
    </div>
  )
}
