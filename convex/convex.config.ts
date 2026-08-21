import agent from "@convex-dev/agent/convex.config"
import workOSAuthKit from "@convex-dev/workos-authkit/convex.config"
import { defineApp } from "convex/server"
import { v } from "convex/values"

const app = defineApp({
  env: {
    WORKOS_CLIENT_ID: v.string(),
    WORKOS_API_KEY: v.string(),
    WORKOS_WEBHOOK_SECRET: v.string(),
    CHAT_ADMISSION_SECRET: v.string(),
  },
})

app.use(workOSAuthKit)
// @convex-dev/agent is registered config-only: nothing app-side imports its
// JS client surface or passes AI SDK objects (models, tools, messages) into
// its APIs. Keep it that way unless an ADR adopts the component as a runtime.
app.use(agent)

export default app
