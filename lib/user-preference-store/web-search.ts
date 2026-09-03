import { defaultPreferences } from "./utils"

export function resolveWebSearchEnabled(value: boolean | undefined): boolean {
  return value ?? defaultPreferences.webSearchEnabled
}

export function persistWebSearchToggle(
  enabled: boolean,
  setEnableSearch: (enabled: boolean) => void,
  persistPreference: (enabled: boolean) => void
) {
  setEnableSearch(enabled)
  persistPreference(enabled)
}
