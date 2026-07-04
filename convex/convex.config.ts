import agent from "@convex-dev/agent/convex.config"
import workOSAuthKit from "@convex-dev/workos-authkit/convex.config"
import { defineApp } from "convex/server"
import { v } from "convex/values"

const app = defineApp({
  env: {
    WORKOS_CLIENT_ID: v.string(),
    WORKOS_API_KEY: v.string(),
    WORKOS_WEBHOOK_SECRET: v.string(),
  },
})

app.use(workOSAuthKit)
// @convex-dev/agent peers on `ai ^6` while the app runs ai@7. That is safe
// ONLY because the component is registered config-only: nothing app-side may
// import its JS client surface or pass AI SDK objects (models, tools,
// messages) into its APIs until it ships an ai@7-compatible release.
app.use(agent)

export default app
