type ShareNavigator = {
  canShare?: (data?: ShareData) => boolean
  share?: (data?: ShareData) => Promise<void>
}

export type ShareTargetOutcome =
  "shared" | "dismissed" | "unsupported" | "failed"

function getShareNavigator(): ShareNavigator | undefined {
  return typeof navigator === "undefined"
    ? undefined
    : (navigator as ShareNavigator)
}

function isDismissal(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  )
}

/**
 * Attempts one browser-native share. Unsupported capability and operational
 * failure are distinct so callers can present their existing custom surface;
 * user dismissal is terminal and must not reopen a fallback behind the sheet.
 */
export async function shareTarget(
  target: ShareData
): Promise<ShareTargetOutcome> {
  const shareNavigator = getShareNavigator()
  if (!shareNavigator?.share) return "unsupported"

  try {
    if (shareNavigator.canShare && !shareNavigator.canShare(target)) {
      return "unsupported"
    }
  } catch {
    return "unsupported"
  }

  try {
    await shareNavigator.share(target)
    return "shared"
  } catch (error) {
    return isDismissal(error) ? "dismissed" : "failed"
  }
}
