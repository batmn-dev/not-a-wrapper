export const LARGE_PASTE_CHARACTER_THRESHOLD = 10_000

export type ComposerPasteDecision =
  | { type: "allow-native-text" }
  | { type: "attach-images"; files: File[] }
  | { type: "attach-large-paste"; text: string }
  | { type: "reject"; message: string }

type ComposerPasteInput = {
  text: string
  imageFiles: File[]
  isAuthenticated: boolean
}

/**
 * One policy for every Composer paste. Image/file paste retains priority over
 * text, while long plain text becomes a recoverable generated attachment.
 *
 * ChatGPT's current genuine-clipboard boundary is inclusive: 9,999 characters
 * stay inline and exactly 10,000 characters become a generated attachment.
 */
export function coordinateComposerPaste({
  text,
  imageFiles,
  isAuthenticated,
}: ComposerPasteInput): ComposerPasteDecision {
  if (imageFiles.length > 0) {
    if (!isAuthenticated) {
      return {
        type: "reject",
        message: "Sign in to paste images.",
      }
    }
    return { type: "attach-images", files: imageFiles }
  }

  if (text.length >= LARGE_PASTE_CHARACTER_THRESHOLD) {
    return { type: "attach-large-paste", text }
  }

  return { type: "allow-native-text" }
}
