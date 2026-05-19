# ChatGPT Prompt Input - Styles Reference

Extracted CSS custom properties and computed styles relevant to the ChatGPT prompt input/composer area (`#thread-bottom-container`).

> **Agent entrypoint:** load `../chatgpt-css.md` first for compact light/dark tokens and the latest live computed composer metrics, then use this file for detailed prompt-input selectors and layout notes. The raw exhaustive CSS archive is lookup-only.

> **Scope guidance:**
> - Include selectors and variables related to composer layout, actions, sticky behavior, and prompt input states.
> - Preserve token links (`--composer-*`, `--theme-*`, `--interactive-*`, `--bg-*`, `--text-*`, `--icon-*`).
> - Keep computed style signals for the root prompt container.
>
> **Fidelity note:**
> - This is a readability-first CSS reference, not a full production stylesheet.
> - Meaningful tokens are preserved; repetitive/global palette noise is condensed where possible.
>
> **Quick navigation:**
> - Prompt-input-critical sections are marked with `★` in comment headers.

---

```css
/* ===================================================================
   FOUNDATIONS
   =================================================================== */

    --font-mono: "ui-monospace","SFMono-Regular","SF Mono","Menlo","Consolas","Liberation Mono","monospace";
    --spacing: .25rem;

/* --- Breakpoints -------------------------------------------------- */

    --breakpoint-md: 48rem;
    --breakpoint-lg: 64rem;
    --breakpoint-xl: 80rem;
    --breakpoint-2xl: 96rem;

/* --- Containers --------------------------------------------------- */

    --container-xs: 20rem;
    --container-sm: 24rem;
    --container-md: 28rem;
    --container-lg: 32rem;
    --container-xl: 36rem;
    --container-2xl: 42rem;
    --container-3xl: 48rem;
    --container-4xl: 56rem;
    --container-5xl: 64rem;
    --container-6xl: 72rem;
    --container-7xl: 80rem;

/* ===================================================================
   TYPOGRAPHY SCALE
   =================================================================== */

    --text-xs: .75rem;
    --text-xs--line-height: calc(1/.75);
    --text-sm: .875rem;
    --text-sm--line-height: calc(1.25/.875);
    --text-base: 1rem;
    --text-base--line-height: calc(1.5/1);
    --text-lg: 1.125rem;
    --text-lg--line-height: calc(1.75/1.125);
    --text-xl: 1.25rem;
    --text-xl--line-height: calc(1.75/1.25);
    --text-2xl: 1.5rem;
    --text-2xl--line-height: calc(2/1.5);
    --text-3xl: 1.875rem;
    --text-3xl--line-height: calc(2.25/1.875);
    --text-4xl: 2.25rem;
    --text-4xl--line-height: calc(2.5/2.25);
    --text-5xl: 3rem;
    --text-5xl--line-height: 1;
    --text-6xl: 3.75rem;
    --text-6xl--line-height: 1;
    --text-7xl: 4.5rem;
    --text-7xl--line-height: 1;

    --font-weight-extralight: 200;
    --font-weight-light: 300;
    --font-weight-normal: 400;
    --font-weight-medium: 500;
    --font-weight-semibold: 600;
    --font-weight-bold: 700;
    --font-weight-black: 900;

    --tracking-tighter: -.05em;
    --tracking-tight: -.025em;
    --tracking-normal: 0em;
    --tracking-wide: .025em;
    --tracking-wider: .05em;
    --tracking-widest: .1em;

    --leading-tight: 1.25;
    --leading-snug: 1.375;
    --leading-normal: 1.5;
    --leading-relaxed: 1.625;

/* ===================================================================
   SHAPE, SHADOWS, MOTION
   =================================================================== */

    --radius-xs: .125rem;
    --radius-sm: .25rem;
    --radius-md: .375rem;
    --radius-lg: .5rem;
    --radius-xl: .75rem;
    --radius-2xl: 1rem;
    --radius-3xl: 1.5rem;
    --radius-4xl: 2rem;

    --shadow-lg: 0 10px 15px -3px #0000001a,0 4px 6px -4px #0000001a;
    --drop-shadow-xs: 0 1px 1px #0000000d;
    --drop-shadow-sm: 0 1px 2px #00000026;
    --drop-shadow-md: 0 3px 3px #0000001f;
    --drop-shadow-lg: 0 4px 4px #00000026;
    --drop-shadow-xl: 0 9px 7px #0000001a;
    --drop-shadow-2xl: 0 25px 25px #00000026;

/* --- Tailwind shadow internals ---------------------------------------- */

    --tw-shadow: 0 0 transparent;
    --tw-shadow-alpha: 100%;
    --tw-inset-shadow: 0 0 transparent;
    --tw-inset-shadow-alpha: 100%;
    --tw-ring-shadow: 0 0 transparent;
    --tw-ring-offset-shadow: 0 0 transparent;
    --tw-inset-ring-shadow: 0 0 transparent;
    --tw-drop-shadow-alpha: 100%;
    --tw-text-shadow-alpha: 100%;

/* ★ shadow-short — the primary COMPOSER SURFACE shadow
   Two-layer composite:
     Layer 1: 0 4px 4px 0 #0000000a  — soft ambient spread (~4% black)
     Layer 2: 0 0 1px 0 #0000009e    — tight 1px outline ring (~62% black)
   The outline layer replaces a traditional border, giving a crisp edge
   without the layout cost of a border-width.

   DARK MODE OVERRIDE:
   Selector: .shadow-short:where(.dark,.dark *):not(:where(.dark .light,.dark .light *))
   Dark mode changes shadow structure: single outer ambient (larger blur) +
   inset inner glow (replaces outer outline). See dark variant below. */
.shadow-short {
    --tw-shadow: 0px 4px 4px 0px var(--tw-shadow-color, var(--shadow-color-1, #0000000a)),
                 0px 0px 1px 0px var(--tw-shadow-color, var(--shadow-color-2, #0000009e));
    box-shadow: var(--tw-inset-shadow), var(--tw-inset-ring-shadow),
                var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow);
}
/* ★ DARK MODE OVERRIDE — Confirmed via Chrome DevTools, 2026-02-20.
   Structure changes from light:
     Light → two OUTER layers (ambient + outline)
     Dark  → one OUTER layer (ambient, larger blur) + one INSET layer (inner glow)
   Computed box-shadow (dark, excluding transparent TW padding layers):
     rgba(0,0,0,0.1) 0px 4px 12px 0px          — soft ambient (10% black, 12px blur)
     rgba(255,255,255,0.2) 0px 0px 1px 0px inset — inner glow (20% white) */
.shadow-short:where(.dark,.dark *):not(:where(.dark .light,.dark .light *)) {
    --tw-shadow: 0px 4px 12px 0px var(--tw-shadow-color, rgba(0,0,0,0.1));
    --tw-inset-shadow: inset 0px 0px 1px 0px rgba(255,255,255,0.2);
}

    --ease-in: cubic-bezier(.4,0,1,1);
    --ease-out: cubic-bezier(0,0,.2,1);
    --ease-in-out: cubic-bezier(.4,0,.2,1);
    --animate-spin: spin 1s linear infinite;
    --animate-pulse: pulse 2s cubic-bezier(.4,0,.6,1)infinite;
    --animate-bounce: bounce 1s infinite;

    --blur-xs: 4px;
    --blur-sm: 8px;
    --blur-md: 12px;
    --blur-lg: 16px;
    --blur-xl: 24px;
    --blur-2xl: 40px;
    --blur-3xl: 64px;

    --default-transition-duration: .15s;
    --default-transition-timing-function: cubic-bezier(.4,0,.2,1);

/* ===================================================================
   DEFAULT FONTS
   =================================================================== */

    --aspect-video: 16/9;
    --default-font-family: "ui-sans-serif","-apple-system","system-ui","Segoe UI","Helvetica","Apple Color Emoji","Arial","sans-serif","Segoe UI Emoji","Segoe UI Symbol";
    --default-mono-font-family: "ui-monospace","SFMono-Regular","SF Mono","Menlo","Consolas","Liberation Mono","monospace";

/* ===================================================================
   SEMANTIC TYPOGRAPHY TOKENS
   =================================================================== */

    --text-heading-2: 1.5rem;
    --text-heading-2--line-height: 1.75rem;
    --text-heading-2--letter-spacing: -.015625rem;
    --text-heading-2--font-weight: 600;
    --text-heading-app: 1.75rem;
    --text-heading-app--line-height: 2.125rem;
    --text-heading-app--letter-spacing: .02375rem;
    --text-heading-app--font-weight: 500;
    --text-heading-3: 1.125rem;
    --text-heading-3--line-height: 1.625rem;
    --text-heading-3--letter-spacing: -.028125rem;
    --text-heading-3--font-weight: 600;
    --text-body-regular: 1rem;
    --text-body-regular--line-height: 1.625rem;
    --text-body-regular--letter-spacing: -.025rem;
    --text-body-regular--font-weight: 400;
    --text-body-small-regular: .875rem;
    --text-body-small-regular--line-height: 1.125rem;
    --text-body-small-regular--letter-spacing: -.01875rem;
    --text-body-small-regular--font-weight: 400;
    --text-footnote-regular: .8125rem;
    --text-footnote-regular--line-height: 1.125rem;
    --text-footnote-regular--letter-spacing: -.005rem;
    --text-footnote-regular--font-weight: 400;
    --text-footnote-medium: .8125rem;
    --text-footnote-medium--line-height: 1.25rem;
    --text-footnote-medium--letter-spacing: -.005rem;
    --text-footnote-medium--font-weight: 500;
    --text-monospace: .9375rem;
    --text-monospace--line-height: 1.375rem;
    --text-monospace--letter-spacing: -.025rem;
    --text-monospace--font-weight: 400;
    --text-caption-regular: .75rem;
    --text-caption-regular--line-height: 1rem;
    --text-caption-regular--letter-spacing: -.00625rem;
    --text-caption-regular--font-weight: 400;

/* ===================================================================
   INTERACTIVE STATE ALIASES
   =================================================================== */

    --interactive-bg-default-primary: var(--interactive-bg-primary-default);
    --interactive-bg-default-secondary: var(--interactive-bg-secondary-default);
    --interactive-bg-default-accent: var(--interactive-bg-accent-default);
    --interactive-bg-default-danger-primary: var(--interactive-bg-danger-primary-default);
    --interactive-bg-hover-primary: var(--interactive-bg-primary-hover);
    --interactive-bg-hover-secondary: var(--interactive-bg-secondary-hover);
    --interactive-bg-hover-accent: var(--interactive-bg-accent-hover);
    --interactive-bg-hover-danger-primary: var(--interactive-bg-danger-primary-hover);
    --interactive-bg-press-primary: var(--interactive-bg-primary-press);
    --interactive-bg-press-secondary: var(--interactive-bg-secondary-press);
    --interactive-bg-press-accent: var(--interactive-bg-accent-press);
    --interactive-bg-press-danger-primary: var(--interactive-bg-danger-primary-press);
    --interactive-bg-inactive-primary: var(--interactive-bg-primary-inactive);
    --interactive-bg-inactive-secondary: var(--interactive-bg-secondary-inactive);
    --interactive-bg-inactive-accent: var(--interactive-bg-accent-inactive);
    --interactive-bg-inactive-danger-primary: var(--interactive-bg-danger-primary-inactive);
    --interactive-bg-selected-primary: var(--interactive-bg-primary-selected);
    --interactive-bg-selected-secondary: var(--interactive-bg-secondary-selected);
    --interactive-bg-selected-accent: var(--interactive-bg-accent-default);
    --interactive-bg-selected-danger-primary: var(--interactive-bg-danger-primary-default);

    --interactive-border-default-secondary: var(--interactive-border-secondary-default);
    --interactive-border-hover-secondary: var(--interactive-border-secondary-hover);
    --interactive-border-press-secondary: var(--interactive-border-secondary-press);
    --interactive-border-inactive-secondary: var(--interactive-border-secondary-inactive);
    --interactive-border-selected-secondary: var(--interactive-border-secondary-default);

    --interactive-label-default-primary: var(--interactive-label-primary-default);
    --interactive-label-default-secondary: var(--interactive-label-secondary-default);
    --interactive-label-default-tertiary: var(--interactive-label-tertiary-default);
    --interactive-label-default-accent: var(--interactive-label-accent-default);
    --interactive-label-hover-primary: var(--interactive-label-primary-hover);
    --interactive-label-hover-secondary: var(--interactive-label-secondary-hover);
    --interactive-label-hover-tertiary: var(--interactive-label-tertiary-hover);
    --interactive-label-hover-accent: var(--interactive-label-accent-hover);
    --interactive-label-press-primary: var(--interactive-label-primary-press);
    --interactive-label-press-secondary: var(--interactive-label-secondary-press);
    --interactive-label-press-tertiary: var(--interactive-label-tertiary-press);
    --interactive-label-press-accent: var(--interactive-label-accent-press);
    --interactive-label-inactive-primary: var(--interactive-label-primary-inactive);
    --interactive-label-inactive-secondary: var(--interactive-label-secondary-inactive);
    --interactive-label-inactive-tertiary: var(--interactive-label-tertiary-inactive);
    --interactive-label-inactive-accent: var(--interactive-label-accent-inactive);
    --interactive-label-selected-primary: var(--interactive-label-primary-selected);
    --interactive-label-selected-secondary: var(--interactive-label-secondary-selected);
    --interactive-label-selected-tertiary: var(--interactive-label-tertiary-selected);
    --interactive-label-selected-accent: var(--interactive-label-accent-selected);

    --interactive-icon-default-accent: var(--interactive-icon-accent-default);
    --interactive-icon-hover-accent: var(--interactive-icon-accent-hover);
    --interactive-icon-press-accent: var(--interactive-icon-accent-press);
    --interactive-icon-inactive-accent: var(--interactive-icon-accent-inactive);
    --interactive-icon-selected-accent: var(--interactive-icon-accent-selected);

/* ===================================================================
   TOUCH & FOCUS
   =================================================================== */

    --tap-padding-pointer: 32px;
    --tap-padding-mobile: 44px;
    --focus-outline-margin-default: 4px;

/* ===================================================================
   COLOR PALETTES (ABRIDGED)
   =================================================================== */

    --white: #fff;
    --black: #000;
    --gray-0: #fff;
    --gray-25: #fcfcfc;
    --gray-50: #f9f9f9;
    --gray-75: #f2f2f2;
    --gray-100: #ececec;
    --gray-150: #e8e8e8;
    --gray-200: #e3e3e3;
    --gray-300: #cdcdcd;
    --gray-500: #9b9b9b;
    --gray-700: #424242;
    --gray-800: #212121;
    --gray-900: #171717;
    --gray-950: #0d0d0d;
    --gray-1000: #0b0b0b;
    --brand-purple: #ab68ff;

    --blue-50: #e5f3ff;
    --blue-75: #cce6ff;
    --blue-100: #99ceff;
    --blue-200: #66b5ff;
    --blue-300: #339cff;
    --blue-400: #0285ff;
    --blue-500: #0169cc;
    --blue-900: #00284d;

    --green-50: #d9f4e4;
    --green-300: #40c977;
    --green-400: #04b84c;
    --green-500: #00a240;
    --green-900: #003716;

    --yellow-50: #fff6d9;
    --yellow-75: #ffeeb8;
    --yellow-300: #ffd240;
    --yellow-400: #ffc300;
    --yellow-500: #e0ac00;
    --yellow-900: #4d3b00;

    --purple-50: #efe5fe;
    --purple-300: #ad7bf9;
    --purple-400: #924ff7;
    --purple-500: #8046d9;
    --purple-900: #2c184a;

    --pink-50: #ffe8f3;
    --pink-300: #ff8cc1;
    --pink-400: #ff66ad;
    --pink-500: #e04c91;
    --pink-900: #4d1f34;

    --orange-50: #ffe7d9;
    --orange-300: #ff8549;
    --orange-400: #fb6a22;
    --orange-500: #e25507;
    --orange-900: #4a2206;

    --red-50: #ffe1e0;
    --red-400: #fa423e;
    --red-500: #e02e2a;
    --red-600: #ba2623;

/* ===================================================================
   GLOBAL DOCUMENT STYLES
   =================================================================== */

    -webkit-text-size-adjust: 100%;
    tab-size: 4;
    line-height: 1.5;
    font-family: var(--default-font-family,ui-sans-serif,system-ui,sans-serif,"Apple Color Emoji","Segoe UI Emoji","Segoe UI Symbol","Noto Color Emoji");
    font-feature-settings: var(--default-font-feature-settings,normal);
    font-variation-settings: var(--default-font-variation-settings,normal);
    -webkit-tap-highlight-color: transparent;
    -webkit-font-smoothing: antialiased;

/* ===================================================================
   ★ COMPOSER & CHAT TOKENS
   =================================================================== */

    --mkt-header-height: calc(16*var(--spacing));
    --message-surface: #e9e9e980;
    --composer-surface: var(--message-surface);
    --composer-blue-bg: #daeeff;
    --composer-blue-hover: #bddcf4;
    --composer-blue-hover-tint: #0084ff24;
    --composer-surface-primary: var(--main-surface-primary);

    --dot-color: var(--black);
    --icon-surface: 13 13 13;
    --content-primary: #01172b;
    --content-secondary: #44505b;
    --text-quaternary: #00000030;
    --text-placeholder: #000000b3;
    --text-danger: var(--red-500);
    --text-error: #f93a37;
    --surface-error: 249 58 55;

    --tag-blue: #08f;
    --tag-blue-light: #0af;
    --hint-text: #08f;
    --hint-bg: #b3dbff;
    --selection: #007aff;

/* ===================================================================
   ★ COMPOSER & CHAT TOKENS (DARK SNAPSHOT)
   Confirmed via Chrome DevTools, 2026-02-20.
   =================================================================== */

    --message-surface: #323232d9;
    --composer-surface: #323232d9;
    --composer-blue-bg: #2a4a6d;
    --composer-blue-hover: #1a416a;
    --composer-blue-hover-tint: #0084ff24;                /* unchanged */
    --composer-surface-primary: #303030;

    --dot-color: #fff;
    --icon-surface: 240 240 240;
    --content-primary: #f2f6fa;
    --content-secondary: #dbe2e8;
    --text-quaternary: #ffffff69;
    --text-placeholder: #fffc;
    --text-danger: #e02e2a;                               /* unchanged */
    --text-error: #f93a37;                                /* unchanged */
    --surface-error: 249 58 55;                           /* unchanged */

    --tag-blue: #08f;                                     /* unchanged */
    --tag-blue-light: #0af;                               /* unchanged */
    --hint-text: #08f;                                    /* unchanged */
    --hint-bg: #b3dbff;                                   /* unchanged */
    --selection: #007aff;                                 /* unchanged */

/* ===================================================================
   CHAT THEME TOKENS (LIGHT SNAPSHOT)
   =================================================================== */

    --default-theme-user-msg-bg: var(--message-surface);
    --default-theme-user-msg-text: var(--text-primary);
    --default-theme-submit-btn-bg: #000;
    --default-theme-submit-btn-text: #fff;
    --default-theme-secondary-btn-bg: var(--gray-100);
    --default-theme-secondary-btn-text: var(--text-primary);
    --default-theme-user-selection-bg: color-mix(in oklab,var(--blue-300)35%,transparent);
    --default-theme-attribution-highlight-bg: var(--yellow-75);
    --default-theme-entity-accent: var(--blue-500);
    --formatted-text-highlight-bg: #bae6fdb3;

    --blue-theme-user-msg-bg: var(--blue-50);
    --blue-theme-user-msg-text: var(--blue-900);
    --blue-theme-submit-btn-bg: var(--blue-400);
    --blue-theme-submit-btn-text: #fff;
    --blue-theme-secondary-btn-bg: var(--blue-50);
    --blue-theme-secondary-btn-text: var(--blue-900);
    --blue-theme-user-selection-bg: color-mix(in oklab,var(--blue-300)35%,transparent);
    --blue-theme-entity-accent: var(--blue-500);

    --green-theme-user-msg-bg: var(--green-50);
    --green-theme-user-msg-text: var(--green-900);
    --green-theme-submit-btn-bg: var(--green-400);
    --green-theme-submit-btn-text: #fff;
    --green-theme-secondary-btn-bg: var(--green-50);
    --green-theme-secondary-btn-text: var(--green-900);
    --green-theme-user-selection-bg: color-mix(in oklab,var(--green-300)35%,transparent);
    --green-theme-entity-accent: var(--green-500);

    --yellow-theme-user-msg-bg: var(--yellow-50);
    --yellow-theme-user-msg-text: var(--yellow-900);
    --yellow-theme-submit-btn-bg: var(--yellow-400);
    --yellow-theme-submit-btn-text: #fff;
    --yellow-theme-secondary-btn-bg: var(--yellow-50);
    --yellow-theme-secondary-btn-text: var(--yellow-900);
    --yellow-theme-user-selection-bg: color-mix(in oklab,var(--yellow-300)35%,transparent);
    --yellow-theme-entity-accent: var(--yellow-500);

    --purple-theme-user-msg-bg: var(--purple-50);
    --purple-theme-user-msg-text: var(--purple-900);
    --purple-theme-submit-btn-bg: var(--purple-400);
    --purple-theme-submit-btn-text: #fff;
    --purple-theme-secondary-btn-bg: var(--purple-50);
    --purple-theme-secondary-btn-text: var(--purple-900);
    --purple-theme-user-selection-bg: color-mix(in oklab,var(--purple-300)35%,transparent);
    --purple-theme-entity-accent: var(--purple-500);

    --pink-theme-user-msg-bg: var(--pink-50);
    --pink-theme-user-msg-text: var(--pink-900);
    --pink-theme-submit-btn-bg: var(--pink-400);
    --pink-theme-submit-btn-text: #fff;
    --pink-theme-secondary-btn-bg: var(--pink-50);
    --pink-theme-secondary-btn-text: var(--pink-900);
    --pink-theme-user-selection-bg: color-mix(in oklab,var(--pink-300)35%,transparent);
    --pink-theme-entity-accent: var(--pink-500);

    --orange-theme-user-msg-bg: var(--orange-50);
    --orange-theme-user-msg-text: var(--orange-900);
    --orange-theme-submit-btn-bg: var(--orange-400);
    --orange-theme-submit-btn-text: #fff;
    --orange-theme-secondary-btn-bg: var(--orange-50);
    --orange-theme-secondary-btn-text: var(--orange-900);
    --orange-theme-user-selection-bg: color-mix(in oklab,var(--orange-300)35%,transparent);
    --orange-theme-entity-accent: var(--orange-500);

    --black-theme-user-msg-bg: #000;
    --black-theme-user-msg-text: #fff;
    --black-theme-submit-btn-bg: #000;
    --black-theme-submit-btn-text: #fff;
    --black-theme-secondary-btn-bg: var(--gray-100);
    --black-theme-secondary-btn-text: var(--text-primary);
    --black-theme-user-selection-bg: color-mix(in oklab,var(--gray-300)40%,transparent);
    --black-theme-entity-accent: var(--gray-500);

    --theme-user-msg-bg: var(--default-theme-user-msg-bg);
    --theme-user-msg-text: var(--default-theme-user-msg-text);
    --theme-submit-btn-bg: var(--default-theme-submit-btn-bg);
    --theme-submit-btn-text: var(--default-theme-submit-btn-text);
    --theme-secondary-btn-bg: var(--default-theme-secondary-btn-bg);
    --theme-secondary-btn-text: var(--default-theme-secondary-btn-text);
    --theme-user-selection-bg: var(--default-theme-user-selection-bg);
    --theme-attribution-highlight-bg: var(--default-theme-attribution-highlight-bg);
    --theme-entity-accent: var(--default-theme-entity-accent);

/* ===================================================================
   CHAT THEME TOKENS (DARK SNAPSHOT)
   Confirmed via Chrome DevTools, 2026-02-20.
   =================================================================== */

    --default-theme-user-msg-bg: #323232d9;
    --default-theme-user-msg-text: #fff;
    --default-theme-submit-btn-bg: #fff;
    --default-theme-submit-btn-text: #000;
    --default-theme-secondary-btn-bg: #424242;
    --default-theme-secondary-btn-text: #fff;
    --default-theme-user-selection-bg: color-mix(in oklab,#66b5ff 40%,transparent);
    --default-theme-attribution-highlight-bg: #6e5400;
    --default-theme-entity-accent: #339cff;
    --formatted-text-highlight-bg: #0ea5e94d;

    --blue-theme-user-msg-bg: #003f7a;
    --blue-theme-user-msg-text: #f5faff;
    --blue-theme-submit-btn-bg: #0169cc;
    --blue-theme-submit-btn-text: #fff;
    --blue-theme-secondary-btn-bg: #004f99;
    --blue-theme-secondary-btn-text: #f5faff;
    --blue-theme-user-selection-bg: color-mix(in oklab,#0285ff 60%,transparent);
    --blue-theme-entity-accent: #0169cc;

    --green-theme-user-msg-bg: #00692a;
    --green-theme-user-msg-text: #edfaf2;
    --green-theme-submit-btn-bg: #00a240;
    --green-theme-submit-btn-text: #fff;
    --green-theme-secondary-btn-bg: #008635;
    --green-theme-secondary-btn-text: #edfaf2;
    --green-theme-user-selection-bg: color-mix(in oklab,#04b84c 60%,transparent);
    --green-theme-entity-accent: #40c977;

    --yellow-theme-user-msg-bg: #916f00;
    --yellow-theme-user-msg-text: #fffbed;
    --yellow-theme-submit-btn-bg: #e0ac00;
    --yellow-theme-submit-btn-text: #fff;
    --yellow-theme-secondary-btn-bg: #ba8e00;
    --yellow-theme-secondary-btn-text: #fffbed;
    --yellow-theme-user-selection-bg: color-mix(in oklab,#ffc300 50%,transparent);
    --yellow-theme-entity-accent: #ffd240;

    --purple-theme-user-msg-bg: #532d8d;
    --purple-theme-user-msg-text: #f9f5fe;
    --purple-theme-submit-btn-bg: #8046d9;
    --purple-theme-submit-btn-text: #fff;
    --purple-theme-secondary-btn-bg: #6b3ab4;
    --purple-theme-secondary-btn-text: #f9f5fe;
    --purple-theme-user-selection-bg: color-mix(in oklab,#924ff7 60%,transparent);
    --purple-theme-entity-accent: #ad7bf9;

    --pink-theme-user-msg-bg: #963c67;
    --pink-theme-user-msg-text: #fff4f9;
    --pink-theme-submit-btn-bg: #e04c91;
    --pink-theme-submit-btn-text: #fff;
    --pink-theme-secondary-btn-bg: #ba437a;
    --pink-theme-secondary-btn-text: #fff4f9;
    --pink-theme-user-selection-bg: color-mix(in oklab,#ff66ad 60%,transparent);
    --pink-theme-entity-accent: #ff8cc1;

    --orange-theme-user-msg-bg: #923b0f;
    --orange-theme-user-msg-text: #fff5f0;
    --orange-theme-submit-btn-bg: #e25507;
    --orange-theme-submit-btn-text: #fff;
    --orange-theme-secondary-btn-bg: #b9480d;
    --orange-theme-secondary-btn-text: #fff5f0;
    --orange-theme-user-selection-bg: color-mix(in oklab,#fb6a22 60%,transparent);
    --orange-theme-entity-accent: #ff8549;

    --black-theme-user-msg-bg: #ececec;
    --black-theme-user-msg-text: #000;
    --black-theme-submit-btn-bg: #fff;
    --black-theme-submit-btn-text: #000;
    --black-theme-secondary-btn-bg: #424242;
    --black-theme-secondary-btn-text: #fff;
    --black-theme-user-selection-bg: color-mix(in oklab,#676767 40%,transparent);
    --black-theme-entity-accent: #cdcdcd;

/* ===================================================================
   LAYOUT DIRECTION + SHARED APP DIMENSIONS
   =================================================================== */

    --start: left;
    --end: right;
    --to-end-unit: 1;
    --is-ltr: unset;
    --is-rtl: ;
    --safe-area-max-inset-bottom: env(safe-area-max-inset-bottom,36px);
    --user-chat-width: 70%;

    --sidebar-width: 260px;
    --sidebar-rail-width: calc(13*var(--spacing));
    --header-height: calc(13*var(--spacing));
    --sidebar-section-margin-top: 1.25rem;
    --sidebar-section-first-margin-top: .5rem;
    --sidebar-expanded-section-margin-bottom: 1.25rem;
    --sidebar-collapsed-section-margin-bottom: .75rem;

/* ===================================================================
   ★ SURFACE, BG, BORDER, TEXT, ICON TOKENS (LIGHT SNAPSHOT)
   =================================================================== */

    --main-surface-background: #fffffff2;
    --main-surface-primary: var(--white);
    --main-surface-primary-inverse: var(--gray-800);
    --main-surface-secondary: var(--gray-50);
    --main-surface-secondary-selected: #0000001a;
    --main-surface-tertiary: var(--gray-100);

    --sidebar-surface-primary: var(--gray-50);
    --sidebar-surface-secondary: var(--gray-100);
    --sidebar-surface-tertiary: var(--gray-200);
    --sidebar-title-primary: #28282880;
    --sidebar-surface: #fcfcfc;
    --sidebar-body-primary: #0d0d0d;
    --sidebar-icon: #7d7d7d;
    --sidebar-surface-floating-lightness: 1;
    --sidebar-surface-floating-alpha: 1;
    --sidebar-surface-pinned-lightness: .99;
    --sidebar-surface-pinned-alpha: 1;

    --bg-primary: #fff;
    --bg-primary-inverted: #000;
    --bg-secondary: #e8e8e8;
    --bg-tertiary: #f3f3f3;
    --bg-scrim: #0d0d0d80;
    --bg-elevated-primary: #fff;
    --bg-elevated-secondary: #f9f9f9;
    --bg-accent-static: var(--blue-400);
    --bg-status-warning: var(--orange-25);
    --bg-status-error: var(--red-25);

    --border-default: #0d0d0d1a;
    --border-heavy: #0d0d0d26;
    --border-light: #0d0d0d0d;
    --border-status-warning: var(--orange-50);
    --border-status-error: var(--red-50);
    --border-xlight: #0000000d;
    --border-medium: #00000026;
    --border-xheavy: #00000040;
    --border-sharp: #0000000d;

    --text-primary: #0d0d0d;
    --text-secondary: #5d5d5d;
    --text-tertiary: #8f8f8f;
    --text-inverted: #fff;
    --text-inverted-static: #fff;
    --text-primary-inverse: var(--gray-100);
    --text-accent: var(--blue-200);
    --text-status-warning: var(--orange-500);
    --text-status-error: var(--red-500);

    --icon-primary: #0d0d0d;
    --icon-secondary: #5d5d5d;
    --icon-tertiary: #8f8f8f;
    --icon-inverted: #fff;
    --icon-inverted-static: #fff;
    --icon-accent: var(--blue-400);
    --icon-status-warning: var(--orange-500);
    --icon-status-error: var(--red-500);

    --surface-hover: #00000012;
    --scrollbar-color: #0000001a;
    --scrollbar-color-hover: #0003;
    --link: #2964aa;
    --link-hover: #749ac8;

/* ===================================================================
   ★ SURFACE, BG, BORDER, TEXT, ICON TOKENS (DARK SNAPSHOT)
   Confirmed via Chrome DevTools, 2026-02-20.
   =================================================================== */

    --main-surface-background: #212121e6;
    --main-surface-primary: #212121;
    --main-surface-primary-inverse: #fff;
    --main-surface-secondary: #2f2f2f;
    --main-surface-secondary-selected: #ffffff1a;
    --main-surface-tertiary: #424242;

    --sidebar-surface-primary: #171717;
    --sidebar-surface-secondary: #212121;
    --sidebar-surface-tertiary: #2f2f2f;
    --sidebar-title-primary: #f0f0f080;
    --sidebar-surface: #2b2b2b;
    --sidebar-body-primary: #ededed;
    --sidebar-icon: #a4a4a4;
    --sidebar-surface-floating-lightness: .3;
    --sidebar-surface-floating-alpha: 1;
    --sidebar-surface-pinned-lightness: .29;
    --sidebar-surface-pinned-alpha: 1;

    --bg-primary: #212121;
    --bg-primary-inverted: #fff;
    --bg-secondary: #303030;
    --bg-tertiary: #414141;
    --bg-scrim: #0d0d0d80;                               /* unchanged */
    --bg-elevated-primary: #303030;
    --bg-elevated-secondary: #181818;
    --bg-accent-static: #0285ff;                          /* unchanged */

    --border-default: #ffffff26;
    --border-heavy: #fff3;
    --border-light: #ffffff0d;
    --border-xlight: #ffffff0d;
    --border-medium: #ffffff26;
    --border-xheavy: #ffffff40;
    --border-sharp: #ffffff0d;

    --text-primary: #fff;
    --text-secondary: #f3f3f3;
    --text-tertiary: #afafaf;
    --text-inverted: #0d0d0d;
    --text-inverted-static: #fff;                         /* unchanged */
    --text-primary-inverse: #0d0d0d;
    --text-accent: #66b5ff;

    --icon-primary: #e8e8e8;
    --icon-secondary: #cdcdcd;
    --icon-tertiary: #afafaf;
    --icon-inverted: #0d0d0d;
    --icon-inverted-static: #fff;                         /* unchanged */
    --icon-accent: #66b5ff;

    --surface-hover: #ffffff26;
    --scrollbar-color: #ffffff1a;
    --scrollbar-color-hover: #fff3;
    --link: #7ab7ff;
    --link-hover: #5e83b3;

/* ===================================================================
   ★ INTERACTIVE STATE PRIMITIVES (LIGHT SNAPSHOT)
   =================================================================== */

    --interactive-bg-primary-default: #0d0d0d;
    --interactive-bg-primary-hover: #0d0d0dcc;
    --interactive-bg-primary-press: #0d0d0de5;
    --interactive-bg-primary-inactive: #0d0d0d;
    --interactive-bg-primary-selected: #0d0d0d;

    --interactive-bg-secondary-default: #0d0d0d00;
    --interactive-bg-secondary-hover: #0d0d0d05;
    --interactive-bg-secondary-press: #0d0d0d0d;
    --interactive-bg-secondary-inactive: #0d0d0d00;
    --interactive-bg-secondary-selected: #0d0d0d0d;

    --interactive-bg-tertiary-default: #fff;
    --interactive-bg-tertiary-hover: #f9f9f9;
    --interactive-bg-tertiary-press: #f3f3f3;
    --interactive-bg-tertiary-inactive: #fff;
    --interactive-bg-tertiary-selected: #fff;

    --interactive-bg-accent-default: var(--blue-50);
    --interactive-bg-accent-hover: var(--blue-75);
    --interactive-bg-accent-muted-hover: #ebf4ff;
    --interactive-bg-accent-muted-context: #ebf4ff80;
    --interactive-bg-accent-press: var(--blue-100);
    --interactive-bg-accent-muted-press: #e0efff;
    --interactive-bg-accent-inactive: var(--blue-50);

    --interactive-bg-danger-primary-default: var(--red-500);
    --interactive-bg-danger-primary-hover: var(--red-400);
    --interactive-bg-danger-primary-press: var(--red-600);
    --interactive-bg-danger-primary-inactive: var(--red-500);

    --interactive-border-focus: #0d0d0d;
    --interactive-border-secondary-default: #0d0d0d1a;
    --interactive-border-secondary-hover: #0d0d0d0d;
    --interactive-border-secondary-press: #0d0d0d0d;
    --interactive-border-secondary-inactive: #0d0d0d1a;
    --interactive-border-tertiary-default: #0d0d0d1a;
    --interactive-border-tertiary-hover: #0d0d0d1a;
    --interactive-border-tertiary-press: #0d0d0d0d;
    --interactive-border-tertiary-inactive: #0d0d0d1a;

    --interactive-label-primary-default: #fff;
    --interactive-label-primary-hover: #fff;
    --interactive-label-primary-press: #fff;
    --interactive-label-primary-inactive: #fff;
    --interactive-label-primary-selected: #fff;
    --interactive-label-secondary-default: #0d0d0d;
    --interactive-label-secondary-hover: #0d0d0de5;
    --interactive-label-secondary-press: #0d0d0dcc;
    --interactive-label-secondary-inactive: #0d0d0d;
    --interactive-label-secondary-selected: #0d0d0d;
    --interactive-label-tertiary-default: #5d5d5d;
    --interactive-label-tertiary-hover: #5d5d5d;
    --interactive-label-tertiary-press: #5d5d5d;
    --interactive-label-tertiary-inactive: #5d5d5d;
    --interactive-label-tertiary-selected: #5d5d5d;

    --interactive-icon-primary-default: #fff;
    --interactive-icon-primary-hover: #fff;
    --interactive-icon-primary-press: #fff;
    --interactive-icon-primary-selected: #fff;
    --interactive-icon-primary-inactive: #fff;
    --interactive-icon-secondary-default: #0d0d0d;
    --interactive-icon-secondary-hover: #0d0d0de5;
    --interactive-icon-secondary-press: #0d0d0dcc;
    --interactive-icon-secondary-selected: #0d0d0d;
    --interactive-icon-secondary-inactive: #0d0d0d;
    --interactive-icon-tertiary-default: #5d5d5d;
    --interactive-icon-tertiary-hover: #5d5d5d;
    --interactive-icon-tertiary-press: #5d5d5d;
    --interactive-icon-tertiary-selected: #5d5d5d;
    --interactive-icon-tertiary-inactive: #5d5d5d;

/* ===================================================================
   ★ INTERACTIVE STATE PRIMITIVES (DARK SNAPSHOT)
   Confirmed via Chrome DevTools, 2026-02-20.
   =================================================================== */

    --interactive-bg-primary-default: #fff;
    --interactive-bg-primary-hover: #fffc;
    --interactive-bg-primary-press: #ffffffe5;
    --interactive-bg-primary-inactive: #fff;
    --interactive-bg-primary-selected: #fff;

    --interactive-bg-secondary-default: #fff0;
    --interactive-bg-secondary-hover: #ffffff1a;
    --interactive-bg-secondary-press: #ffffff0d;
    --interactive-bg-secondary-inactive: #fff0;
    --interactive-bg-secondary-selected: #ffffff1a;

    --interactive-bg-tertiary-default: #212121;
    --interactive-bg-tertiary-hover: #181818;
    --interactive-bg-tertiary-press: #0d0d0d;
    --interactive-bg-tertiary-inactive: #212121;
    --interactive-bg-tertiary-selected: #212121;

    --interactive-bg-accent-default: #013566;
    --interactive-bg-accent-hover: #003f7a;
    --interactive-bg-accent-muted-hover: #394a5b;
    --interactive-bg-accent-muted-context: #394a5b80;
    --interactive-bg-accent-press: #004f99;
    --interactive-bg-accent-muted-press: #40484f;
    --interactive-bg-accent-inactive: #013566;

    --interactive-bg-danger-primary-default: #e02e2a;     /* unchanged */
    --interactive-bg-danger-primary-hover: #fa423e;       /* unchanged */
    --interactive-bg-danger-primary-press: #ba2623;       /* unchanged */
    --interactive-bg-danger-primary-inactive: #e02e2a;    /* unchanged */

    --interactive-border-focus: #fff;
    --interactive-border-secondary-default: #ffffff26;
    --interactive-border-secondary-hover: #ffffff26;
    --interactive-border-secondary-press: #fff3;
    --interactive-border-secondary-inactive: #ffffff1a;
    --interactive-border-tertiary-default: #ffffff1a;
    --interactive-border-tertiary-hover: #ffffff26;
    --interactive-border-tertiary-press: #ffffff1a;
    --interactive-border-tertiary-inactive: #ffffff1a;

    --interactive-label-primary-default: #0d0d0d;
    --interactive-label-primary-hover: #0d0d0d;
    --interactive-label-primary-press: #0d0d0d;
    --interactive-label-primary-inactive: #0d0d0d;
    --interactive-label-primary-selected: #0d0d0d;
    --interactive-label-secondary-default: #f3f3f3;
    --interactive-label-secondary-hover: #ffffffe5;
    --interactive-label-secondary-press: #fffc;
    --interactive-label-secondary-inactive: #f3f3f3;
    --interactive-label-secondary-selected: #f3f3f3;
    --interactive-label-tertiary-default: #cdcdcd;
    --interactive-label-tertiary-hover: #cdcdcd;
    --interactive-label-tertiary-press: #cdcdcd;
    --interactive-label-tertiary-inactive: #cdcdcd;
    --interactive-label-tertiary-selected: #cdcdcd;
    --interactive-label-accent-default: #99ceff;
    --interactive-label-accent-hover: #99ceff;
    --interactive-label-accent-press: #99ceff;
    --interactive-label-accent-inactive: #99ceff;
    --interactive-label-accent-selected: #99ceff;

    --interactive-icon-primary-default: #0d0d0d;
    --interactive-icon-primary-hover: #0d0d0d;
    --interactive-icon-primary-press: #0d0d0d;
    --interactive-icon-primary-selected: #0d0d0d;
    --interactive-icon-primary-inactive: #0d0d0d;
    --interactive-icon-secondary-default: #f3f3f3;
    --interactive-icon-secondary-hover: #ffffffe5;
    --interactive-icon-secondary-press: #fffc;
    --interactive-icon-secondary-selected: #f3f3f3;
    --interactive-icon-secondary-inactive: #f3f3f3;
    --interactive-icon-tertiary-default: #cdcdcd;
    --interactive-icon-tertiary-hover: #cdcdcd;
    --interactive-icon-tertiary-press: #cdcdcd;
    --interactive-icon-tertiary-selected: #cdcdcd;
    --interactive-icon-tertiary-inactive: #cdcdcd;
    --interactive-icon-accent-default: #99ceff;
    --interactive-icon-accent-hover: #99ceff;
    --interactive-icon-accent-press: #99ceff;
    --interactive-icon-accent-inactive: #99ceff;
    --interactive-icon-accent-selected: #99ceff;

/* ===================================================================
   ★ PROMPT LAYOUT, STICKY METRICS, AND MASKS
   =================================================================== */

    --cqh-full: 100cqh;
    --cqw-full: 100cqw;
    --silk-100-lvh-dvh-pct: max(100dvh,100lvh);
    --menu-item-height: calc(var(--spacing)*9);

    --sticky-padding-top: var(--header-height);
    --sticky-padding-bottom: 88px;
    --composer-footer_height: var(--composer-bar_footer-current-height,32px);
    --composer-bar_height: var(--composer-bar_current-height,52px);
    --composer-bar_width: var(--composer-bar_current-width,768px);

    --mask-fill: linear-gradient(to bottom,white 0%,white 100%);
    --mask-erase: linear-gradient(to bottom,black 0%,black 100%);

/* ===================================================================
   SPRING / EASING SYSTEM
   =================================================================== */

    --spring-fast-duration: .667s;
    --spring-fast: linear(0,.01942 1.83%,.07956 4.02%,.47488 13.851%,.65981 19.572%,.79653 25.733%,.84834 29.083%,.89048 32.693%,.9246 36.734%,.95081 41.254%,.97012 46.425%,.98361 52.535%,.99665 68.277%,.99988);
    --spring-common-duration: .667s;
    --spring-common: linear(0,.00506 1.18%,.02044 2.46%,.08322 5.391%,.46561 17.652%,.63901 24.342%,.76663 31.093%,.85981 38.454%,.89862 42.934%,.92965 47.845%,.95366 53.305%,.97154 59.516%,.99189 74.867%,.9991);
    --spring-standard: var(--spring-common);
    --spring-slow-bounce-duration: 1.167s;
    --spring-slow-bounce: linear(0,.00172 0.51%,.00682 1.03%,.02721 2.12%,.06135 3.29%,.11043 4.58%,.21945 6.911%,.59552 14.171%,.70414 16.612%,.79359 18.962%,.86872 21.362%,.92924 23.822%,.97589 26.373%,1.01 29.083%,1.0264 31.043%,1.03767 33.133%,1.04411 35.404%,1.04597 37.944%,1.04058 42.454%,1.01119 55.646%,1.00137 63.716%,.99791 74.127%,.99988);
    --spring-bounce-duration: .833s;
    --spring-bounce: linear(0,.00541 1.29%,.02175 2.68%,.04923 4.19%,.08852 5.861%,.17388 8.851%,.48317 18.732%,.57693 22.162%,.65685 25.503%,.72432 28.793%,.78235 32.163%,.83182 35.664%,.87356 39.354%,.91132 43.714%,.94105 48.455%,.96361 53.705%,.97991 59.676%,.9903 66.247%,.99664 74.237%,.99968 84.358%,1.00048);
    --spring-fast-bounce-duration: 1s;
    --spring-fast-bounce: linear(0,.00683 1.14%,.02731 2.35%,.11137 5.091%,.59413 15.612%,.78996 20.792%,.92396 25.953%,.97109 28.653%,1.00624 31.503%,1.03801 36.154%,1.0477 41.684%,1.00242 68.787%,.99921);
    --easing-spring-elegant-duration: .58171s;
    --easing-spring-elegant: linear(0 0%,.005927 1%,.022466 2%,.047872 3%,.080554 4%,.119068 5%,.162116 6%,.208536 7.0%,.2573 8%,.3075 9%,.358346 10%,.409157 11%,.45935 12%,.508438 13%,.556014 14.0%,.601751 15%,.645389 16%,.686733 17%,.72564 18%,.762019 19%,.795818 20%,.827026 21%,.855662 22%,.881772 23%,.905423 24%,.926704 25%,.945714 26%,.962568 27%,.977386 28.0%,.990295 29.0%,1.00143 30%,1.01091 31%,1.01888 32%,1.02547 33%,1.03079 34%,1.03498 35%,1.03816 36%,1.04042 37%,1.04189 38%,1.04266 39%,1.04283 40%,1.04247 41%,1.04168 42%,1.04052 43%,1.03907 44%,1.03737 45%,1.03549 46%,1.03348 47%,1.03138 48%,1.02922 49%,1.02704 50%,1.02486 51%,1.02272 52%,1.02063 53%,1.01861 54%,1.01667 55.0%,1.01482 56.0%,1.01307 57.0%,1.01142 58.0%,1.00989 59%,1.00846 60%,1.00715 61%,1.00594 62%,1.00485 63%,1.00386 64%,1.00296 65%,1.00217 66%,1.00147 67%,1.00085 68%,1.00031 69%,.999849 70%,.999457 71%,.999128 72%,.998858 73%,.99864 74%,.99847 75%,.998342 76%,.998253 77%,.998196 78%,.998169 79%,.998167 80%,.998186 81%,.998224 82%,.998276 83%,.998341 84%,.998415 85%,.998497 86%,.998584 87%,.998675 88%,.998768 89%,.998861 90%,.998954 91%,.999045 92%,.999134 93%,.99922 94%,.999303 95%,.999381 96%,.999455 97%,.999525 98%,.999589 99%,.99965 100%);

/* ===================================================================
   UTILITY & MISC
   =================================================================== */

    --utility-scrollbar: #0000000a;
    --sharp-edge-top-shadow: 0 1px 0 #0000000d;
    --sharp-edge-top-shadow-placeholder: 0 1px 0 transparent;
    --sharp-edge-bottom-shadow: 0 -1px 0 #0000000d;
    --sharp-edge-bottom-shadow-placeholder: 0 -1px 0 transparent;
    --swiper-theme-color: #007aff;
    --cot-shimmer-duration: 1400ms;
    color-scheme: light;                                  /* light mode */
    color-scheme: dark;                                   /* dark mode */

/* ===================================================================
   ★ PROMPT ROOT — COMPUTED ELEMENT STYLES
   These are the styles on #thread-bottom-container.
   =================================================================== */

    color: var(--text-primary);                          /* light: #0d0d0d | dark: #fff */
    box-sizing: border-box;
    border: 0 solid;
    margin: 0;
    padding: 0;
    position: sticky;
    bottom: 0px;
    isolation: isolate;
    z-index: 10;
    display: flex;
    width: 100%;
    flex-basis: auto;
    flex-direction: column;
    border-color: transparent;
    background-color: transparent;
    box-shadow: none;
    text-shadow: none;
    padding-top: 0px;

/* ===================================================================
   ★ COMPOSER SURFACE — VERIFIED COMPUTED STYLES
   div[data-composer-surface="true"]
   Confirmed via Chrome DevTools, 2026-02-20.
   =================================================================== */

/* --- Tailwind utility classes on the element ---------------------- */
/*  bg-token-bg-primary
    corner-superellipse/1.1                   — CSS superellipse rounding
    cursor-text
    overflow-clip
    bg-clip-padding
    p-2.5
    contain-inline-size
    motion-safe:transition-colors
    motion-safe:duration-200
    motion-safe:ease-in-out
    dark:bg-[#303030]
    grid grid-cols-[auto_1fr_auto]
    [grid-template-areas:'header_header_header'_'leading_primary_trailing'_'._footer_.']
    group-data-expanded/composer:[grid-template-areas:'header_header_header'_'primary_primary_primary'_'leading_footer_trailing']
    shadow-short                                                      */

/* --- Shared (mode-independent) ------------------------------------ */

    background-clip: padding-box;                   /* .bg-clip-padding */
    border-radius: 28px;                            /* all corners, via element.style */
    border-width: 0px;                              /* all sides — NOT rendered */
    border-style: solid;
    box-sizing: border-box;
    padding: 10px;                                  /* p-2.5 */
    cursor: text;
    overflow: clip;
    contain: inline-size;
    display: grid;
    grid-template-columns: auto 1fr auto;
    transition-property: color, background-color, border-color,
        outline-color, -webkit-text-decoration-color,
        text-decoration-color, fill, stroke,
        --tw-gradient-from, --tw-gradient-via, --tw-gradient-to;
    transition-duration: 0.2s;                      /* motion-safe:duration-200 */
    transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);

/* --- Light mode --------------------------------------------------- */

    background-color: var(--bg-primary);             /* #fff */
    border-color: rgba(13, 13, 13, 0.05);           /* set for transitions */
    box-shadow:                                      /* .shadow-short light */
        0px 4px 4px 0px rgba(0,0,0,0.04),           /* soft ambient */
        0px 0px 1px 0px rgba(0,0,0,0.62);           /* tight outline ring */

/* --- Dark mode ---------------------------------------------------- */

    background-color: #303030;                       /* hardcoded dark:bg-[#303030] */
    border-color: rgba(255, 255, 255, 0.05);         /* inverted from light */
    box-shadow:                                      /* .shadow-short dark */
        0px 4px 12px 0px rgba(0,0,0,0.1),           /* larger/softer ambient (12px blur) */
        inset 0px 0px 1px 0px rgba(255,255,255,0.2); /* inner glow replaces outline */

/* --- Textarea (#prompt-textarea) ---------------------------------- */

    font-family: ui-sans-serif, -apple-system, "system-ui", "Segoe UI",
                 Helvetica, "Apple Color Emoji", Arial, "sans-serif",
                 "Segoe UI Emoji", "Segoe UI Symbol";
    font-size: 16px;
    line-height: 24px;
    font-weight: 400;
    letter-spacing: normal;
    color: var(--text-primary);                      /* light: #0d0d0d | dark: #fff */
    background-color: transparent;
    padding: 0px 0px 16px;

/* --- Key takeaways ------------------------------------------------ */
/* 1. Border-width is 0 in both modes — edge definition is 100% shadow
   2. Border-color IS set (for transition-colors animation smoothness)
   3. Light border-color: rgba(13,13,13,0.05) = #0d0d0d at 5%
   4. Dark border-color: rgba(255,255,255,0.05) = white at 5%
   5. border-radius: 28px on all corners (via element.style)
   6. padding: 10px uniform
   7. background-clip: padding-box prevents bg bleeding past border area
   8. Uses CSS superellipse rounding via corner-superellipse/1.1
   9. Grid layout: 3 columns (auto/1fr/auto) with named grid areas
  10. Light shadow: two outer layers (ambient 4px + outline 1px)
  11. Dark shadow: outer ambient (12px blur) + inner glow (1px inset)
  12. Transition duration is 200ms (not the default 150ms) */
```
