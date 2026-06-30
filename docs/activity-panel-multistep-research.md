---
product: not-a-wrapper
title: Activity Panel — Live Multi-Step Timeline (steps · phase · provider shapes) — Research & Discovery
created_at: 2026-06-30
status: research/discovery — NOT an implementation plan
confidence_legend: exact | strong | inferred | unknown
authoritative_sources:
  # ChatGPT reference captures live in a SIBLING repo, one level above this one:
  - /Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/  (NOT not-a-wrapper/reference-ui — see §0)
  - reference-ui/ChatGPT/research/activity-panel-component-inventory.md
  - reference-ui/ChatGPT/research/activity-panel-open-close-animation.md
  - reference-ui/ChatGPT/css/conversation-with-activity-panel.md
  - reference-ui/ChatGPT/pages/conversation-with-activity-panel/{desktop-2000px,tablet-820px,mobile-592px}-light.md
  - docs/activity-panel-gap-analysis.md  (the GA — canonical; WINS on any conflict)
  - docs/activity-panel-implementation-plan.md
  - polish-acitivity-panel-and-page.md
precedence: Where this document and the GA (docs/activity-panel-gap-analysis.md) disagree, the GA wins. Such conflicts are flagged inline as "GA-WINS".
---

# Activity Panel — Live Multi-Step Timeline: Research & Discovery

> **Deliverable scope.** This is a *research and discovery* document only. It does not propose
> commits, write feature code, or open an implementation plan. Its job is to give the next person
> enough evidence-cited insight to write a high-quality plan without re-running the discovery.
> Every non-trivial claim carries a `file:line`, a `capture:line`, a *real captured payload*, or a
> URL, plus a confidence tag (`exact | strong | inferred | unknown`).

---

## §0. Orientation & a path correction (read first)

- **The ChatGPT reference captures are NOT inside this repo.** The prompt and `TODO.md` item 1
  cite `reference-ui/ChatGPT/...`; that path resolves from `Github/Projects/`, i.e. the captures
  live at the **sibling** path `/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/`, one
  level above `not-a-wrapper`. `git ls-files | grep reference-ui` → 0 hits; the tree is untracked
  and external. `exact`. The future plan must reference them by absolute/sibling path.
- **AI SDK generation.** `@ai-sdk/react ^3.0.80`, `@ai-sdk/provider ^3.0.8`, provider packages
  `@ai-sdk/{anthropic,google,openai,mistral,perplexity,xai}@3` (`package.json`). The "AI SDK v6"
  framing in the prompt maps to these `@ai-sdk/*@3` packages and the UIMessage `parts` model. `exact`
- **The reference panel capture is a *settled, completed* turn** ("Activity · 5m 42s", "Thought for
  5m 42s"). There is **no live/streaming capture** anywhere in the reference set — this is the root
  cause of the `phase` uncertainty (§6.1).

---

## §1. TL;DR — the 8 findings that most shape the plan

1. **`phase` is speculative and un-grounded in the reference — confirmed.** Our `phase`
   (`idle | thinking | complete`) is derived *purely* from AI-SDK `reasoning` part `state`
   (`streaming`/`done`) in `app/components/chat/use-reasoning-phase.ts:31-62` — it is **not** a
   ChatGPT-observed affordance. An exhaustive grep of the desktop capture found **zero** live-phase
   markup: no spinner/shimmer/skeleton/pulse, no `aria-busy`, no `role="progressbar"`, no
   "Thinking/Working/loading" status node (`desktop-2000px-light.md`, phase-hunt §2.5). The only
   `aria-live`/`role=status` nodes are empty global app-shell regions ~4500 lines below the panel.
   `exact`. The live "still thinking" capture remains **unobtained / blocked** (§6.1).

2. **The current step selector cannot reproduce the reference timeline (the central mismatch).**
   The reference timeline is **reasoning-dominated**: 40 steps = 18 globe (browse/search) + 21
   bullet (reasoning narration) + 1 done (terminal) (`activity-panel-component-inventory.md:360-368`,
   verified by grep counts `exact`). But
   `app/components/chat/use-activity-panel.ts:234-237` defines `steps = parts.filter(isStaticToolUIPart)`
   — **tool parts only**, which drops every reasoning step. And `PanelBody`
   (`activity-panel.tsx:82-104`) today renders exactly **one** hardcoded
   `<ActivityStep leading="done">` "Reasoning" step. `exact`.

3. **A *real* captured payload shows the true ordered multi-step sequence — it is the interleave.**
   From the live Convex deployment (`messages` table, real OpenAI `gpt-5-mini` turn): the part
   order is `step-start → reasoning → tool-web_search → reasoning → tool-web_search → … (×5) →
   reasoning ×3 → text → source-url ×5` (§10 Appendix A, `exact`). This *is* the timeline. It maps
   cleanly onto the reference: **`tool-web_search` → globe step** (title = `output.action.query`;
   chips = `output.sources[]`), **visible `reasoning` → bullet step** (body = `text`), **opaque
   `reasoning` → bodyless step**, and a synthesized **terminal "done"** step. The step model must
   fold parts **in document order**, segmented by `step-start` — not filter to one type.

4. **Provider divergence is severe; the step model must degrade on observed parts, never a
   capability table.** Of seven providers, only **claude / openai / gemini** surface rich
   reasoning+tools+sources *live*; **mistral and perplexity emit no reasoning at all**;
   **perplexity & grok search is *implicit*** (citations only, no tool step); **openrouter** is a
   wildcard that inherits the wrapped model's shape (§3). External evidence confirms reasoning is
   *silently dropped* under tool/JSON modes even on capable models, so presence must be
   runtime-observed (`https://medium.com/@fhorvat90/...`, `strong`). The existing
   `useReasoningPhase` "did reasoning parts arrive?" derivation is already the correct defensive
   shape.

5. **Opaque reasoning is first-class and cross-provider — promote it.** Real OpenAI data: 5 of 25
   reasoning parts have empty `text` (opaque), 20 carry summary text; opaque/visible blocks
   *interleave within one message* (§10 Appendix A). Gemini-3 carries reasoning as opaque
   `providerMetadata.google.thoughtSignature` (`app/api/chat/adapters/google.ts:283-306`, `strong`);
   OpenRouter exposes `reasoning_details[].type ∈ {reasoning.text, reasoning.summary,
   reasoning.encrypted("[REDACTED]")}` (`https://openrouter.ai/docs/...`, `exact`).
   `useReasoningPhase.isOpaqueReasoning` (`use-reasoning-phase.ts:64`) already anticipates this.

6. **Source normalization has a concrete, documentable gap.** `getSources`
   (`app/components/chat/get-sources.ts:23-65`) already subsumes three shapes (native `source-url`
   parts; array tool `output`; the `summarizeSources` tool's nested `citations`). But OpenAI's real
   `tool-web_search.output` is an **object** `{action, sources}` (not an array) with no top-level
   `.url`, so `isValidSource` filters it **out** — the **~20 per-search browse results that should
   become per-globe-step chips are currently dropped**; only the final `source-url` gallery sources
   (5) survive (§3.2 OpenAI, §5, `strong`). This is the precedent a step model must generalize.

7. **Tool-step duplication — GA-WINS, and it diverges from the reference.** There is **no literal
   "§3-A" tool-duplication decision** in any doc (`activity-panel-gap-analysis.md` §3-A is
   "Existing components that MUST change"). The GA/plan position is: at cutover only **reasoning +
   sources** leave the inline message body; **tool invocations STAY inline** (`ToolInvocation`), and
   tool `steps` are an **optional** separate projection into the panel timeline
   (`implementation-plan.md:713`; `gap-analysis.md:194`, `strong`). The **reference contradicts
   this** — it renders tool/browse steps *as in-panel globe steps with chips*. The plan must
   reconcile this consciously (§6.2). No dedupe decision exists yet.

8. **Motion is captured for the settled open/close only; no streaming animation exists to copy.**
   Open/close is a **JS spring on one property (stage width 0⇄400px)**, ≈480ms open / ≈515ms close,
   best approximated by `cubic-bezier(0.22,1,0.36,1)` (easeOutQuint) ~500ms, **slides shut populated
   (no opacity fade)** (`activity-panel-open-close-animation.md:79-153`, `exact`; corroborates memory
   [[chatgpt-activity-flyout-motion]]). Per-step chips enter with `animate-[show_150ms_ease-in]`.
   **Reduced motion was never exercised in the reference** (explicit gap) — it is wholly our concern,
   and the cascade gotcha [[tailwind-motion-reduce-cascade]] applies.

---

## §2. Reference teardown — how ChatGPT composes the panel

> Sources: `activity-panel-component-inventory.md` (the load-bearing inventory),
> `activity-panel-open-close-animation.md` (runtime rAF motion), `conversation-with-activity-panel.md`
> (CSS/tokens), and the three `conversation-with-activity-panel/*.md` DOM captures
> (desktop 16,060 / tablet 16,147 / mobile 12,920 lines). All counts below are grep-verified and
> identical across desktop/tablet/mobile unless noted.

### 2.1 Composition: one shared body, two CSS-gated shells
The panel is **one `ReasoningContent` body wrapped by a breakpoint-selected shell**, not one
component in three containers (`activity-panel-component-inventory.md:15-38`, `exact`):
- **≥1024px (`lg`):** `DockedFlyoutShell` — an in-flow, right-docked column (`[data-testid="stage-thread-flyout"]`),
  **no overlay, no dialog semantics, no backdrop, no focus trap** (`section[aria-label="Reasoning details"]`).
- **<1024px:** `ContentSheetShell` — a Silk `[role="dialog"][aria-modal="true"]` that CSS-morphs
  between a centered **card** (≥640px: 16px radius, `sm:shadow-long`, blurred backdrop) and a
  **bottom sheet** (<640px: `16px 16px 0 0`, drag handle, no backdrop blur).
- The two shells **coexist gated by CSS** (`max-lg:w-0!`), they do not morph into one another. `exact`

### 2.2 The step model: leading × body is rank-1
40 steps reduce to **exactly three** combinations (`activity-panel-component-inventory.md:358-368`,
grep-verified `exact`):

| Leading marker | Body | Count | Connector | Maps to (our) |
| --- | --- | --- | --- | --- |
| **globe** (sprite `#6b0d8c`, 15×15) | source **chips** | 18 | yes | browse/search/tool step |
| **bullet** (6px dot, `bg-token-interactive-icon-tertiary-default`) | markdown **description** | 21 | yes | reasoning-narration step |
| **done** (sprite `#a4763e`, 15×15) | description ("Thought for 5m 42s" / body "Done") | 1 | **no** | terminal step |

- *Not observed* (do not over-build): `title-only`, `chips+description`, `globe+description`,
  `bullet+chips`. `exact`
- **Connectors = steps − 1 = 39.** Every step's leading rail is a marker box + a `w-[1px]`
  `bg-token-border-heavy` connector **except the terminal "done" step**, which has the marker box
  only and `margin-bottom:0px` (`desktop-2000px-light.md:11304-11340`, `exact`). Verbatim DOM in §10
  Appendix B.
- Steps carry inline `z-index: 0..39` ascending inside a `relative isolate` column so connectors
  overlap correctly; settled state is `opacity:1; transform:none` (the residue of an
  `animate-[show_150ms_ease-in]` enter). `exact`
- **The sprite hashes `#6b0d8c` / `#a4763e` / `#85f94b` are sprite-fragment ids, NOT colors**
  (`<use href="…/sprites-core-eb6cc3cb.svg#6b0d8c" fill="currentColor">`); the glyphs inherit
  `currentColor` (`#5d5d5d`). Match on marker *intent*, never the hash. `exact` (this is also a
  boundary condition, §9).

### 2.3 Source chips (globe-step body)
- `SourceChipGroup` renders **two** `flex-wrap` rows; **the first row is always empty** in 18/18
  globe steps (a reserved slot — see §6 streaming hypothesis), the second holds the chips
  (`desktop-2000px-light.md:7669`, `exact`).
- **`SourceChip`** = a class-only `<a href target=_blank rel=noopener>` (no `data-testid`),
  `rounded-full bg-[#f4f4f4] h-[25px] px-3 text-xs`, leading 12×12 favicon + hostname, **hover
  inverts** (`hover:bg-token-main-surface-primary-inverse hover:text-token-text-inverted`). 33 in
  the timeline. `exact`. It is **distinct** from the thread's `[data-testid="webpage-citation-pill"]`
  (39, all in the message body) — the older CSS doc conflated them; corrected 2026-06-27.
- **`OverflowChip`** = a `<button>` (no href) sharing the *exact* chip skin, stacking up to 3
  overlapping favicons + a `max-w-[8rem] truncate` "N more" label. 3 instances ("9 more", "21 more",
  "12 more"), only on the globe steps that had 4 chips. `exact`. (Distinguish from `SourceChip` by
  *tag*, not class.)
- **Favicons** are `https://www.google.com/s2/favicons?domain=<url>&sz=32`, rendered `h-3 w-3`,
  `motion-safe:transition-opacity` on load; 194 app-wide. `exact`. Verbatim chip/overflow DOM in §10
  Appendix B.

### 2.4 Header & sources gallery
- Header cluster = 3 spans **"Activity · 5m 42s"** (label / tertiary `·` / tertiary duration) +
  a 36px `rounded-lg` Close button (`#85f94b`). **"Activity" is the header label; "Pro thinking" is
  a separate sub-heading** inside the scroll body, above the timeline
  (`desktop-2000px-light.md:7558-7607`, `exact`).
- Below the timeline: a **"Sources · 113"** section (a `<ul>` of ~113 items, ~141 favicons) — out
  of scope of the reasoning inventory; the in-timeline 33 chips are a subset
  (`activity-panel-component-inventory.md:421`, `exact`). Our analog is `SourcesGallery` (§4).

### 2.5 PHASE HUNT (the central open question) — conclusive: nothing live in the markup
An exhaustive grep of the desktop capture for any in-progress affordance returned **zero** of:
`spinner`, `skeleton`, `shimmer`, `pulse`, `aria-busy`, `role="progressbar"`,
`data-streaming|data-loading|isLoading` (`exact`). Specifically:
- The only `aria-live`/`role=status` nodes are **empty `sr-only` global app-shell notify regions**
  (`id=aria-notify-live-region-*`) ~4500 lines below the panel — not panel-related
  (`desktop-2000px-light.md:15956-15975`, `exact`).
- All 39 `animate-` usages are `animate-[show_150ms_ease-in]` on **inline citation chips in the
  message body** (L3841–6344), a one-shot reveal, **none inside the panel timeline**. `exact`
- "Searching"/"Browsing"/"Looking at" are settled **StepTitle text** (past/gerund labels of
  *completed* steps), not live status. `exact`
- **Conclusion:** the reference panel is a purely settled render; there is no live-phase UI to copy
  from these captures. Whatever the live affordance is, it must be obtained from a mid-generation
  capture (§6.1) — which neither we nor the reference team have.

### 2.6 Motion (settled open/close only)
- **Mechanism:** Silk drives the docked **stage width with a JS spring** (per-rAF inline `width`
  writes), *not* a CSS transition or WAAPI (`getComputedStyle(stage).transitionDuration=0s` every
  frame; `getAnimations()=[]`). It settles on the `var(--…preset-width,400px)` token
  (`activity-panel-open-close-animation.md:79-90`, `exact`).
- **Timing:** open ≈480ms (≥99% by ~380ms, ~0.3% overshoot), close ≈515ms; one strongly
  decelerating spring on **one property** (width). **No opacity fade — slides shut populated**;
  content is fixed-width, pinned to the stage's left edge, clipped by `overflow-x:hidden`; `#thread`
  never translates. Closest CSS curve: `cubic-bezier(0.22,1,0.36,1)` ~500ms (`:119-196`, `exact`).
  This corroborates memory [[chatgpt-activity-flyout-motion]] (500ms easeOutQuint, width-only).
- **`@container` thread snap is shared with the reference** — do not add a transition to it
  (memory [[activity-panel-motion-snap-shared]]; polish-doc M3, `polish-acitivity-panel-and-page.md:690`).
- **Reduced motion: a reference gap.** Never exercised live in either reference doc (`:177-178`).
  Entirely our responsibility (§9).
- **Tokens** (light, `getComputedStyle`-exact unless noted): surface `--main-surface-primary #fcfcfc`
  (flyout) / `--bg-primary #fff` (sheet); text `#0d0d0d` / `#5d5d5d` / `#8f8f8f`; connector
  `bg-token-border-heavy` and bullet `bg-token-interactive-icon-tertiary-default` (class tokens, hex
  unresolved); chip `#f4f4f4`/`#303030` (literal, not a token); `--header-height 56px`; radii 16px;
  `sm:shadow-long` numeric value **provisional/unresolved**; `--stage-thread-flyout-preset-width
  400px` is a class-literal default (`strong`, not `exact`). Full table in §10 Appendix C.

---

## §3. Provider-shape matrix (the central thread) — built from real payloads where they exist

> **Honesty flag (read before trusting the rows).** The live Convex dev deployment
> (`polite-jackal-630`) contains **6 assistant messages, ALL `openai | gpt-5-mini`** (§10 Appendix A).
> So **genuine wire-captured payloads exist only for OpenAI** (tagged `exact`). The other six rows
> are reconstructed from adapter/strategy **code** (`exact` for code shape) plus **authored test
> fixtures** and the `thinking-states` mock page (tagged `strong`), never live captures. Where an
> axis has no evidence at all it is tagged `unknown`.

### 3.0 Routing spine (foundation)
Two-key routing (`lib/openproviders/provider-map.ts:123`, `app/api/chat/adapters/index.ts:33-61`,
`exact`):

| User label | Internal `Provider` id | History adapter | Replay compiler |
| --- | --- | --- | --- |
| claude | `anthropic` | `anthropicAdapter` (near-passthrough, "standard") | anthropic compiler |
| openai | `openai` | `openaiAdapter` (atomic reasoning→tool→result, "complex") | openai compiler |
| gemini | `google` | `googleAdapter` (role-merge + thoughtSignature, "structural") | **none → fallback** |
| grok | `xai` | `openaiCompatibleAdapter` (shared w/ mistral) | **none → fallback** |
| mistral | `mistral` | `openaiCompatibleAdapter` | **none → fallback** |
| perplexity | `perplexity` | `textOnlyAdapter` (flatten to text, "simple") | **none → fallback** |
| openrouter | `openrouter` | underlying-provider adapter via `openrouter:` prefix sniff, else `defaultAdapter` | underlying's compiler iff anthropic/openai, else fallback |

**Two layers that must not be conflated** (`chat-turn-runtime.ts:1585-1591`, `exact`):
- **LIVE (what the panel reads):** the SDK emits UIMessage parts via
  `result.toUIMessageStreamResponse({ sendReasoning: true, sendSources: true })`. The SDK owns
  reasoning `state` (`streaming`/`done`); the app only *times* it (`reasoningDurationMs`,
  `chat-turn-runtime.ts:1273-1283`). **The panel sees the full richness the model streamed** — the
  adapter drops below do NOT apply here.
- **HISTORY (what is sent back to the model next turn):** `adaptHistoryForProvider` shapes outgoing
  history; this is where the per-adapter `droppedPartTypes` matter (and where replay compilers may
  *synthesize* parts that never existed, e.g. OpenAI's `step-start` + placeholder `reasoning`,
  `replay/compilers/openai.ts:140-201`). **Relevant to normalization debt, not to what the live
  panel renders.** This distinction is load-bearing and easy to get wrong.

Canonical live part vocabulary (`lib/chat-messages/parts.ts`, AI-SDK helpers, `exact`):
`text` · `reasoning` (state streaming|done) · `tool-*`/`dynamic-tool` (state input-streaming →
input-available → output-available|output-error|output-denied; only the last three are "final",
`adapters/types.ts:80`) · `source-url` · `source-document` · `file` · `step-start` · `data-*`.

### 3.1 claude (`anthropic` adapter; "standard"/near-passthrough)
- **Reasoning** — visible CoT, **preserved verbatim** (`anthropic.ts:202-203`). Thinking enabled
  server-side via `providerOptions.anthropic.thinking` (`adaptive` for Opus 4.6+, else `enabled`
  with budget; `request-shaping.ts:78-86`). Multi-block (joined `\n\n`). `hasVisibleText: yes`,
  `hasOpaque: no`, `absent: no`. `strong` (no live anthropic capture in-repo; shape from code +
  fixtures `fixtures.ts:13`).
- **Tools** — native `webSearch_20250305`; output is an **array** of
  `{url, title|null, pageAge|null, encryptedContent, type:"web_search_result"}`. **Uniquely**
  carries `encryptedContent` (the gate distinguishing a real Anthropic result from OpenAI's
  `{action,sources}`; `replay/compilers/anthropic.ts:15-33`). `nativeWebSearch: yes`. `strong`.
- **Sources** — `source-url` parts + tool-embedded; **no** `source-document`. In *replay* the
  anthropic compiler intentionally drops `source-url` (continuity carried as text from encrypted
  results; `compilers/anthropic.ts:135-143`). `kind: mixed`. `strong`.
- **Degrade:** near-passthrough keeps `reasoning|tool-*|source-url|text` intact → no
  provider-specific timeline branch needed.

### 3.2 openai (`openai` adapter; "complex") — the only row with REAL payloads
- **Reasoning — *sometimes visible, sometimes opaque* (REAL).** Real data: 25 reasoning parts → 20
  with summary `text` (~380–622 chars), 5 with empty `text` (opaque); `reasoningEncryptedContent`
  was `null` in all; opaque/visible blocks **interleave within one message**
  (lengths `[447,451,480,502,0,0,494,622]`) (§10 Appendix A, `exact`). OpenAI is the canonical
  opaque case (`use-reasoning-phase.ts:64`; `thinking-states/page.tsx:476-485`). The openai adapter
  *enforces* a reasoning-before-first-tool, none-after invariant (`openai.ts:116-139`). `hasVisibleText:
  sometimes`, `hasOpaque: sometimes`, `absent: no`.
- **Tools — native `web_search`, REAL shape.** `{ type:"tool-web_search", state:"output-available",
  providerExecuted:true, input:{}, output:{ action:{query, type:"search"}, sources:[{type:"url",
  url}] } }` (§10 Appendix A, `exact`). The `output` is an **object** `{action, sources}` — the
  distinguishing OpenAI shape. `nativeWebSearch: yes`, `implicitSearch: no`.
- **Sources — tool-embedded + trailing `source-url` (REAL).** Inline citations live on the **text
  part**: `text.providerMetadata.openai.annotations[] = {type:"url_citation", start_index, end_index,
  title, url}`; the **trailing `source-url` parts** are the deduped cited sources (5), a subset of
  the ~20 `web_search.output.sources`. `source-document` never produced; standalone `source-url`
  dropped in *replay* (`compilers/openai.ts:110-118`). `kind: tool-embedded + source-url`. `exact`.
- **The real ordered sequence** (`exact`): `step-start → (reasoning ↔ tool-web_search)×5 →
  reasoning×3 → text → source-url×5`. Non-search turns degrade to `step-start → reasoning(s) → text`
  (no tools, no sources). This is the empirical backbone for §5 and §8.

### 3.3 gemini (`google` adapter; "structural")
- **Reasoning — spans all three.** Visible (gemini-2.5-flash/pro, `reasoningText:true`); **opaque**
  via `providerMetadata.google.thoughtSignature` for Gemini-3 (`google.ts:283-306`, injects a
  `skip_thought_signature_validator` placeholder when absent); **none** (flash-lite, gemma
  `reasoningText:false`). `hasVisibleText: sometimes`, `hasOpaque: sometimes`. `strong`.
- **Tools** — native `googleSearch`; strict function-call/response parity (drops unpaired,
  `google.ts:175-259`). `nativeWebSearch: yes`. `strong`. **Gemini grounding/groundingMetadata wire
  shape is `unknown`** (no real payload in-repo).
- **Sources** — `source-url` + tool-embedded live; both `source-url` & `source-document` dropped in
  *history* (`google.ts:321`). No replay compiler (falls back, `replay_compile_fallback`). `strong`.

### 3.4 grok (`xai` → `openaiCompatibleAdapter`)
- **Reasoning** — `reasoningText:true` (grok-4, grok-4-1-fast-reasoning) / `false`
  (fast-non-reasoning, code-fast). Visibility derived (`use-reasoning-phase.ts:64`). Whether xAI
  emits opaque/redacted reasoning is **`unknown`** (no payload). `hasVisibleText: sometimes`,
  `hasOpaque: unknown`.
- **Tools** — native server-side `webSearch` (`provider-strategy.ts:163-166`), but
  **provider-executed/server-side**, so a real grok turn likely surfaces as `source-url` citations
  rather than an assistant-visible tool part. `nativeWebSearch: yes`, `implicitSearch: yes`. `strong`.
- **Sources** — `source-url` (streamed, `sendSources:true`) + tool-embedded. `strong`.
- **Caveat:** the `openaiCompatibleAdapter` **drops reasoning/step-start/source-url/source-document
  in history** (`openai-compatible.ts:47-54`) — so grok reasoning/sources render *live* but are not
  replayed to the model; no replay compiler.

### 3.5 mistral (`mistral` → `openaiCompatibleAdapter`)
- **Reasoning — ABSENT.** All 7 models `reasoningText:false` (`mistral.ts`); request-shaper returns
  `{}` (`request-shaping.ts:75`); adapter drops any reasoning part. **Not opaque — absent.**
  `hasVisibleText: no`, `hasOpaque: no`, `absent: yes`. `strong`.
- **Tools — NO native search.** `searchTool: () => undefined`, no `searchToolMetadata`
  (`provider-strategy.ts:176`). Models may call **app tools** (e.g. `exa_search`) if `tools:true`,
  but search is never provider-native. `nativeWebSearch: no`, `implicitSearch: no`. `strong`.
- **Sources** — only via app tools (tool-embedded) or `source-url`; both standalone source kinds
  dropped in history. `kind: none (native)`. `strong`.
- **Degrade (critical):** the step model **must distinguish "absent" from "opaque"** — mistral has
  *no* reasoning phase (`phase:'idle'`), so it must NOT draw a phantom "Thinking…" shimmer
  (`use-activity-panel.ts:247`'s hard-coded `isOpaqueReasoning:true` is only for the synthetic
  pending pre-stream turn).

### 3.6 perplexity (`perplexity` → `textOnlyAdapter`; "simple")
- **Reasoning — ABSENT.** All Sonar models `reasoningText:false`; text-only adapter drops
  everything non-text (`text-only.ts:19,52`). Even `sonar-reasoning-pro` surfaces zero reasoning
  parts. `absent: yes`. `strong`.
- **Tools — IMPLICIT search.** No `searchTool`/metadata; Sonar searches server-side and grounds the
  answer with **no tool-call/result part** (verified: `cross-provider.test.ts:275-289` — output is
  text-only even with tools in history). `nativeWebSearch: no`, `implicitSearch: yes`. `strong`.
- **Sources** — live citations *would* arrive as native `source-url` parts (the @ai-sdk/perplexity
  provider maps Sonar citations) — but **this is `inferred`** (no in-repo perplexity payload proves
  it); dropped in history. `kind: source-url (inferred)`.
- **Degrade:** the floor timeline is `text + optional source-url gallery`; never block on a
  reasoning/tool part this provider never emits.

### 3.7 openrouter (wildcard; `default` adapter for the shipped catalog)
- **Wildcard pass-through.** Shape is inherited from the wrapped model. Catalog ships
  `deepseek/*` and `meta-llama/*` whose prefixes are **not** in `KNOWN_UNDERLYING_PROVIDERS`
  (`adapters/index.ts:17`), so they route to `defaultAdapter` (no compiler) — the **lossiest** path
  (`default.ts:14-19` drops reasoning/tool/source). An `openrouter:anthropic/*` or `openrouter:openai/*`
  id *would* reuse that provider's adapter+compiler (`cross-provider.test.ts:312-339`), but no such
  model is in the catalog. `strong`.
- **Reasoning** — present live only if the wrapped model emits it (DeepSeek R1 `reasoningText:true`),
  dropped in history by `defaultAdapter`. `hasVisibleText: sometimes`, `hasOpaque: sometimes`,
  `absent: unknown`. `strong`.
- **Tools/Sources** — no native search (`searchTool:()=>undefined`); both source kinds dropped in
  history. `strong`. **No openrouter real payload exists in-repo** (`unknown` at the wire level).
- **The normalization worst-case (external):** when reasoning *is* present, OpenRouter re-emits an
  OpenAI-shaped envelope with `reasoning_details[]` discriminated by `format`
  (`anthropic-claude-v1`|`openai-responses-v1`|`google-gemini-v1`) **and** `type`
  (`reasoning.text`|`reasoning.summary`|`reasoning.encrypted`/`[REDACTED]`), order-immutable for
  replay (`https://openrouter.ai/docs/guides/best-practices/reasoning-tokens`, `exact`). A
  `parts → NormalizedStep[]` boundary must collapse this to an opaque step (§8).

### 3.8 Matrix at a glance

| Provider | Reasoning | Opaque reasoning | Native web search | Search style | Sources kind |
| --- | --- | --- | --- | --- | --- |
| claude | visible (preserved) | no | yes (array+`encryptedContent`) | explicit tool part | source-url + tool-embedded |
| **openai** ✅REAL | **visible+opaque (mixed)** | **yes (5/25 real)** | **yes (`{action,sources}`)** | **explicit tool part** | **tool-embedded + trailing source-url; annotations on text** |
| gemini | visible / opaque / none | yes (Gemini-3 thoughtSignature) | yes (`googleSearch`) | explicit tool part | source-url + tool-embedded |
| grok | sometimes | unknown | yes (server-side) | implicit+native | source-url + tool-embedded |
| mistral | **none** | no | **no** | app-tools only | none native |
| perplexity | **none** | no | **no** | **implicit** | source-url (inferred) |
| openrouter | inherited | inherited | no | inherited | inherited (all dropped in history) |

**Divergence summary (the degradation contract):** the step model must treat **reasoning, tools,
and sources as three *independently optional* axes**, read from observed `part.type`/`part.state`,
with a **text-only floor** (mistral/perplexity/openrouter routinely hit it) and a distinct
**absent vs opaque** branch (mistral = absent → no row; OpenAI-o/Gemini-3/OpenRouter-encrypted =
opaque → bodyless "Thought for Ns" row).

---

## §4. Current-state inventory — built vs. intentional scaffolding (`file:line`)

### 4.1 What renders TODAY
- **`ActivityPanel`** (`app/components/chat/activity/activity-panel.tsx:115-191`) — responsive
  composition root; `useBreakpoint(1024)` gates docked flyout (portaled into the layout dock slot)
  vs. `ContentSheetShell`; the shared `body` mounts in at most one shell (favicons load once, GA §7
  R6). `exact`.
- **`PanelBody`** (`activity-panel.tsx:82-104`) — renders **exactly one** hardcoded
  `<ActivityStep leading="done" body="description">` titled "Reasoning" with the joined
  `reasoningText` markdown, then `SourcesGallery` when `source-url` parts exist. **No loop over
  `steps`, no globe/bullet rows, no chips.** `exact`.
- **`SourcesGallery`** (`sources-gallery.tsx:33-53`) — a flat `<ul>` of `SourcesGalleryItem` under a
  "Sources · N" heading; no grouped/HoverCard path; `site`/`faviconDomain` never populated. `exact`.
- **Hooks** — `useActivityPanel` (`use-activity-panel.ts`) is the single chat-owned selector;
  `useReasoningPhase` (`use-reasoning-phase.ts`) derives `phase`/`reasoningText`/`durationSeconds`/
  `isReasoningStreaming`/`isOpaqueReasoning`; `getSources` (`get-sources.ts`) normalizes sources.
  `exact`.

### 4.2 Intentional scaffolding (carried, NOT consumed — do not "clean up")
| # | Scaffold | Evidence | Status |
| --- | --- | --- | --- |
| 1 | `phase`, `steps`, `isReasoningStreaming` | declared `activity-panel.tsx:44-56`; supplied at `use-activity-panel.ts:241-256`; spread at `chat.tsx:373-377`; **omitted from the `ActivityPanel` destructure `:115-124`** | accepted & silently dropped `exact` |
| 2 | `leading=globe|bullet`, `body=chips` cva axes | `activity-timeline.tsx:63-79`; only `done`/`description` in prod; globe/bullet/chips only in `activity-timeline.test.tsx` | unconsumed `exact` |
| 3 | `DockedFlyoutShell.viewportRef` | wired to ScrollArea `docked-flyout-shell.tsx:52-74`; `ActivityPanel` never passes it (`activity-panel.tsx:160-168`) → internal ref wins | unfed `exact` |
| 4 | `badge.tsx` `variant="source"` (hover-invert) + `size:md→h-[25px]` | `components/ui/badge.tsx:19-27`; **zero usages repo-wide** | reserved `exact` |
| 5 | `StepLeadingIndicator` exported | `activity-timeline.tsx:81-112` | internal-only `exact` |

- The `leading` cva axis is **style-neutral** (all three keys `""`) because the glyph is resolved
  out-of-band via `STEP_MARKERS` (`activity-timeline.tsx:22-44`); only `body` emits classes. `exact`.
- `activity-timeline.tsx` deliberately **mirrors** `components/ui/chain-of-thought.tsx`
  (`LEADING_MARKERS`, the rail idiom) **without mutating** it — the compose-don't-mutate precedent
  (§9). `exact`.

### 4.3 What does NOT exist yet
- **`SourceChip`, `OverflowChip`, `SourceChipGroup` — zero refs repo-wide** (grep, `exact`). The
  reserved `badge` `source` variant is the only chip-related seam in code.
- **`source-chip-group.tsx` is ABSENT on this branch** (`darknight/gotham-by-gaslight`). The polish
  doc lists it among "implemented" files (`polish-acitivity-panel-and-page.md:90-133`) — but that
  doc was written against branch `darknight/clock-king` (HEAD `7167e0d`). On the current branch the
  file and the symbol do not exist. Treat grep as authoritative; flag the doc drift (§6.6). `exact`.

### 4.4 Prop seams the future plan inherits
`ActivityPanel { panelId?, open, onOpenChange, title?, phase, durationSeconds?, steps: ToolUIPart[],
sources: SourceUrlUIPart[], reasoningText, isReasoningStreaming, isOpaqueReasoning }` — consumed
today: `open/onOpenChange/panelId/title/durationSeconds/sources/reasoningText/isOpaqueReasoning`;
**dropped: `phase`, `steps`, `isReasoningStreaming`**. `ActivityStep { leading?, body?, isLast?,
index? }`. `DockedFlyoutShell { …, viewportRef? }` (unfed). `SourcesGalleryItemProps { href, title,
site?, faviconDomain? }` (last two unfed). `ActivityPanelTrigger.state =
{status:"thinking"} | {status:"thought", durationSeconds?} | {status:"sources", count} |
{status:"activity"}`. (`current-state` inventory, `exact`.)

---

## §5. Gap & alignment map — reference ↔ our data ↔ our primitives

| Reference behavior | Our data (live parts) | Our primitive(s) | Meets? |
| --- | --- | --- | --- |
| 40 ordered steps, reasoning-dominated | real interleave `reasoning ↔ tool-web_search → text` (§3.2) | `ActivityStep` exists; selector `steps = filter(isStaticToolUIPart)` keeps **tools only** | ❌ selector drops reasoning steps & ignores order |
| globe step ⇒ chips (title = query) | `tool-web_search.output.{action.query, sources[]}` | `ActivityStep leading="globe" body="chips"` (cva axis present, unused); chips **don't exist** | ⚠️ primitive axis ready; chip components + chip-data path missing |
| bullet step ⇒ markdown description | visible `reasoning.text` | `ActivityStep leading="bullet"` (unused) + `Markdown` | ⚠️ ready, but `PanelBody` renders one joined block, not per-reasoning-part steps |
| terminal "done" step, no connector | derived (last part / status ready) | `ActivityStep leading="done"` + `ActivityTimeline` injects `isLast` (drops connector) | ✅ |
| per-step source chips, "N more" overflow, hover-invert | per-search `output.sources[]` (currently **dropped** by `getSources`, §6.3) | `SourceChip`/`OverflowChip`/`SourceChipGroup` **absent**; `badge variant="source"` reserved | ❌ chips + chip-data both missing |
| header "Activity · 5m 42s" | `useReasoningPhase.durationSeconds` (live + `metadata.reasoningDurationMs`) | `TitleDurationCluster` | ✅ |
| "Sources · N" gallery | trailing `source-url` parts | `SourcesGallery` | ✅ (flat list; reference is richer) |
| live "thinking" phase | `phase`/`isReasoningStreaming` (SDK-derived) | carried, **unconsumed**; no reference target | ❓ speculative (§6.1) |
| stream-following auto-scroll | `isReasoningStreaming` exists | `viewportRef` wired but **unfed** | ⚠️ plumbing present, unconnected |

**The two structural gaps:** (1) the *selector* (`steps`) must become an **ordered fold over
reasoning + tool parts**, not a tool-only filter; (2) the *source path* must harvest per-step
browse results as chips (today only the final gallery sources survive).

---

## §6. Open questions & risks

### 6.1 `phase` — NOT-FOUND in the reference; live capture BLOCKED (resolved as "blocked")
- The settled capture has **zero** live-phase markup (§2.5, `exact`). Both reference docs explicitly
  list "capture a reasoning panel *while the model is still thinking*" as an unresolved gap
  (`activity-panel-component-inventory.md:426`; `activity-panel-open-close-animation.md` scope note).
- **Attempted live capture, this session — blocked.** A Chrome browser is connected
  (`list_connected_browsers` → "Browser 1"), but there is no existing ChatGPT MCP tab, and I
  **did not initiate a ChatGPT generation** — that would be sending a message / acting on the user's
  behalf (a confirmation-required outward action), and it would also need a logged-in Pro reasoning
  model mid-stream. Memory [[mcp-chrome-tab-hidden-blocks-live-capture]] further warns a driven tab
  is `visibilityState:hidden` (rAF/CSS paused). *Note:* the reference team's open/close capture
  proves a live tab **can** be driven (trusted clicks + rAF, chunk pre-warmed) — so this is feasible
  in principle for whoever has the user's session, just not safely automatable here.
- **Conservative, reference-grounded options for the plan (pick later, do not assume):**
  - **(a) Don't ship a distinct `phase` affordance.** Treat the panel as the reference does — a
    settled timeline that simply grows as parts stream in; "still thinking" is conveyed only by the
    live `durationSeconds` timer + the reserved-empty first chip row filling in. Lowest risk; matches
    captured evidence. *Recommended baseline.*
  - **(b) Use `phase` as an internal open/collapse trigger only** (auto-open while
    `isReasoningStreaming`, settle on done — mirrors `reasoning.tsx:93-105`, GA §6 auto-open), with
    **no** ChatGPT-claimed visual shimmer. `phase` stays an SDK-derived control signal, not a
    fidelity claim.
  - **(c) Defer any shimmer/spinner** until a real mid-generation capture exists. If added, it is an
    *our-product* decision, documented as un-grounded in the reference.
- **The reserved empty first chip row** (18/18 globe groups, §2.3) is the strongest *hint* of a
  streaming/second-category slot, but it is **empty in every captured step** — a hypothesis, not
  evidence. `inferred`.

### 6.2 Tool-step duplication — GA-WINS, reference diverges (decision still open)
- **No literal "§3-A" decision exists** (§1.7, §4). GA/plan position: reasoning + sources move to
  the panel at cutover; **tools stay inline** (`ToolInvocation`); tool `steps` are an *optional*
  projection (`implementation-plan.md:713`, `gap-analysis.md:194`, `strong`). This matches the
  current `activity-panel.tsx:58-63` comment ("the panel does not re-render tool steps").
- **The reference contradicts this:** browse/search steps are *first-class globe steps inside the
  panel* with chips. So fidelity-to-reference and the GA's "tools stay inline" pull in opposite
  directions. **Options to weigh (recommend, don't decide unilaterally):**
  - **(i) Panel reasoning-only (GA literal):** tools only inline. Simplest; *loses* the globe/chip
    steps that define the reference's panel. 
  - **(ii) Panel mirrors tool steps as globe rows (reference-faithful):** tools render **both**
    inline and as panel steps. Risk: duplication / double favicon load (GA §7 R6 favicon-count==N
    test is the binding guard) and a re-render path (GA §7 R3 — `getToolSignature` keys only on
    name+state; a surface reading `output` without a state change would freeze).
  - **(iii) Hybrid:** tools inline by default; the panel shows globe steps *only when the active
    turn has browse/search tool parts* (the common reasoning-model case), reusing the same
    `ToolUIPart` data the inline renderer reads. Likely the best fidelity/complexity trade — but it
    is a **product decision the GA has not made**; the plan must make it explicitly. **GA-WINS until
    then:** the canonical position is reasoning+sources-in-panel, tools-inline.

### 6.3 Source-normalization debt (the precedent to subsume) — `strong`
`getSources` (`get-sources.ts:23-65`) already handles three shapes: native `source-url` parts
(returned as-is); array tool `output` (flattened); the `summarizeSources` tool's nested
`result[].citations`. **But:**
- OpenAI's real `tool-web_search.output` is `{action, sources}` (object, no top-level `.url`) →
  `isValidSource` rejects it → the **~20 per-search browse sources are dropped** (§3.2). Only the
  trailing `source-url` gallery sources survive. So the data that should become **per-globe-step
  chips** is currently discarded.
- Anthropic's `web_search` output is an **array** with `encryptedContent` — a different shape again.
- No path reads `text.providerMetadata.openai.annotations[]` (inline citations) as sources.
- **Risk:** a step model that wants per-step chips must generalize this normalizer to (a) read
  `output.sources[]` *and* array outputs *and* `summarizeSources.citations`, (b) associate each
  source set with its originating tool step (for chips) vs. the deduped gallery, and (c) stay
  resilient to provider-divergent output shapes. This is the highest-leverage normalization task and
  the strongest argument for a single `parts → NormalizedStep[]` boundary (§8).

### 6.4 R1 — the un-memoized `parts.filter` (do not "optimize") — `exact`
The reasoning derivation is **intentionally un-memoized** because the AI SDK **mutates part objects
in place** without changing the array reference (`use-reasoning-phase.ts:28-31`; GA §7 R1
`gap-analysis.md:363`). Any step-model fold must (a) recompute from `parts` **every render**, (b)
**not** memoize on the array reference, and (c) preserve the render-sync reset (`:78-83`) +
cleanup-freeze (`:96-106`) verbatim. Residual: a same-id `isLast` `true→false→true` bounce on
regenerate can zero the timer (memory [[c2-edit-version-guard-count-drift]]); fix = gate the reset on
`prevPhase !== "thinking"`. **External nuance (§7):** the "filter because the SDK mutates in place"
rationale is **not** AI-SDK *documented* guidance — it traces to issue
[vercel/ai#6466](https://github.com/vercel/ai/issues/6466), not the docs. The practice is sound;
the *attribution* in any code comment should cite the issue, not "the docs".

### 6.5 Motion (boundary, §9) — reduced-motion is a reference gap
Open/close ≈500ms easeOutQuint width-only (§2.6). The reference **never exercised reduced motion**,
so our `motion-reduce:` variants are un-grounded by the reference and entirely our responsibility.
The cascade gotcha [[tailwind-motion-reduce-cascade]] (bare `motion-reduce:transition-none` dies
under a competing `sm:transition-*`) and the shared-`@container`-snap trap
[[activity-panel-motion-snap-shared]] both apply. The polish doc's implemented mount strategy (keep
docked shell mounted through close) is in **tension with GA §7 R6** ("exactly one shell active /
favicons==N") — **GA-WINS: R6's favicon-count==N is the binding test**
(`polish-acitivity-panel-and-page.md:786-819` vs `gap-analysis.md:368`).

### 6.6 Doc/branch drift
The polish doc (branch `darknight/clock-king`, HEAD `7167e0d`) describes a render state that
**partially diverges from the current branch** (`darknight/gotham-by-gaslight`): it lists
`source-chip-group.tsx` as implemented, but that file/symbol does not exist here (§4.3). The plan
should re-baseline against the current branch, not the polish doc's snapshot. `exact`.

### 6.7 Residual `unknown`s (need real payloads / live capture)
- Live "thinking" panel DOM (§6.1) — **blocked**.
- Real wire payloads for claude/gemini/grok/mistral/perplexity/openrouter — **none in-repo** (only
  authored fixtures); the matrix rows for those are `strong`/`inferred`, not `exact`.
- Gemini grounding/groundingMetadata citation shape; xAI opaque-reasoning behavior; perplexity live
  `source-url` emission — all `unknown`.
- `sm:shadow-long` exact value; connector/bullet token hex; the `show` keyframe body — reference
  gaps (§10 Appendix C).
- Exact `isStaticToolUIPart`/`getStaticToolName` signatures vs. installed `@ai-sdk` types — verify
  against `node_modules` (§7).

---

## §7. Best-practices findings (cited)

### 7.1 AI SDK v6 UIMessage `parts`
- `UIMessage.parts` is "the source of truth for application state"; render via a `switch(part.type)`
  (`https://ai-sdk.dev/docs/reference/ai-sdk-core/ui-message`, `exact`). `TextUIPart` and
  `ReasoningUIPart` carry `state: 'streaming'|'done'`; `ToolUIPart` carries
  `'input-streaming'|'input-available'|'output-available'|'output-error'` + `toolCallId/input/output/
  errorText/providerExecuted` (`exact`).
- **Recommended:** branch per typed tool name (`tool-getWeather`); reserve `isToolUIPart`/
  `getToolName` for a generic fallback; read `dynamic-tool` via `part.toolName`
  (`migration-guide-5-0`, `chatbot-tool-usage`, `exact`).
- **Sources require `sendSources: true`** on `toUIMessageStreamResponse` (we set it,
  `chat-turn-runtime.ts:1591`); `source-url`/`source-document` are rendered by filtering parts
  (`exact`).
- **Our `parts.filter`-every-render is defensible but NOT documented doctrine.** Official docs show
  plain `.map`/`.filter` with `key={index}` and never warn about in-place mutation; the mutation is
  real but reporter-confirmed only (issue [#6466](https://github.com/vercel/ai/issues/6466)) — the
  issue's own fix is *copying the messages array*, not filtering parts (`exact`/`strong`). Transient
  `data-*` never appears in `parts` (use `onData`). `isStaticToolUIPart`/`getStaticToolName` exact
  signatures: `inferred` — verify against installed types.

### 7.2 Provider-agnostic normalization
- The industry converges on **a discriminated union of stream parts with a uniform
  start/delta/end lifecycle** (Vercel `LanguageModelV*StreamPart`; StrongDM `StreamEventType`;
  LangChain standard content blocks; LiteLLM `ModelResponseStream`) folded into a typed view model —
  exactly the `parts → NormalizedStep[]` target. The AI-SDK protocol even ships `start-step`/
  `finish-step` boundaries, the natural NormalizedStep delimiter
  (`https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol`, `exact`).
- **Pure-function boundary** (deterministic, no I/O, idempotent, input-immutable) is endorsed by
  StrongDM's spec and **already our `adapters/types.ts:51-56` contract** (`exact`).
- **Graceful degradation = optionality + opacity, not capability tables.** Capability parts are
  simply absent when unsupported; an escape hatch (`providerMetadata`/`raw`) carries the long tail.
  Empirically, reasoning is *silently dropped* under JSON-schema/tool modes on multiple models
  (`https://medium.com/@fhorvat90/...`, `strong`) — so branch on observed parts, never a static flag
  (validates our `useReasoningPhase` approach).
- **LiteLLM is the counter-pattern** to avoid: collapsing everything into an OpenAI chunk bolts
  `reasoning_content` onto a delta and loses the start/delta/end + opaque/summary/encrypted
  distinction (`strong`).
- **OpenRouter** is "normalize-the-normalizer": `reasoning_details[]` with `format`+`type`
  discriminators, order-immutable for replay (§3.7, `exact`).

### 7.3 Accessible streaming + timelines
- **Live regions:** mount the region empty *before* injecting; `aria-live="polite"` (or `role="log"`
  — implicit polite + `aria-atomic=false`) for appended chat/log content; reserve `assertive` for
  critical interruptions (MDN; Sara Soueidan; W3C ARIA23, `exact`).
- **Token-flood mitigation:** set `aria-busy="true"` while streaming and flip to `false` to announce
  the completed batch; or debounce ~2–3s; keep focus on the composer (don't steal it) (MDN
  `aria-busy`, `exact`; chatbot-a11y guidance, `strong`).
- **Accessible step timeline:** a real `<ol>/<li>` with `aria-current="step"` on the active item
  (NVDA says "current step …"), plus visually-hidden "completed"/"not completed" + a "Step N of M"
  counter (USWDS step-indicator; Geoff Rich; MDN aria-current, `exact`). **Gotcha:** stripping
  `list-style` can drop list semantics in Safari/VoiceOver → re-assert `role="list"`. `aria-hidden`
  the decorative marker/counter when `aria-current` already conveys state.
- **Contrast with the reference:** ChatGPT's timeline is **plain `div`s — no list role, no
  `aria-current`, no programmatic progress** (§2; `inferred`). Mirroring it verbatim inherits those
  a11y gaps; the accessible ideal layers `ol/li + aria-current="step" + sr-only status` over the
  same visual. **Decision for the plan:** prefer the accessible markup even though the reference
  omits it.
- **Motion:** gate smooth/auto-scroll behind `prefers-reduced-motion: no-preference` (Tailwind
  `motion-safe:`), and in JS pick `behavior:'auto'` via `matchMedia`. Use `0.01ms` (not `0`) when JS
  depends on `transitionend`/`animationend`. Ties to memory [[tailwind-motion-reduce-cascade]]:
  prefer the `motion-safe:` opt-in to sidestep the cascade fight, or `motion-reduce:!…` /
  `sm:motion-reduce:…` (Smashing Magazine, `exact`).

---

## §8. Hypotheses & recommended direction (to validate later — NOT a plan)

> A discovered design space + one recommended abstraction. Explicitly not an implementation plan;
> the GA's staged-commit runbook and the §6.2 tool decision are the plan's job.

### 8.1 The core abstraction: a pure `parts → NormalizedStep[]` boundary
Replace the tool-only `steps` filter (`use-activity-panel.ts:234`) with a **pure, un-memoized fold**
`(parts, ctx) => NormalizedStep[]` that walks parts **in document order**, segmented by `step-start`.
Proposed discriminated union (mirrors the reference's rank-1 model and the AI-SDK/StrongDM/LangChain
canonical shape):

```
type NormalizedStep =
  | { kind: "reasoning"; title?: string; markdown?: string; opaque: boolean }   // bullet (or opaque bodyless)
  | { kind: "browse";    title: string; chips: SourceChip[]; overflow?: {count, favicons[]} } // globe
  | { kind: "terminal";  title: string; markdown?: string }                     // done (no connector)
type SourceChip = { href: string; hostname: string; faviconDomain: string }
```

Mapping (grounded in §3.2 real OpenAI data + §2.2 reference):
- `tool-*` (web_search/googleSearch/etc., final state) → **browse** step; `title` from
  `input.query` ?? `output.action.query`; `chips` from `output.sources[]` (object shape) **or**
  array `output` (Anthropic) **or** `summarizeSources.citations`.
- visible `reasoning` (`text` non-empty) → **reasoning** step (`opaque:false`).
- opaque `reasoning` (`text` empty, or Gemini-3 `thoughtSignature`, or OpenRouter
  `reasoning.encrypted`) → **reasoning** step (`opaque:true`, no body).
- the last reasoning/terminal signal (status ready / final done) → **terminal** step
  (`ActivityTimeline` already drops the connector on `isLast`).

### 8.2 Why this shape
- **Degrades by construction (§3 contract):** mistral/perplexity yield zero reasoning/browse steps →
  a clean text-only floor; absent ≠ opaque is encoded in the `reasoning` branch.
- **Reuses the proven seams:** `ActivityStep` already has `leading=globe|bullet|done` ×
  `body=chips|description` (§4.2 #2); `badge variant="source"` is the chip skin (§4.2 #4);
  `ActivityTimeline` injects `isLast`/`index`. The fold is the missing piece, not the primitives.
- **Subsumes the normalization debt (§6.3):** the same fold harvests per-step chips *and* feeds the
  gallery — one boundary, two consumers, ending the `getSources` divergence.
- **Pure but recomputed (§6.4):** the function is pure (`adapters/types.ts` contract) yet must run
  every render (SDK in-place mutation) — not a contradiction (the input changes more often than its
  reference). Promote `isOpaqueReasoning` from a UI-local flag to a first-class step field.
- **OpenRouter worst-case (§3.7):** route `openrouter:` to the underlying provider's reasoning
  sub-parser (already resolvable via the prefix sniff) and preserve `reasoning_details` order.

### 8.3 Things to validate before committing
- Whether browse steps appear in the panel at all (§6.2 tool-duplication — GA-WINS says optional).
- Whether `phase` drives only auto-open/collapse (§6.1 option b) vs. a visible affordance.
- Feeding `isReasoningStreaming` → `DockedFlyoutShell.viewportRef` for stream-following auto-scroll,
  gated `motion-safe:` (§6.5, §7.3).
- The accessible-markup decision (§7.3) — `ol/li + aria-current="step"` over the reference's divs.

---

## §9. Boundary conditions for the future plan (record-only)

1. **No feature flags / clean cutover.** The plan is PR1→PR5; PR5 removes inline reasoning +
   `getSources`/`SourcesList` from the message body and makes the panel the sole path; any single
   `git revert` restores a green `main` (`implementation-plan.md:255-265`).
2. **OKLCH semantic tokens only.** Map ChatGPT sRGB/`--token-*` to the project's shadcn OKLCH tokens
   by role (GA §4). **Sprite hashes `#6b0d8c`/`#a4763e`/`#85f94b` are sprite *ids*, not colors** —
   glyphs use `currentColor`; match on marker intent (§2.2).
3. **Compose, don't mutate shared primitives.** `activity-timeline.tsx` mirrors
   `chain-of-thought.tsx` without editing it; `content-sheet-shell.tsx` composes `sheet.tsx` via a
   single additive `overlayClassName` (§4.2, GA §7 R2; pairs with the `fix-overlay-bleedthrough`
   skill — keep surfaces opaque, don't retint the primitive).
4. **Every animation carries a `motion-reduce:` variant.** Cascade gotcha: bare
   `motion-reduce:transition-none` dies under a competing `sm:transition-*` → use `!` or
   `sm:motion-reduce:`, or prefer the `motion-safe:` opt-in (memory [[tailwind-motion-reduce-cascade]]).
   Don't transition the shared `@container` thread snap (memory [[activity-panel-motion-snap-shared]]).
5. **Lean tests on risky logic.** Concentrate coverage on R1 (timer never regresses), R3
   (tool-signature re-render), R6 (favicon count == N), and the new `parts → NormalizedStep[]` fold's
   ordering/degradation — not broad snapshotting (memory [[prefers-lean-test-suites]]).
6. **Live vs history (§3.0):** the panel reads **live** parts (full richness); adapter `droppedPartTypes`
   only affect **outgoing history**. Don't conflate the two.
7. **GA-WINS:** on any conflict with this document, `docs/activity-panel-gap-analysis.md` is
   canonical (esp. §6.7 ownership, §7 risk register, the tools-stay-inline position).
8. **Stay on the current branch** (`darknight/gotham-by-gaslight`); no new branches (memory
   [[git-no-unsolicited-branches]]).

---

## §10. Appendix — raw captured payloads & reproducible method

### Appendix A — REAL OpenAI payloads (live Convex `polite-jackal-630`, captured 2026-06-30) `exact`
**Method (read-only):** `mcp__convex__runOneoffQuery` against the `messages` table,
`order desc .take(3000)`, filtered `role === "assistant"`. Census: 12 docs total, **6 assistant
messages, all `openai | gpt-5-mini`**. Aggregate parts: reasoning 25, tool-web_search 11, source-url
10, step-start 6, text 6. Reasoning split: 20 visible (≈380–622 chars) / 5 opaque (empty);
`reasoningEncryptedContent` null in all.

```
# Real ordered sequence (msg k573jddt…, completed; reasoningTextLens [0,0,0,412,422,516,529,571]):
step-start, reasoning, tool-web_search, reasoning, tool-web_search, reasoning, tool-web_search,
reasoning, tool-web_search, reasoning, tool-web_search, reasoning, reasoning, reasoning,
text, source-url, source-url, source-url, source-url, source-url
# Non-search turns (×4) degrade to: step-start, reasoning(s), text   (no tools, no sources)

# reasoning — OPAQUE (text empty):
{ "type":"reasoning", "state":"done", "text":"",
  "providerMetadata":{"openai":{"itemId":"rs_0888…","reasoningEncryptedContent":null}} }

# reasoning — VISIBLE summary:
{ "type":"reasoning", "state":"done",
  "text":"**Clarifying recent events request**\n\nThe user wants to know about recent events…",
  "providerMetadata":{"openai":{"itemId":"rs_05ee…"}} }

# tool-web_search — providerExecuted native search (output is an OBJECT {action,sources}):
{ "type":"tool-web_search", "toolCallId":"ws_0888…", "state":"output-available",
  "providerExecuted":true, "input":{},
  "output":{ "action":{"query":"New York City June 28 2026 news top stories","type":"search"},
             "sources":[ {"type":"url","url":"https://apnews.com/article/c230…"}, … (~20) ] } }

# text — inline citations live in providerMetadata.openai.annotations[]:
{ "type":"text", "state":"done", "text":"Do you mean the calendar week of June 22–28, 2026?…",
  "providerMetadata":{"openai":{"itemId":"msg_0888…",
    "annotations":[ {"type":"url_citation","start_index":443,"end_index":566,
                     "title":"…rent freeze - UPI.com","url":"https://www.upi.com/…?utm_source=openai"}, … (5) ] }} }

# source-url — trailing deduped cited sources (5; subset of the ~20 web_search sources):
{ "type":"source-url", "sourceId":"GeqYO5FUmDJpb9Ih",
  "title":"New York City rental board approves Mamdani rent freeze - UPI.com",
  "url":"https://www.upi.com/…?utm_source=openai" }

# message.metadata (real): reasoningDurationMs 25649/5339; toolMetadataByName.web_search =
#   { displayName:"Web Search", icon:"search", serviceName:"OpenAI", source:"builtin",
#     openWorld:true, readOnly:true, estimatedCostPer1k:30 }
```
Full dump: scratch `openai-real-payloads.md` (this session).

### Appendix B — Reference DOM snippets (verbatim, `desktop-2000px-light.md`) `exact`
```html
<!-- Globe browse step: marker #6b0d8c + connector + StepTitle + SourceChipGroup (empty row 1) [L7621-7700] -->
<div class="flex h-full w-4 shrink-0 flex-col items-center">
  <div class="flex h-5 shrink-0 items-center justify-center">
    <svg width="20" height="20" class="h-[15px] w-[15px]"><use href="…/sprites-core-eb6cc3cb.svg#6b0d8c" fill="currentColor"></use></svg>
  </div>
  <div class="bg-token-border-heavy h-full w-[1px] rounded-full" style="opacity:1;transform:none"></div>
</div>
<div class="w-full min-w-0" style="margin-bottom:12px">
  <div class="text-token-text-primary text-[14px]">Browsing web for Tally.so data and market analysis</div>
  <div class="flex min-w-0 flex-col gap-2 text-sm"><div class="flex min-w-0 flex-col gap-1">
    <div class="flex flex-wrap items-center gap-1"></div>           <!-- row 1 ALWAYS empty -->
    <div class="flex flex-wrap items-center gap-1"> … SourceChip … </div>
  </div></div>
</div>

<!-- SourceChip <a> (hover-invert) [L7685] -->
<a href="https://www.reddit.com/…" target="_blank" rel="noopener" alt="https://www.reddit.com/…"
   class="text-token-text-secondary inline-flex items-center rounded-full bg-[#f4f4f4] dark:bg-token-main-surface-secondary
          h-[25px] px-3 text-xs … hover:bg-token-main-surface-primary-inverse hover:text-token-text-inverted">
  <div class="z-1 inline-flex items-center gap-1">
    <div class="bg-token-main-surface-primary -ms-3 box-content h-3 w-3 overflow-hidden rounded-full first:-ms-1">
      <img alt="" width="32" height="32" class="m-0 h-3 w-3 motion-safe:transition-opacity"
           src="https://www.google.com/s2/favicons?domain=https://www.reddit.com&sz=32"/></div>
    www.reddit.com</div></a>

<!-- Bullet reasoning step: 6px dot + connector + markdown <p> [L8108-8158] -->
<div class="bg-token-interactive-icon-tertiary-default h-[6px] w-[6px] rounded-full"></div>
… <div class="text-token-text-primary text-[14px]">Looking at pricing data for form builders</div>
<div class="QKycbG_markdown … markdown prose … markdown-new-styling"><p>I need to gather pricing data…</p></div>

<!-- Terminal "done" step: marker #a4763e, NO connector, margin-bottom:0px [L11304-11340] -->
<div class="flex h-5 shrink-0 items-center justify-center">
  <svg class="h-[15px] w-[15px]"><use href="…#a4763e" fill="currentColor"></use></svg></div>
<!-- (no w-[1px] connector div follows) -->
<div class="w-full min-w-0" style="margin-bottom:0px">
  <div class="text-token-text-primary text-[14px]">Thought for 5m 42s</div>
  <div class="QKycbG_markdown … markdown prose …"><p>Done</p></div></div>

<!-- OverflowChip <button> ("9 more", 3 stacked favicons) — same skin as <a>, no href [L7866-7929] -->
<button class="… inline-flex items-center rounded-full bg-[#f4f4f4] h-[25px] px-3 text-xs … hover:bg-token-main-surface-primary-inverse">
  <div class="z-1 inline-flex items-center gap-1"> …3× favicon holders… <div class="max-w-[8rem] truncate">9 more</div></div>
</button>

<!-- PHASE HUNT: only aria-live nodes are EMPTY global app-shell regions ~4500 lines below the panel [L15956-15975] -->
<div aria-live="assertive" class="sr-only" id="aria-notify-live-region-assertive" role="alert"><span></span></div>
<div aria-live="polite"    class="sr-only" id="aria-notify-live-region-polite"    role="status"><span></span></div>
```
Grep counts (desktop/tablet/mobile, identical): globe `#6b0d8c` 18/18/18 · bullet dot 21/21/21 ·
done `#a4763e` 1/1/1 · connector `w-[1px]` 39/39/39 · SourceChip `<a>` 33/33/33 · OverflowChip 3/3/3
· markdown bodies 22/22/22 · favicons 194/194/194. Phase markers (spinner/skeleton/shimmer/pulse/
aria-busy/role=progressbar) 0/0/0/0/0/0.

### Appendix C — Reference token map (light, `getComputedStyle`-exact unless noted) `exact`/`strong`
`--main-surface-primary #fcfcfc` (flyout) · `--bg-primary #fff` (sheet) · `--bg-secondary #e8e8e8`
(handle) · text `--text-primary #0d0d0d` / `--text-secondary #5d5d5d` / `--text-tertiary #8f8f8f` ·
`bg-token-border-heavy` (connector, hex unresolved) · `bg-token-interactive-icon-tertiary-default`
(bullet, hex unresolved) · chip `#f4f4f4`/`#303030` (literal) · `--surface-hover #00000012` ·
`--header-height 56px` · `--sheet-radius-amount 16px` · `sm:shadow-long` ≈ `0 8px 12px #00000014,
0 0 1px #0000009e` (**provisional/`strong`**) · `--stage-thread-flyout-preset-width 400px`
(class-literal default, **`strong`**). Per-step chip enter: `animate-[show_150ms_ease-in]` (keyframe
body not quoted in the reference — `unknown`).

### Appendix D — Capture methods (reproducibility)
- **Convex (Appendix A):** `mcp__convex__status` → deployment selector; `mcp__convex__tables` →
  schema; `mcp__convex__runOneoffQuery` (read-only) for census + verbatim parts. Re-runnable.
- **Reference DOM (Appendix B):** `rg -n` against
  `/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT/pages/conversation-with-activity-panel/*.md`
  at the cited line anchors; counts via `rg -c`.
- **Reference motion/CSS (Appendix C):** `activity-panel-open-close-animation.md` (runtime rAF
  sampling, desktop flyout only) + `conversation-with-activity-panel.md` (live `getComputedStyle` +
  class mining).
- **Live "thinking" capture:** NOT performed — blocked (§6.1). `list_connected_browsers` shows a
  connected browser, but no ChatGPT MCP tab existed and initiating a generation on the user's behalf
  was out of bounds.
- **Workflow provenance:** the §3 matrix (non-OpenAI rows), §4 docs extraction, and §7 web research
  were produced by a 15-agent background research workflow (`activity-panel-multistep-research`,
  run `wf_e639b600-a18`), then reconciled against first-hand reads of the load-bearing files.

<!-- End of research document. -->
