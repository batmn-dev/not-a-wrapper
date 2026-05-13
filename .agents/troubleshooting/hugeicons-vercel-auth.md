# Obsolete Private Icon Registry Auth

This troubleshooting note is obsolete.

The app now uses the official `@remixicon/react` package for UI icons. Vercel
and GitHub Actions should install dependencies with the standard public npm
registry flow; no private icon registry setup or icon license environment
variable is required.

If a build fails while installing icons, check the normal dependency pipeline:

1. `package.json` should include `@remixicon/react`.
2. `bun.lock` should include the matching public package entry.
3. Vercel should run `bun install`.
4. GitHub Actions should run `bun install --frozen-lockfile`.
