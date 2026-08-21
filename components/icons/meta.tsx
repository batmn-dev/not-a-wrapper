import { forwardRef, type SVGProps } from "react"

export type MetaIconProps = {
  size?: number | string
} & SVGProps<SVGSVGElement>

export const MetaIcon = forwardRef<SVGSVGElement, MetaIconProps>(
  ({ size = 24, width, height, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={width ?? size}
      height={height ?? size}
      viewBox="0 0 48 32"
      fill="none"
      {...props}
    >
      <image href="/provider-logos/meta-logo.svg" width="48" height="32" />
    </svg>
  )
)

MetaIcon.displayName = "MetaIcon"

export default MetaIcon
