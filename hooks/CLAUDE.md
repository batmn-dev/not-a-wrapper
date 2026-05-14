# Hooks Context

Root `hooks/` is for small utilities reused across unrelated features.

Current hooks:

- `use-mobile.ts`: responsive breakpoint state.
- `useClickOutside.tsx`: outside-click detection for a referenced element.

Keep feature-specific hooks near their feature, such as `app/components/chat/`. Add a hook here only when it is genuinely shared.
