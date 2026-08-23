import { createIcon } from "./create-icon"

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

export { ComposerCollapseIcon, ComposerExpandIcon }
