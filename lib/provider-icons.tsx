import AnthropicIcon from "@/components/icons/anthropic"
import ClaudeIcon from "@/components/icons/claude"
import DeepSeekIcon from "@/components/icons/deepseek"
import GeminiIcon from "@/components/icons/gemini"
import GLMIcon from "@/components/icons/glm"
import GoogleIcon from "@/components/icons/google"
import GrokIcon from "@/components/icons/grok"
import KimiIcon from "@/components/icons/kimi"
import LingIcon from "@/components/icons/ling"
import MetaIcon from "@/components/icons/meta"
import MiniMaxIcon from "@/components/icons/minimax"
import MistralIcon from "@/components/icons/mistral"
import NemotronIcon from "@/components/icons/nemotron"
import OpenAIIcon from "@/components/icons/openai"
import OpenRouterIcon from "@/components/icons/openrouter"
import PerplexityIcon from "@/components/icons/perplexity"
import QwenIcon from "@/components/icons/qwen"
import XaiIcon from "@/components/icons/xai"
import XiaomiIcon from "@/components/icons/xiaomi"
import type { KnownVendorId } from "@/lib/provider-identity"
import { isKnownVendorId } from "@/lib/provider-identity"

/**
 * The client-only sibling of the Provider identity module: vendor icons,
 * keyed by the same vendor ids. Kept out of `lib/provider-identity.ts` so
 * server code (key resolution, the catalog generator) never imports React
 * components.
 */
export type VendorIcon = React.ComponentType<
  React.SVGProps<SVGSVGElement> & { size?: number | string }
>

export const VENDOR_ICONS: Record<KnownVendorId, VendorIcon> = {
  openrouter: OpenRouterIcon,
  openai: OpenAIIcon,
  mistral: MistralIcon,
  deepseek: DeepSeekIcon,
  gemini: GeminiIcon,
  claude: ClaudeIcon,
  grok: GrokIcon,
  xai: XaiIcon,
  google: GoogleIcon,
  anthropic: AnthropicIcon,
  meta: MetaIcon,
  perplexity: PerplexityIcon,
  moonshotai: KimiIcon,
  "z-ai": GLMIcon,
  nvidia: NemotronIcon,
  minimax: MiniMaxIcon,
  qwen: QwenIcon,
  xiaomi: XiaomiIcon,
  inclusionai: LingIcon,
}

/**
 * Icon for an open-set vendor id. Wrapped OpenRouter models can carry real
 * vendor ids without registered icons; those fall back to the OpenRouter icon
 * (the Vendor entry's documented fallback). Accepts
 * undefined so callers with an optional icon field don't re-encode the
 * fallback this module owns.
 */
export function getVendorIcon(id: string | undefined): VendorIcon {
  return id !== undefined && isKnownVendorId(id)
    ? VENDOR_ICONS[id]
    : OpenRouterIcon
}
