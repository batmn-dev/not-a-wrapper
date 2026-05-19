# ChatGPT Sidebar - Styles Reference

Extracted CSS custom properties and computed styles from the ChatGPT sidebar element.

> **Agent entrypoint:** load `../chatgpt-css.md` first for compact light/dark tokens, then use this file for detailed sidebar selectors, item states, and collapsed/expanded behavior. The raw exhaustive CSS archive is lookup-only.

> **Scope guidance:**
> - Include selectors related to sidebar structure, states, and interactions.
> - Prefer preserving custom properties (`--sidebar-*`, `--bg-*`, token vars).
> - Keep both expanded and collapsed state rules when available.
>
> **Fidelity note:**
> - This is a readability-first CSS reference, not a full production stylesheet.
> - Keep meaningful selectors and variables; omit unrelated global resets/noise.
>
> **Quick navigation:**
> - Sidebar-relevant sections are marked with `★` in the comment headers.

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
   TAILWIND TYPE SCALE
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

/* --- Font Weights ------------------------------------------------- */

    --font-weight-extralight: 200;
    --font-weight-light: 300;
    --font-weight-normal: 400;
    --font-weight-medium: 500;
    --font-weight-semibold: 600;
    --font-weight-bold: 700;
    --font-weight-black: 900;

/* --- Letter Spacing ----------------------------------------------- */

    --tracking-tighter: -.05em;
    --tracking-tight: -.025em;
    --tracking-normal: 0em;
    --tracking-wide: .025em;
    --tracking-wider: .05em;
    --tracking-widest: .1em;

/* --- Line Height -------------------------------------------------- */

    --leading-tight: 1.25;
    --leading-snug: 1.375;
    --leading-normal: 1.5;
    --leading-relaxed: 1.625;

/* ===================================================================
   ★ SEMANTIC TYPOGRAPHY TOKENS
   Used for sidebar section headers, body text, captions.
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

    /* Body — sidebar chat item text likely uses this */
    --text-body-regular: 1rem;
    --text-body-regular--line-height: 1.625rem;
    --text-body-regular--letter-spacing: -.025rem;
    --text-body-regular--font-weight: 400;

    /* Body Small — sidebar item labels */
    --text-body-small-regular: .875rem;
    --text-body-small-regular--line-height: 1.125rem;
    --text-body-small-regular--letter-spacing: -.01875rem;
    --text-body-small-regular--font-weight: 400;

    /* Footnote Regular */
    --text-footnote-regular: .8125rem;
    --text-footnote-regular--line-height: 1.125rem;
    --text-footnote-regular--letter-spacing: -.005rem;
    --text-footnote-regular--font-weight: 400;

    /* ★ Footnote Medium — likely sidebar section header typography */
    --text-footnote-medium: .8125rem;
    --text-footnote-medium--line-height: 1.25rem;
    --text-footnote-medium--letter-spacing: -.005rem;
    --text-footnote-medium--font-weight: 500;

    --text-monospace: .9375rem;
    --text-monospace--line-height: 1.375rem;
    --text-monospace--letter-spacing: -.025rem;
    --text-monospace--font-weight: 400;

    /* Caption — user plan tier label ("Plus") */
    --text-caption-regular: .75rem;
    --text-caption-regular--line-height: 1rem;
    --text-caption-regular--letter-spacing: -.00625rem;
    --text-caption-regular--font-weight: 400;

/* ===================================================================
   BORDER RADIUS
   =================================================================== */

    --radius-xs: .125rem;
    --radius-sm: .25rem;
    --radius-md: .375rem;
    --radius-lg: .5rem;
    --radius-xl: .75rem;
    --radius-2xl: 1rem;
    --radius-3xl: 1.5rem;
    --radius-4xl: 2rem;

/* ===================================================================
   SHADOWS & EFFECTS
   =================================================================== */

    --shadow-lg: 0 10px 15px -3px #0000001a,0 4px 6px -4px #0000001a;
    --drop-shadow-xs: 0 1px 1px #0000000d;
    --drop-shadow-sm: 0 1px 2px #00000026;
    --drop-shadow-md: 0 3px 3px #0000001f;
    --drop-shadow-lg: 0 4px 4px #00000026;
    --drop-shadow-xl: 0 9px 7px #0000001a;
    --drop-shadow-2xl: 0 25px 25px #00000026;
    --blur-xs: 4px;
    --blur-sm: 8px;
    --blur-md: 12px;
    --blur-lg: 16px;
    --blur-xl: 24px;
    --blur-2xl: 40px;
    --blur-3xl: 64px;

/* ===================================================================
   ★ EASING & ANIMATION
   Standard easing curves and the default transition baseline.
   =================================================================== */

    --ease-in: cubic-bezier(.4,0,1,1);
    --ease-out: cubic-bezier(0,0,.2,1);
    --ease-in-out: cubic-bezier(.4,0,.2,1);
    --animate-spin: spin 1s linear infinite;
    --animate-pulse: pulse 2s cubic-bezier(.4,0,.6,1)infinite;
    --animate-bounce: bounce 1s infinite;

    /* ★ Default transition — used for non-animated property changes */
    --default-transition-duration: .15s;
    --default-transition-timing-function: cubic-bezier(.4,0,.2,1);

/* ===================================================================
   DEFAULT FONTS
   =================================================================== */

    --aspect-video: 16/9;
    --default-font-family: "ui-sans-serif","-apple-system","system-ui","Segoe UI","Helvetica","Apple Color Emoji","Arial","sans-serif","Segoe UI Emoji","Segoe UI Symbol";
    --default-mono-font-family: "ui-monospace","SFMono-Regular","SF Mono","Menlo","Consolas","Liberation Mono","monospace";

/* ===================================================================
   INTERACTIVE STATE ALIASES
   Maps state×tier to resolved primitives (see resolved values below).
   =================================================================== */

/* --- Background --------------------------------------------------- */

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

/* --- Border ------------------------------------------------------- */

    --interactive-border-default-secondary: var(--interactive-border-secondary-default);
    --interactive-border-hover-secondary: var(--interactive-border-secondary-hover);
    --interactive-border-press-secondary: var(--interactive-border-secondary-press);
    --interactive-border-inactive-secondary: var(--interactive-border-secondary-inactive);
    --interactive-border-selected-secondary: var(--interactive-border-secondary-default);

/* --- Label -------------------------------------------------------- */

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

/* --- Icon --------------------------------------------------------- */

    --interactive-icon-default-accent: var(--interactive-icon-accent-default);
    --interactive-icon-hover-accent: var(--interactive-icon-accent-hover);
    --interactive-icon-press-accent: var(--interactive-icon-accent-press);
    --interactive-icon-inactive-accent: var(--interactive-icon-accent-inactive);
    --interactive-icon-selected-accent: var(--interactive-icon-accent-selected);

/* ===================================================================
   ★ TOUCH & FOCUS TARGETS
   =================================================================== */

    --tap-padding-pointer: 32px;
    --tap-padding-mobile: 44px;
    --focus-outline-margin-default: 4px;

/* ===================================================================
   COLOR PALETTES
   Full ramps with alpha variants. Not sidebar-specific but available.
   =================================================================== */

/* --- Green -------------------------------------------------------- */

    --green-25: #edfaf2;
    --green-50: #d9f4e4;
    --green-75: #b8ebcc;
    --green-100: #8cdfad;
    --green-200: #66d492;
    --green-300: #40c977;
    --green-400: #04b84c;
    --green-500: #00a240;
    --green-600: #008635;
    --green-700: #00692a;
    --green-800: #004f1f;
    --green-900: #003716;
    --green-950: #011c0b;
    --green-1000: #001207;
    --green-a25: #04b84c14;
    --green-a50: #04b84c26;
    --green-a75: #04b84c4a;
    --green-a100: #04b84c73;
    --green-a200: #04b84c99;
    --green-a300: #04b84cbf;

/* --- Purple ------------------------------------------------------- */

    --purple-25: #f9f5fe;
    --purple-50: #efe5fe;
    --purple-75: #e0cefd;
    --purple-100: #ceb0fb;
    --purple-200: #be95fa;
    --purple-300: #ad7bf9;
    --purple-400: #924ff7;
    --purple-500: #8046d9;
    --purple-600: #6b3ab4;
    --purple-700: #532d8d;
    --purple-800: #3f226a;
    --purple-900: #2c184a;
    --purple-950: #160c25;
    --purple-1000: #100a19;
    --purple-a25: #924ff70f;
    --purple-a50: #924ff726;
    --purple-a75: #924ff747;
    --purple-a100: #924ff773;
    --purple-a200: #924ff799;
    --purple-a300: #924ff7bf;

/* --- Blue --------------------------------------------------------- */

    --blue-25: #f5faff;
    --blue-50: #e5f3ff;
    --blue-75: #cce6ff;
    --blue-100: #99ceff;
    --blue-200: #66b5ff;
    --blue-300: #339cff;
    --blue-400: #0285ff;
    --blue-500: #0169cc;
    --blue-600: #004f99;
    --blue-700: #003f7a;
    --blue-800: #013566;
    --blue-900: #00284d;
    --blue-950: #000e1a;
    --blue-1000: #000d19;
    --blue-a25: #0285ff0a;
    --blue-a50: #0285ff21;
    --blue-a75: #0285ff40;
    --blue-a100: #0285ff66;
    --blue-a200: #0285ff99;
    --blue-a300: #0285ffcc;

/* --- Orange ------------------------------------------------------- */

    --orange-25: #fff5f0;
    --orange-50: #ffe7d9;
    --orange-75: #ffcfb4;
    --orange-100: #ffb790;
    --orange-200: #ff9e6c;
    --orange-300: #ff8549;
    --orange-400: #fb6a22;
    --orange-500: #e25507;
    --orange-600: #b9480d;
    --orange-700: #923b0f;
    --orange-800: #6d2e0f;
    --orange-900: #4a2206;
    --orange-950: #281105;
    --orange-1000: #211107;
    --orange-a25: #fb6a2212;
    --orange-a50: #fb6a2229;
    --orange-a75: #fb6a2254;
    --orange-a100: #fb6a227a;
    --orange-a200: #fb6a22a6;
    --orange-a300: #fb6a22cf;

/* --- Red ---------------------------------------------------------- */

    --red-25: #fff0f0;
    --red-50: #ffe1e0;
    --red-75: #ffc6c5;
    --red-100: #ffa4a2;
    --red-200: #ff8583;
    --red-300: #ff6764;
    --red-400: #fa423e;
    --red-500: #e02e2a;
    --red-600: #ba2623;
    --red-700: #911e1b;
    --red-800: #6e1615;
    --red-900: #4d100e;
    --red-950: #280b0a;
    --red-1000: #1f0909;
    --red-a25: #fa423e14;
    --red-a50: #fa423e29;
    --red-a75: #fa423e4c;
    --red-a100: #fa423e7a;
    --red-a200: #fa423ea3;
    --red-a300: #fa423ec9;

/* --- Pink --------------------------------------------------------- */

    --pink-25: #fff4f9;
    --pink-50: #ffe8f3;
    --pink-75: #ffd4e8;
    --pink-100: #ffbada;
    --pink-200: #ffa3ce;
    --pink-300: #ff8cc1;
    --pink-400: #ff66ad;
    --pink-500: #e04c91;
    --pink-600: #ba437a;
    --pink-700: #963c67;
    --pink-800: #6e2c4a;
    --pink-900: #4d1f34;
    --pink-950: #29101c;
    --pink-1000: #1a0a11;
    --pink-a25: #ff66ad14;
    --pink-a50: #ff66ad29;
    --pink-a75: #ff66ad47;
    --pink-a100: #ff66ad73;
    --pink-a200: #ff66ad99;
    --pink-a300: #ff66adc2;

/* --- Yellow ------------------------------------------------------- */

    --yellow-25: #fffbed;
    --yellow-50: #fff6d9;
    --yellow-75: #ffeeb8;
    --yellow-100: #ffe48c;
    --yellow-200: #ffdb66;
    --yellow-300: #ffd240;
    --yellow-400: #ffc300;
    --yellow-500: #e0ac00;
    --yellow-600: #ba8e00;
    --yellow-700: #916f00;
    --yellow-800: #6e5400;
    --yellow-900: #4d3b00;
    --yellow-950: #261d00;
    --yellow-1000: #1a1400;
    --yellow-a25: #ffc30014;
    --yellow-a50: #ffc30026;
    --yellow-a75: #ffc30045;
    --yellow-a100: #ffc30073;
    --yellow-a200: #ffc30096;
    --yellow-a300: #ffc300bd;

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

/* ===================================================================
   COMPOSER & CHAT TOKENS
   Not sidebar-specific. Included for completeness.
   =================================================================== */

    --composer-surface: var(--message-surface);
    --composer-blue-hover-tint: #0084ff24;
    --tag-blue: #08f;
    --tag-blue-light: #0af;
    --text-danger: var(--red-500);
    --hint-text: #08f;
    --hint-bg: #b3dbff;
    --selection: #007aff;
    --mkt-header-height: calc(16*var(--spacing));

/* ===================================================================
   CHAT THEME TOKENS
   Per-theme color overrides for user messages, buttons, accents.
   Not sidebar-specific. Included for completeness.
   =================================================================== */

    --default-theme-user-msg-bg: var(--message-surface);
    --default-theme-submit-btn-bg: #fff;
    --default-theme-submit-btn-text: #000;
    --default-theme-user-msg-text: var(--text-primary);
    --default-theme-secondary-btn-bg: var(--gray-700);
    --default-theme-secondary-btn-text: #fff;
    --default-theme-user-selection-bg: color-mix(in oklab,var(--blue-200)40%,transparent);
    --default-theme-attribution-highlight-bg: var(--yellow-800);
    --default-theme-entity-accent: var(--blue-300);
    --formatted-text-highlight-bg: #0ea5e94d;

    --blue-theme-submit-btn-text: #fff;
    --blue-theme-entity-accent: var(--blue-500);
    --blue-theme-user-msg-bg: var(--blue-700);
    --blue-theme-user-msg-text: var(--blue-25);
    --blue-theme-submit-btn-bg: var(--blue-500);
    --blue-theme-secondary-btn-bg: var(--blue-600);
    --blue-theme-secondary-btn-text: var(--blue-25);
    --blue-theme-user-selection-bg: color-mix(in oklab,var(--blue-400)60%,transparent);

    --green-theme-submit-btn-text: #fff;
    --green-theme-user-msg-bg: var(--green-700);
    --green-theme-user-msg-text: var(--green-25);
    --green-theme-submit-btn-bg: var(--green-500);
    --green-theme-secondary-btn-bg: var(--green-600);
    --green-theme-secondary-btn-text: var(--green-25);
    --green-theme-user-selection-bg: color-mix(in oklab,var(--green-400)60%,transparent);
    --green-theme-entity-accent: var(--green-300);

    --yellow-theme-submit-btn-text: #fff;
    --yellow-theme-user-msg-bg: var(--yellow-700);
    --yellow-theme-user-msg-text: var(--yellow-25);
    --yellow-theme-submit-btn-bg: var(--yellow-500);
    --yellow-theme-secondary-btn-bg: var(--yellow-600);
    --yellow-theme-secondary-btn-text: var(--yellow-25);
    --yellow-theme-user-selection-bg: color-mix(in oklab,var(--yellow-400)50%,transparent);
    --yellow-theme-entity-accent: var(--yellow-300);

    --purple-theme-submit-btn-text: #fff;
    --purple-theme-user-msg-bg: var(--purple-700);
    --purple-theme-user-msg-text: var(--purple-25);
    --purple-theme-submit-btn-bg: var(--purple-500);
    --purple-theme-secondary-btn-bg: var(--purple-600);
    --purple-theme-secondary-btn-text: var(--purple-25);
    --purple-theme-user-selection-bg: color-mix(in oklab,var(--purple-400)60%,transparent);
    --purple-theme-entity-accent: var(--purple-300);

    --pink-theme-submit-btn-text: #fff;
    --pink-theme-user-msg-bg: var(--pink-700);
    --pink-theme-user-msg-text: var(--pink-25);
    --pink-theme-submit-btn-bg: var(--pink-500);
    --pink-theme-secondary-btn-bg: var(--pink-600);
    --pink-theme-secondary-btn-text: var(--pink-25);
    --pink-theme-user-selection-bg: color-mix(in oklab,var(--pink-400)60%,transparent);
    --pink-theme-entity-accent: var(--pink-300);

    --orange-theme-submit-btn-text: #fff;
    --orange-theme-user-msg-bg: var(--orange-700);
    --orange-theme-user-msg-text: var(--orange-25);
    --orange-theme-submit-btn-bg: var(--orange-500);
    --orange-theme-secondary-btn-bg: var(--orange-600);
    --orange-theme-secondary-btn-text: var(--orange-25);
    --orange-theme-user-selection-bg: color-mix(in oklab,var(--orange-400)60%,transparent);
    --orange-theme-entity-accent: var(--orange-300);

    --black-theme-user-msg-bg: var(--gray-100);
    --black-theme-user-msg-text: #000;
    --black-theme-submit-btn-bg: #fff;
    --black-theme-submit-btn-text: #000;
    --black-theme-secondary-btn-bg: var(--gray-700);
    --black-theme-secondary-btn-text: #fff;
    --black-theme-user-selection-bg: color-mix(in oklab,var(--gray-600)40%,transparent);
    --black-theme-entity-accent: var(--gray-300);

    /* Active theme (defaults) */
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
   LAYOUT DIRECTION (LTR / RTL)
   =================================================================== */

    --start: left;
    --end: right;
    --to-end-unit: 1;
    --is-ltr: unset;
    --is-rtl: ;
    --safe-area-max-inset-bottom: env(safe-area-max-inset-bottom,36px);
    --user-chat-width: 70%;

/* ===================================================================
   ★ SIDEBAR LAYOUT DIMENSIONS
   Core geometry for expanded/collapsed states.
   =================================================================== */

    --sidebar-width: 260px;                                /* expanded width */
    --sidebar-rail-width: calc(13*var(--spacing));         /* collapsed width → 3.25rem / 52px */
    --header-height: calc(13*var(--spacing));              /* header row height → 3.25rem / 52px */
    --sidebar-section-margin-top: 1.25rem;                /* 20px */
    --sidebar-section-first-margin-top: .5rem;            /* 8px */
    --sidebar-expanded-section-margin-bottom: 1.25rem;    /* 20px — expanded sections */
    --sidebar-collapsed-section-margin-bottom: .75rem;    /* 12px — collapsed sections */

/* ===================================================================
   ★ GRAY SCALE & BRAND
   Sidebar surfaces reference these heavily.
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
    --gray-250: #d8d8d8;
    --gray-300: #cdcdcd;
    --gray-350: silver;
    --gray-400: #b4b4b4;
    --gray-450: #a8a8a8;
    --gray-500: #9b9b9b;
    --gray-550: #818181;
    --gray-600: #676767;
    --gray-650: #545454;
    --gray-700: #424242;
    --gray-750: #2f2f2f;
    --gray-800: #212121;             /* = --bg-primary (collapsed sidebar bg) */
    --gray-850: #1c1c1c;
    --gray-900: #171717;             /* = --sidebar-surface-primary */
    --gray-925: #121212;
    --gray-950: #0d0d0d;
    --gray-975: #0c0c0c;
    --gray-1000: #0b0b0b;
    --brand-purple: #ab68ff;
    -webkit-font-smoothing: antialiased;

/* ===================================================================
   ★ SIDEBAR SURFACE & COLOR TOKENS (Dark Mode)
   =================================================================== */

    --main-surface-background: #212121e6;
    --message-surface: #323232d9;
    --composer-blue-bg: #2a4a6d;
    --composer-blue-hover: #1a416a;
    --composer-blue-text: #48aaff;
    --composer-surface-primary: #303030;
    --dot-color: var(--white);
    --icon-surface: 240 240 240;
    --text-primary-inverse: var(--gray-950);
    --text-quaternary: #ffffff69;
    --text-placeholder: #fffc;
    --content-primary: #f2f6fa;
    --content-secondary: #dbe2e8;
    --text-error: #f93a37;
    --border-xlight: #ffffff0d;
    --border-medium: #ffffff26;
    --border-xheavy: #ffffff40;
    --border-sharp: #ffffff0d;

    /* Main app surfaces */
    --main-surface-primary: var(--gray-800);              /* #212121 */
    --main-surface-primary-inverse: var(--white);
    --main-surface-secondary: var(--gray-750);            /* #2f2f2f */
    --main-surface-secondary-selected: #ffffff26;
    --main-surface-tertiary: var(--gray-700);             /* #424242 */

    /* ★ Sidebar surfaces */
    --sidebar-surface-primary: var(--gray-900);           /* #171717 */
    --sidebar-surface-secondary: var(--gray-800);         /* #212121 */
    --sidebar-surface-tertiary: var(--gray-750);          /* #2f2f2f */
    --sidebar-title-primary: #f0f0f080;                   /* ★ 50% opacity white — section headers */
    --sidebar-surface: #2b2b2b;
    --sidebar-body-primary: #ededed;                      /* ★ chat item text */
    --sidebar-icon: #a4a4a4;                              /* ★ icon default color */

    /* ★ Hover / interaction */
    --surface-hover: #ffffff26;                           /* 15% white overlay */
    --link: #7ab7ff;
    --link-hover: #5e83b3;
    --surface-error: 249 58 55;

    /* ★ Scrollbar */
    --scrollbar-color: #ffffff1a;
    --scrollbar-color-hover: #fff3;

    /* Sidebar floating/pinned surfaces */
    --sidebar-surface-floating-lightness: .3;
    --sidebar-surface-floating-alpha: 1;
    --sidebar-surface-pinned-lightness: .29;
    --sidebar-surface-pinned-alpha: 1;

/* ===================================================================
   CONTAINER QUERY / VIEWPORT
   =================================================================== */

    --cqh-full: 100cqh;
    --cqw-full: 100cqw;
    --silk-100-lvh-dvh-pct: max(100dvh,100lvh);

/* ===================================================================
   ★ MENU GEOMETRY
   =================================================================== */

    --menu-item-height: calc(var(--spacing)*9);           /* 2.25rem / 36px — chat row height */

/* ===================================================================
   ★ SPRING ANIMATION SYSTEM
   CSS spring physics via linear() easing functions.
   Used for sidebar width transitions and UI interactions.
   =================================================================== */

    /* Fast spring — quick, no overshoot */
    --spring-fast-duration: .667s;
    --spring-fast: linear(0,.01942 1.83%,.07956 4.02%,.47488 13.851%,.65981 19.572%,.79653 25.733%,.84834 29.083%,.89048 32.693%,.9246 36.734%,.95081 41.254%,.97012 46.425%,.98361 52.535%,.99665 68.277%,.99988);

    /* Common/standard spring — general-purpose */
    --spring-common-duration: .667s;
    --spring-common: linear(0,.00506 1.18%,.02044 2.46%,.08322 5.391%,.46561 17.652%,.63901 24.342%,.76663 31.093%,.85981 38.454%,.89862 42.934%,.92965 47.845%,.95366 53.305%,.97154 59.516%,.99189 74.867%,.9991);
    --spring-standard: var(--spring-common);

    /* Slow bounce — visible overshoot, long settle */
    --spring-slow-bounce-duration: 1.167s;
    --spring-slow-bounce: linear(0,.00172 0.51%,.00682 1.03%,.02721 2.12%,.06135 3.29%,.11043 4.58%,.21945 6.911%,.59552 14.171%,.70414 16.612%,.79359 18.962%,.86872 21.362%,.92924 23.822%,.97589 26.373%,1.01 29.083%,1.0264 31.043%,1.03767 33.133%,1.04411 35.404%,1.04597 37.944%,1.04058 42.454%,1.01119 55.646%,1.00137 63.716%,.99791 74.127%,.99988);

    /* Bounce — moderate overshoot */
    --spring-bounce-duration: .833s;
    --spring-bounce: linear(0,.00541 1.29%,.02175 2.68%,.04923 4.19%,.08852 5.861%,.17388 8.851%,.48317 18.732%,.57693 22.162%,.65685 25.503%,.72432 28.793%,.78235 32.163%,.83182 35.664%,.87356 39.354%,.91132 43.714%,.94105 48.455%,.96361 53.705%,.97991 59.676%,.9903 66.247%,.99664 74.237%,.99968 84.358%,1.00048);

    /* Fast bounce */
    --spring-fast-bounce-duration: 1s;
    --spring-fast-bounce: linear(0,.00683 1.14%,.02731 2.35%,.11137 5.091%,.59413 15.612%,.78996 20.792%,.92396 25.953%,.97109 28.653%,1.00624 31.503%,1.03801 36.154%,1.0477 41.684%,1.00242 68.787%,.99921);

    /* Elegant spring — refined, 100+ stops, minimal overshoot */
    --easing-spring-elegant-duration: .58171s;
    --easing-spring-elegant: linear(0 0%,.005927 1%,.022466 2%,.047872 3%,.080554 4%,.119068 5%,.162116 6%,.208536 7.0%,.2573 8%,.3075 9%,.358346 10%,.409157 11%,.45935 12%,.508438 13%,.556014 14.0%,.601751 15%,.645389 16%,.686733 17%,.72564 18%,.762019 19%,.795818 20%,.827026 21%,.855662 22%,.881772 23%,.905423 24%,.926704 25%,.945714 26%,.962568 27%,.977386 28.0%,.990295 29.0%,1.00143 30%,1.01091 31%,1.01888 32%,1.02547 33%,1.03079 34%,1.03498 35%,1.03816 36%,1.04042 37%,1.04189 38%,1.04266 39%,1.04283 40%,1.04247 41%,1.04168 42%,1.04052 43%,1.03907 44%,1.03737 45%,1.03549 46%,1.03348 47%,1.03138 48%,1.02922 49%,1.02704 50%,1.02486 51%,1.02272 52%,1.02063 53%,1.01861 54%,1.01667 55.0%,1.01482 56.0%,1.01307 57.0%,1.01142 58.0%,1.00989 59%,1.00846 60%,1.00715 61%,1.00594 62%,1.00485 63%,1.00386 64%,1.00296 65%,1.00217 66%,1.00147 67%,1.00085 68%,1.00031 69%,.999849 70%,.999457 71%,.999128 72%,.998858 73%,.99864 74%,.99847 75%,.998342 76%,.998253 77%,.998196 78%,.998169 79%,.998167 80%,.998186 81%,.998224 82%,.998276 83%,.998341 84%,.998415 85%,.998497 86%,.998584 87%,.998675 88%,.998768 89%,.998861 90%,.998954 91%,.999045 92%,.999134 93%,.99922 94%,.999303 95%,.999381 96%,.999455 97%,.999525 98%,.999589 99%,.99965 100%);

    /* Common easing — extremely granular (100+ stops), no overshoot */
    --easing-common: linear(0,0,.0001,.0002,.0003,.0005,.0007,.001,.0013,.0016,.002,.0024,.0029,.0033,.0039,.0044,.005,.0057,.0063,.007,.0079,.0086,.0094,.0103,.0112,.0121,.0132 1.84%,.0153,.0175,.0201,.0226,.0253,.0283,.0313,.0345,.038,.0416,.0454,.0493,.0535,.0576,.0621,.0667,.0714,.0764,.0816 5.04%,.0897,.098 5.62%,.1071,.1165,.1263 6.56%,.137,.1481 7.25%,.1601 7.62%,.1706 7.94%,.1819 8.28%,.194,.2068 9.02%,.2331 9.79%,.2898 11.44%,.3151 12.18%,.3412 12.95%,.3533,.365 13.66%,.3786,.3918,.4045,.4167,.4288,.4405,.452,.4631 16.72%,.4759,.4884,.5005,.5124,.5242,.5354,.5467,.5576,.5686,.5791,.5894,.5995,.6094,.6194,.6289,.6385,.6477,.6569,.6659 24.45%,.6702,.6747,.6789,.6833,.6877,.6919,.696,.7002,.7043,.7084,.7125,.7165,.7205,.7244,.7283,.7321,.7358,.7396,.7433,.7471,.7507,.7544,.7579,.7615,.7649,.7685,.7718,.7752,.7786,.782,.7853,.7885,.7918,.7951,.7982,.8013,.8043,.8075,.8104,.8135,.8165,.8195,.8224,.8253,.8281,.8309,.8336,.8365,.8391,.8419,.8446,.8472,.8499,.8524,.855,.8575,.8599,.8625 37.27%,.8651,.8678,.8703,.8729,.8754,.8779,.8803,.8827,.8851,.8875,.8898,.892,.8942,.8965,.8987,.9009,.903,.9051,.9071,.9092,.9112,.9132,.9151,.9171,.919,.9209,.9227,.9245,.9262,.928,.9297,.9314,.9331,.9347,.9364,.9379,.9395,.941,.9425,.944,.9454,.9469,.9483,.9497,.951,.9524,.9537,.955,.9562,.9574,.9586,.9599,.961,.9622,.9633,.9644,.9655,.9665,.9676,.9686,.9696,.9705,.9715,.9724,.9733,.9742,.975,.9758,.9766,.9774,.9782,.9789,.9796,.9804,.9811,.9817,.9824,.9831,.9837,.9843,.9849,.9855,.986,.9866,.9871,.9877,.9882,.9887,.9892,.9896 70.56%,.9905 71.67%,.9914 72.82%,.9922,.9929 75.2%,.9936 76.43%,.9942 77.71%,.9948 79.03%,.9954 80.39%,.9959 81.81%,.9963 83.28%,.9968 84.82%,.9972 86.41%,.9975 88.07%,.9979 89.81%,.9982 91.64%,.9984 93.56%,.9987 95.58%,.9989 97.72%,.9991);

/* ===================================================================
   ★ BACKGROUND TOKENS (Dark Mode)
   =================================================================== */

    --bg-primary: #212121;                                /* collapsed sidebar bg */
    --bg-primary-inverted: #fff;
    --bg-secondary: #303030;
    --bg-tertiary: #414141;
    --bg-scrim: #0d0d0d80;
    --bg-elevated-primary: #303030;
    --bg-elevated-secondary: #181818;                     /* ★ expanded sidebar bg */
    --bg-accent-static: var(--blue-400);
    --bg-status-warning: var(--orange-900);
    --bg-status-error: var(--red-900);

/* ===================================================================
   ★ BORDER TOKENS
   =================================================================== */

    --border-default: #ffffff26;
    --border-heavy: #fff3;
    --border-light: #ffffff0d;                            /* ★ sidebar right border */
    --border-status-warning: var(--orange-900);
    --border-status-error: var(--red-900);

/* ===================================================================
   ★ TEXT COLOR TOKENS (Dark Mode)
   =================================================================== */

    --text-primary: #fff;
    --text-secondary: #f3f3f3;
    --text-tertiary: #afafaf;                             /* ★ section header text, trailing icons */
    --text-inverted: #0d0d0d;
    --text-inverted-static: #fff;
    --text-accent: var(--blue-200);
    --text-status-warning: var(--orange-200);
    --text-status-error: var(--red-200);

/* ===================================================================
   ★ ICON COLOR TOKENS (Dark Mode)
   =================================================================== */

    --icon-primary: #e8e8e8;
    --icon-secondary: #cdcdcd;
    --icon-tertiary: #afafaf;                             /* ★ trailing icon, active indicator */
    --icon-inverted: #0d0d0d;
    --icon-inverted-static: #fff;
    --icon-accent: var(--blue-200);
    --icon-status-warning: var(--orange-200);
    --icon-status-error: var(--red-200);

/* ===================================================================
   ★ INTERACTIVE STATE PRIMITIVES (Resolved Values — Dark Mode)
   Sidebar items use the "secondary" tier.
   =================================================================== */

/* --- Background: Primary (buttons on dark bg → white) ------------- */

    --interactive-bg-primary-default: #fff;
    --interactive-bg-primary-hover: #fffc;
    --interactive-bg-primary-press: #ffffffe5;
    --interactive-bg-primary-inactive: #fff;
    --interactive-bg-primary-selected: #fff;

/* --- ★ Background: Secondary (sidebar items) ---------------------- */

    --interactive-bg-secondary-default: #fff0;            /* transparent */
    --interactive-bg-secondary-hover: #ffffff1a;          /* 10% white */
    --interactive-bg-secondary-press: #ffffff0d;          /* 5% white */
    --interactive-bg-secondary-inactive: #fff0;           /* transparent */
    --interactive-bg-secondary-selected: #ffffff1a;       /* 10% white (same as hover) */

/* --- Background: Tertiary ----------------------------------------- */

    --interactive-bg-tertiary-default: #212121;
    --interactive-bg-tertiary-hover: #181818;
    --interactive-bg-tertiary-press: #0d0d0d;
    --interactive-bg-tertiary-inactive: #212121;
    --interactive-bg-tertiary-selected: #212121;

/* --- Background: Accent ------------------------------------------- */

    --interactive-bg-accent-default: var(--blue-800);
    --interactive-bg-accent-hover: var(--blue-700);
    --interactive-bg-accent-muted-hover: #394a5b;
    --interactive-bg-accent-muted-context: #394a5b80;
    --interactive-bg-accent-press: var(--blue-600);
    --interactive-bg-accent-muted-press: #40484f;
    --interactive-bg-accent-inactive: var(--blue-800);

/* --- Background: Danger ------------------------------------------- */

    --interactive-bg-danger-primary-default: var(--red-500);
    --interactive-bg-danger-primary-hover: var(--red-400);
    --interactive-bg-danger-primary-press: var(--red-600);
    --interactive-bg-danger-primary-inactive: var(--red-500);
    --interactive-bg-danger-secondary-default: #fff0;
    --interactive-bg-danger-secondary-hover: #fff0;
    --interactive-bg-danger-secondary-press: #fff0;
    --interactive-bg-danger-secondary-inactive: #fff0;

/* --- Border: Focus + Secondary + Tertiary + Danger ---------------- */

    --interactive-border-focus: #fff;
    --interactive-border-secondary-default: #ffffff26;
    --interactive-border-secondary-hover: #ffffff26;
    --interactive-border-secondary-press: #fff3;
    --interactive-border-secondary-inactive: #ffffff1a;
    --interactive-border-tertiary-default: #ffffff1a;
    --interactive-border-tertiary-hover: #ffffff26;
    --interactive-border-tertiary-press: #ffffff1a;
    --interactive-border-tertiary-inactive: #ffffff1a;
    --interactive-border-danger-secondary-default: var(--red-400);
    --interactive-border-danger-secondary-hover: var(--red-300);
    --interactive-border-danger-secondary-press: var(--red-500);
    --interactive-border-danger-secondary-inactive: var(--red-400);

/* --- Label: All tiers --------------------------------------------- */

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
    --interactive-label-accent-default: var(--blue-100);
    --interactive-label-accent-hover: var(--blue-100);
    --interactive-label-accent-press: var(--blue-100);
    --interactive-label-accent-inactive: var(--blue-100);
    --interactive-label-accent-selected: var(--blue-100);
    --interactive-label-danger-primary-default: #fff;
    --interactive-label-danger-primary-hover: #fff;
    --interactive-label-danger-primary-press: #fff;
    --interactive-label-danger-primary-inactive: #fff;
    --interactive-label-danger-secondary-default: var(--red-400);
    --interactive-label-danger-secondary-hover: var(--red-300);
    --interactive-label-danger-secondary-press: var(--red-500);
    --interactive-label-danger-secondary-inactive: var(--red-400);

/* --- Icon: All tiers ---------------------------------------------- */

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
    --interactive-icon-accent-default: var(--blue-100);
    --interactive-icon-accent-hover: var(--blue-100);
    --interactive-icon-accent-press: var(--blue-100);
    --interactive-icon-accent-selected: var(--blue-100);
    --interactive-icon-accent-inactive: var(--blue-100);
    --interactive-icon-danger-primary-default: #fff;
    --interactive-icon-danger-primary-hover: #fff;
    --interactive-icon-danger-primary-press: #fff;
    --interactive-icon-danger-primary-inactive: #fff;
    --interactive-icon-danger-secondary-default: var(--red-400);
    --interactive-icon-danger-secondary-hover: var(--red-300);
    --interactive-icon-danger-secondary-press: var(--red-500);
    --interactive-icon-danger-secondary-inactive: var(--red-400);

/* ===================================================================
   ★ UTILITY & MISCELLANEOUS
   =================================================================== */

    --utility-scrollbar: #fff3;

    /* Scroll edge shadows (used by sticky header/footer in sidebar) */
    --sharp-edge-top-shadow: 0 1px 0 var(--border-sharp);
    --sharp-edge-top-shadow-placeholder: 0 1px 0 transparent;
    --sharp-edge-bottom-shadow: 0 -1px 0 var(--border-sharp);
    --sharp-edge-bottom-shadow-placeholder: 0 -1px 0 transparent;

    --swiper-theme-color: #007aff;
    color-scheme: dark;
    --cot-shimmer-duration: 1400ms;

/* ===================================================================
   ★ SIDEBAR ROOT — COMPUTED ELEMENT STYLES
   These are the actual styles on the #stage-slideover-sidebar element.
   =================================================================== */

    color: var(--text-primary);
    box-sizing: border-box;
    border: 0 solid;
    margin: 0;
    padding: 0;
    position: relative;
    z-index: 21;
    height: 100%;
    flex-shrink: 0;
    overflow: hidden;
    border-color: var(--border-light);
    border-right-style: var(--tw-border-style);
    border-right-width: 1px;
    width: var(--sidebar-width);                          /* toggles to --sidebar-rail-width when collapsed */
    background-color: var(--sidebar-bg, var(--bg-elevated-secondary)); /* toggles to --bg-primary when collapsed */
```
