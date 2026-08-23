import { forwardRef, type ReactNode, type SVGProps } from "react"

export type CustomIconProps = {
  /** Icon size in pixels. Sets both width and height. @default 24 */
  size?: number | string
} & SVGProps<SVGSVGElement>

type CreateIconOptions = {
  /** SVG viewBox attribute @default "0 0 24 24" */
  viewBox?: string
  /** Default width and height when the caller does not provide `size`. @default 24 */
  defaultSize?: number | string
  /** Display name for React DevTools */
  displayName: string
}

/**
 * Factory function to create consistent custom SVG icons.
 * Matches Phosphor's API (size prop, ref forwarding).
 */
export function createIcon(path: ReactNode, options: CreateIconOptions) {
  const { viewBox = "0 0 24 24", defaultSize = 24, displayName } = options

  const Icon = forwardRef<SVGSVGElement, CustomIconProps>(
    ({ size = defaultSize, width, height, ...props }, ref) => (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        viewBox={viewBox}
        width={width ?? size}
        height={height ?? size}
        fill="none"
        {...props}
      >
        {path}
      </svg>
    )
  )

  Icon.displayName = displayName
  return Icon
}
