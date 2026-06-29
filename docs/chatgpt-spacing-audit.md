# ChatGPT box-model audit — conversation page

Spacing/box-model companion to [`docs/chatgpt-structural-audit.md`](./chatgpt-structural-audit.md). **Propose only — this document changes no code.**

Every px claim is anchored on **both** sides:
- **ChatGPT** → `reference-ui/ChatGPT/css/component-computed-styles.json` (live `getComputedStyle`, `captures.conversation.targets[i]`, captured at a 1216px viewport) and/or the authored class strings in `reference-ui/ChatGPT/pages/chatgpt-conversation-html-example-desktop-1609px-light.md` (`HTML:line`), with token corroboration from `reference-ui/ChatGPT/css/chatgpt-design-tokens.md` / `chatgpt-component-styles.md`.
- **Ours** → `app/…` / `components/…` at the cited line, **live-measured** in the running app at a 1280px viewport / 1024px `@container/main` (top `@[64rem]/main` tier, sidebar open, panel closed).

Methodology note: ChatGPT's computed capture is 1216px and the HTML strings are 1609px; ours are 1280px. Tier-independent box values (padding, radius, gap, min-height) are directly comparable across these; the few tier-dependent values (gutter/cap) already shipped and are shown only as MATCH rows. The Tailwind v4 spacing base is **4px (`0.25rem`) on both sides**, so `gap-1`=4, `py-2.5`=10, `pb-25`=100 map 1:1 — every delta below is a per-token choice, not a scale mismatch.

---

## Spacing delta table (1280px)

MATCH rows are included deliberately so the reader sees what is already aligned — **do not re-touch them**.

| Node | ChatGPT px (anchor) | Our px (anchor) | Δ | Cause | Status |
|---|---|---|---|---|---|
| User-turn article `padding-top` | 12px · `HTML:1280 pt-3` | 12px · `pt-3` `conversation.tsx:169` | 0 | — | **MATCH (shipped)** |
| Assistant-turn article `padding-bottom` | 40px · `HTML:1315 pb-10` | 40px · `pb-10` `conversation.tsx:171` | 0 | — | **MATCH (shipped)** |
| Turn `scroll-margin-top` (user/asst) | 52 / 252px · `HTML:1278/1313` | 52 / 252px · `conversation.tsx:169/171` | 0 | — | **MATCH (shipped)** |
| Turn-to-turn rhythm | user→asst 0, asst→user 52px (derived) | user→asst 0, asst→user 52px (measured) | 0 | — | **MATCH** |
| Composer-overlap (`-mb`) | 28px · `HTML:1275 [--composer-overlap-px:28px]` | 28px · `conversation.tsx:135` | 0 | — | **MATCH (preserve)** |
| Composer surface pad/radius/min-h | 5/8/5/7 · r28 · 52 · `targets[11]` | 5/8/5/7 · r28 · 52 · `prompt-input.tsx:117` | 0 | — | **MATCH** |
| Assistant inner-stack gap | 8px · `HTML:1313 gap-2` | 8px · `gap-2` `message-assistant.tsx:275` | 0 | — | **MATCH** |
| User bubble `padding-x` | 16px · `targets[23]` | 16px · `px-4` `message-user.tsx:299` | 0 | — | **MATCH** |
| Sidebar new-chat item | pad 6/10 · mx6 · r10 · h36 · `targets[7]` | pad 6/10 · mx6 · r10 · h36 · `sidebar-menu-item.tsx:38-42` | 0 | — | **MATCH** |
| `#page-header` height / `padding-x` | 52 / 8px · `targets[4]` | 52 (`h-app-header`) / 8px (`px-2`) · `header.tsx:39,43` | 0 | content band identical | **MATCH** |
| **User bubble `padding-y`** | **10px** · `targets[23]`; recipe `py-2.5` `chatgpt-component-styles.md:129` | **6px** compact (`py-1.5`) / 12px multiline (`py-3`) · `message-user.tsx:300` | **+4 / −2** | token (literal `py-1.5`/`py-3` vs flat 10px) | **DELTA — R1** |
| **Sidebar nav width** | **260px** · `chatgpt-design-tokens.md:74`, `targets[5]` rect 260 | **256px** (`16rem`) · `sidebar.tsx:30`, `globals.css:335` | **+4** | token (`16rem` vs 260px) | **DELTA — R2** |
| **User message-container `min-height`** | **32px** · `targets[22]`, `HTML:1283 min-h-8` | **none** · `message-user.tsx:189-197` (no `min-h`) | **+32 floor** | missing `min-h-8` | **DELTA — R3** |
| **Action-button radius** | **8px** · `targets[24]` (copy 32²), `targets[8]` (close-sidebar 36²) | **10px** · `rounded-lg`→`--radius-lg:.625rem` `globals.css:318,382`; `message-user.tsx:314,333`, `message-assistant.tsx:416,431`, `message-branch-controls.tsx:52,68`, `sidebar.tsx:297` | **−2** | radius scale (`rounded-lg`=10 vs 8) | **DELTA — R4** |
| **User message-container gap** | **4px** governing inner wrapper · `HTML:1284 gap-1` (outer `gap-2` `HTML:1283` is inert single-child; `targets[22]` computes no gap) | **2px** · `gap-0.5` `message-user.tsx:191` | **+2** | token (`gap-0.5` vs `gap-1`); structural collapse | **DELTA — R5** |
| **Composer surface → viewport bottom** | **36px** (form flush: `form` h52 = `surface` h52, `targets[10]` rect bottom 1287 / vh 1323; gap = disclaimer region) | **32px** (intrinsic ChatInput `pb-3 sm:pb-4` 16px + disclaimer `-mt-4` overlap; live-measured) · `chat-input.tsx:228`, `chat.tsx:437` | **−4** | mechanism differs (ours via `pb-4`, ChatGPT via column `mb-4`); both ≈flush | **MATCH — R6 corrected** |
| **Thread bottom reservation** | **100px** · `HTML:1277 pb-25` (carrier `-mb-28` + `grow`; `#thread` pb 0 `targets[9]`) | **166px** · `pb-[calc(--spacing-input-area 134px + 2rem + env)]` `conversation.tsx:135`, `globals.css:52` | **+66** | token+structure (134 stack + flat 32 addend) | **DELTA — R7 / R10** |
| **Assistant Message wrapper** | container `flex flex-col items-end gap-2` (8px), no avatar row · `HTML:1313` | `flex flex-1 items-start gap-4` — **inert** (no avatar; `h6` out of flow) · `message-assistant.tsx:264` | 0 visible / +8 declared | vestigial avatar-row fossil | **DELTA — R8** |
| **Edit-mode user bubble `padding-y`** | n/a (single bubble recipe = 10px) | **8px** (`py-2`) · `message-user.tsx:241` | self-inconsistent vs display bubble | divergent edit/display token | **DELTA — R9** |
| User bubble radius | 18px authored (`HTML:1285 rounded-[18px]`) · 22px computed (`targets[23]`) is a `corner-superellipse/1.1` artifact | 18px · `rounded-[18px]` `message-user.tsx:299` | 0 authored | superellipse, not a token | **MATCH / cut** (see appendix) |
| Per-attachment spacing | unobserved (capture has no attachments) | 4px `mb-1` per child · `message-user.tsx:215,55` | n/a | fine pattern | **cut** |

---

## 10 ranked recommendations

Ranked by **(fidelity × visible-impact × maintainability) ÷ risk**. Sub-2px nits and 0-px-effect items are honestly down-ranked rather than dropped; nothing already MATCHED/shipped is re-recommended. Where a number was corrected during verification (R5 gap, R1 radius) the corrected value is used.

---

### 1. Flatten the user-bubble vertical padding to 10px (`py-2.5`, drop the multiline branch)
- **Rank & value:** 1 — **9/10** (impact 5 · fidelity 9 · risk 2)
- **ChatGPT does X:** the user bubble computes `padding: 10px 16px` (`reference-ui/ChatGPT/css/component-computed-styles.json` → `captures.conversation.targets[23]`). The current authoritative recipe is **flat** `px-4 py-2.5 leading-6` with **no** multiline switch (`reference-ui/ChatGPT/css/chatgpt-component-styles.md:129`). An older HTML capture still shows `px-4 py-1.5 data-[multiline]:py-3` (`pages/chatgpt-conversation-html-example-desktop-1609px-light.md:1285`) — that build is byte-identical to our current code.
- **We do Y:** `app/components/chat/message-user.tsx:300` — `isMultiline ? "py-3" : "py-1.5"` → **6px** compact / **12px** multiline. Compact is **−4px** under ChatGPT; multiline is **+2px over**.
- **Gap & why it matters:** our compact bubble is visibly tighter top/bottom than ChatGPT, while our multiline branch over-pads in the *opposite* direction — an internally inconsistent two-state bubble. ChatGPT collapsed both into one flat 10px line. One edit fixes both directions and deletes a code path.
- **Proposed change:** collapse the ternary at `message-user.tsx:299-301` to a flat string — `… rounded-[18px] px-4 py-2.5 whitespace-pre-wrap` (optionally add `leading-6` to match the recipe). `isMultiline` (`:186`) then becomes dead for the bubble — remove it if it has no other consumer. **Hold `rounded-[18px]`** (the 22px is a superellipse artifact — see appendix). *Byte-identical / composer-overlap:* none — message-internal node; does not touch the `THREAD_*_VARS` strings; `contentRef` (`:302`) reads `offsetWidth` only.
- **Blast radius:** functional `message-user.tsx:300` (token) + `:299` (px/radius sibling) + `:186` (`isMultiline`, becomes dead). Lockstep mirror: `app/test/thinking-states/page.tsx:327-328`. Untouched: edit bubble `:241` (own node — see Rec 9), share bubble `article.tsx` (`MessageContent rounded-lg p-2`), base `components/ui/message.tsx:90` (overridden by caller). Tests: `message-user.test.tsx` / `message.test.tsx` / `message-assistant.test.tsx` assert aria/text only — **zero breakage** (grep for `py-`/`isMultiline`/`getComputedStyle` is empty).
- **Effort & confidence:** S · exact.

---

### 2. Set the sidebar width 256px → 260px
- **Rank & value:** 2 — **9/10** (impact 3 · fidelity 10 · risk 2)
- **ChatGPT does X:** `--sidebar-width: 260px`, tokenized and marked *exact* (`reference-ui/ChatGPT/css/chatgpt-design-tokens.md:74`), corroborated by live geometry `nav[aria-label="Chat history"]` rect width 260 (`component-computed-styles.json` → `targets[5]`).
- **We do Y:** `const SIDEBAR_WIDTH = "16rem"` = **256px** (`components/ui/sidebar.tsx:30`), applied inline at `:158`; redundant `:root { --sidebar-width: 16rem }` at `app/globals.css:335`.
- **Gap & why it matters:** a clean **+4px** token delta with dual evidence (declared token + live rect) and no superellipse confound — the single most unambiguous fix here.
- **Proposed change:** two-line lockstep edit — `sidebar.tsx:30` `"16rem" → "16.25rem"` (260px; keeps the rem convention shared with `SIDEBAR_WIDTH_ICON 3.25rem`) and `globals.css:335` `--sidebar-width: 16rem → 16.25rem`. The inline `:158` value is what cascades app-wide (SidebarProvider wraps everything at `app/layout.tsx`), so the const edit drives runtime; the `:root` copy moves in lockstep to prevent token drift. *Guardrail:* this is the **permitted sidebar-width token**, not the deferred fixed-vs-in-flow shell (Rank 4) — topology untouched.
- **Blast radius:** primary `sidebar.tsx:30` (+ cascade `:158`), fallback `globals.css:335`. Auto-adapting (no edits): `sidebar.tsx:195/245/257/259-260` (`w-(--sidebar-width)`, gap spacer, offcanvas `calc(...*-1)`), `app-sidebar.tsx:204`, account popover `app-sidebar.tsx:760` (`calc(...-12px)` → 248px, intentionally tracks). Not affected: mobile Sheet (overridden to `SIDEBAR_WIDTH_MOBILE 18rem`). No test asserts sidebar width.
- **Effort & confidence:** S · exact.

---

### 3. Floor the user message container at `min-h-8` (32px)
- **Rank & value:** 3 — **8/10** (impact 2 · fidelity 9 · risk 2)
- **ChatGPT does X:** the user message container reserves a 32px floor — computed `min-height: 32px` (`component-computed-styles.json` → `targets[22]`); authored `min-h-8` (`pages/…:1283`).
- **We do Y:** no `min-h` on `MessageContainer` (`app/components/chat/message-user.tsx:189-197`).
- **Gap & why it matters:** parity with our *own* assistant footer, which already floors at `min-h-8` (`message-assistant.tsx:380`). Without it, a one-word user turn collapses below the 32px rhythm ChatGPT guarantees, making the turn cadence subtly jumpier.
- **Proposed change:** `message-user.tsx:191` — prepend `min-h-8`: `cn("flex min-h-8 w-full flex-col items-end gap-0.5", className)`. `min-h-8` = 32px (default scale, CSS-only). Additive class; `cn()` merge order and `className` passthrough unchanged. *Byte-identical / composer-overlap:* none — user turns carry `data-scroll-anchor="false"` (`:195`), never the bottom anchor, so the floor cannot shift stick-to-bottom math.
- **Blast radius:** `message-user.tsx:191` (base primitive `components/ui/message.tsx:46` `cn("flex gap-3", className)` — `min-h-8` lands additively). Parity reference `message-assistant.tsx:380`. Optional mirror `thinking-states/page.tsx:319`. Tests assert aria/text only — **unaffected**.
- **Effort & confidence:** S · exact.

---

### 4. Align every action-button corner 10px → 8px (`rounded-lg` → `rounded-md`)
- **Rank & value:** 4 — **8/10** (impact 3 · fidelity 9 · risk 2)
- **ChatGPT does X:** action buttons compute 8px — `copy-turn-action-button` 8px/32² (`targets[24]`), `close-sidebar-button` 8px/36² (`targets[8]`); authored `rounded-lg` resolving to 8px under ChatGPT's token scale (`pages/…:1293,1300`).
- **We do Y:** **10px**. Our `rounded-lg` resolves via `--radius-lg: var(--radius)` (`globals.css:318`), `--radius: 0.625rem` (`globals.css:382`) = 10px — repeated across the whole turn footer row and the sidebar trigger: `message-user.tsx:314,333`, `message-assistant.tsx:416,431`, `message-branch-controls.tsx:52,68`, `components/ui/sidebar.tsx:297`.
- **Gap & why it matters:** a consistent **−2px** divergence repeated across an entire control row — not a one-off nit. The 8px token already exists (`--radius-md: calc(var(--radius) - 2px)` = 8px, `globals.css:317`), so the fix is a token swap, not a magic number. Doing the *whole row at once* (including branch controls) avoids leaving 8px and 10px corners side-by-side.
- **Proposed change:** per-button `rounded-lg → rounded-md` at all seven sites above. **Do not** touch `globals.css --radius`/`--radius-lg` (a global change would ripple to every `rounded-lg` consumer). Note `app-sidebar.tsx:336` (the *actual* close button) is already `rounded-md`/8px and needs no edit; `sidebar.tsx:297` is the `SidebarTrigger`. *Byte-identical / composer-overlap:* none — `thread-bounds.ts` has no radius reference.
- **Blast radius:** the seven edited sites; read-only token at `globals.css:317`. Selectors (`aria-label="Copy text"/"Regenerate"/"Previous branch"/"Next branch"`, `data-sidebar="trigger"`) are class-orthogonal. No test asserts `rounded-*`/`borderRadius`/snapshots → **zero breakage**.
- **Effort & confidence:** S · exact.

---

### 5. Widen the user-container gap 2px → 4px (`gap-0.5` → `gap-1`, **not** `gap-2`)
- **Rank & value:** 5 — **6/10** (impact 3 · fidelity 9 · risk 2)
- **ChatGPT does X:** the element that actually governs attachment→bubble→toolbar rhythm is the **inner** `gap-1` (4px) wrapper (`pages/…:1284`, `flex w-full flex-col gap-1 empty:hidden items-end`). The outer `[data-message-author-role="user"]` `gap-2` (`:1283`) wraps a single child in a user turn, so it is **inert** — `targets[22]` records no computed gap, confirming `gap-2` has zero corroboration.
- **We do Y:** `gap-0.5` (2px) on the flat `MessageContainer` (`app/components/chat/message-user.tsx:191`), which holds attachments + bubble + toolbar as direct siblings — the structural analogue of ChatGPT's inner `gap-1` wrapper.
- **Gap & why it matters:** our stack is **+2px** tight versus ChatGPT's real inner wrapper. The naïve "match the visible `gap-2`" reading would over-widen by +6px against an *inert* value — the verified, evidence-backed move is `gap-1`.
- **Proposed change:** `message-user.tsx:191` — `gap-0.5 → gap-1`. Lockstep `thinking-states/page.tsx:319`. Note attachments already carry per-child `mb-1` (4px, `:215`), so net image→bubble is `gap + 4px` — eyeball with an attachment present. *Byte-identical / composer-overlap:* none.
- **Blast radius:** sole consumer `message-user.tsx:191` (governs attachments `:200`, bubble `:297`, edit panel `:240`, `MessageActions` `:309`). Mirror `thinking-states/page.tsx:319`. Tests query roles/text only.
- **Effort & confidence:** S · exact.

---

### 6. ~~Add `mb-4` to the composer column~~ → CORRECTED: rely on the intrinsic `pb-4`, no `mb-4` (composer vertical position)
- **Rank & value:** 6 — **6/10** (impact 4 · fidelity 8 · risk 2). **Originally shipped as "add `mb-4`"; reverted after a live geometry check — see correction below.**
- **ChatGPT does X:** the composer **surface sits 36px above the viewport bottom** — its `form` has **zero** padding below the surface (`targets[10]` form rect bottom 1287 = `targets[11]` surface bottom, both height 52, in a 1323px viewport). The composer→disclaimer gap lives solely in the column `mb-4` (`pages/…:1570`); the disclaimer's `-mt-4` (`pages/…:1652`) cancels it, so the disclaimer sits flush and the only below-surface space is the ~36px disclaimer region.
- **We do Y:** our `ChatInput` **already** bakes `pb-3 sm:pb-4` (16px) below the surface (`chat-input.tsx:228`) — ChatGPT has no such form padding. So our `pb-4` already plays the role of ChatGPT's column `mb-4`. Our disclaimer's `-mt-4` (`chat.tsx:437`) absorbs that `pb-4`, netting the disclaimer flush — surface→bottom **= 32px** (live-measured), ≈ ChatGPT's 36px.
- **Gap & why it matters / the correction:** the original recommendation added `mb-4` to `#thread-bottom` to mirror ChatGPT's column margin — but that **double-counted** with our intrinsic `pb-4`. With both present, the disclaimer's `-mt-4` cancels the new `mb-4` instead of the `pb-4`, leaving the full 16px `pb-4` as dead space and **lifting the composer 16px** (surface→bottom went 32→**48px**, sitting 12px higher than ChatGPT). The structural lesson: ChatGPT's `mb-4` is its *only* composer→disclaimer spacing (flush form), whereas ours lives in the ChatInput's `pb-4`; the two are equivalent, not additive.
- **Applied change (revert):** `chat.tsx:432` — **removed** the `mb-4` so the disclaimer's `-mt-4` again absorbs the intrinsic `pb-4` (net = disclaimer height, surface→bottom 32px). Keep the disclaimer's `-mt-4` (`:437`) and ChatInput's `pb-3 sm:pb-4` (`chat-input.tsx:228`) as-is — together they are our ChatGPT-equivalent mechanism. *Byte-identical / composer-overlap:* none — the `THREAD_MAXWIDTH_VARS` tail at `:432` stays last; `#thread-bottom` is in the sticky subtree, not the `ScrollRootContent` `contentRef`.
- **Blast radius:** `chat.tsx:432` (reverted). The intrinsic spacer `chat-input.tsx:228` (`pb-3 sm:pb-4`, shared with onboarding) is intentionally **left untouched** — removing it would also strip the onboarding composer's bottom breathing. No test asserts the composer's vertical position. Live-verified surface→viewport-bottom: 32px (was 48px; ChatGPT 36px).
- **Effort & confidence:** S · strong.

---

### 7. Trim the flat 2rem addend from the thread-bottom reservation (166px → 134px)
- **Rank & value:** 7 — **6/10** (impact 6 · fidelity 7 · risk 5 — highest-risk survivor; touches the stick-to-bottom measurement)
- **ChatGPT does X:** the inner turn-list reserves `pb-25` = 100px (`pages/…:1277`), the carrier uses `-mb` 28px + `grow flex` (`:1275`), and `#thread` padding-bottom is 0 (`component-computed-styles.json` → `targets[9]`). The 100px equals the composer-stack footprint; the `-mb-28` overlap is the breathing strategy — **no extra flat pad**.
- **We do Y:** `pb-[var(--thread-bottom-offset)]` = `calc(--spacing-input-area + 2rem + env(safe-area-inset-bottom))` (`app/components/chat/conversation.tsx:135`), where `--spacing-input-area: 134px` (`globals.css:52`). On desktop `env=0` → **166px**. Our `-mb` overlap is already 28px (matches).
- **Gap & why it matters:** **+66px** of extra reservation = ~34px (our genuinely taller `gap-4` composer stack, baked into 134px) + ~32px (a discretionary flat 2rem addend). The addend is the cleanly removable half; hardcoding ChatGPT's literal 100px would crowd our taller composer.
- **Proposed change:** in **both** `conversation.tsx:135` and `thinking-states/page.tsx:429` (keep byte-identical), change the offset to `calc(var(--spacing-input-area)+env(safe-area-inset-bottom,0px))` — drops +32px → 134px on desktop. **Preserve** `-mb-[var(--composer-overlap-px)]` / `[--composer-overlap-px:28px]` (already matches). The remaining +34px is structural — see Rec 10. *Composer-overlap guardrail:* this **does** touch the unguarded stick-to-bottom measurement — `ScrollRootContent` carries the `useStickToBottom` `contentRef` (`components/ui/scroll-root.tsx:97-99`), which measures this element's `scrollHeight` *including* `pb`; **no test guards it** → run a manual scroll-lock check after the edit. *THREAD_*_VARS:* disjoint — `thread-bounds.ts:44,54` cover only gutter/cap tokens.
- **Blast radius:** production consumer `conversation.tsx:135`; token `globals.css:52`; mirror `thinking-states/page.tsx:429`; measurement node `scroll-root.tsx:97-99`. The sticky composer (`chat.tsx:415-431`) does not read `--spacing-input-area` for its own height, so retuning only resizes the reserved gap. Tests mock `ScrollRootContent`/`useScrollRoot` and assert neither the `pb` string nor the 134/166 values → the height change is **unguarded**.
- **Effort & confidence:** S · strong.

---

### 8. Strip the inert `flex-1 items-start gap-4` avatar fossil on the assistant wrapper
- **Rank & value:** 8 — **4/10** (impact 1 — 0 visible px · fidelity 9 · risk 3) — maintainability-grade: the classes misrepresent the layout
- **ChatGPT does X:** the assistant message container is `flex w-full flex-col items-end gap-2` (`pages/…:1313`), byte-identical to the user container — `gap-2` (8px), **no** `flex-row`/`items-start`/avatar wrapper.
- **We do Y:** `message-assistant.tsx:264` = `cn("flex w-full flex-1 items-start gap-4", className)` via base `Message` (`components/ui/message.tsx:46`). The `gap-4` is **inert**: the only in-flow child is the inner stack (`:274`); the `h6` (`:271`) is `sr-only`/out of flow and no avatar is rendered (`grep avatar` = 0). `items-start`/`flex-1` are no-ops on a single `min-w-full` child. The inner stack (`:274-277`) already matches ChatGPT's 8px.
- **Gap & why it matters:** 0 rendered px, but the wrapper class is a vestigial avatar-row fossil that lies to anyone editing it. ChatGPT's `items-end gap-2` maps to our *inner* `:274` stack (already `gap-2`); our `:264` wrapper maps to ChatGPT's gapless `flex max-w-full flex-col grow`.
- **Proposed change:** `message-assistant.tsx:264` → `cn("flex w-full flex-col gap-2", className)`. **Care:** you cannot drop the gap *silently* — base `Message` supplies `flex gap-3`, so an explicit `gap-2` is required to keep the effective gap at 8px; `items-start → (removed)` and `flex-1 → (removed)` are no-ops on the single child (verified no avatar/`flex-row`). Lockstep `thinking-states/page.tsx:350`. *Byte-identical / composer-overlap:* none.
- **Blast radius:** `message-assistant.tsx:264` (+ `:271` sr-only h6 confirming inertness; `:274-277` inner stack left untouched — `useAssistantMessageSelection.ts` `closest('[data-message-id]')` resolves to the inner div `:279`). Base `message.tsx:46` (the `gap-3` re-emergence footgun, neutralized by explicit `gap-2`). Mirror `thinking-states/page.tsx:350`. Untouched: share `Message` (`article.tsx`), user wrapper `message-user.tsx:191` (distinct string — the two wrappers stay non-identical; no shared-constant dedupe). Tests assert aria/content only → **test-invisible**.
- **Effort & confidence:** S · exact.

---

### 9. Reconcile the edit-mode bubble padding with the (flattened) display bubble
- **Rank & value:** 9 — **4/10** (impact 2 · fidelity 7 · risk 2) — consistency-grade
- **ChatGPT does X:** a single user-bubble recipe (10px vertical, `chatgpt-component-styles.md:129`) — editing in place does not change the bubble's vertical metrics.
- **We do Y:** the edit surface is a *separate* node with `py-2` (8px): `bg-accent … rounded-[18px] px-4 py-2` (`message-user.tsx:241`), versus the display bubble's `py-1.5` (6px) today / `py-2.5` (10px) after Rec 1.
- **Gap & why it matters:** entering edit mode currently shifts the bubble's vertical padding (6→8px), and after Rec 1 it would shift the *other* way (10→8px) — a small but real jump precisely when the user is focused on that bubble. One token makes display and edit agree.
- **Proposed change:** `message-user.tsx:241` — `py-2 → py-2.5` so the edit container matches the display bubble's flattened 10px. *Byte-identical / composer-overlap:* none — edit container is a transient local-state node; `contentRef` reads width only.
- **Blast radius:** sole consumer `message-user.tsx:241` (the `isEditing` branch); the inline `style.width` snapshot (`:247`) reads width, unaffected by vertical padding. Tests drive the textarea by role/value — no padding assertion.
- **Effort & confidence:** S · exact.

---

### 10. Re-derive `--spacing-input-area` to close the residual composer-stack delta (134px → ~100px)
- **Rank & value:** 10 — **3/10** (impact 6 · fidelity 7 · risk 6) — **flagged, not actioned this pass**
- **ChatGPT does X:** the full bottom reservation is `pb-25` = 100px (`pages/…:1277`), equal to its composer-stack footprint with `-mb-28` overlap and column `mb-4` (`:1570`); `#thread` pb is 0 (`targets[9]`).
- **We do Y:** after Rec 7 trims the flat addend, the reservation is still **134px** because `--spacing-input-area: 134px` (`app/globals.css:52`) bakes in our taller composer stack — the `gap-4` outer wrap in `chat-input.tsx:215` is ~34px taller than ChatGPT's.
- **Gap & why it matters:** the last ~34px of the original +66px is *structural*, not a pad. Closing it means shrinking the composer stack itself (e.g. the `gap-4` outer wrap), which changes the *physical* composer, not just the reserved gap — a deliberate design call with broader visual consequences.
- **Proposed change:** **do not action now.** Re-derive `--spacing-input-area` only after a decision to tighten the composer stack, and only against a *measured* real composer height (the 134px is the intrinsic measured height, so the token must follow a stack change, not precede it). *Composer-overlap:* same unguarded stick-to-bottom measurement as Rec 7. *THREAD_*_VARS:* disjoint.
- **Blast radius:** `globals.css:52` (sole token) + its only reader `conversation.tsx:135` (mirror `:429`); physical cause `chat-input.tsx:215` `gap-4`. No test guards the token.
- **Effort & confidence:** M · inferred (residual is real; the *fix* awaits a composer-stack decision).

---

## Appendix

### Token-scale findings
- **Spacing base is identical.** Both builds use the Tailwind v4 4px (`0.25rem`) step, so `gap-1`=4, `gap-2`=8, `py-2.5`=10, `pb-25`=100 map 1:1. There is **no `--spacing` base divergence** — every delta above is a per-token choice.
- **Radius scale diverges.** Our `rounded-lg` resolves to **10px** (`--radius-lg: var(--radius)`, `globals.css:318`; `--radius: 0.625rem`, `:382`), where ChatGPT's `rounded-lg` computes to **8px** for action buttons (`targets[24]`/`targets[8]`). The fix is local (`rounded-md` = `calc(--radius - 2px)` = 8px, token already at `globals.css:317`) — **never** a global `--radius`/`--radius-lg` change. See Rec 4.
- **Superellipse, not a radius token.** The user bubble computes `border-radius: 22px` (`targets[23]`) while its authored class is `rounded-[18px]` (`HTML:1285`) — byte-identical to ours. The 22px is produced by the `corner-superellipse/1.1` corner-shaping modifier, an explicitly brittle ChatGPT internal we never mimic. A literal 22px rounded rect does **not** reproduce the superellipse shape, so chasing it would make us *less* faithful — hence the radius bump is cut and Rec 1 holds `rounded-[18px]`.

### Intentional divergences / matched items — do NOT regress
- **Already MATCH (don't propose changing):** user-turn `pt-3` (12px) and assistant-turn `pb-10` (40px); scroll-margin-top 52/252; composer surface `5/8/5/7` · r28 · min-h 52 (`prompt-input.tsx:117` ↔ `targets[11]`); sidebar new-chat item `6/10` · mx6 · r10 · h36 (`sidebar-menu-item.tsx:38-42` ↔ `targets[7]`); composer-overlap `-mb` 28px (`conversation.tsx:135` ↔ `HTML:1275`); header height 52 / `px-2` (`header.tsx:39,43` ↔ `targets[4]`); assistant inner-stack `gap-2` (8px); user bubble `px-4` (16px); authored user-bubble `rounded-[18px]`.
- **Shipped structural items (don't reopen):** thread gutter/cap/scrollbar-gutter tiers at `@[40rem]/main` & `@[64rem]/main`; body `aria-live`; one `<article>` per turn; `--sticky-padding-top` scroll-pt collapse; `data-scroll-root` / `data-turn-id`; sidebar nav/aside landmarks; `<main> min-h-0 flex-1`; two-tier header transparency.
- **Deferred (don't reopen):** sidebar fixed-vs-in-flow shell topology (Rank 4) — the width token (Rec 2) is permitted; the shell is not.
- **Guardrails:** flat app-root single flex-row; single dock-slot panel carrier; composer-overlap `-mb`/`pb` on `ScrollRootContent` feeds the **unguarded** stick-to-bottom measured height (Recs 7/10 — manual scroll-lock check); the `[--thread-content-margin…]` / `[--thread-content-max-width…]` strings in `thread-bounds.ts` must stay appended **LAST** so the article + inner-column attrs remain byte-identical — **none of the 10 recs edit these strings** (Rec 6 prepends `mb-4` ahead of the max-width tail); viewport-vs-`@container` axis split; `@w-{n}/main` = breakpoint scale (sm=40, lg=64rem); brittle ChatGPT internals (`data-silk`, `_r_…`, hashed classes, `corner-superellipse`) are reference-only; no new deps; bun; no new `useEffect`.

### Dropped cut-list (false positives / re-recommend matched work)
- **User-bubble radius 18→22px** — false positive. Authored class is `rounded-[18px]` (`HTML:1285`), byte-identical to ours; the computed 22px (`targets[23]`) is a `corner-superellipse` artifact. A literal 22px *reduces* fidelity and chases a derived number against source intent.
- **Per-attachment `mb-1` → flex `gap-1` wrapper** — drop. The reference capture (`HTML:1284`) has **no attachments**, so there is zero evidence ChatGPT spaces them via that wrapper. Net effect is a ~2px change for added DOM nesting; per-child `mb-1` (`:215`/`:55`) is a fine, readable pattern.
- **Header `p-2` vs `px-2`** — false positive. ChatGPT's 8px vertical pad on the 52px border-box yields a 36px centered content band; ours centers via `items-center` inside `h-52`. All header children (≤36px) sit on the same center line → **0px effective delta**. Adding `py-2` is a visual no-op that risks a band shift if any child ever exceeds 36px.
- **Inter-block `[.text-message+&]:mt-1`** — drop. It is an *adjacency* rule that never fires (each turn renders exactly one `.text-message`; `targets[22]` computes `margin-top: 0`). Our side has no `.text-message` class and renders one wrapper per turn — no surface. Claimed +4px is purely hypothetical (0px actual).

### Needs further live measurement
- **Recs 7 / 10 (thread-bottom):** re-measure the 166 → 134 → ~100px chain against a *real* composer height (134px is the measured intrinsic stack height; the residual ~34px is structural). Run a manual scroll-lock / stick-to-bottom check after the `pb` edit since no test guards the `contentRef` `scrollHeight`.
- **Rec 1 (multiline bubble):** eyeball a genuinely multi-line user bubble after flattening to `py-2.5` to confirm the 12→10px reduction reads correctly with `leading-6`.
- **Rec 5 (container gap):** eyeball with attachments present — net image→bubble is `gap + mb-1` (4px), so `gap-1` yields ~8px image-to-bubble.
- **Cross-viewport spot-checks:** ChatGPT computed captures are 1216px and the HTML is 1609px; ours are 1280px. Spot-check the surviving deltas (sidebar width, action-button radius, bubble `py`, min-h floor) at **1609px** and **390px** (mobile) before shipping — several tokens are not container-query-scoped and could read differently at the extremes. (Note: at 390px mobile, ChatGPT's bubble authored class is also `rounded-[18px] px-4 py-1.5` — `pages/chatgpt-conversation-html-example-mobile-390px-light.md:121` — so the `py` bump is a desktop-rendered/recipe target, worth confirming the recipe applies at our mobile width too.)

---

*Provenance: ChatGPT px from `reference-ui/ChatGPT/css/component-computed-styles.json` (`captures.conversation`) + HTML class strings (desktop 1609px / mobile 390px) + `chatgpt-design-tokens.md` / `chatgpt-component-styles.md`; ours live-measured via getComputedStyle at 1280px on `darknight/gcpd-rooftop`. Candidate set verified + blast-radius-mapped by a parallel agent sweep (21 agents); C3/C7/C11/C12 dropped, C2 corrected (`gap-1`, not `gap-2`), C6 rescued from a tooling error.*
