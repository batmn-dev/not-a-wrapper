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
app.use(agent)

export default app
