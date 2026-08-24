import { useSyncExternalStore } from "react"

/**
 * ChatGPT-parity mobile-OS detection (their fastTools gate, decompiled
 * 2026-08-24 — see reference-ui/ChatGPT/components/chat-composer/
 * chatgpt-plus-menu-touch-optimized-2026-08-24.md). The touch-optimized
 * composer menu keys on the USER AGENT OS, not pointer coarseness: a narrow
 * desktop window keeps the compact fine-pointer popover, while an iPhone,
 * Android device, or DevTools mobile emulation (which swaps the UA) gets the
 * icon-chip treatment. Includes their iPadOS-as-Mac case.
 */
function isMobileDeviceOs() {
  if (typeof navigator === "undefined") return false
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) ||
    /Android/.test(navigator.userAgent)
  )
}

const subscribe = () => () => {}
const getServerSnapshot = () => false

function useIsMobileDeviceOs() {
  return useSyncExternalStore(subscribe, isMobileDeviceOs, getServerSnapshot)
}

export { isMobileDeviceOs, useIsMobileDeviceOs }
