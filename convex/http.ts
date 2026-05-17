import { httpRouter } from "convex/server"
import { authKit } from "./workosAuth"

const http = httpRouter()

authKit.registerRoutes(http)

export default http
