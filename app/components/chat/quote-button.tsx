import { Button } from "@/components/ui/button"
import { SelectionAction } from "@/components/ui/selection-action"

type QuoteButtonProps = {
  container: HTMLElement
  onQuote: () => void
  range: Range
}

export function QuoteButton({ container, onQuote, range }: QuoteButtonProps) {
  return (
    <SelectionAction container={container} range={range}>
      <Button
        type="button"
        onClick={onQuote}
        className="bg-popover text-popover-foreground hover:bg-popover-bg-hover shadow-border-md h-9 rounded-[12px] px-3 text-sm"
      >
        Add to chat
      </Button>
    </SelectionAction>
  )
}
