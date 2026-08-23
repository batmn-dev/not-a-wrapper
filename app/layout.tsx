import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import {
  ChatAnnouncerOutlet,
  ChatAnnouncerProvider,
} from "@/app/components/chat/chat-announcer"
import { FocusModeController } from "@/components/ui/focus-mode"
import { SidebarProvider } from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ChatsProvider } from "@/lib/chat-store/chats/provider"
import { ChatSessionProvider } from "@/lib/chat-store/session/provider"
import { APP_DOMAIN } from "@/lib/config"
import { ModelProvider } from "@/lib/model-store/provider"
import { TanstackQueryProvider } from "@/lib/tanstack-query/tanstack-query-provider"
import { UserPreferencesProvider } from "@/lib/user-preference-store/provider"
import { UserProvider } from "@/lib/user-store/provider"
import { getUserAuth } from "@/lib/user/api"
import { ThemeProvider } from "next-themes"
import Script from "next/script"
import { LayoutClient } from "./layout-client"
import { Providers } from "./providers"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
}

export const metadata: Metadata = {
  metadataBase: new URL(APP_DOMAIN),
  title: "Not A Wrapper",
  description:
    "Not A Wrapper is an open-source, Next.js-based AI chat application that provides a unified interface for multiple models, including OpenAI, Mistral, Claude, and Gemini. BYOK-ready.",
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const isDev = process.env.NODE_ENV === "development"
  const isOfficialDeployment = process.env.NAW_OFFICIAL === "true"
  const { initialAuth, userProfile } = await getUserAuth()

  return (
    <html lang="en" suppressHydrationWarning>
      {isOfficialDeployment ? (
        <Script
          defer
          src="https://assets.onedollarstats.com/stonks.js"
          {...(isDev ? { "data-debug": "not-a-wrapper.com" } : {})}
        />
      ) : null}
      <body
        className={`${geistSans.variable} ${geistMono.variable} isolate antialiased`}
      >
        <FocusModeController />
        <a
          href="#main"
          data-skip-to-content=""
          className="bg-background text-foreground ring-border fixed inset-x-0 top-0 z-[100] mx-auto mt-4 w-fit rounded-2xl px-4 py-2 text-sm font-medium shadow-lg ring-1 not-focus:sr-only focus:outline-none"
        >
          Skip to content
        </a>
        <ChatAnnouncerProvider>
          <ChatAnnouncerOutlet />
          <Providers initialAuth={initialAuth}>
            <TanstackQueryProvider>
              <LayoutClient />
              <UserProvider initialUser={userProfile}>
                <ModelProvider>
                  <ChatsProvider userId={userProfile?.id}>
                    <ChatSessionProvider>
                      <UserPreferencesProvider
                        userId={userProfile?.id}
                        initialPreferences={userProfile?.preferences}
                      >
                        <TooltipProvider delay={0}>
                          <ThemeProvider
                            attribute="class"
                            defaultTheme="system"
                            enableSystem
                            disableTransitionOnChange
                          >
                            <SidebarProvider defaultOpen>
                              <Toaster position="top-center" />
                              {children}
                            </SidebarProvider>
                          </ThemeProvider>
                        </TooltipProvider>
                      </UserPreferencesProvider>
                    </ChatSessionProvider>
                  </ChatsProvider>
                </ModelProvider>
              </UserProvider>
            </TanstackQueryProvider>
          </Providers>
        </ChatAnnouncerProvider>
      </body>
    </html>
  )
}
