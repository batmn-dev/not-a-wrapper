export const MAX_PROJECT_NAME_LENGTH = 50

export const PROJECT_NAME_REQUIRED_MESSAGE = "Project name is required."

export const PROJECT_NAME_TOO_LONG_MESSAGE = `Project names cannot be longer than ${MAX_PROJECT_NAME_LENGTH} characters.`

/**
 * The one project-name rule, shared by the create dialog and the Convex
 * mutations: names are trimmed, and the trimmed value must be non-empty and
 * within the limit. Throws so server callers reject blank or over-long names.
 */
export function normalizeProjectName(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length === 0) {
    throw new Error(PROJECT_NAME_REQUIRED_MESSAGE)
  }
  if (trimmed.length > MAX_PROJECT_NAME_LENGTH) {
    throw new Error(PROJECT_NAME_TOO_LONG_MESSAGE)
  }
  return trimmed
}
