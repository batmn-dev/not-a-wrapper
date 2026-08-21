import { forwardRef, type SVGProps } from "react"

export type GoogleIconProps = {
  size?: number | string
} & SVGProps<SVGSVGElement>

export const GoogleIcon = forwardRef<SVGSVGElement, GoogleIconProps>(
  ({ size = 24, width, height, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={width ?? size}
      height={height ?? size}
      viewBox="0 0 268.1522 273.8827"
      fill="none"
      {...props}
    >
      <image
        href="/provider-logos/google-logo.svg"
        width="268.1522"
        height="273.8827"
      />
    </svg>
  )
)

GoogleIcon.displayName = "GoogleIcon"

export default GoogleIcon
