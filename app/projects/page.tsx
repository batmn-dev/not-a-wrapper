import { LayoutApp } from "@/app/components/layout/layout-app"
import { getAuthenticatedWorkosSession } from "@/lib/auth/workos"
import { MessagesProvider } from "@/lib/chat-store/messages/provider"
import { redirect } from "next/navigation"
import { ProjectsView } from "./projects-view"

/**
 * The authenticated Projects directory. Guests are redirected home (matching
 * the /p/[projectId] gate). The page owns its header composition, so the shell
 * header slot is explicitly empty — the view renders its own compact mobile
 * bar and in-page heading.
 */
export default async function Page() {
  const authSession = await getAuthenticatedWorkosSession()
  if (!authSession) {
    redirect("/")
  }

  return (
    // MessagesProvider is a LayoutApp prerequisite (its HistorySearchProvider
    // reads the messages store), same as the home and /p/[projectId] routes.
    <MessagesProvider>
      <LayoutApp header={null}>
        <ProjectsView />
      </LayoutApp>
    </MessagesProvider>
  )
}
