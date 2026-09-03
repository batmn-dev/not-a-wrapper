// The Chat surface is mounted by the persistent (chat)/layout.tsx — see its
// header comment (adoption-loss fix). Chat identity is client-minted and the
// same for guests and signed-in users (ADR-0033), so this segment cannot tell
// a guest's local chat from a durable one; the mounted Chat resolves the id
// against the caller's own store and renders not-found when nothing answers.
export default function Page() {
  return null
}
