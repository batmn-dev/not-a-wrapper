import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/utils"
import { RiAppleFill, RiPhoneLine } from "@remixicon/react"

const providers = [
  {
    name: "Google",
    label: "Continue with Google",
    icon: <GoogleMark />,
  },
  {
    name: "Apple",
    label: "Continue with Apple",
    icon: <Icon icon={RiAppleFill} slotSize={20} />,
  },
  {
    name: "Phone",
    label: "Continue with phone",
    icon: <Icon icon={RiPhoneLine} slotSize={20} glyphSize={24} />,
  },
] as const

export type AuthProviderName = (typeof providers)[number]["name"]

export function AuthProviderOptions({
  buttonClassName,
  onUnavailable,
}: {
  buttonClassName: string
  onUnavailable: (provider: AuthProviderName) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      {providers.map((provider) => (
        <Button
          className={cn(
            "border-border bg-background hover:bg-muted/50 w-full gap-2 rounded-full border text-base font-medium shadow-none",
            buttonClassName
          )}
          key={provider.name}
          onClick={() => onUnavailable(provider.name)}
          type="button"
          variant="outline"
        >
          <span className="grid size-5 place-items-center">
            {provider.icon}
          </span>
          <span>{provider.label}</span>
        </Button>
      ))}
    </div>
  )
}

export function AuthProviderStatus({ message }: { message: string | null }) {
  return message ? (
    <p role="status" className="text-muted-foreground text-center text-sm">
      {message}
    </p>
  ) : null
}

export function AuthProviderDivider({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "grid grid-cols-[1fr_max-content_1fr] items-center",
        className
      )}
    >
      <div className="bg-border h-px" />
      <div className="mx-6 text-[13px] font-medium">OR</div>
      <div className="bg-border h-px" />
    </div>
  )
}

function GoogleMark() {
  return (
    <svg
      aria-hidden="true"
      width={18}
      height={18}
      viewBox="0 0 18 18"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.56 2.69-3.87 2.69-6.62Z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.8.54-1.84.86-3.05.86a5.38 5.38 0 0 1-5.06-3.72H.93v2.33A9 9 0 0 0 9 18Z"
        fill="#34A853"
      />
      <path
        d="M3.94 10.7A5.41 5.41 0 0 1 3.66 9c0-.59.1-1.16.28-1.7V4.97H.93A9 9 0 0 0 0 9c0 1.45.34 2.82.93 4.03l3.01-2.33Z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A8.65 8.65 0 0 0 9 0 9 9 0 0 0 .93 4.97L3.94 7.3A5.38 5.38 0 0 1 9 3.58Z"
        fill="#EA4335"
      />
    </svg>
  )
}
