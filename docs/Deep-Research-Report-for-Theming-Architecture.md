# Deep Research Report for Not a Wrapper Theming Architecture

All cited documentation pages, repository pages, and source files below were accessed on June 23, 2026.

## Executive summary

The strongest open-source precedent for **declarative visual theming** is still the editor/tooling ecosystem, especially **VS Code**, **JupyterLab**, **Zed**, and **Eclipse Theia**. Those projects have mature theme contracts, extension manifests, runtime switching, and preference hierarchies. However, most of them stop at **tokens, colors, syntax styles, and icon themes**. They are excellent references for Levels 1 to 3 of your hierarchy, but not sufficient by themselves for renderer-level theming. citeturn29view0turn33view0turn22view0turn22view2turn26view0turn27view0turn34view2turn36search2

The strongest precedent for **structural customization without forking product logic** is not a theme system at all. It comes from **slot APIs, headless primitives, and behavior/render separation** in projects like **MUI**, **React Spectrum / React Aria**, and **Zag + Ark UI**. MUI explicitly formalizes slots, owner state, theme default props, and slot replacement; React Spectrum explicitly treats rendered DOM as an internal implementation detail and centers accessibility/behavior in hooks and providers; Zag centralizes interaction behavior in state machines while Ark exposes stylable parts using `data-scope` and `data-part`. citeturn41view1turn41view2turn40search1turn40search5turn16search5turn17search0turn17search2turn17search8turn17search12

The strongest precedent for **layout-level extensibility** is **Eclipse Theia** and, to a lesser extent, **JupyterLab** and **Grafana**. Theia’s `ApplicationShell` explicitly allows `createLayout()` overrides, and frontend application contributions can initialize or customize shell layout without replacing backend services. JupyterLab persists workspaces separately from theme settings and models themes as plugins, while Grafana’s extension-point system lets plugins add components, links, functions, and exposed components to versioned UI targets. citeturn36search2turn36search3turn34view1turn22view0turn22view3turn37view2turn37view3turn38view0turn38view1

For **theme contracts**, mature systems converge on a few patterns: JSON or JSON-schema-backed theme files for externally authored themes; semantic token names rather than raw component-specific CSS selectors; CSS custom properties for runtime switching; provider/context layers for resolving appearance and scale; and versioned extension point IDs for safe plugin interoperability. Zed’s theme JSON schema is a particularly clean example of a typed semantic theme document. VS Code’s color theme schema, contribution points, and high-contrast defaults are the most mature extension-theme model. citeturn27view0turn26view0turn29view2turn31view1turn33view0turn30search0

For **runtime application**, the most reusable proven patterns are: an early script that sets a theme attribute before hydration to avoid flicker, CSS variables tied to `class` or `data-*` selectors, provider-based resolution of current mode/scheme, and preference-layer merging. Material UI’s `InitColorSchemeScript`, Mantine’s `ColorSchemeScript`, Tailwind’s `data-theme` variant pattern, and JupyterLab’s movement of theme hints to a body-level attribute are all directly relevant. citeturn41view0turn41view3turn18search3turn20search2turn24search4

For **preference hierarchy**, the mature pattern is clear: store **small preference IDs**, not theme payloads. VS Code, Theia, JupyterLab, and Zed all persist settings as layered configuration rather than pushing theme structure through the backend. Theia is especially useful because it documents explicit scopes and also notes that backend services only see Default and User scopes, which is a good reminder not to let backend business logic depend on workspace-specific cosmetic state. citeturn29view5turn35view0turn35view1turn22view3turn28view0

For **accessibility**, the safest systems do not let theming own behavior. React Spectrum bakes in keyboard and screen-reader support across devices; Zag advertises accessibility-focused state machines; Ark exposes part/state attributes while preserving machine-driven behavior; Primer explicitly ships light/dark/high-contrast schemes and documents forced-colors expectations; VS Code lets contributed colors define dark, light, high-contrast, and high-contrast-light defaults. This is the clearest argument for keeping accessibility in controllers, not in custom renderers. citeturn40search5turn17search8turn17search17turn21search0turn21search2turn21search7turn30search0

The decisive recommendation is that Not a Wrapper should **keep “Theme” as the user-facing term, but model it internally as an `ExperiencePack`**. That model is sound, but it needs one important refinement: treat the pack as a **capability bundle** with layered surfaces rather than a flat optional-object bag. Specifically, separate **tokens**, **skin CSS**, **behavior profiles**, **component renderer registry**, **layout renderer registry**, and **background assets**. Do **not** allow arbitrary third-party renderer JavaScript in early versions. Start with trusted first-party renderer packs only, while opening community support first for tokens, CSS skins, and backgrounds. This conclusion is supported by the contrast between declarative theme manifests in VS Code/Zed and code-bearing extension systems like Grafana/Theia, where versioning and metadata become mandatory once code can alter UI structure. citeturn33view0turn26view0turn38view0turn38view1turn37view4turn36search2

## Landscape map

The landscape splits into five useful families.

**Editor and workbench platforms** provide the best evidence for extension-supplied themes, preference hierarchies, and shell-level UI composition. **VS Code** is the most mature reference for declarative theme contracts, extension manifests, high-contrast roles, and layered user/workspace settings. **JupyterLab** is the most useful reference for theme plugins plus separately persisted workspaces and application layout. **Eclipse Theia** is the strongest reference for customizing the application shell itself while keeping a modular service architecture. **Zed** is a strong modern reference for JSON-schema-backed theme files and user theme overrides, though its customization is still visually oriented rather than renderer-oriented. citeturn29view0turn31view0turn29view5turn22view0turn22view3turn34view0turn34view2turn36search2turn36search3turn26view0turn26view2turn28view0turn27view0

**Component-system references** provide the best evidence for structural customization. **MUI** is strongest for slot customization, theme-driven defaults, and practical CSS variable runtime switching. **React Spectrum / React Aria** is strongest for separating behavior, accessibility, and rendering concerns. **Zag + Ark UI** is strongest for turning interaction logic into independent state machines and then exposing stylable parts for any visual system. **Primer** is strongest for semantic color roles, explicit high-contrast strategy, and accessibility-specific component guidance. citeturn41view1turn41view2turn41view3turn40search0turn40search1turn40search5turn16search5turn17search0turn17search2turn17search8turn21search0turn21search4turn21search7turn21search6

**Plugin-driven product platforms** provide the best evidence for safe extension metadata and versioned extension points. **Grafana** stands out here: plugins declare extension metadata in `plugin.json`, use typed APIs like `addComponent`, `addLink`, and `exposeComponent`, and can define RBAC roles and IAM permissions. This is not a theme system, but it is a very strong reference for a future Not a Wrapper marketplace or renderer-pack ecosystem. citeturn37view2turn37view3turn37view4turn38view0turn38view2turn38view3

**Token-pipeline references** provide the best evidence for Level 1. **Style Dictionary** is still the most practical cross-platform token compiler and now aligns with DTCG format support. **Tailwind CSS v4** is a strong reference for using CSS-based theme variables and selector-driven variants like `data-theme`. These tools are useful for Not a Wrapper’s token and skin layers, but not for renderer or shell overrides. citeturn20search3turn20search7turn20search15turn20search19turn20search18turn20search2turn20search14

**Highly stylized CSS systems** are mostly inspiration, not architecture. The evidence gathered here points to a general rule: retro or brutalist CSS libraries are good sources for **skin packs** and visual affordances, but mature OSS systems that safely support different **DOM trees, layout shells, and interaction models** rely on headless behavior contracts and extension points rather than pure CSS. That is the key distinction Not a Wrapper should keep front and center. This last point is an inference from the contrast between the theme-centric editor systems and the headless/component-platform systems above. citeturn29view0turn26view0turn41view1turn40search1turn17search0

## Comparison matrix

| Project                                                                                                            | License                                                                | Theme definition format                                                       | Runtime application method                                                | Supports user preferences         | Supports extension themes                     | Supports structural component changes                          | Supports layout changes                                             | Accessibility safeguards                                                    | Testing strategy                                                      | Relevance for Not a Wrapper                                |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------- |
| VS Code citeturn42view0turn29view0turn29view2turn31view0turn33view0turn29view5                             | MIT                                                                    | JSON theme files + schema + manifest contribution points                      | Workbench settings, CSS variables in webviews, theme service              | User + workspace                  | Yes                                           | Limited in theme layer; deeper changes via extensions/webviews | Moderate via workbench contributions                                | High-contrast defaults, semantic colors                                     | Mature internal test suite in repo; highly production-hardened        | **Very high** for extension themes and preference model    |
| JupyterLab citeturn43view0turn22view0turn22view2turn22view3turn24search4                                    | BSD-3-Clause                                                           | Theme plugins + CSS variables + settings schema                               | Dynamic CSS/theme plugin loading; app/workspace restore                   | User + app overrides + workspaces | Yes                                           | Limited in theme layer; strong plugin architecture overall     | Yes, via plugin/layout/workspace model                              | Semantic CSS variable conventions and separation of public/private vars     | Build/static asset pipeline; extension ecosystem conventions          | **High** for plugin themes + layout persistence            |
| Eclipse Theia citeturn43view1turn34view0turn34view2turn35view2turn36search2turn36search3                   | EPL-2.0 primary, with additional GPL/MIT/VS Code license files present | Preferences schemas + frontend config + shell APIs                            | Preference service + frontend application config                          | Default/User/Workspace/Folder     | Yes, including VS Code extensions             | Yes through widgets and custom frontend extensions             | **Yes, strongly** via `ApplicationShell` and frontend contributions | Scope-aware prefs; modular APIs; inherits editor accessibility patterns     | Mature framework repo testing; long-lived platform                    | **Very high** for shell/layout renderer architecture       |
| Grafana citeturn43view2turn37view0turn37view1turn37view2turn37view3turn37view4turn38view0turn38view3     | AGPL-3.0                                                               | TypeScript theme objects + `plugin.json` metadata + extension-point manifests | Theme hooks/providers + Emotion + manifest-declared lazy extensions       | Org/user plugin settings model    | Yes                                           | Yes via component exposure and extension points                | Yes in bounded extension-point form                                 | Theme hooks, strong component guidance, RBAC/IAM for plugins                | Plugin examples and official E2E/plugin guidance; production-hardened | **Very high** for future marketplace/plugin safety model   |
| MUI citeturn43view3turn41view1turn41view2turn41view3turn41view4                                             | MIT                                                                    | TypeScript theme object + slots + CSS variables                               | `ThemeProvider`, CSS variables, `data`/`class` selectors, SSR init script | Yes                               | N/A marketplace-style                         | **Yes** via slots and slot replacement                         | Limited, mostly app-owned                                           | Warns against breaking semantic DOM; theme/system APIs                      | Visual regression with Argos; large internal suite                    | **Very high** for component renderer contract design       |
| React Spectrum / React Aria citeturn43view4turn40search0turn40search1turn40search5turn16search5             | Apache-2.0                                                             | Provider themes + style macros + headless hooks                               | `Provider` resolves theme, color scheme, scale, locale                    | Yes                               | N/A marketplace-style                         | **Yes** via hooks/render freedom                               | Limited, mostly app-owned                                           | Excellent keyboard/screen-reader support; DOM treated as black box in tests | Accessibility-centered testing guidance; large suite in repo          | **Very high** for controller/renderer separation           |
| Zag + Ark UI citeturn43view5turn17search0turn17search2turn17search8turn17search12turn17search17            | MIT                                                                    | State machines + headless parts + `data-scope` / `data-part`                  | Machine connect APIs + part/state attributes + CSS variables where needed | App-owned                         | N/A marketplace-style                         | **Yes**                                                        | Limited, mostly app-owned                                           | Accessibility-first state machines; inert hidden interactive content        | Mature OSS repo tests; machine contracts enable deterministic tests   | **Extremely high** for Not a Wrapper controllers           |
| Primer React + Primitives citeturn43view6turn21search0turn21search1turn21search4turn21search7turn21search6 | MIT                                                                    | CSS variables + color modes + theme hooks                                     | `data-color-mode`, `data-light-theme`, `data-dark-theme`                  | Yes                               | Internal ecosystem more than open marketplace | Limited structural overrides                                   | Limited                                                             | High-contrast themes, forced-colors guidance, component accessibility docs  | Integration and accessibility checks documented per component         | **High** for semantic token naming and accessibility rules |

## Deep dives

### VS Code

**Why it matters.** VS Code is the best mature reference for a **declarative, extension-delivered theme contract**. Themes are contributed through the extension manifest under `contributes.themes`, with JSON files that define workbench colors and syntax styles. It separately supports file icon themes and product icon themes, which is a useful reminder that “theme” often needs multiple orthogonal contracts rather than one giant object. citeturn33view0turn32view2turn32view1

**Relevant sources and directories.** The key implementation references are the Color Theme guide, Theme Color reference, contribution points docs, `src/vs/workbench/services/themes/common/colorThemeSchema.ts`, and `src/vs/workbench/services/themes/browser/workbenchThemeService.ts`. The default theme JSONs under `extensions/theme-defaults/themes/` show the actual shipped contract in practice. citeturn29view0turn29view1turn29view2turn29view3turn29view4turn31view1

**Theme definition and runtime.** The contract is JSON plus schema. Users can live-override workbench and token colors through `workbench.colorCustomizations` and `editor.tokenColorCustomizations`, and the theme service listens for configuration changes, including preferred dark, light, and high-contrast themes. Extensions can also contribute new themeable color IDs with defaults for `dark`, `light`, `highContrast`, and `highContrastLight`. That is a very strong pattern for semantic roles. citeturn29view0turn29view3turn31view1turn30search0

**What it can and cannot change.** A VS Code theme does **not** normally change core workbench DOM structure. Structural changes come through separate mechanisms such as views containers, tree views, status bar items, and webviews. That division is one of VS Code’s most important lessons: **theme contracts stay declarative**, while structural changes go through explicit extension points. For Not a Wrapper, that argues against putting layout and renderer code in the same contract as basic tokens. citeturn31view0turn32view3

**Preference hierarchy and backend separation.** VS Code stores user and workspace settings separately, and workspace settings override user settings at the project level. Theme state is just a setting key, not theme data itself. This is the right shape for Not a Wrapper as well: persist IDs and mode choices, not token blobs. citeturn29view5turn29view3

**What Not a Wrapper should copy.** Copy VS Code’s split between declarative theme manifests and explicit structural extension points, its semantic color registry approach, and its layered preference model. **Do not** copy the assumption that theme JSON alone can address renderer-level or shell-level experience changes, because VS Code itself does not solve that with themes. citeturn33view0turn30search0turn31view0

### JupyterLab

**Why it matters.** JupyterLab is one of the clearest examples of a product that treats **themes as plugins** while separately treating **workspaces/layout state** as persistent application state. That separation maps well to Not a Wrapper’s need to keep presentation flexible without entangling backend/domain logic. citeturn22view0turn22view3

**Relevant sources and directories.** The most useful references are the extension developer guide’s plugin taxonomy, the CSS Patterns guide, the main theme variable files, the application settings and workspaces documentation, and `packages/apputils-extension` / `packages/apputils/src/thememanager.ts` as implementation entry points mentioned throughout docs and issues. citeturn22view0turn22view2turn22view3turn25search0

**Theme definition and runtime.** JupyterLab documents theme plugins as a distinct plugin type. The CSS Patterns guide says packages should rely on variables defined in theme packages, and it explicitly distinguishes public and private CSS variables via naming conventions. That is a mature, reusable pattern for Not a Wrapper’s token layer: public semantic variables for pack authors, private variables for internal composition details. citeturn22view0turn22view2

**Preferences, layout, and persistence.** JupyterLab can set default themes via `overrides.json`, writes user settings into the user settings directory, and persists layout and open-document state in separate workspace files. In other words, **theme choice is not the same thing as workspace layout**. That distinction is extremely useful for Not a Wrapper: a terminal pack might influence shell defaults, but user-created workspaces and page arrangements should remain separate persisted state. citeturn22view3

**Structural flexibility.** JupyterLab’s theme layer is mostly CSS variables and assets, but its plugin architecture can add or alter application features. The strongest lesson is not “themes can do everything”; it is that **theme plugins and application plugins are different classes of extension**. Not a Wrapper should adopt the same philosophical split between packs that skin UI and packs that bring new renderers or layouts. citeturn22view0

**What Not a Wrapper should copy.** Copy JupyterLab’s clear distinction between theme assets, settings, and workspace state; copy its public/private CSS variable policy; copy its plugin taxonomy thinking. **Avoid** allowing arbitrary CSS overrides with weak validation. JupyterLab’s own issue history shows how permissive override channels can become a maintenance and safety problem if schema boundaries are loose. citeturn22view2turn25search4

### Eclipse Theia

**Why it matters.** Theia is the strongest reference if your question is, “How do we support radically different shells and layouts without forking the whole app?” Its architecture is explicitly about building custom IDEs and tools on a shared platform, and its `ApplicationShell` exposes layout assembly points. citeturn34view4turn36search2

**Relevant sources and directories.** The most useful evidence is Theia’s preferences documentation, `dev-packages/application-package/src/application-props.ts`, `packages/core/src/browser/shell/application-shell.ts`, and the frontend application contribution docs. These show default theme config, shell layout composition, and startup/layout hooks. citeturn34view0turn34view2turn34view1turn36search3

**Theme and preference contracts.** Theia preferences are schema-driven and explicitly scoped across Default, User, Workspace, and Folder levels. It also documents that backend services only see Default and User scopes. That is a major architectural clue for Not a Wrapper: **frontend presentation preferences should not be treated as backend-varying workspace truth** unless absolutely necessary. citeturn35view0turn35view1turn35view2

**Layout and shell extensibility.** `ApplicationShell` explicitly says `createLayout()` can be overridden to change the arrangement of main and side panels, and maintainer guidance confirms that teams can subclass the shell and hide/change panels for custom products. Frontend application contributions can initialize layouts or customize the shell at startup without replacing stored layouts once a user already has one. This is exactly the model Not a Wrapper needs for Level 5 layout renderers. citeturn36search2turn36search1turn36search3

**What Not a Wrapper should copy.** Copy Theia’s separation of shell/layout composition from core services, and copy its scoped preference system. **Avoid** making layout switching a purely CSS concern. Theia’s architecture makes clear that once shell chrome and panel relationships change, you are in application-shell territory, not theming territory. citeturn36search2turn35view0

### Grafana

**Why it matters.** Grafana is the best open-source reference in this set for **versioned UI extension points with manifest metadata, RBAC-aware plugins, and future-safe plugin contracts**. That makes it highly relevant for later-stage official packs or a renderer marketplace, even though it is not a “theme engine” in the narrow sense. citeturn37view2turn37view3turn37view4

**Relevant sources and directories.** The theme style guide points to `packages/grafana-data/src/themes/createTheme.ts` and `createColors.ts`. The plugin docs around `plugin.json`, UI extension concepts, and UI extension APIs show how extension metadata, targets, and exposed components work. citeturn37view0turn37view4turn38view0turn38view1turn37view2turn37view3

**Theme and runtime model.** Grafana themes are TypeScript objects, and plugin authors are told to use `@grafana/ui`, `useTheme2()`, and `useStyles2()` rather than global CSS. That is a mature pattern for front-end-owned presentation: consistent primitives, stable theme hooks, and a strong bias against uncontrolled global styling. citeturn37view0turn37view1

**Structural extensibility and safety.** UI extensions revolve around versioned extension points and functions like `addComponent`, `addLink`, `addFunction`, and `exposeComponent`. Crucially, `plugin.json` must declare added components, links, functions, exposed components, and extension points, or they “won’t work.” That manifest discipline is one of the cleanest safety and compatibility precedents in the set. Grafana also supports IAM and plugin-defined RBAC roles. citeturn37view2turn37view3turn38view0turn38view1turn38view2turn38view3

**What Not a Wrapper should copy.** Copy Grafana’s manifest-first extension metadata, versioned identifiers for extension points, and the idea that anything structural must be declared up front. **Avoid** opening renderer packs to arbitrary community code without a similar metadata, review, and compatibility story. citeturn38view0turn38view1turn38view3

### Material UI

**Why it matters.** MUI is one of the clearest practical references for **Levels 2 to 4**: skins, slots, and controlled DOM replacement. It does not solve app-shell theming end to end, but it offers a highly reusable component customization vocabulary. citeturn41view1turn41view2

**Relevant sources and directories.** The key docs are “Creating themed components,” “Overriding component structure,” “CSS theme variables,” and `InitColorSchemeScript`. The source side includes the `ThemeProviderWithVars` implementation path. citeturn41view1turn41view2turn41view3turn41view0turn18search2

**Theme contract and runtime.** MUI uses a TypeScript theme object, component identifiers under `components`, slot-specific `styleOverrides`, `useThemeProps`, and CSS variable generation. It supports `class`- or `data`-based color scheme selectors and ships an early script specifically to eliminate SSR flicker. That runtime pattern is directly usable for Not a Wrapper. citeturn41view1turn41view3turn41view0

**Structural flexibility.** MUI slots are important because they let you replace subcomponents in a controlled way. The docs distinguish using `component` to preserve slot styles versus using `slots` when replacing styles and functionality entirely. It also explicitly warns you not to break semantic and accessible HTML when overriding structure. That warning should be turned into hard constraints in Not a Wrapper’s renderer API. citeturn41view2

**Testing and QA.** MUI documents a wide internal test suite and calls out visual regression testing with Argos. The practical lesson is that once you support many variants across one component API, visual regression becomes mandatory, not optional. citeturn41view4

**What Not a Wrapper should copy.** Copy MUI’s slot model, owner-state pattern, theme default props, CSS variable runtime, and SSR anti-flicker script. **Avoid** overloading theme objects with too much structural power; in MUI, theme objects customize components, but structural replacement still stays bounded by explicit APIs. citeturn41view1turn41view2turn41view0

### React Spectrum and React Aria

**Why it matters.** React Spectrum gives the strongest argument for **controller/renderer separation with accessibility preserved**. It is the best reference for your proposed split between a stable semantic component and a renderer that can vary. citeturn40search0turn40search5turn40search1

**Relevant sources and directories.** The most relevant references are the `Provider` docs, testing docs, styling docs, and React Aria component docs showing state-driven styling hooks. citeturn40search0turn40search1turn16search0turn16search5

**Theme and runtime model.** React Spectrum’s `Provider` supplies theme, color scheme, scale, and locale. By default it follows OS settings for color scheme and device type for scale, but those can be overridden by app settings. That is a good reference for Not a Wrapper’s appearance, density, and input-behavior profiles. citeturn40search0

**Behavior first, DOM second.** The testing docs explicitly say the DOM structure rendered by React Spectrum should be considered a black box and may change, and tests should query semantics rather than internal classes. That is unusually relevant to Not a Wrapper: if renderers differ across packs, controller contracts and a11y semantics become the stable contract, not DOM snapshots. citeturn40search1

**What Not a Wrapper should copy.** Copy the principle that accessibility and interaction belong to controllers and that renderers should be swappable under stable semantics. **Avoid** treating renderer DOM as an external contract you can never change. The stable contract should be props, states, semantics, and a11y outcomes. citeturn40search1turn40search5

### Zag and Ark UI

**Why it matters.** Zag is the cleanest open-source reference for the “controller” half of your proposal. It builds accessible components as finite state machines, separate from styling and framework. Ark UI then gives those machines a composable/headless rendering surface with explicit parts and state attributes. citeturn17search0turn17search1turn17search4turn17search8

**Relevant sources and directories.** The most relevant docs are Zag’s introduction and examples, Ark’s styling guide, and Ark component docs showing `asChild`, `Context`, `data-part`, and `data-state` usage. citeturn17search0turn17search2turn17search12turn17search13turn17search14

**Structural flexibility.** Ark UI uses `data-scope` and `data-part` attributes for precise part styling and lets you provide custom child elements with `asChild`. Meanwhile Zag machines stay unstyled and portable across frameworks. This is probably the single best conceptual reference for Not a Wrapper’s split between `ComponentController` and `ComponentRenderer`. citeturn17search2turn17search8turn17search12

**Accessibility.** Zag explicitly positions accessibility as a first-class concern. Ark’s docs also show subtle but important behaviors such as making interactive content inside collapsed areas `inert`, which is exactly the kind of behavioral invariant that should remain controller-owned regardless of theme. citeturn17search8turn17search17

**What Not a Wrapper should copy.** Copy the state-machine controller idea almost directly. Copy part/state attributes for renderer CSS targeting. **Avoid** allowing renderer packs to reimplement interaction logic from scratch if you can centralize it in machines/controllers instead. citeturn17search0turn17search2turn17search8

### Primer

**Why it matters.** Primer is a strong reference for semantic color roles, explicit theme attributes on the document, and accessibility policies around high contrast and forced colors. If Not a Wrapper wants user-customizable themes without sacrificing legibility, Primer’s patterns are useful. citeturn21search0turn21search4turn21search7

**Relevant sources and directories.** The most relevant references are Primer Primitives, React theming docs, color usage guidance, and component accessibility pages. citeturn21search0turn21search1turn21search2turn21search4turn21search6turn21search7

**Theme contract and runtime.** Primer uses `data-color-mode` plus `data-light-theme` and `data-dark-theme` on the document, which is a simple, proven runtime contract. It also distinguishes color mode from color scheme, an important naming refinement that may help Not a Wrapper separate appearance mode from pack identity. citeturn21search0turn21search4

**Accessibility discipline.** Primer explicitly ships light and dark high-contrast sub-themes, targets 7:1 for most text and interactive elements in high-contrast themes, and documents integration/component tests for accessibility outcomes. That is the right level of rigor for official ExperiencePacks. citeturn21search2turn21search7turn21search6

**What Not a Wrapper should copy.** Copy Primer’s semantic role naming, explicit document attributes for selected schemes, and accessibility acceptance criteria. **Avoid** allowing arbitrary pack authors to redefine semantic roles so loosely that “button text,” “border,” or “focus ring” no longer map cleanly to contrast requirements. citeturn21search0turn21search2turn21search7

## Pattern synthesis

The clearest pattern across mature systems is that **Level 1 tokens** and **Level 2 skins** are usually declarative, while deeper levels become increasingly API-driven. Style Dictionary, Tailwind, Primer, JupyterLab, VS Code, Zed, and MUI all reinforce the same lesson: tokens work best when they are semantic, versioned, and consumable by build/runtime tooling rather than hand-authored selector soup. citeturn20search3turn20search7turn20search18turn21search0turn22view2turn29view2turn27view0turn41view3

For **runtime switching**, the most proven implementations combine CSS variables with a cheap DOM-level selector, then set that selector before hydration. MUI explicitly uses an early script to attach a mode attribute before React renders. Mantine uses a `data-mantine-color-scheme` attribute for the same anti-flicker purpose. Tailwind formalizes `data-theme`-based variants. JupyterLab’s move of the theme hint to a broader container/body scope is a reminder that overlays, dialogs, and portals need access to the active theme selector too. citeturn41view0turn18search3turn20search2turn24search4

For **Level 3 slots**, MUI and Ark UI are the most practical references. Both treat subparts as named targets, and both allow bounded overrides. This is the right solution for cases where a Button remains “a Button” but its icon wrapper, label container, chrome, or indicator subparts change. citeturn41view1turn41view2turn17search2turn17search14

For **Level 4 component renderers**, the best pattern is headless behavior controllers feeding pack-specific renderers. React Spectrum and Zag strongly support this direction. The controller owns state, keyboard handling, focus management, and ARIA semantics. The renderer owns DOM tree, slots, skin chrome, and local motion within strict boundaries. This is the most important architectural decision in the whole report, because it is what will let Not a Wrapper support Aqua, Terminal, Brutalist, and product-native UIs without separate frontends. citeturn40search1turn40search5turn17search0turn17search8

For **Level 5 layout renderers**, the best pattern is not a CSS theme but a **shell adapter**. Theia proves you can keep services and data models stable while varying the shell layout. JupyterLab proves layout persistence should be separate from theme settings. Grafana proves extension points should be versioned and declared. Combined, these suggest a Not a Wrapper architecture with a stable app core and a `LayoutRendererRegistry` keyed by pack capabilities. citeturn36search2turn36search3turn22view3turn37view3turn38view1

For **Level 6 interaction models**, there is no strong mature precedent for treating them as simple themes. That is an important negative finding. Command-first terminal modes, desktop-window metaphors, and radically different navigation models generally behave more like **product modes** or **app shells** than CSS themes. My recommendation is to model them as `InteractionProfile` plus `LayoutRenderer`, not as token packs. This is a synthesis from the material above rather than a direct statement from one project. citeturn31view0turn36search2turn40search1turn17search0

For **third-party safety**, mature systems converge on manifest discipline and versioning once extensions can add code. VS Code and Grafana are the best evidence: contribution points, explicit paths/IDs, typed manifests, and versioned identifiers. Not a Wrapper should use the same discipline for any future renderer marketplace. Until then, community support should stay declarative. citeturn33view0turn37view4turn38view0turn38view1

## Recommended architecture for Not a Wrapper

The proposed `ExperiencePack` direction is sound, and I recommend keeping **Theme** as the user-facing label and **ExperiencePack** as the internal architectural term. The main improvement is to make the pack explicitly layered and capability-based.

A practical package structure would look like this:

- `@naw/ui-contracts` for stable semantic component contracts and layout contracts
- `@naw/ui-controllers` for controller hooks/state machines and accessibility logic
- `@naw/ui-renderers-default` for first-party renderers
- `@naw/ui-renderers-terminal`
- `@naw/ui-renderers-aqua`
- `@naw/ui-renderers-brutalist`
- `@naw/ui-layouts-*` for shell/page renderers
- `@naw/tokens-core` for semantic token schema and validation
- `@naw/experience-runtime` for registry, preference resolution, lazy loading, and SSR hydration
- `@naw/experience-packs-official` for first-party packs
- `@naw/experience-validator` for schema, asset, token, and a11y checks

This structure reflects the same separation mature systems use between theme contracts, runtime resolution, and extension surfaces. citeturn33view0turn36search2turn37view4turn41view1turn17search0

### Architecture shape

Use this high-level layering:

1. **Semantic core contracts**
   `ButtonContract`, `DialogContract`, `WorkspaceShellContract`, and so on.  
   These define states, events, semantics, and stable data requirements.

2. **Controllers**
   Headless logic with state machines or controller hooks.  
   They own:
   - ARIA
   - keyboard interactions
   - focus management
   - analytics hooks
   - reduced-motion handling
   - semantics-preserving refs and event wiring

3. **Renderers**
   Pack-specific React components that receive a controller API and produce DOM/slots/chrome.  
   They may vary DOM structure and internal wrappers, but they cannot replace required semantics from the controller.

4. **Layout renderers**
   Shell/page renderers that map shared product data into different app shells and navigation models.

5. **Skin layer**
   Tokens, CSS variables, backgrounds, and local visual motion rules.

This is essentially a blend of Zag/Ark’s controller philosophy, React Spectrum’s semantics-first guidance, MUI’s slot/bounded-override approach, and Theia/Grafana’s extension-registry thinking. citeturn17search0turn17search2turn40search1turn41view2turn36search2turn38view1

### Refined `ExperiencePack`

Your current proposed shape is close, but I would separate declarative artifacts from code-bearing artifacts:

```ts
type ExperiencePackManifest = {
  id: string
  label: string
  version: string
  kind: "official" | "partner" | "community"
  capabilities: {
    tokens: boolean
    skins: boolean
    backgrounds: boolean
    componentRenderers: string[]
    layoutRenderers: string[]
    interactionProfiles: string[]
  }
  compatibility: {
    appVersion: string
    contractVersion: string
  }
  appearance: {
    supportedModes: Array<"light" | "dark" | "system">
    highContrast?: boolean
  }
  assets: {
    tokenBundle?: string
    skinCss?: string[]
    backgroundManifest?: string
  }
}
```

```ts
type ExperiencePackRuntime = {
  manifest: ExperiencePackManifest
  tokens?: ThemeTokens
  backgrounds?: BackgroundDefinition[]
  behavior?: ExperienceBehaviorProfiles
  componentRenderers?: Partial<ComponentRendererRegistry>
  layoutRenderers?: Partial<LayoutRendererRegistry>
}
```

The reason for this split is simple: once some packs are CSS-only and others include trusted renderer code, you need a manifest boundary for loading, compatibility, and safety. Grafana and VS Code strongly support this pattern. citeturn37view4turn38view0turn33view0

### Runtime theming contract

At runtime, set root attributes as early as possible:

```html
<html
  data-exp-pack="terminal"
  data-appearance="dark"
  data-density="compact"
  data-motion="reduced"
></html>
```

Then load:

- a tiny critical CSS layer for semantic variables,
- the selected pack’s token CSS,
- the selected pack’s skin CSS,
- only the renderer/layout bundles required by the active pack.

Use an early inline script or server-rendered attribute injection, following the same principle as MUI’s `InitColorSchemeScript` and Mantine’s `ColorSchemeScript`. citeturn41view0turn18search3

### Backend preference contract

Your backend contract is directionally correct. Keep it narrow:

```json
{
  "themeId": "terminal",
  "backgroundId": "crt-grid",
  "appearance": "dark",
  "density": "compact",
  "motion": "reduced"
}
```

I would add one optional field only if you need explicit future compatibility:

```json
{
  "themeId": "terminal",
  "themeVersion": "1",
  "backgroundId": "crt-grid",
  "appearance": "dark",
  "density": "compact",
  "motion": "reduced"
}
```

Do **not** store tokens, CSS variables, layout selections, or renderer component names on the backend. The backend should store user preference identifiers only. That matches the best patterns in VS Code, Zed, JupyterLab, and Theia. citeturn29view5turn28view0turn22view3turn35view0

### Accessibility constraints

Not a Wrapper should make these non-negotiable:

- Controllers own keyboard behavior, focus logic, ARIA, and announced states.
- Renderers may not remove required semantic roles or labels.
- Every renderer must expose a semantic test suite shared across packs.
- Official packs must support reduced motion and visible focus states.
- All packs must inherit semantic focus-ring tokens that cannot be fully disabled.
- Only official packs can alter interaction model or layout renderer at first.
- Community packs can alter tokens, CSS skins, and backgrounds only.

These constraints are directly motivated by React Spectrum, Zag, Ark, Primer, and MUI’s own warnings about semantics when overriding structure. citeturn40search1turn17search8turn17search17turn21search7turn21search6turn41view2

### Third-party safety model

Adopt a staged model:

**Stage one**  
Community packs are declarative only:

- tokens
- semantic skin CSS
- approved background assets
- no arbitrary JS
- no custom DOM renderers

**Stage two**  
Partner packs may include reviewed renderer bundles:

- signed manifest
- compatibility gate
- capability declaration
- size budgets
- a11y certification
- screenshot baselines

**Stage three**  
Marketplace packs can expose renderers and layouts only through versioned contract IDs and strict validation, similar in spirit to Grafana extension points.

This is the safest route. Mature systems become much stricter the moment extensions can add code, and Not a Wrapper should do the same. citeturn38view0turn38view1turn38view3turn33view0

### Example TypeScript interfaces

```ts
export type AppearanceMode = "light" | "dark" | "system"
export type DensityMode = "comfortable" | "compact"
export type MotionMode = "full" | "reduced"

export interface ThemeTokens {
  color: Record<string, string>
  typography: {
    families: Record<string, string>
    sizes: Record<string, string>
    weights: Record<string, number>
    lineHeights: Record<string, string | number>
  }
  radius: Record<string, string>
  spacing: Record<string, string>
  shadows: Record<string, string>
  motion: {
    durations: Record<string, string>
    easings: Record<string, string>
    scales?: Record<string, number>
  }
  density: {
    controlHeights: Record<string, string>
    padding: Record<string, string>
  }
  focus: {
    ringColor: string
    ringWidth: string
    ringOffset: string
  }
}

export interface BackgroundDefinition {
  id: string
  label: string
  kind: "solid" | "gradient" | "image" | "shader-like"
  appearance?: "light" | "dark" | "both"
  css?: Record<string, string>
  assetUrl?: string
  blurhash?: string
  safeAreaAware?: boolean
}

export interface ExperienceBehaviorProfiles {
  motion?: MotionProfile
  input?: InputBehaviorProfile
  navigation?: NavigationBehaviorProfile
  windowing?: WindowBehaviorProfile
}

export interface MotionProfile {
  prefersReducedMotionAware: boolean
  emphasis: "low" | "medium" | "high"
  springiness?: "none" | "soft" | "playful"
}

export interface InputBehaviorProfile {
  pointerTargets: "default" | "large"
  keyboardFirst: boolean
  commandPalettePriority?: boolean
}

export interface NavigationBehaviorProfile {
  shellMode: "standard" | "terminal-first" | "windowed" | "grid"
  sidebarBehavior?: "persistent" | "overlay" | "hidden"
}

export interface WindowBehaviorProfile {
  draggablePanels?: boolean
  floatingWindows?: boolean
  snapLayouts?: boolean
}

export interface ButtonContract {
  id?: string
  disabled?: boolean
  loading?: boolean
  pressed?: boolean
  variant?: "primary" | "secondary" | "ghost" | "danger"
  size?: "sm" | "md" | "lg"
  iconStart?: React.ReactNode
  iconEnd?: React.ReactNode
  children?: React.ReactNode
  onPress?: () => void
  ariaLabel?: string
}

export interface WorkspaceShellContract {
  title?: string
  nav?: React.ReactNode
  sidebar?: React.ReactNode
  content: React.ReactNode
  utility?: React.ReactNode
  status?: React.ReactNode
}

export interface ComponentControllerApi<TContract> {
  contract: TContract
  props: Record<string, unknown>
  aria: Record<string, unknown>
  state: Record<string, unknown>
  refs: Record<string, React.RefObject<HTMLElement | null>>
  handlers: Record<string, (...args: any[]) => void>
}

export type ComponentRenderer<TContract> = React.ComponentType<{
  controller: ComponentControllerApi<TContract>
  tokens: ThemeTokens
  pack: ExperiencePackRuntime
}>

export type LayoutRenderer<TContract> = React.ComponentType<{
  contract: TContract
  tokens: ThemeTokens
  pack: ExperiencePackRuntime
}>

export interface ComponentRendererRegistry {
  Button?: ComponentRenderer<ButtonContract>
  Card?: ComponentRenderer<any>
  Dialog?: ComponentRenderer<any>
  Input?: ComponentRenderer<any>
  EmptyState?: ComponentRenderer<any>
}

export interface LayoutRendererRegistry {
  WorkspaceShell?: LayoutRenderer<WorkspaceShellContract>
  ProjectView?: LayoutRenderer<any>
}

export interface ExperiencePackManifest {
  id: string
  label: string
  version: string
  kind: "official" | "partner" | "community"
  capabilities: {
    tokens: boolean
    skins: boolean
    backgrounds: boolean
    componentRenderers: string[]
    layoutRenderers: string[]
    interactionProfiles: string[]
  }
  compatibility: {
    appVersion: string
    contractVersion: string
  }
  appearance: {
    supportedModes: AppearanceMode[]
    highContrast?: boolean
  }
}

export interface ExperiencePackRuntime {
  manifest: ExperiencePackManifest
  tokens?: ThemeTokens
  backgrounds?: BackgroundDefinition[]
  behavior?: ExperienceBehaviorProfiles
  componentRenderers?: Partial<ComponentRendererRegistry>
  layoutRenderers?: Partial<LayoutRendererRegistry>
}

export interface UserUIPreferences {
  themeId: string
  themeVersion?: string
  backgroundId?: string
  appearance: AppearanceMode
  density: DensityMode
  motion: MotionMode
}
```

## Implementation roadmap

A successful rollout should be staged by _power_, not by theme count.

### Prototype phase

Build the semantic core first:

- stable contracts for Button, Card, Dialog, Input, WorkspaceShell
- headless controllers for those components
- token pipeline and root runtime attributes
- one default renderer set
- one alternate visual skin implemented as tokens + CSS only

Success criterion: a single app can flip between product-native and one highly stylized skin without DOM/logic regressions. This phase should be heavily influenced by MUI’s slot thinking and React Spectrum/Zag controller separation. citeturn41view1turn40search1turn17search0

### Official themes phase

Add official first-party packs:

- `default`
- `brutalist`
- `aqua-lite`

Still keep them mostly at Levels 1 to 3:

- tokens
- skins
- limited slot changes
- shared layout renderer

This will validate the token taxonomy and CSS variable boundaries before introducing renderer divergence. citeturn22view2turn21search0turn41view3

### Structural renderers phase

Introduce first-party renderer overrides for a narrow set of components:

- Button
- Card
- Dialog
- WorkspaceShell

Do not open this to third parties yet. Add renderer contract tests and accessibility snapshots across all official packs. This is where the controller/renderer split becomes real. citeturn17search8turn40search1turn41view2

### Backgrounds phase

Add background packs:

- approved gradients
- user-uploaded images with sanitization, sizing, and performance limits
- reduced-motion handling for animated backgrounds

Keep backgrounds isolated from renderer logic. They should be purely decorative and bound by legibility rules. Primer’s contrast guidance is especially relevant here. citeturn21search2turn21search7

### Community theme support phase

Open community support only for:

- tokens
- semantic skin CSS
- approved backgrounds
- manifest + schema validation

No arbitrary JS. No custom renderers. No layout packs. This mirrors the safety/value tradeoff proven by declarative theme systems. citeturn33view0turn26view0turn27view0

### Marketplace or extension phase

If the product truly needs third-party renderer/layout packs:

- require manifest metadata
- version every contract and extension point
- require automated a11y checks and screenshot baselines
- review/sign packages
- enforce capability flags and semver compatibility
- prefer prior-reviewed official APIs only

Grafana is the clearest model for this phase. citeturn37view4turn38view0turn38view1

## Risks and mitigations

**CSS leakage** is likely if packs can reach into arbitrary selectors. The mitigation is public semantic variables plus part/state attributes, and pack CSS restricted to documented targets. JupyterLab’s public/private variable distinction and Ark’s `data-part` model are the right precedent. citeturn22view2turn17search2

**Accessibility regressions** are the biggest risk once DOM structures diverge. The mitigation is to keep accessibility in controllers, enforce semantic test suites across packs, and require focus-ring, reduced-motion, and contrast invariants. React Spectrum, Zag, Primer, and MUI all point in this direction. citeturn40search1turn17search8turn21search7turn41view2

**Theme flash** will appear if mode/pack attributes are applied after hydration. The mitigation is an early root script or server-side attribute injection, plus critical CSS variable bootstrapping. MUI and Mantine provide directly relevant models. citeturn41view0turn18search3

**Bundle size** will blow up if every pack ships all renderers eagerly. The mitigation is pack manifests, capability flags, and lazy loading only the active pack’s renderer/layout bundle, similar in spirit to manifest-declared plugin metadata in Grafana and declarative theme registration in editor products. citeturn38view0turn37view4

**Renderer fragmentation** can make the product feel like multiple apps. The mitigation is a small stable contract set, official design QA for each pack, and limited renderer surface area in early versions. Start with a few hero components and the shell, not every component in the library. This is an architectural synthesis, but it is strongly supported by how bounded MUI slots and Grafana extension points remain. citeturn41view2turn38view1

**Untrusted third-party themes** become a security and reliability problem the moment arbitrary code is allowed. The mitigation is staged capability opening: CSS/tokens first, reviewed renderers later, if ever. VS Code and Grafana both reinforce the value of manifest discipline and explicit contribution surfaces. citeturn33view0turn37view4turn38view0

**Mobile responsiveness** will break faster in packs with radically different desktop metaphors. The mitigation is to treat responsive constraints as part of the contract, not a pack afterthought. Controllers and layout renderers should know viewport capabilities, and certain interaction profiles may need mobile-specific fallbacks. This is a synthesis informed by React Spectrum’s adaptive design stance. citeturn40search5turn40search0

**Backend coupling** becomes a long-term trap if the server starts storing renderer specifics or layout details. The mitigation is the narrow preference-ID contract recommended above and frontend ownership of registry, assets, and layout/render logic. Theia’s backend/frontend preference distinction is especially instructive here. citeturn35view1turn35view2

## Final recommendation

Not a Wrapper should **internally model themes as `ExperiencePack`s**. That is the right call.

But the implementation should be more disciplined than a standard “theme object.” The pack should be **layered**, with clear boundaries between:

- **tokens**
- **skins**
- **component slot variants**
- **trusted component renderers**
- **trusted layout renderers**
- **interaction profiles**
- **background assets**

The most important thing to copy is **not** any single theme engine. It is the combination of:

- **VS Code** for declarative theme manifests, semantic color registries, and preference hierarchy
- **Theia** for shell/layout customization without backend coupling
- **JupyterLab** for separating themes from workspace/layout persistence
- **MUI** for slots, owner state, and SSR-safe CSS variable theming
- **React Spectrum / React Aria** for accessibility-first controller semantics
- **Zag + Ark UI** for headless behavior machines and stylable parts
- **Grafana** for manifest-first, versioned extension points and future marketplace discipline
- **Primer** for semantic color roles and high-contrast rigor citeturn29view0turn31view0turn22view3turn36search2turn41view1turn41view0turn40search1turn17search0turn17search2turn37view4turn38view0turn21search0turn21search7

The most important thing to avoid is the belief that everything can be solved with CSS variables. Mature open-source systems consistently show that once you want different shells, wrappers, navigation, or command-first/windowed interaction models, you need **renderer registries and layout adapters**, not just tokens. citeturn36search2turn41view2turn40search1turn17search0

If I had to reduce the entire report to one build strategy, it would be this:

**Build a headless semantic UI core first. Then let official ExperiencePacks swap skins, slots, renderers, and layouts in bounded stages. Keep the backend preference-only. Keep accessibility in controllers. Keep community support declarative until you have manifest/versioning/review infrastructure.** citeturn40search1turn17search8turn35view1turn38view0

### Open questions and limitations

A few useful references were investigated at a lighter level than the core set, including Zed’s broader source layout, Mantine’s deeper provider internals, and token tooling projects like Style Dictionary and Tailwind as implementation references rather than full architectural comparators. The evidence already gathered is strong enough to make the core recommendation, but if Not a Wrapper later wants a dedicated follow-up specifically on **third-party pack packaging, signed manifests, or token build tooling**, that should be a separate narrower study grounded in marketplace and supply-chain concerns.
