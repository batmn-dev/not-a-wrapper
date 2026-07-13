# ChatGPT Activity timeline reference — 2026-07-12

Reference conversation: `https://chatgpt.com/c/6a54040d-a4b8-83ea-95bf-232d02db71c3`

## Measured desktop structure

- Viewport inspected: 1681 × 1200 CSS px.
- Flyout: 400px wide, full viewport height, in-flow beside the conversation.
- Surface: measured `rgb(252, 252, 252)` in light mode with a 1px left sharp edge.
- Header: 53px high; 16px horizontal padding; 18px/28px title and duration; 36px close target with a 20px icon; bottom divider remains visible while the body scrolls.
- The header and body are separate siblings. The body owns vertical scrolling; the conversation remains independently scrollable.
- Body frame: 8px outer horizontal padding. The first content group adds 12px horizontal padding.
- Section label: 16.8px/25.2px, weight 500, secondary text.
- Timeline: 16px rail column, 8px rail-to-content gap, 15px semantic markers, 1px connector, 14px/21px titles, and 14px/20px details.
- Search chips: 25px high, fully rounded, 12px text, 12px favicons, 4px wrap gap. Hover inverts to near-black/white. Three sources are shown before an `N more` chip.
- Tool detail: nested below its timeline title; muted `#f4f4f4` surface, 24px radius, 48px minimum header, 16px horizontal inset, 36px circular copy target, 12.25px/20px monospace code with horizontal overflow.
- Terminal entry is part of the same rail: `Worked for 42s` followed by muted `Done`.
- Sources follow the timeline with `Sources · 31`; result anchors are 383px wide, 12px radius, 10px × 12px padding, and a 7% black hover tint.

## Narrow behavior

- At 390 × 844, the dock becomes a modal bottom sheet.
- The sheet is 390px wide with a 16px top radius and a flat 30% black scrim.
- Its content section is 80vh (675.2px); the handle/padding produce a 701.2px outer sheet anchored to the viewport bottom.
- The mobile header uses 24px start, 16px end, 16px top, and 8px bottom padding. The close control is visually hidden; backdrop/sheet dismissal owns closing.
- Timeline geometry and source-chip wrapping remain the same; the sheet body owns scrolling.

## Interaction observations

- Desktop close and copy targets are 36px and keyboard reachable.
- Search-chip hover changes from `rgb(244, 244, 244)` / secondary text to `rgb(33, 33, 33)` / white.
- Source-card hover uses `rgba(0, 0, 0, 0.07)`.
- Open/close reflows the conversation through an animated width carrier; reduced motion removes the transition.
- The inspected completed run exposes one semantic `Reasoning details` region, one chronological timeline, then Sources.
- Persisted approval-example conversations in the logged-in account had executed without host approval gating, so no live ChatGPT approval card was available to measure. Approval, error, stopped, and disabled states are covered deterministically in the local fixture and component tests.

## Architecture decision

The former section-bucket model could not preserve arbitrary interleaving and forced tool calls into a second transcript renderer. The implementation now retains ordered assistant message parts in `AssistantTurnView`, derives one stable-ID activity entry stream, attaches sources to the closest search entry, and projects the same model into the transcript disclosure and panel. Repeated tool-call states replace the existing entry at its original index; they never append a duplicate or regroup by type.

## Follow-up parity pass

- The desktop flyout is a 400px border-box with a real 1px start border; its header and scroll viewport are therefore 399px wide. Replacing an inset shadow with the layout border aligns the 383px source rows, 359px timeline, and 335px nested tool card without local offsets.
- The measured tool card is 335px × 82px: a 1px low-contrast border around a 333px inner surface, 24px radius, 48px header, 36px copy target, and 32px single-line code area. The card label is 14px/500 and is distinct from the outer action title.
- Source result rows are 383px wide with an explicit 12px radius. Search-result snippets must survive normalization; otherwise the row collapses from the measured 106.5px reference height to a title-only 68px shell.
- The docked Close button has no `aria-expanded` or `aria-controls`. The flyout landmark is exposed as `Reasoning details`; disclosure ARIA remains solely on the transcript trigger.
- A fresh 390px Chrome viewport in the current logged-in session exposed an alternate inline-expanded transcript treatment instead of the previously observed bottom sheet. The local bottom sheet remains because it is the explicit product contract and the earlier same-day reference capture measured its 80vh/701.2px geometry. This mobile reference state remains an observable ChatGPT variant rather than a local redesign input.
