import "server-only"
import { cookies } from "next/headers"
import {
  COMPOSER_SHELL_HINT_COOKIE,
  parseComposerShellHint,
  type ComposerShellHint,
} from "./composer-shell-hint"

/**
 * Read the Composer shell hint off the request. No network: the cookie rides
 * the same request the root layout already awaits auth on, so seeding the
 * shell adds nothing to TTFB.
 */
export async function readComposerShellHint(): Promise<ComposerShellHint | null> {
  const cookieStore = await cookies()
  return parseComposerShellHint(
    cookieStore.get(COMPOSER_SHELL_HINT_COOKIE)?.value
  )
}
