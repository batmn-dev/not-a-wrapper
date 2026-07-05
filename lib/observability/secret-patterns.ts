/**
 * Canonical secret-value detector shared by every telemetry scrubber.
 *
 * Key-name / path-based redaction (redact the value when the *field* is called
 * `authorization`, `apiKey`, …) misses a secret that lands inside a free-text
 * string at an innocuous path — the classic case being a provider SDK's 401
 * whose message echoes the credential ("Incorrect API key provided: sk-…"),
 * captured into `event.exception.values[].value`. That string is not under a
 * sensitive key, so name-based scrubbing never touches it.
 *
 * This module owns the one pattern that recognizes credential-*shaped* strings
 * so Sentry, Braintrust, and any future sink redact the same shapes instead of
 * each maintaining a drifting copy.
 */

const REDACTED = "[REDACTED]"

/**
 * Matches common API-key / token shapes by their public prefix, optionally
 * behind a `Bearer ` scheme. Covers the providers this app brokers BYOK keys
 * for and a few ubiquitous cloud credentials:
 *
 * - `sk-…`, `sk-ant-…`, `sk-or-…`, `sk-proj-…` — OpenAI / Anthropic / OpenRouter
 * - `fc-…` — Firecrawl
 * - `ghp_…` / `gho_…` / `ghu_…` / `ghs_…` / `ghr_…` — GitHub tokens (underscore)
 * - `xox[baprs]-…` — Slack tokens
 * - `bt-…` — Braintrust
 * - `AKIA…` — AWS access key id
 * - `AIza…` — Google API key
 *
 * The prefix is followed by `-` or `_` (GitHub uses `_`, the rest `-`) and an
 * `{8,}` body, which keeps this off short dashed identifiers (uuids split on `-`,
 * css class fragments, etc.), so false positives on real telemetry are rare.
 *
 * Stateful (`g`) — callers using `.test()` in a loop must reset `lastIndex`, or
 * call the provided helpers which build a fresh regex per invocation.
 */
export function buildSecretValueRegex(): RegExp {
  return /\b(?:Bearer\s+)?(?:bt|fc|gh[pousr]|sk|xox[baprs]?)[-_][A-Za-z0-9_-]{8,}\b|\bAKIA[0-9A-Z]{16}\b|\bAIza[0-9A-Za-z_-]{35}\b/g
}

/** True if the string contains anything shaped like a credential. */
export function containsSecret(value: string): boolean {
  return buildSecretValueRegex().test(value)
}

/**
 * Replace every credential-shaped run in a string with `[REDACTED]`, leaving
 * surrounding text intact so the message stays useful for debugging.
 */
export function redactSecretsInString(value: string): string {
  return value.replace(buildSecretValueRegex(), REDACTED)
}
