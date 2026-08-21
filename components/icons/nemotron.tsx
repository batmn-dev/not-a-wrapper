import { forwardRef, type SVGProps } from "react"

import { cn } from "@/lib/utils"

export type NemotronIconProps = {
  size?: number | string
} & SVGProps<SVGSVGElement>

export const NemotronIcon = forwardRef<SVGSVGElement, NemotronIconProps>(
  ({ size = 24, width, height, className, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={width ?? size}
      height={height ?? size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={cn("text-nvidia-logo", className)}
      {...props}
    >
      <path d="M2.453 10.719S4.62 7.518 8.955 7.187v-1.161C4.155 6.41 0 10.475 0 10.475s2.355 6.804 8.955 7.428v-1.236c-4.845-.609-6.503-5.948-6.503-5.948M8.955 14.213v1.13c-3.66-.653-4.677-4.458-4.677-4.458S6.035 8.937 8.955 8.621v1.242h-.006c-1.532-.185-2.73 1.245-2.73 1.245s.672 2.411 2.736 3.105M9 3l-.045 3.026A10.5 10.5 0 0 1 9.378 6c5.456-.185 9.011 4.475 9.011 4.475s-4.083 4.965-8.336 4.965q-.585-.003-1.098-.098v1.325q.438.059.915.06c3.957 0 6.819-2.022 9.591-4.415.461.369 2.342 1.263 2.729 1.656-2.636 2.205-8.778 3.986-12.26 3.986a10.5 10.5 0 0 1-.975-.051V21H24l.045-18zm-.045 5.621v-1.434a9 9 0 0 1 .423-.023c3.924-.123 6.498 3.372 6.498 3.372S13.095 14.397 10.115 14.397c-.429 0-.813-.069-1.16-.185v-4.35c1.527.185 1.835.858 2.753 2.39L13.751 10.53s-1.491-1.956-4.005-1.956a7.5 7.5 0 0 0-.791.047" />
    </svg>
  )
)

NemotronIcon.displayName = "NemotronIcon"

export default NemotronIcon
