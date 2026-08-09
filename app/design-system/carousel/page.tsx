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
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel"
import type { Metadata } from "next"

const defaultCode = `import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel"

export function CarouselDefault() {
  return (
    <Carousel className="w-full max-w-48">
      <CarouselContent>
        {[1, 2, 3, 4, 5].map((slide) => (
          <CarouselItem key={slide}>
            <div className="flex aspect-square items-center justify-center rounded-xl border text-2xl font-semibold">
              {slide}
            </div>
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious />
      <CarouselNext />
    </Carousel>
  )
}`

const sizesCode = `import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel"

export function CarouselSizes() {
  return (
    <Carousel opts={{ align: "start" }} className="w-full max-w-64">
      <CarouselContent>
        {[1, 2, 3, 4, 5].map((slide) => (
          <CarouselItem key={slide} className="basis-1/3">
            <div className="flex aspect-square items-center justify-center rounded-xl border text-lg font-semibold">
              {slide}
            </div>
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious />
      <CarouselNext />
    </Carousel>
  )
}`

const apiRows = [
  {
    prop: "opts",
    type: "EmblaOptionsType",
    defaultValue: "—",
    description:
      "Embla options forwarded to useEmblaCarousel, e.g. align, loop, dragFree.",
  },
  {
    prop: "plugins",
    type: "EmblaPluginType[]",
    defaultValue: "—",
    description: "Embla plugins such as Autoplay, forwarded untouched.",
  },
  {
    prop: "orientation",
    type: '"horizontal" | "vertical"',
    defaultValue: '"horizontal"',
    description:
      "Scroll axis. Also repositions the previous/next buttons and item spacing.",
  },
  {
    prop: "setApi",
    type: "(api: CarouselApi) => void",
    defaultValue: "—",
    description:
      "Receives the Embla API once ready, for slide counters or programmatic scrolls.",
  },
  {
    prop: "CarouselItem className",
    type: "string",
    defaultValue: "—",
    description:
      "Items default to basis-full; set a basis fraction (e.g. basis-1/3) to show several per view.",
  },
] as const

export const metadata: Metadata = {
  title: "Carousel | Design System",
  description:
    "Embla-powered carousel with previous/next controls and arrow-key navigation.",
}

export default function CarouselPage() {
  const carouselSource = readComponentSource("components/ui/carousel.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="carousel"
        title="Carousel"
        description="Embla-powered slide carousel with previous/next controls, arrow-key navigation, and horizontal or vertical orientation."
      />

      <DsSection
        id="default"
        title="Default"
        description="One slide per view. The previous/next buttons float outside the track and disable themselves at each end; arrow keys scroll while the carousel has focus."
      >
        <ComponentPreview code={defaultCode} sourceCode={carouselSource}>
          <Carousel className="w-full max-w-48">
            <CarouselContent>
              {[1, 2, 3, 4, 5].map((slide) => (
                <CarouselItem key={slide}>
                  <div className="flex aspect-square items-center justify-center rounded-xl border text-2xl font-semibold">
                    {slide}
                  </div>
                </CarouselItem>
              ))}
            </CarouselContent>
            <CarouselPrevious />
            <CarouselNext />
          </Carousel>
        </ComponentPreview>
      </DsSection>

      <DsSection
        id="sizes"
        title="Item sizes"
        description="Items default to basis-full; give CarouselItem a smaller basis to show several slides per view."
      >
        <ComponentPreview code={sizesCode} sourceCode={carouselSource}>
          <Carousel opts={{ align: "start" }} className="w-full max-w-64">
            <CarouselContent>
              {[1, 2, 3, 4, 5].map((slide) => (
                <CarouselItem key={slide} className="basis-1/3">
                  <div className="flex aspect-square items-center justify-center rounded-xl border text-lg font-semibold">
                    {slide}
                  </div>
                </CarouselItem>
              ))}
            </CarouselContent>
            <CarouselPrevious />
            <CarouselNext />
          </Carousel>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[22, 26, 14, 38]} rows={apiRows} />
        <DsParagraph className="mt-3">
          CarouselContent, CarouselItem, CarouselPrevious, and CarouselNext
          forward standard div/Button props. useCarousel exposes the same
          context (api, scrollPrev/scrollNext, canScrollPrev/canScrollNext) to
          custom controls inside a Carousel.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
