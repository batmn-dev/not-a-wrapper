# ChatGPT vs. not-a-wrapper — Conversation-Page Structural Topology Audit

**Scope:** page skeleton & layout topology — flex/grid, width ownership, scroll/sticky boundaries, responsive axis, semantics/landmarks, layering. **Out of scope:** component pixel styling, tokens, copy, and the activity-panel open/close motion (already verified). **Roots:** ours `/Users/andresgonzalez/Github/Projects/not-a-wrapper`; reference `/Users/andresgonzalez/Github/Projects/reference-ui/ChatGPT` (cited below as `reference-ui/ChatGPT/...`). **Analysis only — nothing implemented.**

> **Headline correction (read first).** The established "finding #2" — that our thread gutter/cap container tiers already match ChatGPT — is **wrong on the thresholds**. ChatGPT's thread tiers fire on a *custom `@w-*` container-query family bound to the **breakpoint** scale* (`@w-sm/main`=40rem, `@w-lg/main`=64rem), while ours use Tailwind's default `@*/main` family bound to the **container** scale (`@sm/main`=24rem, `@lg/main`=32rem). The *values* (1/1.5/4rem gutter, 40/48rem cap) match; the *firing widths* do not (≈1.6×). This is verified to the byte in §4 Rank 1 and corrects `thread-bounds.ts`'s comment. It is the single highest-value finding here.

> **Working-tree note.** At audit time the branch `darknight/gcpd-rooftop` has uncommitted in-flight work (`chat.tsx` saved 15:05 — the new `stopScroll`-on-panel-open; plus the activity-panel refactors). All `app/...:line` anchors are a snapshot against the current files; a few may drift as that work continues. The audit changed nothing.

---

## 1. ChatGPT structural skeleton

Tags: `[width-carrier]` `[scroll-port]` `[cap]` `[gutter]` `[centering]` `[sticky]` `[container-root]` `[landmark]` `[stacking-context]`.

**Container-query families (decisive for §3/§4).** ChatGPT registers **two** container-query variant families on `@container/main`:
- `@w-{n}/main` → `@container main (width ≥ var(--breakpoint-{n}))` → **sm=40, md=48, lg=64, xl=80, 2xl=96 rem** (used by the thread gutter, cap, scrollbar-gutter, header transparency).
- `@{n}/main` → `@container main (width ≥ var(--container-{n}))` → **sm=24, lg=32, 2xl=42 rem** (used elsewhere, e.g. message-internal layout at `width≥42rem`).

Evidence: `--breakpoint-lg`=64rem / `--breakpoint-2xl`=96rem and `--container-sm`=24rem / `--container-lg`=32rem / `--container-2xl`=42rem are declared at `reference-ui/ChatGPT/css/matched-rules.json:4685-4702`. The **only** two compiled `@container main` contexts in the matched rules are `width≥80rem` and `width≥96rem` (`matched-rules.json:42,54`) — the header's `@w-xl/main` and `@w-2xl/main` transparency tiers — which equal `--breakpoint-xl`/`--breakpoint-2xl`, **not** `--container-xl`(36)/`--container-2xl`(42). That proves `@w-*` resolves on the breakpoint scale, hence `@w-lg/main`=64rem.

### 1A — Panel OPEN

Source: `reference-ui/ChatGPT/pages/conversation-with-activity-panel.md`. Indent depths verified (ROW A=6, ROW B=8, host=10, `@container/main`=14, flyout=8).

```
body
└─ div.flex.h-svh.w-screen.flex-col                                       [stacking-context root]   :40   app-root (flex-COL outer)
   ├─ div.relative.z-0.flex.min-h-0.w-full.flex-1                         [stacking-context z-0]    :41   ROW A
   │  └─ div.relative.flex.min-h-0.w-full.min-w-0.flex-1                                            :42   ROW B
   │     ├─ div#stage-slideover-sidebar  relative z-21 h-full shrink-0 overflow-hidden border-e max-md:hidden
   │     │     style="width:var(--sidebar-width)"                                                   :46   sidebar          [shrink-0, in-flow width-carrier, stacking-context z-21]
   │     └─ div[data-side-pane-shell-host="true"]  relative flex min-h-0 min-w-0 flex-1            :3324  HOST             [width-carrier(flex-1), OPEN-ONLY wrapper]
   │        ├─ div.@container/main relative flex min-w-0 flex-1 flex-col -translate-y-… pt-…       :3329  main column       [container-root, flex-1]
   │        │  └─ div[data-scroll-root]  group/scroll-root relative flex min-h-0 min-w-0 flex-1 flex-col
   │        │     │   [scrollbar-gutter:stable]  @w-sm/main(40rem):[scrollbar-gutter:stable_both-edges]
   │        │     │   not-print:overflow-x-clip not-print:overflow-y-auto  scroll-pt-(--header-height)
   │        │     │   [--sticky-padding-top:var(--header-height)]
   │        │     │   has-data-[fixed-header=less-than-xl]:@w-xl/main(80rem):scroll-pt-0           :3332  SCROLL PORT       [scroll-port, scrollbar-gutter, scroll-pt]
   │        │     ├─ header#page-header  draggable sticky top-0 z-20 h-header-height pointer-events-none
   │        │     │      data-[fixed-header=less-than-xl]:@w-xl/main(80rem):bg-transparent
   │        │     │      data-[fixed-header=less-than-xxl]:@w-2xl/main(96rem):bg-transparent       :3342  HEADER            [landmark, sticky, z-20, stacking-context]
   │        │     └─ main#main  min-h-0 flex-1   (NO flex-col)                                      :3431  MAIN              [landmark, flex-1]
   │        │        └─ div#thread  group/thread flex flex-col min-h-full                           :3436  THREAD            [flex-col, min-h-full]
   │        │           └─ div[role=presentation].composer-parent flex flex-1 flex-col             :3442  COMPOSER-PARENT   [flex-1]
   │        │              ├─ div.relative.basis-auto.flex-col.-mb-(--composer-overlap-px)
   │        │              │      [--composer-overlap-px:28px].grow.flex                            :3447  TURNS-WRAPPER     [grow, overlap-reserve(-mb), basis-auto]
   │        │              │  └─ div.flex.flex-col.text-sm                                          :3452  TURNS-LIST
   │        │              │     └─ article[data-turn=user][data-turn-id][data-scroll-anchor] w-full scroll-mt-(--sticky-padding-top)  :3458  ARTICLE(user)  [landmark, scroll-mt]
   │        │              │        └─ div.text-base.my-auto.mx-auto.pt-3
   │        │              │              [--thread-content-margin:--spacing(4)=1rem]
   │        │              │              @w-sm/main(40rem):[…:--spacing(6)=1.5rem]
   │        │              │              @w-lg/main(64rem):[…:--spacing(16)=4rem]  px-(--thread-content-margin)  :3466  TURN GUTTER  [gutter, centering(mx-auto)]
   │        │              │           └─ div[data-conversation-screenshot-content]
   │        │              │                 [--thread-content-max-width:40rem]
   │        │              │                 @w-lg/main(64rem):[--thread-content-max-width:48rem]
   │        │              │                 mx-auto max-w-(--thread-content-max-width) flex-1
   │        │              │                 group/turn-messages relative flex w-full min-w-0 flex-col   :3469  MESSAGE COLUMN  [cap, centering(mx-auto)]
   │        │              │     └─ article[data-turn=assistant][data-scroll-anchor=true] …  (same gutter → cap shape)
   │        │              └─ div#thread-bottom-container  sticky bottom-0 z-10 isolate
   │        │                     relative w-full basis-auto content-fade flex flex-col             :7141  COMPOSER          [sticky, z-10, isolate, stacking-context]
   │        │                 └─ div#thread-bottom › div.…@w-sm/main:… @w-lg/main:….px-(--thread-content-margin)  :7180  COMPOSER GUTTER  [gutter]
   │        │                       └─ div.[--thread-content-max-width:40rem].@w-lg/main:48rem.mx-auto  :7184  COMPOSER CAP   [cap, centering]
   │        └─ div[data-side-pane-shell-rail="true"]  relative min-h-0 shrink-0 overflow-hidden
   │                 transition-[width] duration-300  style="width:0"                               :7508  IN-FLOW RAIL      [shrink-0 spacer, width=0 here]
   └─ div[data-stage-thread-flyout][data-testid=stage-thread-flyout]  relative z-1 shrink-0
            overflow-x-hidden  max-lg:w-0!  style="width:var(--…-width,400px)"                       :7515  FLYOUT            [shrink-0, z-1]
      └─ div.absolute.h-full.[width:var(--…-width,400px)]                                            :7528  flyout inner (absolute, fixed width)
         └─ section[data-testid=screen-threadFlyOut][aria-label="Reasoning details"] flex-1 border-s :7531  panel screen      [landmark, border-s]
```

**Open-panel width mechanics.** The visible 400px content rides the flyout at `:7515`; in-flow width is reserved by `[data-side-pane-shell-host].flex-1` (`:3324`, present only when open) plus the `[data-side-pane-shell-rail]` `shrink-0` spacer inside it (`:7508`, `transition-[width] duration-300`). Opening shrinks `@container/main` (#thread 1020→619 @1280), which re-tiers the gutter/cap on the `@w-*` thresholds. **Scroll owner = the single `[data-scroll-root]` node** (`:3332`); header & composer are sticky children *inside* it.

### 1B — Panel CLOSED

Sources: `reference-ui/ChatGPT/pages/chatgpt-conversation-html-structure.md` (distilled) + `…/pages/chatgpt-conversation-html-example-desktop-1609px-light.md` (line-verified). `data-side-pane-shell-host` is **absent** when closed (`@container/main` is then a direct child of ROW B).

```
body
└─ div.flex.h-svh.w-screen.flex-col                                       struct.md:21 / wide:40   app-root            [stacking-context root]
   ├─ div.relative.z-0.flex.min-h-0.w-full.flex-1                         struct.md:22 / wide:54   ROW A               [stacking-context z-0]
   │  └─ div.relative.flex.min-h-0.w-full.flex-1                          struct.md:23 / wide:55   ROW B
   │     ├─ div#stage-slideover-sidebar  relative z-21 h-full shrink-0 overflow-hidden border-e max-md:hidden  struct.md:42  sidebar  [shrink-0, in-flow width-carrier]
   │     └─ div.@container/main relative flex min-w-0 flex-1 flex-col …    wide:1232                main column         [container-root, flex-1]  (DIRECT child of ROW B)
   │        └─ div[data-scroll-root]  relative flex min-h-0 min-w-0 flex-1 flex-col
   │           │   [scrollbar-gutter:stable]  @w-sm/main:[scrollbar-gutter:stable_both-edges]
   │           │   not-print:overflow-x-clip not-print:overflow-y-auto  scroll-pt-(--header-height)  wide:1233  SCROLL PORT  [scroll-port, scrollbar-gutter, scroll-pt]
   │           ├─ header#page-header  sticky top-0 z-20 h-header-height pointer-events-none …  struct.md:98  HEADER  [landmark, sticky, z-20, stacking-context]
   │           └─ main#main  min-h-0 flex-1   (NO flex-col)               wide:1272                MAIN                [landmark, flex-1]
   │              └─ div#thread  group/thread flex flex-col min-h-full    struct.md:126            THREAD              [flex-col]
   │                 └─ div[role=presentation].composer-parent flex flex-1 flex-col  struct.md:131  COMPOSER-PARENT    [flex-1]
   │                    ├─ div.relative.basis-auto.flex-col.-mb-(--composer-overlap-px)
   │                    │      [--composer-overlap-px:28px].grow.flex      struct.md:132            TURNS-WRAPPER       [grow, overlap-reserve(-mb)]
   │                    │  ├─ div[data-edge][aria-hidden]                  struct.md:133            (edge spacer)
   │                    │  └─ div.flex.flex-col.text-sm.pb-25              struct.md:134            TURNS-LIST
   │                    │     ├─ article[data-turn=user][data-turn-id][data-scroll-anchor=false] w-full scroll-mt-(--header-height)  struct.md:135,148  ARTICLE(user)  [landmark]
   │                    │     │  └─ div.text-base.…[gutter tiers]  →  div.[cap].mx-auto  →  div[data-message-author-role=user][data-message-id]  (author = plain DIV)
   │                    │     └─ article[data-turn=assistant][data-scroll-anchor=true] …
   │                    └─ div#thread-bottom-container  sticky bottom-0 isolate
   │                           relative z-10 w-full basis-auto content-fade flex flex-col  struct.md:232  COMPOSER  [sticky, z-10, isolate, stacking-context]
   └─ div                                                                  struct.md:24             empty portal-mount sibling (ROW A's sibling)
```

**Body-level siblings of app-root** (both states; `struct.md:16-33`): skip-link `div.fixed.inset-x-0.top-0.z-50 > a[data-skip-to-content][href="#main"]`; **four** `sr-only` `aria-live` regions `#live-region-assertive/polite`, `#aria-notify-live-region-assertive/polite` (`struct.md:28-31`); trailing `audio.fixed.hidden`.

---

## 2. Our structural skeleton

```
HistorySearchProvider › ActivityPanelHostProvider  (context only, no DOM)            layout-app.tsx:18-19   (DockSlotContext bridge)
└─ div.flex.h-svh.w-full.overflow-hidden                                  layout-app.tsx:20   APP-ROOT          [single flex-ROW; NO outer flex-col, no z-0 row]
   ├─ <AppSidebar/>  (preferences.layout==="sidebar")                     layout-app.tsx:21   sidebar           [own width owner — fixed shell + gap spacer; see §3 / Rank 4]
   │
   ├─ div.@container/main.relative.flex.min-w-0.flex-1.flex-col           layout-app.tsx:22   MAIN COLUMN       [container-root, width-carrier, flex-1; relative, NOT a z-0 ctx]
   │  └─ ScrollRoot inner div  relative flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-clip   scroll-root.tsx:62-69  SCROLL PORT  [scroll-port; ref=scrollRef; NO data-scroll-root attr]
   │     │   + min-w-0 scroll-pt-[var(--spacing-app-header)] [scrollbar-gutter:stable]
   │     │     @sm/main(24rem):[scrollbar-gutter:stable_both-edges] pointer-coarse:[scrollbar-width:none] print:overflow-visible   layout-app.tsx:23
   │     │
   │     ├─ <header>  sticky top-0 z-20 shrink-0 h-app-header bg-background pointer-events-none
   │     │     @7xl/main(80rem):bg-transparent @7xl/main:[box-shadow:none]!               header.tsx:38-39   HEADER  [landmark, sticky, z-20, stacking-context]
   │     │
   │     └─ main#main  flex min-h-0 flex-1 flex-col                       layout-app.tsx:25   MAIN              [landmark; flex-col HERE — ChatGPT defers it to #thread]
   │        └─ {app/page.tsx → ChatContainer → <Chat/>}
   │           └─ div#thread  group/thread flex min-h-full flex-1 flex-col   chat.tsx:368     THREAD            [flex-col, min-h-full]
   │              ├─ <DialogAuth/> (portal, off-spine)                     chat.tsx:369
   │              ├─ <ActivityPanel …/>  (rendered here, PORTALS OUT to dock slot)   chat.tsx:371-376 → activity-panel.tsx createPortal
   │              └─ div[role=presentation].composer-parent flex flex-1 flex-col   chat.tsx:379-380  COMPOSER-PARENT  [flex-1]
   │                 ├─ <AnimatePresence mode="popLayout"> → <Conversation/>   chat.tsx:382-408
   │                 │     └─ ScrollRootContent div  relative -mb-[var(--composer-overlap-px)]
   │                 │         flex w-full flex-1 flex-col items-center pt-4 pb-[var(--thread-bottom-offset)]
   │                 │         [--composer-overlap-px:28px] […]            conversation.tsx:133  CONTENT  [overlap-reserve(-mb), centering(items-center)]
   │                 │        ├─ data-edge="top" sentinel                  conversation.tsx:134-138
   │                 │        ├─ messages.map → <TurnRow>                  conversation.tsx:162-171 / 60-80
   │                 │        │   OUTER (article|div, data-turn):
   │                 │        │     mx-auto w-full px-[var(--thread-content-margin,1rem)] text-base ${THREAD_GUTTER_VARS}   conversation.tsx:165  TURN GUTTER  [gutter, centering(mx-auto)]
   │                 │        │     +user: scroll-mt-[--spacing-app-header] pt-3 · +asst: scroll-mt-[calc(…+20svh)] pb-10
   │                 │        │   └─ INNER div.group/turn-messages relative mx-auto flex w-full
   │                 │        │       max-w-[var(--thread-content-max-width,40rem)] min-w-0 flex-1 flex-col ${THREAD_MAXWIDTH_VARS}   conversation.tsx:74  MESSAGE COLUMN  [cap, centering(mx-auto)]
   │                 │        │      └─ <Message/> = components/ui/message.tsx:37  <article …>  (INNER article — see Rank 3; data-turn DUP, data-message-id)
   │                 │        ├─ pending-assistant <TurnRow as="div">      conversation.tsx:200-224
   │                 │        └─ data-edge="bottom" sentinel               conversation.tsx:226-230
   │                 │
   │                 └─ div#thread-bottom-container  sticky bottom-0 isolate z-10
   │                     flex min-h-0 w-full basis-auto flex-col px-[var(--thread-content-margin,1rem)]
   │                     pb-[env(safe-area-inset-bottom)] ${THREAD_GUTTER_VARS}   chat.tsx:413-415  COMPOSER  [sticky, z-10, isolate, stacking-context, gutter]
   │                    ├─ ScrollButton wrapper (h-0, z-30)               chat.tsx:419-427
   │                    ├─ div#thread-bottom  mx-auto w-full
   │                    │    max-w-[var(--thread-content-max-width,40rem)] ${THREAD_MAXWIDTH_VARS}   chat.tsx:429-430  COMPOSER CAP  [cap, centering]
   │                    └─ disclaimer footer                              chat.tsx:434-444
   │
   └─ <ActivityPanelDockSlot/>                                            layout-app.tsx:34 → activity-panel-host.tsx:71-90
       div[data-slot=activity-panel-dock][data-testid=stage-thread-flyout][data-state=closed]
         relative w-0 shrink-0 overflow-hidden transition-[width] duration-[500ms]
         ease-[cubic-bezier(0.22,1,0.36,1)] max-lg:w-0! max-lg:transition-none motion-reduce:transition-none
         data-[expanded]:w-[var(--activity-panel-width)]                            PANEL WIDTH-CARRIER  [shrink-0, flex sibling of @container/main]
```

**Bridge.** `<ActivityPanel>` renders inside `#thread` (`chat.tsx:371-376`) but `createPortal`s its docked subtree into the dock-slot element shared via `DockSlotContext` (`activity-panel-host.tsx:29-44,64-69`). The slot owns the width animation; below `lg` it renders a Base UI Sheet instead. **Our `@sm/@lg/@7xl/main` are Tailwind defaults** (no container-scale override in `app/globals.css`'s `@theme`): `@sm/main`=24rem, `@lg/main`=32rem, `@7xl/main`=80rem (`thread-bounds.ts:18-36` documents the 24/32rem/512px values directly).

---

## 3. Structural divergence map

| Node | ChatGPT's form | Our form | Verdict |
|---|---|---|---|
| **Thread gutter/cap tiers** | gutter steps at `@w-sm/main`=**40rem** & `@w-lg/main`=**64rem**; cap flips at `@w-lg/main`=**64rem** (`1609px:1280-1281`, breakpoint scale) | gutter at `@sm/main`=**24rem** & `@lg/main`=**32rem**; cap at `@lg/main`=**32rem** (`thread-bounds.ts:19-20,35-36`) | **structural delta — Rank 1** (values match, thresholds ≈1.6× narrower; wider column than ChatGPT in the 512–1024px band) |
| scrollbar-gutter both-edges | `@w-sm/main`=**40rem** (`struct.md:87`, `panel-open:3332`) | `@sm/main`=**24rem** (`layout-app.tsx:23`) | **structural delta** (same `@w-` vs `@` root cause; folded into Rank 1) |
| Global aria-live | four body-level `sr-only` regions (`struct.md:28-31`) | none (`layout.tsx:61-69`) | **structural delta — Rank 2** |
| Turn element nesting | ONE `<article>` + author `<div data-message-author-role>` (`struct.md:152-160`) | nested `<article>` (`conversation.tsx:72`) > inner `<article>` (`message.tsx:37`); `data-turn` duplicated; no `data-message-author-role` | **structural delta — Rank 3** |
| Sidebar width carrier | in-flow `relative z-21 shrink-0` shell, own `style.width` (`struct.md:42`, `1609px:56`) | `fixed z-10` shell + phantom in-flow `sidebar-gap` spacer (`sidebar.tsx:242,254-257`) | **structural delta — Rank 4** |
| Header scroll-pt collapse | `has-data-[fixed-header]:@w-xl/main:scroll-pt-0` + `--sticky-padding-top:0` (`1609px:1233`) | static `scroll-pt-[--spacing-app-header]`, no reset (`layout-app.tsx:23`) | **structural delta — Rank 5** |
| Scroll-port DOM hook | `div[data-scroll-root]` keys real CSS off the node (`struct.md:87`) | same role, **no `data-scroll-root` attr** (`scroll-root.tsx:62-69`) | **structural delta — Rank 6** |
| Turn id hook | stable `data-turn-id` UUID on the article (`struct.md:135,269`) | none (grep 0); only inner `data-message-id` | **structural delta — Rank 7** |
| Collapsed-rail / quick-actions landmarks | `<nav aria-label="Sidebar">` + `<aside>` (`conversation-with-activity-panel.md:50`, `sidebar/chatgpt-expanded-html.md:154`) | `<div>` + `<div>` (`app-sidebar.tsx:117,358`); expanded `<nav aria-label="Chat history">` already matches (`:307`) | **structural delta — Rank 8** |
| `<main>` flex axis | `min-h-0 flex-1`, NO flex-col; column on `#thread` (`struct.md:89,126`) | `flex min-h-0 flex-1 flex-col` (redundant) (`layout-app.tsx:25`) | **cosmetic/structural delta — Rank 9** |
| Header transparency tier | container `@w-xl/main`=80rem + `@w-2xl/main`=96rem, `data-fixed-header` JS gate (`matched-rules.json:42,54`) | single container `@7xl/main`=80rem, no JS gate (`header.tsx:39`) | **structural delta — Rank 10** (axis + lower tier match; 2nd tier is a data-feature) |
| `@container/main` column | `flex-1` container-root, panel-dependent (`:3329`) | identical `@container/main … flex-1` (`layout-app.tsx:22`) | **same** |
| App-root | flex-COL → ROW A (z-0) → ROW B (`struct.md:21-23`) | single flex-ROW (`layout-app.tsx:20`) | **intentional-better-divergence** (App. A§1) |
| Header landmark/sticky/z | real `<header id>` sticky top-0 z-20 (`struct.md:98`) | identical (`header.tsx:38-39`) | **same** |
| Scroll/sticky boundary set | single scroll owner; header sticky top-0 z-20, composer sticky bottom-0 isolate z-10 inside (`struct.md:87,98,232`) | identical (`scroll-root.tsx:65`, `header.tsx:39`, `chat.tsx:413`) | **same** |
| Composer position/overlap | sticky bottom-0 isolate z-10; `-mb-(--composer-overlap-px)` 28px on turns-wrapper (`struct.md:232,132`) | identical mechanism; overlap on `ScrollRootContent` (`chat.tsx:413`, `conversation.tsx:133`) | **same / intentional-better-divergence** (App. A§3) |
| Composer gutter/cap nesting | two inner divs under `#thread-bottom` (`:7180,:7184`) | gutter on `#thread-bottom-container`, cap on `#thread-bottom` (`chat.tsx:415,430`) | **intentional-better-divergence** (App. A§4 — THREAD_*_VARS invariant) |
| Panel width carrier | open-only host + in-flow rail + ROW-A flyout (`:3324,:7508,:7515`) | single always-mounted dock-slot `shrink-0` sibling (`layout-app.tsx:34`) | **intentional-better-divergence** (App. A§2) |
| Panel docked↔sheet / sidebar gates | viewport `max-lg`=64rem (`:7519`) / `max-md` | viewport `max-lg` + `matchMedia 1024` (`activity-panel-host.tsx:86`) / `md` | **same** (correctly viewport, App. A§5) |
| Skip-link, sr-only turn headings, role=presentation, data-scroll-anchor | present (`struct.md:148,156,…`) | present (`layout.tsx:64`, `message-user.tsx:196`, `message-assistant.tsx:269`, `chat.tsx:379`, `message-*` `data-scroll-anchor`) | **same** (App. A§6 — do not regress) |

---

## 4. Ten ranked recommendations

### Rank 1 — Reconcile the thread responsive tiers: ChatGPT fires them on the breakpoint scale (40/64rem), we fire on the container scale (24/32rem)
**Value 8/10.** Highest-leverage finding: it is the container-query-axis divergence the brief prioritized, it produces a **visible width difference at the most common desktop widths**, and it corrects a **factual error in shipped code's comment**. Down-weighted from a perfect score only because the *fix* is entangled with a deliberate anti-pop decision (so "what to do" needs a product/live call, even though "what ChatGPT does" is exact).

**ChatGPT does X.** The turn gutter and the composer gutter use `[--thread-content-margin:--spacing(4)] @w-sm/main:[--thread-content-margin:--spacing(6)] @w-lg/main:[--thread-content-margin:--spacing(16)]` and the message column / composer cap use `[--thread-content-max-width:40rem] @w-lg/main:[--thread-content-max-width:48rem]` — `reference-ui/ChatGPT/pages/chatgpt-conversation-html-example-desktop-1609px-light.md:1280-1281` (also `…/conversation-with-activity-panel.md:3466,3469,7180,7184`). The scroll-port's `both-edges` gutter is at `@w-sm/main` (`struct.md:87`). **`@w-*` resolves on the breakpoint scale**, so the thresholds are **`@w-sm/main`=40rem, `@w-lg/main`=64rem** — proof: `--breakpoint-lg`=64rem / `--breakpoint-2xl`=96rem (`matched-rules.json:4685-4690`); the only compiled `@container main` contexts are `width≥80rem` and `width≥96rem` (`matched-rules.json:42,54`) = the header's `@w-xl/main`/`@w-2xl/main`, equal to `--breakpoint-xl`/`--breakpoint-2xl`, **not** `--container-xl`(36)/`--container-2xl`(42).

**We do Y.** `THREAD_GUTTER_VARS` = `[--thread-content-margin:1rem] @sm/main:[…:1.5rem] @lg/main:[…:4rem]` and `THREAD_MAXWIDTH_VARS` = `[--thread-content-max-width:40rem] @lg/main:[…:48rem]` (`app/components/chat/thread-bounds.ts:19-20,35-36`), plus `@sm/main:[scrollbar-gutter:stable_both-edges]` (`app/components/layout/layout-app.tsx:23`). These use the **default** `@*/main` family = container scale, so they fire at **`@sm/main`=24rem, `@lg/main`=32rem**. The `thread-bounds.ts:22-33` comment asserts `@lg/main`=32rem "mirrors ChatGPT byte-for-byte (`@w-lg/main` = `--container-lg` = 32rem)" — that equivalence is **incorrect**; `@w-lg/main`=64rem.

**The gap & why it matters.** Values match (1/1.5/4rem; 40/48rem) but thresholds are ≈1.6× apart. Consequence in the **512–1024px container band** (extremely common desktop widths, panel closed): we render the **48rem-capped column with a 4rem gutter** where ChatGPT still shows the **40rem-capped column with a 1.5rem gutter**. So our conversation column reads as *too wide with too much side padding* versus ChatGPT until the container exceeds 1024px. The `both-edges` scrollbar gutter likewise reserves earlier (24rem vs 40rem). This is the textbook container-vs-viewport-axis fidelity bug, and the mislabeled comment risks future edits "fixing" the wrong number.

**Proposed change (decision-gated, not a blind flip).** First, correct the `thread-bounds.ts` comment to state the real mapping (`@w-lg/main`=64rem, `@w-sm/main`=40rem; `@w-*` = breakpoint scale). Then choose, consciously:
- **(a) Match ChatGPT's thresholds** — shift the tiers to `@[40rem]/main` / `@[64rem]/main` (or register a `@w-*`-equivalent breakpoint-scale container family). This restores byte-accurate responsive behavior but reintroduces the cap-flip *inside* the panel sweep that the codebase deliberately removed (the "narrow→expanded pop," `thread-bounds.ts:31-33`). Note ChatGPT itself re-caps mid-sweep (its #thread reflows 1020→619 @1280), so the pop may be *intended* parity, not a defect — confirm via live measurement (App. B).
- **(b) Keep 24/32rem as a conscious divergence** — if the smooth panel close is judged more important than mid-band width fidelity, keep the values but **relabel** the comment as an intentional divergence (not "matching ChatGPT") and record it in the regression ledger.

Either way preserves the **THREAD_*_VARS byte-identical invariant** (the var strings are still appended last; only their tier prefixes/values change, identically across both consumer sites).

**Blast radius.** `app/components/chat/thread-bounds.ts:19-20,35-36` (the only tier definitions) + its comment `:22-33`; consumers that interpolate the vars **must stay byte-identical**: `conversation.tsx:74,165,202`, `chat.tsx:415,430`, `app/test/thinking-states/page.tsx` (THREAD_*_VARS importers — grep `THREAD_GUTTER_VARS|THREAD_MAXWIDTH_VARS`); scrollbar-gutter tier `layout-app.tsx:23`; the `--thread-content-max-width`/`--thread-content-margin` *consumers* are inline and unchanged. No test asserts a specific tier width. The dock-slot 500ms close sweep (`activity-panel-host.tsx:86`) interacts with option (a) — re-verify live.

**Effort & confidence.** Comment fix S; threshold change M · **what ChatGPT does = exact; recommended action = strong** (the trade-off is a design call).

---

### Rank 2 — Add global aria-live regions for streaming responses and app status
**Value 7/10.** Real unmet a11y gap, fidelity-exact, additive/low-risk. Below 8 because it is a11y-semantics rather than core flex/scroll/axis topology, and effort is M (wiring the status machine, not the DOM).

**ChatGPT does X.** Four persistent body-level `sr-only` divs, siblings of and outside the app-root, surviving route swaps: `#live-region-assertive`, `#live-region-polite`, `#aria-notify-live-region-assertive`, `#aria-notify-live-region-polite` — `reference-ui/ChatGPT/pages/chatgpt-conversation-html-structure.md:28-31` (table `:328-331`).

**We do Y.** No global/persistent live regions. `app/layout.tsx:61-69` has the skip-link but no live regions; the streaming assistant article (`app/components/chat/message-assistant.tsx:261-274`) has only an sr-only `<h6>` at `:269`. Grep `aria-live` across `app/` = 0 global hits (only scattered component-local `role=alert/status`).

**The gap & why it matters.** Screen-reader users get **no announcement** as an assistant response streams or finishes, and there is no app-wide polite/assertive channel for status/errors. Body-level placement (outside the app-root) is the load-bearing structural detail — the regions must survive route changes and not unmount mid-announcement.

**Proposed change.** Add a small client component rendering `sr-only` `aria-live` polite + assertive divs at body level in `app/layout.tsx`, sibling of the skip-link and **outside** Providers/LayoutApp so they persist. Wire the chat status machine (stream start/finish, stop, errors) into polite (response) vs assertive (errors). MVP = the polite "response" region first. Use Tailwind `sr-only`; do **not** copy ChatGPT's `#live-region-*` ids (app-internal). No THREAD_*_VARS implication.

**Blast radius.** `app/layout.tsx:61-69` (insert outside Providers); `app/components/chat/message-assistant.tsx:261-274` (read status, no structural change); no test references the ids; no `#live-region-*` collisions; THREAD_*_VARS untouched.

**Effort & confidence.** M · exact (gap) / strong (wiring).

---

### Rank 3 — Collapse the nested `<article>` turn elements to one article + an author `<div data-message-author-role>`
**Value 6.5/10.** Verified double-landmark a11y bug plus a missing author-role hook. Below 7 because the fix must be opt-in (a blunt global swap regresses the share page) and it carries no layout/scroll/axis leverage.

**ChatGPT does X.** Exactly ONE `<article>` per turn; the author node beneath is a plain `<div data-message-author-role="user|assistant" data-message-id …>` (assistant also `data-message-model-slug`) — `reference-ui/ChatGPT/pages/chatgpt-conversation-html-structure.md:152,156,177,182`. `data-turn` appears once (on the article).

**We do Y.** Two nested articles: `TurnRow` outer `<article data-turn>` (`app/components/chat/conversation.tsx:60-72`) wraps `Message`, which is itself a hardcoded `<article>` (`components/ui/message.tsx:37`) carrying `data-turn` (duplicated) + `data-message-id` (`message-user.tsx`, `message-assistant.tsx`). `data-message-author-role` is absent everywhere (grep 0). Note `TurnRow` already accepts `as?: "article" | "div"` (`conversation.tsx:60-69`) — the configurability gap is on the **inner** `Message` only.

**The gap & why it matters.** Nested articles emit two stacked "article" landmarks for one logical turn; AT/document-outline tooling sees the turn twice, `data-turn` is redundant, and there is no role-typed author hook. ChatGPT exposes one landmark + a typed author div.

**Proposed change.** Make the **inner** `Message` element configurable via an `as`/render prop (default keeps `article` for safety; `Conversation`'s `TurnRow` children pass `'div'`), and add `data-message-author-role="user|assistant"` to that inner node. Keep the single outer `TurnRow <article>` as the turn landmark. **Do NOT** do a blunt global `<article>→<div>` swap. Class strings / THREAD_*_VARS untouched.

**Blast radius.** `components/ui/message.tsx:37` (add `as`/render prop + author-role); `app/components/chat/conversation.tsx:60-78` (outer landmark retained, pass `'div'`); `message-user.tsx`, `message-assistant.tsx` (pass `'div'`, set author-role); **regression guard** `app/share/[chatId]/article.tsx` — keep `'article'` there (Message sits inside a plain `<div key>`, so its `<article>` is the only landmark on that path, verified by the critic); `useAssistantMessageSelection.ts` uses `closest('[data-message-id]')` (tag-agnostic, SAFE); `app/test/thinking-states/page.tsx` imports Message (verify no article assumption); no `getByRole('article')`/tag assertions/`data-turn`/`data-message-author-role` selectors in tests; no CSS targets the `article` tag.

**Effort & confidence.** M · exact.

---

### Rank 4 — Unify the sidebar onto an in-flow `shrink-0` shell (drop the `fixed` shell + phantom gap)
**Value 6/10.** Highest-leverage width-topology divergence after Rank 1; parallels the dock pattern we already adopted. Downscored for primitive-level risk (vendored shadcn shell, three collapsible variants to re-derive) and a prophylactic-not-live bug.

**ChatGPT does X.** The sidebar is an in-flow flex sibling that is itself the width carrier — `#stage-slideover-sidebar … relative z-21 h-full shrink-0 overflow-hidden border-e max-md:hidden` with `style="width:var(--sidebar-width)"` — `reference-ui/ChatGPT/pages/chatgpt-conversation-html-example-desktop-1609px-light.md:56` (also `…/chatgpt-conversation-html-structure.md:42`). No phantom spacer; the shell's own `shrink-0` width reflows the `flex-1` main column directly.

**We do Y.** A two-node mechanism — a `position:fixed` shell `data-slot="sidebar-container"` (`components/ui/sidebar.tsx:254-257`, the `fixed inset-y-0 z-10 … w-(--sidebar-width)` line) paired with a separate in-flow `data-slot="sidebar-gap"` spacer (`:242`) whose width animates to push the main column. The fixed shell paints over the gap.

**The gap & why it matters.** (a) Gap width and fixed-shell width must stay in lockstep — a latent desync class where one transitions and the other snaps, so the main column under/over-reserves space; (b) intra-codebase inconsistency — the activity dock already uses the in-flow `shrink-0` sibling-shrink pattern (`layout-app.tsx:34`) for the same "reserve width and reflow" job. Unifying removes the phantom-spacer class and gives both rails one mental model — and aligns with ChatGPT.

**Proposed change.** Replace the `fixed` shell + `sidebar-gap` pair with a single `relative shrink-0 w-(--sidebar-width)` shell (dock-slot pattern); keep the width var + transition on the shell, and the `id=SIDEBAR_CONTAINER_ID` (aria-controls target). Re-derive the three collapsible-variant selector groups (`offcanvas:w-0`, `offcanvas:left-…`, `icon:w-(--sidebar-width-icon)`) onto the single node; for offcanvas, animate the node's own width to 0 (like the dock's `data-[expanded]`). **Real behavior change** — re-verify against collapsed/icon/offcanvas + mobile-sheet and the `absolute z-10` collapsed rail (`app-sidebar.tsx:117`) and drag handle that assume current stacking. No THREAD_*_VARS implication.

**Blast radius.** `components/ui/sidebar.tsx:242` (drop gap — only definition), `:254-257` (fixed→relative shrink-0), `:34,209,254,295,763` (`SIDEBAR_CONTAINER_ID` must survive); `app/components/layout/header-sidebar-trigger.tsx` + `app/components/layout/sidebar/app-sidebar.tsx:30,230` (aria-controls consumers); `SidebarInset` (`sidebar.tsx`) has no in-app consumers; `--sidebar-width` (`globals.css`, `app-sidebar.tsx:203`) unaffected; `<Sidebar>` shell used only at `app-sidebar.tsx:101`; no DOM-topology tests reference `sidebar-gap`/`sidebar-container`.

**Effort & confidence.** M · strong. (Canonical path is `components/ui/sidebar.tsx`, not `app/components/ui/...`.)

---

### Rank 5 — Collapse `scroll-pt` to 0 when the header goes transparent (`--sticky-padding-top` indirection)
**Value 5.5/10.** Verified, axis-correct (container tier), real mis-anchor at the wide tier — but the payoff is confined to a **≥80rem container** regime that is rare while the panel is open, and the full fix also touches the per-turn `scroll-mt` anchors.

**ChatGPT does X.** The scroll port declares `scroll-pt-(--header-height)` AND `[--sticky-padding-top:var(--header-height)]`, then resets both at the transparent tier: `has-data-[fixed-header=less-than-xl]:@w-xl/main:scroll-pt-0` + `…[--sticky-padding-top:0px]` (plus the `@w-2xl/main` twin) — `reference-ui/ChatGPT/pages/chatgpt-conversation-html-example-desktop-1609px-light.md:1233`. The header goes transparent at the same tier (`:1234`). `@w-xl/main`=80rem, `@w-2xl/main`=96rem (`matched-rules.json:42,54`).

**We do Y.** Static `scroll-pt-[var(--spacing-app-header)]` (52px), no `--sticky-padding-top` var, no `@7xl/main:scroll-pt-0` reset (`app/components/layout/layout-app.tsx:23`) — even though our header DOES go `bg-transparent`+`[box-shadow:none]!` at `@7xl/main`=80rem (`header.tsx:39`). `--spacing-app-header`=52px (`globals.css`) = ChatGPT's header-height.

**The gap & why it matters.** At ≥80rem container the header is visually gone, but scroll-into-view of a turn (and each turn's `scroll-mt-[--spacing-app-header]`) still reserves 52px, so anchored turns land 52px below the now-transparent header — a mis-anchor ChatGPT explicitly fixes. Note our `@7xl/main`=80rem **byte-matches** ChatGPT's lower tier here, so the axis & value are already right; only the reset is missing.

**Proposed change.** On the scroll-port className add `@7xl/main:scroll-pt-0`; introduce `[--sticky-padding-top:var(--spacing-app-header)]` + `@7xl/main:[--sticky-padding-top:0px]`, and re-point the per-turn `scroll-mt` (`conversation.tsx:166,168,202`) at `--sticky-padding-top` so port AND turn anchors collapse from one source. We correctly need only ONE tier (no 96rem twin). `scroll-pt` is untransitioned and container-gated → no panel-close pop. No THREAD_*_VARS impact.

**Blast radius.** `layout-app.tsx:23` (edit site); `conversation.tsx:166,168,202` (turn `scroll-mt` co-fix); `chat.tsx` consumes `--spacing-app-header` for sizing (unaffected); `globals.css` source var; no test references `scroll-pt`/`scroll-mt`/`sticky-padding`; pairs with Rank 6 if ever moved to a `has-data-[…]` form.

**Effort & confidence.** M · strong.

---

### Rank 6 — Add a `data-scroll-root` attribute to our scroll port
**Value 5/10.** Verified exact, trivially safe and additive; mid-ranked because in isolation it changes nothing observable — its value is as an enabler for Rank 5 and for test/e2e/devtools targeting.

**ChatGPT does X.** `div[data-scroll-root=""]` on the single scroll owner, keying real CSS off the same node's state (`has-data-[fixed-header=…]:scroll-pt-0`) — `reference-ui/ChatGPT/pages/chatgpt-conversation-html-example-desktop-1609px-light.md:1233` (also `…structure.md:87`, table `:265`).

**We do Y.** The ScrollRoot inner div sets only `ref={scrollRef}` + merged className; no `data-scroll-root` or any data-* hook (`components/ui/scroll-root.tsx:62-69`). The scroll owner is discoverable only via React `ScrollRootContext`, never via CSS/`querySelector`. Grep `data-scroll-root` repo-wide = 0.

**The gap & why it matters.** No DOM/CSS hook for the scroll port; tests, future `has-*` descendant CSS (incl. Rank 5), and devtools must route through React internals.

**Proposed change.** In `components/ui/scroll-root.tsx` add a literal `data-scroll-root=""` **before** `{...props}` so callers can override. No className change, no THREAD_*_VARS impact, no layout effect.

**Blast radius.** `scroll-root.tsx:62-69` (only edit site); `layout-app.tsx:23` (sole port consumer, no conflicting prop); `ScrollRootContent` is a separate node (`scroll-root.tsx:98`); context consumers (`message-user.tsx`, `header.tsx:25`, `scroll-button.tsx`, `chat.tsx:194`) unaffected; no test selects on it.

**Effort & confidence.** S · exact.

---

### Rank 7 — Add a stable `data-turn-id` to each turn article
**Value 5/10.** Verified-exact semantics/hooks parity, additive and safe; mid-ranked because the stated brittleness is mild (we already have `closest('[data-message-id]')`) and the bigger fidelity gap in this node — the redundant nested article — is Rank 3.

**ChatGPT does X.** Each turn article carries a stable UUID decoupled from message ordering: `<article data-testid="conversation-turn-N" data-turn="…" data-turn-id="…uuid…" data-scroll-anchor="…">` — `reference-ui/ChatGPT/pages/chatgpt-conversation-html-structure.md:135-136`, table `:269`; the assistant `data-turn-id` differs from either inner `data-message-id`, proving turn-level identity over a multi-message turn.

**We do Y.** `TurnRow` outer renders `<As data-turn={role}>` with no `data-turn-id` (`app/components/chat/conversation.tsx:72`; call sites `:165,:202`). Turn identity is exposed only as inner `data-message-id` (`message-user.tsx`, `message-assistant.tsx`). Grep `data-turn-id` = 0.

**The gap & why it matters.** ChatGPT addresses turns by a stable per-turn id on the turn element; we can only target inner `data-message-id` one level deeper (assistant has two), which is brittle for `querySelector` scroll/anchor and e2e selectors.

**Proposed change.** Thread the per-TURN id (the user/anchor message id) into `TurnRow` as a `dataTurnId` prop and render `data-turn-id={dataTurnId}` on the outer `<As>` (`conversation.tsx:72`) and the pending-assistant TurnRow (`:200`). Pure additive attribute; no className change → THREAD_*_VARS byte-identical invariant untouched.

**Blast radius.** `conversation.tsx:72` (add attr), `:162-171` (thread `message.id`), `:200-204` (pending — pass `PENDING_ACTIVITY_TURN_ID`), `:60-69` (signature); `useAssistantMessageSelection.ts` `closest('[data-message-id]')` UNAFFECTED; `conversation.test.tsx` asserts only `data-testid=message-${id}` (no turn-id/role/article assertions); no e2e suite.

**Effort & confidence.** S · exact.

---

### Rank 8 — Promote the collapsed sidebar rail to `<nav aria-label="Sidebar">` and quick-actions to `<aside>`
**Value 4/10.** Verified landmark-parity nits from the sidebar decomposition. Low leverage (a11y landmark naming, no topology change), but a clean, safe win.

**ChatGPT does X.** The newest build promotes the collapsed rail to `<nav id="stage-sidebar-tiny-bar" aria-label="Sidebar">` (`reference-ui/ChatGPT/pages/conversation-with-activity-panel.md:50`) and the sticky quick-actions block to `<aside>` (`…/components/sidebar/chatgpt-expanded-html.md:154`). The expanded scrollport is already `<nav aria-label="Chat history">`.

**We do Y.** The collapsed rail is a `<div>` (`app/components/layout/sidebar/app-sidebar.tsx:117`) and quick-actions is a `<div>` (`:358`). Our expanded scrollport `<nav aria-label="Chat history">` (`:307-311`) and `<h2 class="sr-only">Chat history</h2>` (`:304`) already match.

**The gap & why it matters.** Two missing landmarks — the collapsed rail and the quick-actions region are not exposed as navigation/complementary landmarks, so they're invisible to AT landmark navigation.

**Proposed change.** Change the collapsed-rail wrapper `<div>` → `<nav aria-label="Sidebar">` (`app-sidebar.tsx:117`) and the quick-actions `<div>` → `<aside>` (`:358`). Verify no CSS selector relies on those being divs. No THREAD_*_VARS impact. Independent of Rank 4.

**Blast radius.** `app-sidebar.tsx:117` (rail element), `:358` (quick-actions element); confirm no tag-based CSS/test targets these wrappers (none found).

**Effort & confidence.** S · strong.

---

### Rank 9 — Move `flex-col` off `<main>` down to `#thread`
**Value 4/10.** Verified-exact parity nit, trivially safe; ranked low because it has no behavioral payoff today (the extra flex context is inert) — justified on single-owner clarity and a latent second-child foot-gun.

**ChatGPT does X.** `<main#main class="min-h-0 flex-1">` — NO flex-col; the column axis is established one level down on `#thread` (`group/thread flex flex-col min-h-full`) — `reference-ui/ChatGPT/pages/chatgpt-conversation-html-structure.md:89,126`. `<main>` is a pure flex-1 sizing landmark.

**We do Y.** `<main id="main" className="flex min-h-0 flex-1 flex-col">` (`app/components/layout/layout-app.tsx:25`) AND `#thread` is also `flex min-h-full flex-1 flex-col` (`chat.tsx:368`). Column axis declared twice in a row.

**The gap & why it matters.** A redundant flex context on `<main>`. Harmless today (`#thread` is the sole child and re-establishes flex-col + height-fill), but it diverges from ChatGPT's thin-landmark seam and is one extra place a future second child could get unexpected column stacking.

**Proposed change.** Change `layout-app.tsx:25` from `flex min-h-0 flex-1 flex-col` → `min-h-0 flex-1` (drop `flex flex-col`). `#thread` keeps the column flow. No THREAD_*_VARS impact.

**Blast radius.** `app/layout.tsx:64` skip-link `href="#main"` targets by id (unchanged); `app/auth/_components/auth-shell.tsx` is a SEPARATE `id="main"` (out of scope); `components/ui/sidebar.tsx` `SidebarInset` `<main>` is unrelated/unused; no `getByRole('main')`/`#main` test selectors; no `getElementById('main')`.

**Effort & confidence.** S · strong.

---

### Rank 10 — Add the second header-transparency tier + `data-fixed-header` gate (opt-in; only with a product need)
**Value 3.5/10.** Verified data/feature delta, **not** an axis gap (our axis and lower tier already match). Listed to complete the ten and explicitly flagged borderline — implement only with a product requirement.

**ChatGPT does X.** TWO container transparency tiers selected by a runtime attribute — `data-[fixed-header=less-than-xl]:@w-xl/main:bg-transparent` (80rem) and `data-[fixed-header=less-than-xxl]:@w-2xl/main:bg-transparent` (96rem) — `reference-ui/ChatGPT/pages/chatgpt-conversation-html-structure.md:98`; contexts `matched-rules.json:42,54`. Paired with the scroll-pt reset of Rank 5.

**We do Y.** A single hard-coded container tier `@7xl/main:bg-transparent @7xl/main:[box-shadow:none]!` (80rem) with no `data-fixed-header` attribute (`app/components/layout/header.tsx:39`). Our `@7xl/main`=`--container-7xl`=80rem byte-matches ChatGPT's lower `less-than-xl` tier.

**The gap & why it matters.** We cannot vary the transparency breakpoint per layout context (no 96rem tier, no data-attr selector). This is a feature/data delta, not topology or axis — the axis (container `@…/main`) and the 80rem value already match.

**Proposed change.** If context-dependent header breakpoints are ever required, add a `data-fixed-header` attribute on `<header>` and a second `@[96rem]/main` transparency tier gated by it, **and** bring its paired `scroll-pt-0`/`--sticky-padding-top:0` reset (Rank 5). Otherwise leave as-is. No THREAD_*_VARS impact.

**Blast radius.** `header.tsx:39` (header className + new data-attr); `layout-app.tsx:23` (companion scroll-pt reset); a runtime source for the attribute value would be new.

**Effort & confidence.** M · strong. (Borderline: data-feature, not topology; do not implement without a product need.)

---

## 5. Appendix

### A. Intentional / better-than-ChatGPT divergences — DO NOT regress

1. **Flat app-root** — single flex-ROW (`layout-app.tsx:20`) vs ChatGPT's flex-COL → z-0 ROW A → ROW B (`struct.md:21-23`). ChatGPT's ROW A `z-0` isolates its **in-flow** `z-21` sidebar peer and `z-1` flyout from app portals; we have no in-flow high-z peer (sidebar is `fixed z-10`, dock slot has no z), and `<body>` already has `isolate` (`layout.tsx:62`) capping the skip-link/Toaster ladder. Overlays are portaled to body. Do not add two empty wrapper rows. Only future trigger: if an in-flow high-z sibling is introduced, add a `relative isolate`/`z-0` row then.

2. **Single dock-slot panel carrier** — `ActivityPanelDockSlot` (`layout-app.tsx:34`, `activity-panel-host.tsx:71-90`) collapses ChatGPT's open-only host wrapper + in-flow rail spacer + ROW-A flyout (`:3324,:7508,:7515`) into one always-mounted `shrink-0` in-flow carrier. Same container-shrink outcome, no DOM insert/remove on open (animates from first frame). Do NOT reintroduce host+rail+flyout.

3. **Composer-overlap on `ScrollRootContent`** — `-mb-(--composer-overlap-px)` 28px on the stick-to-bottom contentRef (`conversation.tsx:133`) instead of ChatGPT's dedicated turns-wrapper (`struct.md:132`). Identical token/mechanism, one fewer wrapper. Caveat: that node doubles as the `use-stick-to-bottom` contentRef, so any edit to `-mb-…`/`pb-[--thread-bottom-offset]` changes measured content height and **no test guards it**. Don't split for parity alone.

4. **Composer gutter/cap flattening** — gutter on `#thread-bottom-container`, cap on `#thread-bottom` (`chat.tsx:415,430`) vs ChatGPT's two inner divs under `#thread-bottom` (`:7180,:7184`). Flattened deliberately to preserve the **THREAD_*_VARS byte-identical invariant** (`thread-bounds.ts:6-12` — vars appended LAST so article and inner-column class strings stay byte-identical). Do not regress to ChatGPT's extra nesting.

5. **Panel/sidebar viewport gates are correct** — docked↔sheet (`max-lg` + `matchMedia 1024`, `activity-panel-host.tsx:86`, `activity-panel.tsx`) and sidebar visibility (`md`, `sidebar.tsx`) are correctly **viewport**, not container. A container gate here would feed back on itself (opening the panel shrinks `@container/main`). This is the load-bearing *other half* of the container-vs-viewport axis discipline — and it already matches ChatGPT's `max-lg:w-0!` flyout (`:7519`) and `max-md:hidden` sidebar. Do not "unify to container queries."

6. **Brand-neutral semantics already in place** — skip-link to `#main` (`layout.tsx:64`, matches ChatGPT), sr-only turn headings `<h5>You said:`/`<h6>Assistant said:` (`message-user.tsx:196`, `message-assistant.tsx:269`; brand-neutral vs ChatGPT's "ChatGPT said:"), `role="presentation"` composer-parent (`chat.tsx:379`), and `data-scroll-anchor` (dynamic on assistant, consumed by `globals.css`). Preserve the attribute AND those CSS rules. ChatGPT's internal `data-skip-to-content` hook is unnecessary (no consumer).

7. **Activity-panel aria wiring** — trigger `aria-expanded`/`aria-controls`; docked shell is a labelled `<section>` landmark (not a dialog: no trap/backdrop/scroll-lock), matching ChatGPT's `screen-threadFlyOut` in-flow push semantics (`:7531`). Our `aria-labelledby`→visible title is a deliberate improvement over ChatGPT's static `aria-label="Reasoning details"` — do not regress to a static label. Already pinned by tests.

8. **Scroll/sticky boundary set** — single scroll owner with header (`top-0 z-20`) and composer (`bottom-0 isolate z-10`) sticky inside it matches ChatGPT exactly. The composer's `isolate` is load-bearing (scopes the inner z-30 ScrollButton below the z-20 header); preserve it. No test guards this contract.

### B. Would need LIVE measurement

- **Rank 1's design call.** Whether ChatGPT pops/reflows the cap during the panel sweep (option a) vs. holds it (option b) is observable but not in the static capture. Use the playbook: on the live (hidden) tab, `getComputedStyle` flushes layout, so force the `@container/main` width via inline style across 480–1100px and read `--thread-content-max-width` / `--thread-content-margin` at each step to pin the exact flip widths (expect 40rem & 64rem), then watch a real panel close for a final-frame snap. This decides (a) vs (b) and confirms `@w-lg/main`=64rem empirically.
- **scrollbar-gutter indirection.** ChatGPT's live scroll-port uses `@w-sm/main:[scrollbar-gutter:var(--stage-scroll-gutter)]` (`conversation-with-activity-panel.md:3333`) rather than the literal `stable both-edges` in the distilled doc — a value detail, not a breakpoint-axis difference; confirm only if exact gutter behavior is chased.

### C. Open questions / gaps

- **`@w-*` family naming** is verified by value (breakpoint scale) but its exact `@theme`/`@utility` registration is not in the capture — irrelevant to the recommendation (we'd use `@[40rem]/main`/`@[64rem]/main` arbitrary contexts, never mimic the `@w-` token).
- **Sidebar collapse audit** — `max-md:hidden` (768px) collapse and the offcanvas/icon/mobile-sheet state matrix were out-of-scope for the layout lens; they need their own pass alongside the Rank 4 width refactor.
- **Turn-node edit surface** — Rank 3 and Rank 7 share `conversation.tsx`/`message-*.tsx`; implement together (article→div opt-in + `data-message-author-role` + `data-turn-id`) to touch them once; the share-page landmark regression guard (Rank 3) is the critical constraint.
- **Uncommitted in-flight work** — `chat.tsx` (+`stopScroll`-on-panel-open) and the activity-panel files are modified but uncommitted; line anchors are a snapshot and may drift.
```
