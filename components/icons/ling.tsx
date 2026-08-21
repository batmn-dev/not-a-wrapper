import { forwardRef, type SVGProps } from "react"

export type LingIconProps = {
  size?: number | string
} & SVGProps<SVGSVGElement>

export const LingIcon = forwardRef<SVGSVGElement, LingIconProps>(
  ({ size = 24, width, height, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={width ?? size}
      height={height ?? size}
      viewBox="0 0 97 58"
      fill="currentColor"
      {...props}
    >
      <g transform="translate(0,58) scale(0.05,-0.05)">
        <path d="M790 1127 c-23 -23 -30 -52 -22 -91 9 -44 -3 -77 -50 -142 -57 -79 -61 -94 -54 -233 l6 -148 -327 -232 -328 -231 776 -5 c426 -3 778 -2 782 2 4 4 5 252 2 550 l-5 544 -220 -153 c-121 -84 -262 -184 -314 -221 l-94 -69 -28 96 c-27 90 -26 97 9 110 20 8 38 26 38 40 1 14 5 59 8 99 9 104 -106 157 -179 84z m625 -340 c25 -6 45 -23 45 -36 0 -32 -96 -121 -113 -105 -27 27 -65 -30 -55 -83 8 -40 -6 -72 -55 -131 -36 -44 -68 -92 -70 -107 -2 -16 -16 -43 -32 -62 -15 -18 -38 -58 -51 -88 -13 -30 -34 -55 -47 -55 -13 0 -40 -15 -60 -33 -35 -32 -37 -30 -37 39 0 54 10 74 40 84 42 13 54 59 20 80 -61 37 12 315 85 322 67 6 112 37 137 94 17 37 49 68 78 76 69 19 65 19 115 5z" />
        <path d="M1640 600 l0 -560 140 0 140 0 0 560 0 560 -140 0 -140 0 0 -560z" />
      </g>
    </svg>
  )
)

LingIcon.displayName = "LingIcon"

export default LingIcon
