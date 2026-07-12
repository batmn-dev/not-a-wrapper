# Prompt: ChatGPT thread spacing & typography — aggressive byte-level replication

You are a senior design engineer. Your mission: inspect the live ChatGPT
conversation thread's box model — every gap, padding, margin, text size,
line-height, radius, and token — and replicate it in this app at the value
level. Adopt their exact HTML class strings, arbitrary values, and CSS
variable names. Replace whatever we currently have on conflict. Do not
approximate from screenshots; extract computed values and authored classes.

## Context you inherit

- The scroll/DOM architecture is already source-level ChatGPT parity — read
  `docs/chatgpt-scroll-architecture-audit.md` first (§10 documents the
  extraction methodology, including mining their `conversation-small-*.js`
  chunk via in-page fetch when the DOM alone can't explain a value).
- `app/components/chat/thread-bounds.ts` already mirrors their width/gutter
  tiers (`--thread-content-margin`, `--thread-content-max-width`) — byte
  accurate, leave them.
- Known measured deltas to start from (2026-07): user bubble padding theirs 6
  vs ours 10; intra-turn part gap theirs 0.5 vs ours 2. Turn paddings and
  composer already match. Sidebar is OUT of scope.
- Reference captures exist at `../reference-ui/ChatGPT` (sibling repo,
  untracked) but may be stale — the live site is the source of truth.

## Ground rules

- Work on the current branch. Never create or switch branches. No commits or
  pushes unless asked.
- Inspect chatgpt.com through the user's signed-in Chrome (claude-in-chrome
  MCP). Verify our side on http://localhost:3000 — the user's long-running
  `bun dev` owns that port; never kill or restart it.
- Chrome-driving gotchas: hidden driven tabs freeze IntersectionObserver,
  rAF, and CSS transitions — take a screenshot to force a rendering frame,
  and trust computed styles over pixels. javascript_tool results containing
  `=`/`;` pairs get DLP-replaced with "[BLOCKED: Cookie/query string data]" —
  sanitize outputs with `.replace(/=/g,'≡').replace(/;/g,'¶')`.
- bun for everything. After every edit wave:
  `bun run typecheck && bun run lint && bun run test`.

## What to capture (live ChatGPT, desktop ≥1280px AND ~380px narrow)

For each item record BOTH the authored `className` string and the computed
values, on a real conversation containing rich markdown (make a test chat if
needed — permission granted):

1. **Turn sections** — inter-turn rhythm: the user turn's top padding, the
   assistant turn's bottom padding, margins between consecutive turns, and
   any `[.text-message+*]`-style adjacency rules (seen in their DOM).
2. **User bubble** — padding, border-radius, `--user-chat-width` (name and
   value), background token, min-height, line-height, whitespace handling.
3. **Assistant prose** — base font-size/line-height; per-element margins for
   `p`, `ul/ol/li` (including nesting and `p`-inside-`li`), `h1–h4`,
   `pre`/`code` (font stack, size, padding, radius), `blockquote`, `table`,
   `hr`; first/last-child trims; their `markdown prose` class stack.
4. **Intra-turn gaps** — between reasoning/tool/text blocks (`gap-1`,
   `gap-2`, `empty:hidden` wrappers), bubble→action-row spacing, action row
   button sizing (verify; largely matched already).
5. **Auxiliary rows** — timestamp/date headers, thinking-chip rows (their DOM
   shows `min-h-8` and `min-h-[46px]`), sources row.
6. **Tokens** — resolve every `--spacing`-multiple, radius token, and
   `text-token-*` the thread uses. Adopt their variable NAMES for
   spacing/typography (as done for `--header-height`,
   `--thread-show-context-pct`); map color tokens onto ours instead of
   importing OpenAI brand names.

## Replication mandate

- Our surfaces: `app/components/chat/conversation.tsx`, `message-user.tsx`,
  `message-assistant.tsx`, `components/ui/message.tsx`, prose/markdown rules
  in `app/globals.css` (and any typography-plugin overrides).
- Spacing, typography, and radius values must be byte-accurate to theirs —
  replace ours. Colors keep our tokens (mapped). Do NOT touch the scroll
  system (`thread-scroll.tsx`, `scroll-root.tsx`, gutter, pins).
- Any deliberate divergence needs a code comment at the site plus an entry in
  the audit doc.

## Deliverables

1. The implemented replacement, checks green.
2. A computed-style diff table (element × property: theirs / ours-before /
   ours-after) — every remaining delta either 0 or documented.
3. Live verification on localhost across a markdown-heavy thread, light and
   dark, desktop and narrow.
4. Findings appended to `docs/chatgpt-scroll-architecture-audit.md` (new
   section) or a sibling `docs/chatgpt-thread-box-model-audit.md`.
