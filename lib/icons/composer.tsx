import { createIcon } from "./create-icon"

const COMPOSER_PAPERCLIP_PATH =
  "M7.668 12.834V5.5c0-2.253 1.746-3.998 3.999-3.998 2.274 0 4.032 1.765 4.032 4.037v7.283c0 3.227-2.482 5.677-5.7 5.677-3.209 0-5.664-2.457-5.664-5.665V7.167a.665.665 0 0 1 1.33 0v5.667c0 2.474 1.86 4.335 4.334 4.335 2.492 0 4.37-1.863 4.37-4.347V5.54c0-1.54-1.164-2.707-2.702-2.707-1.518 0-2.669 1.15-2.669 2.668v7.334c0 .58.423 1.001 1.002 1.001.58 0 1.002-.42 1.002-1.001V7.167a.665.665 0 1 1 1.33 0v5.667A2.3 2.3 0 0 1 10 15.165a2.3 2.3 0 0 1-2.332-2.331"

const WEB_SEARCH_GLOBE_PATH =
  "M12 2c5.522 0 10 4.478 10 10s-4.478 10-10 10S2 17.522 2 12 6.478 2 12 2M9.172 13c.146 4.477 1.284 7 2.828 7s2.682-2.523 2.828-7zm-5.108 0a8 8 0 0 0 4.313 6.134C7.686 17.622 7.261 15.549 7.174 13zm12.762 0c-.087 2.55-.512 4.622-1.204 6.134A8 8 0 0 0 19.936 13zm-8.45-8.135A8 8 0 0 0 4.065 11h3.11c.087-2.55.511-4.623 1.203-6.135M12.001 4c-1.544 0-2.682 2.523-2.828 7h5.656C14.682 6.523 13.544 4 12 4m3.623.865C16.314 6.377 16.74 8.45 16.826 11h3.11a8 8 0 0 0-4.314-6.135"

const ComposerPaperclipIcon = createIcon(
  <path fill="currentColor" d={COMPOSER_PAPERCLIP_PATH} />,
  {
    defaultSize: 20,
    displayName: "ComposerPaperclipIcon",
    viewBox: "0 0 20 20",
  }
)

const ComposerWebSearchIcon = createIcon(
  <g>
    <circle cx="12" cy="12" r="9" fill="var(--web-search-icon-surface)" />
    <path
      fill="var(--web-search-icon-foreground)"
      fillRule="evenodd"
      d={WEB_SEARCH_GLOBE_PATH}
      clipRule="evenodd"
    />
  </g>,
  {
    defaultSize: 24,
    displayName: "ComposerWebSearchIcon",
    viewBox: "0 0 24 24",
  }
)

const ComposerExpandIcon = createIcon(
  <path
    fill="currentColor"
    d="M4.335 11a.665.665 0 0 1 1.33 0v3.335H9l.134.014a.665.665 0 0 1 0 1.302L9 15.665H5A.665.665 0 0 1 4.335 15zm10-2V5.665H11a.665.665 0 0 1 0-1.33h4l.134.014c.303.062.531.33.531.651v4a.665.665 0 1 1-1.33 0"
  />,
  {
    defaultSize: 20,
    displayName: "ComposerExpandIcon",
    viewBox: "0 0 20 20",
  }
)

const ComposerCollapseIcon = createIcon(
  <path
    fill="currentColor"
    d="M7.335 16v-3.335H4a.665.665 0 1 1 0-1.33h4c.367 0 .665.298.665.665v4a.665.665 0 0 1-1.33 0m4-12a.665.665 0 1 1 1.33 0v3.335H16l.134.014a.665.665 0 0 1 0 1.302L16 8.665h-4A.665.665 0 0 1 11.335 8z"
  />,
  {
    defaultSize: 20,
    displayName: "ComposerCollapseIcon",
    viewBox: "0 0 20 20",
  }
)

export {
  COMPOSER_PAPERCLIP_PATH,
  ComposerCollapseIcon,
  ComposerExpandIcon,
  ComposerPaperclipIcon,
  ComposerWebSearchIcon,
  WEB_SEARCH_GLOBE_PATH,
}
