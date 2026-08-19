import { forwardRef, type SVGProps } from "react"

export type GeminiIconProps = {
  size?: number | string
} & SVGProps<SVGSVGElement>

export const GeminiIcon = forwardRef<SVGSVGElement, GeminiIconProps>(
  ({ size = 24, width, height, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={width ?? size}
      height={height ?? size}
      viewBox="0 0 192 192"
      fill="none"
      {...props}
    >
      <image
        href="/provider-logos/gemini-logo.svg"
        width="192"
        height="192"
      />
    </svg>
  )
)

GeminiIcon.displayName = "GeminiIcon"

export default GeminiIcon
