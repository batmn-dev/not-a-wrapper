# ChatGPT sidebar grouping reference

Verified against the authenticated `chatgpt.com` sidebar on 2026-07-17 in an
isolated background Chrome tab. The account's original grouping was **By
project**; it was restored after inspection. The current organizer exposed no
sort setting to record or restore. No chat or project content was
changed.

## Verified information architecture

| Mode        | Runtime structure                                                                                                                                                                                        | Evidence                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| By project  | The standalone `/projects` row disappears. A collapsible, non-navigable **Projects** section appears after Pinned and before **Chats**.                                                                  | Visible runtime behavior; DOM/accessibility roles and href inspection; element bounds. |
| By project  | Unpinned project rows stay inside Projects. A pinned project moves to the global Pinned section.                                                                                                         | Visible runtime behavior; DOM order.                                                   |
| By project  | A project row expands to as many as five recent project-chat rows plus **Show more**. Project chats do not also appear in global Chats. Opening a project chat automatically expands its owning project. | Visible runtime behavior; DOM relationship inspection; navigation behavior.            |
| By project  | The Projects header has organizer and new-project actions. The section header is not the Projects-directory route. Project rows retain a separate project-home action and options menu.                  | Accessibility names; href inspection; visible hover state.                             |
| In one list | A standalone, navigable **Projects** row appears with a new-project action. Unpinned project rows disappear from top-level navigation.                                                                   | Visible runtime behavior; DOM/accessibility inspection.                                |
| In one list | The combined collapsible section is named **Recents**. It interleaves project and non-project chats by recent activity.                                                                                  | Visible runtime behavior; DOM order and labels.                                        |
| In one list | Project chats show their project name and announce “chat in project …”; otherwise they use the same row height and actions as regular chats.                                                             | Visible text; accessible-name inspection; element bounds.                              |
| In one list | A pinned project remains an expandable row in global Pinned rather than disappearing.                                                                                                                    | Visible runtime behavior; DOM/accessibility inspection.                                |

Pinned-project preview chats do not also appear in Recents. In By project,
project chats remain under their project rather than moving into global Pinned.
In one list, an individually pinned project chat may surface globally with its
project provenance unless its pinned parent already represents it. The latter
rule is the only part not conclusively exercised with every pin combination;
the no-duplicate parent/child behavior was directly visible.

## Project row and nested-row anatomy

| Detail                      | Current live value                                                                                                       | Evidence                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| Primary project interaction | Disclosure only; `aria-expanded` and `aria-controls`                                                                     | Visible runtime behavior; DOM/accessibility inspection |
| Project actions             | Separate project-home and overflow controls; no new-chat or direct pin control                                           | DOM/accessibility inspection                           |
| Reveal                      | Absolutely overlaid at rest; opacity/pointer reveal on hover, focus, or menu-open; primary reserves 60 px while revealed | Computed style; element bounds                         |
| Action bounds               | Home x=196, overflow x=220 within a row at x=6; each 34 px wide with 10 px overlap and a 52 px vertical hit target       | Element bounds                                         |
| Project menu                | Share project, Rename project, Project settings, Project home, Pin/Unpin project, Delete project                         | Visible runtime behavior; accessibility names          |
| Nested chat                 | No leading glyph; 36 px row; `padding: 6px 10px 6px 36px`; title begins at x=42                                          | Computed style; element bounds                         |
| Show more                   | Same 36 px nested geometry and title start                                                                               | Computed style; element bounds                         |
| Active child                | Child row receives active fill and forces its project open; parent project does not receive active fill                  | Navigation/reload behavior; visible runtime behavior   |
| Pinned chat                 | Persistent 20 px chat slot at x=16; title begins at x=42                                                                 | Visible runtime behavior; element bounds               |

All 36 px navigation rows use the same `sidebar-menu-row` contract. They are
non-shrinking flex items, and their one-pixel transparent block borders plus
`background-clip: padding-box` keep adjacent hover/active fills visually
separated without changing row cadence. This is a layout invariant, not a
viewport-specific adjustment: the scroll container must take overflow rather
than compressing or visually pinching adjacent rows.

Compact-row actions use one 58 px rail composed from two 34 px slots with a
10 px overlap. Project disclosure rows reveal the rail as an overlay; chat rows
reveal the same rail by reflow. Strategy changes ownership of reveal behavior,
not control or glyph placement. A non-idle chat status occupies the rightmost
34 px slot at rest, then collapses as the two-action rail reveals; idle rows
reserve no end-slot width.

The project primary is a focusable `role=button` element in ChatGPT, with the
home and overflow buttons as siblings. The local implementation may use a
native button for stronger semantics, but must preserve the sibling-action
boundary and avoid nested interactive HTML for the project row.

## Menu and persistence evidence

The current live menu label is **Organize chats**. Its grouping items are ordered
**In one list**, then **By project**, and expose `menuitemradio` with
`aria-checked`. Selecting an item closes the menu. Enter opens the trigger,
arrow keys move between radio items, Enter selects, and Escape closes the menu
and returns focus to the organizer trigger.

The selected grouping survived navigation, reload, and a second background tab.
That proves durable same-browser persistence, but does not distinguish local
browser storage from an account-backed preference. Testing another browser or
account would have exceeded the permitted reference mutations.

The live menu no longer exposed the previously observed Priority, Last updated,
or Manual order controls. This contradicts the older local placeholder menu;
grouping therefore does not integrate with a verified sort mode in this change.

## Measurements and environment

The desktop reference used a 260 px sidebar. Group headers were 32 px tall;
their left collapse target was 200 px, followed by 34 px organizer and 34 px
create actions. Chat and project rows were 248 × 36 px at x=6, with 10 px
content padding, 10 px radius, and 20 px leading slots separated from titles by
6 px. Light hover/active fill was `rgba(0, 0, 0, 0.05)`. Header actions were
transparent at rest and revealed on section hover or keyboard focus. The
project popup measured about 181 × 228 px with 16 px radius and opened at x=212.

At 1280 × 600, the history area remained the vertical scroll owner. Collapsed
desktop retained the 260 px navigation DOM as inert/pointer-disabled content
behind a 52 px clipped rail. The mobile drawer measured 260 px wide at a 390 ×
844 viewport, and its rows remained 36 px high. Mobile chat rows omitted the
quick pin control while retaining overflow.

The primary inspection environment was light theme, fine pointer, full motion,
at 1586 × 1199 CSS pixels. Dark theme was not changed in the authenticated
account. Coarse-pointer behavior was inferred from the mobile drawer plus
responsive DOM inspection; the exact hover media-query path could not be
conclusively exercised with a physical touch device.

## Unverified live edge cases

The reference account could not safely produce zero-project, one-project,
loading, or empty-history states without creating or deleting user data.
Account-backed versus browser-local storage and cross-device synchronization
also remain inference-only. These cases are covered by deterministic local
composition and persistence behavior, but are not claimed as directly observed
ChatGPT behavior.
