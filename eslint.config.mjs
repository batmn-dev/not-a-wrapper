import nextConfig from "eslint-config-next"

const eslintConfig = [
  ...nextConfig,
  {
    ignores: ["convex/_generated/**"],
  },
  {
    // Icon system enforcement: use Remix Icons React components for UI icons.
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "lucide-react",
              message: "Use @remixicon/react for UI icons.",
            },
            {
              name: "@phosphor-icons/react",
              message: "Use @remixicon/react for UI icons.",
            },
            {
              name: "remixicon-react",
              message: "Use the official @remixicon/react package instead.",
            },
            {
              name: "remixicon",
              message:
                "Use @remixicon/react components, not the CSS/webfont package.",
            },
          ],
          patterns: [
            {
              group: ["lucide-react/*"],
              message: "Use @remixicon/react for UI icons.",
            },
            {
              group: ["@phosphor-icons/react/*"],
              message: "Use @remixicon/react for UI icons.",
            },
          ],
        },
      ],
    },
  },
  {
    // Prefer `type` over `interface` for type definitions (R09).
    // Reasons: consistency across the codebase, better union/intersection composability,
    // and alignment with React 19 patterns (e.g. props as type aliases).
    // Existing violations should be fixed opportunistically during other work.
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
    },
  },
  {
    // Authenticated handler seam (ADR-0003): Convex handlers must go through the
    // builders in convex/lib/authedFunctions.ts (which inject ctx.user / ctx.chat
    // / ctx.identity) instead of calling ctx.auth.getUserIdentity() inline. This
    // keeps auth structural and un-bypassable. The auth helpers themselves live
    // in convex/lib/ and are exempt below.
    files: ["convex/**/*.ts"],
    ignores: ["convex/lib/**", "convex/**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name='getUserIdentity'][callee.object.property.name='auth']",
          message:
            "Do not call ctx.auth.getUserIdentity() directly. Use the builders in convex/lib/authedFunctions.ts (authenticatedQuery/Mutation, ownedChatMutation, maybeAuth*, optionalAuth*, identity*) so auth is structural. See ADR-0003.",
        },
      ],
    },
  },
]

export default eslintConfig
