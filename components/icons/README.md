# Icon System

This project uses **official Remix Icons React components** as the primary UI icon library.

## Quick Start

### Default: Remix Icons

```typescript
import { RiCheckLine, RiCloseLine } from "@remixicon/react"

// Usage
<RiCheckLine size={16} />
<RiCloseLine size={16} className="text-red-500" />
```

### Custom Brand Icons

```typescript
import ClaudeIcon from "@/components/icons/claude"
import OpenAIIcon from "@/components/icons/openai"
```

All brand icons support the `size` prop:

```tsx
<ClaudeIcon size={24} />
<OpenAIIcon size={32} className="text-primary" />
```

### Re-exported Icons (via lib/icons)

Some commonly used icons are re-exported from `@/lib/icons` for convenience:

```typescript
import {
  GripVerticalIcon,
  PanelLeftIcon,
  PinIcon,
  PinOffIcon,
} from "@/lib/icons"
```

## Creating New Custom Icons

Use the `createIcon` factory for simple path-based icons:

```typescript
import { createIcon } from "@/lib/icons"

export const MyIcon = createIcon(
  <path d="..." fill="currentColor" />,
  { viewBox: "0 0 24 24", displayName: "MyIcon" }
)
```

For complex icons with gradients/defs, use the forwardRef pattern:

```typescript
import { forwardRef, type SVGProps } from "react"

export interface MyIconProps extends SVGProps<SVGSVGElement> {
  size?: number | string
}

export const MyIcon = forwardRef<SVGSVGElement, MyIconProps>(
  ({ size = 24, width, height, ...props }, ref) => (
    <svg
      ref={ref}
      width={width ?? size}
      height={height ?? size}
      viewBox="0 0 24 24"
      {...props}
    >
      {/* SVG content */}
    </svg>
  )
)

MyIcon.displayName = "MyIcon"
export default MyIcon
```

### Common Icons Quick Reference

| Purpose     | Remix icon           |
| ----------- | -------------------- |
| Checkmark   | `RiCheckLine`        |
| Close/X     | `RiCloseLine`        |
| Arrow down  | `RiArrowDownSLine`   |
| Send/up     | `RiArrowUpLine`      |
| Arrow up    | `RiArrowUpSLine`     |
| Back arrow  | `RiArrowLeftLine`    |
| Prev arrow  | `RiArrowLeftSLine`   |
| Arrow right | `RiArrowRightSLine`  |
| Search      | `RiSearchLine`       |
| Loading     | `RiLoader4Line`      |
| Refresh     | `RiRefreshLine`      |
| Warning     | `RiErrorWarningLine` |
| Error       | `RiCloseCircleLine`  |
| Info        | `RiInformationLine`  |
| Delete      | `RiDeleteBinLine`    |
| More menu   | `RiMoreFill`         |
| Quote       | `RiDoubleQuotesL`    |
| Chat        | `RiChat3Line`        |
| Settings    | `RiSettings3Line`    |
| User        | `RiUserLine`         |
| Copy        | `RiFileCopyLine`     |
| Edit        | `RiEditLine`         |
| Add         | `RiAddLine`          |
| New chat    | `RiAddCircleLine`    |
| Share       | `RiShare2Line`       |
| Minus       | `RiSubtractLine`     |

## Available Brand Icons

- `AnthropicIcon`
- `ClaudeIcon`
- `DeepseekIcon`
- `GeminiIcon`
- `GoogleIcon`
- `GrokIcon`
- `MetaIcon`
- `MistralIcon`
- `OpenAIIcon`
- `OpenRouterIcon`
- `PerplexityIcon`
- `XaiIcon`
- `XIcon` (X/Twitter logo)
- `ZolaIcon`

## Notes

Use line variants for most UI icons. Use fill variants only when the design calls for a filled glyph.
