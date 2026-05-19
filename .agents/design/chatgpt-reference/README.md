# ChatGPT Reference

Compact reference set for reproducing ChatGPT-like UI from copied HTML. Start here instead of loading the raw CSS archive.

## Which File To Load

| Task | Load |
| --- | --- |
| Global colors, typography, radii, shadows | `chatgpt-design-tokens.md` |
| Quick CSS/token summary | `chatgpt-css.md` |
| Prompt input / composer | `prompt-input/chatgpt-prompt-styles-reference.md` plus prompt HTML examples |
| Sidebar | `sidebar/chatgpt-styles-reference.md` plus expanded/collapsed HTML examples |
| Conversation and message body | `chatgpt-conversation-styles-reference.md` plus conversation HTML examples |
| DOM shape before styling | `chatgpt-conversation-html-structure.md` |
| Exhaustive token lookup | `raw/chatgpt-css-exhaustive-2026-05-18.md` |

## Agent Guidance

- Load the smallest matching component reference first.
- Use `chatgpt-css.md` for high-signal light/dark tokens and live computed composer metrics.
- Use copied HTML examples for structure and class evidence, but map styles into this repo's components and tokens.
- Do not start with `raw/chatgpt-css-exhaustive-2026-05-18.md`; it is a traceability archive with thousands of generated variables.

## Current Coverage

- Light/dark semantic color tokens.
- Prompt composer layout, radius, shadow, sticky behavior, and textarea metrics.
- Sidebar surface, item, hover, and collapsed/expanded reference HTML.
- Conversation/message shell, typography, prose rules, message surfaces, and responsive width guidance.

## Capture Notes

- Latest cleanup capture: 2026-05-18 from `https://chatgpt.com/`.
- Chrome live computed metrics were captured from the dark rendered ChatGPT home/composer state.
- Light/dark token pairs were parsed from the loaded ChatGPT CSS assets without changing the user's ChatGPT theme preference.
