import { forwardRef, type SVGProps } from "react"

export type XiaomiIconProps = {
  size?: number | string
} & SVGProps<SVGSVGElement>

export const XiaomiIcon = forwardRef<SVGSVGElement, XiaomiIconProps>(
  ({ size = 24, width, height, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={width ?? size}
      height={height ?? size}
      viewBox="0 0 48 31"
      fill="oklch(0.699627 0.201959 44.4414)"
      {...props}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M21.231 30.503C21.231 30.7747 21.0047 31 20.7292 31H13.8985C13.6182 31 13.3909 30.7747 13.3909 30.503V12.4465C13.3909 12.1724 13.6182 11.9482 13.8985 11.9482H20.7292C21.0047 11.9482 21.231 12.1724 21.231 12.4465V30.503Z"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M34.6053 30.503C34.6053 30.7747 34.378 31 34.1014 31H27.5994C27.3205 31 27.0932 30.7747 27.0932 30.503V14.9242C27.0864 12.2043 26.9326 9.40878 25.5434 8.00376C24.349 6.79268 22.1217 6.51521 19.8047 6.45697H8.01839C7.74024 6.45697 7.51553 6.68306 7.51553 6.955V30.503C7.51553 30.7747 7.28612 31 7.00797 31H0.501557C0.223667 31 0 30.7747 0 30.503V0.499345C0 0.22398 0.223667 0 0.501557 0H19.2734C24.1795 0 29.3082 0.226091 31.8376 2.78632C34.378 5.35789 34.6053 10.5329 34.6053 15.4976V30.503Z"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M48 30.503C48 30.7747 47.7703 31 47.4948 31H40.9894C40.7115 31 40.4855 30.7747 40.4855 30.503V0.499345C40.4855 0.22398 40.7115 0 40.9894 0H47.4948C47.7703 0 48 0.22398 48 0.499345V30.503Z"
      />
    </svg>
  )
)

XiaomiIcon.displayName = "XiaomiIcon"

export default XiaomiIcon
