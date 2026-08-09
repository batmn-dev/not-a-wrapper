import { ButtonCopy } from "@/components/ui/button-copy"

export function ButtonCopyDemo() {
  return (
    <div className="flex items-center gap-6">
      <ButtonCopy code="bun add @base-ui/react" />
      <ButtonCopy code="npx create-next-app@latest" label="Copy command" />
    </div>
  )
}
