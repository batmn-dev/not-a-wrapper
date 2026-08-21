import { forwardRef, type SVGProps } from "react"

export type KimiIconProps = {
  size?: number | string
} & SVGProps<SVGSVGElement>

export const KimiIcon = forwardRef<SVGSVGElement, KimiIconProps>(
  ({ size = 24, width, height, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={width ?? size}
      height={height ?? size}
      viewBox="0 0 24 24"
      fill="currentColor"
      {...props}
    >
      <path d="M18.77 6.554c.143-.183.269-.35.4-.512.062-.076.057-.134-.003-.213-.573-.754-.627-1.59-.297-2.439.247-.639.795-.938 1.464-1.002.418-.04.827.004 1.207.207.499.267.79.673.884 1.235.075.448.061.886-.066 1.32-.225.768-.777 1.166-1.534 1.267-.628.084-1.265.094-1.898.137-.05.004-.1 0-.156 0M17.217 3.113h-3.785l-2.997 6.834H6.198V3.143H2.812V20.75H6.2v-7.417h5.97a2.65 2.65 0 0 0 2.4-1.532v8.949h3.387v-7.417a3.386 3.386 0 0 0-3.14-3.378v-.009h-1.859a3.45 3.45 0 0 0 2.033-1.855z" />
    </svg>
  )
)

KimiIcon.displayName = "KimiIcon"

export default KimiIcon
