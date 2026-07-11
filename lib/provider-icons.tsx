import AnthropicIcon from "@/components/icons/anthropic"
import ClaudeIcon from "@/components/icons/claude"
import DeepSeekIcon from "@/components/icons/deepseek"
import GeminiIcon from "@/components/icons/gemini"
import GoogleIcon from "@/components/icons/google"
import GrokIcon from "@/components/icons/grok"
import MetaIcon from "@/components/icons/meta"
import MistralIcon from "@/components/icons/mistral"
import OpenAIIcon from "@/components/icons/openai"
import OpenRouterIcon from "@/components/icons/openrouter"
import PerplexityIcon from "@/components/icons/perplexity"
import XaiIcon from "@/components/icons/xai"
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
}

/**
 * Icon for an open-set vendor id. Wrapped OpenRouter models carry real vendor
 * ids without registered icons (qwen, z-ai, moonshotai, …) — those fall back
 * to the OpenRouter icon (the Vendor entry's documented fallback).
 */
export function getVendorIcon(id: string): VendorIcon {
  return isKnownVendorId(id) ? VENDOR_ICONS[id] : OpenRouterIcon
}
