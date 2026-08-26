import { Pin, PinFilled, PinOff, PinOffOutline } from "@/lib/icons"

type PinActionGlyphProps = {
  pinned: boolean
  slotSize?: number | string
}

/** Shared outline-to-filled pin glyph behavior for compact row actions. */
export function PinActionGlyph({ pinned, slotSize = 20 }: PinActionGlyphProps) {
  return pinned ? (
    <>
      <PinOffOutline
        slotSize={slotSize}
        className="absolute group-hover/pin:opacity-0 group-focus-visible/pin:opacity-0"
      />
      <PinOff
        slotSize={slotSize}
        className="absolute opacity-0 group-hover/pin:opacity-100 group-focus-visible/pin:opacity-100"
      />
    </>
  ) : (
    <>
      <Pin
        slotSize={slotSize}
        className="absolute group-hover/pin:opacity-0 group-focus-visible/pin:opacity-0"
      />
      <PinFilled
        slotSize={slotSize}
        className="absolute opacity-0 group-hover/pin:opacity-100 group-focus-visible/pin:opacity-100"
      />
    </>
  )
}
