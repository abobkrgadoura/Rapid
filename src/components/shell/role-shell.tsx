import { LogOut } from "lucide-react"

import { signOut } from "@/lib/auth/actions"
import type { SessionProfile } from "@/lib/auth/profile"
import { Button } from "@/components/ui/button"

export function RoleShell({
  title,
  profile,
  width = "wide",
  actions,
  signOutLabel = "Sign out",
  children,
}: {
  title: string
  profile: SessionProfile
  width?: "wide" | "narrow"
  actions?: React.ReactNode
  signOutLabel?: string
  children: React.ReactNode
}) {
  const name = profile.fullName || profile.email || title

  return (
    <div className="flex min-h-full flex-1 flex-col bg-muted/40">
      <header className="border-b bg-background">
        <div
          className={`mx-auto flex h-14 w-full items-center justify-between gap-3 px-4 ${
            width === "narrow" ? "max-w-lg" : "max-w-6xl"
          }`}
        >
          <div className="flex min-w-0 items-center gap-3">
            <span className="text-sm font-semibold tracking-tight">Rapid</span>
            <span className="text-muted-foreground truncate text-sm">
              {title}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {actions}
            <span className="text-muted-foreground hidden max-w-36 truncate text-sm sm:inline">
              {name}
            </span>
            <form action={signOut}>
              <Button type="submit" variant="outline" size="lg" className="h-11 min-h-11 px-3">
                <LogOut />
                {signOutLabel}
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main
        className={`mx-auto flex w-full flex-1 flex-col px-4 py-8 ${
          width === "narrow" ? "max-w-lg" : "max-w-6xl"
        }`}
      >
        {children}
      </main>
    </div>
  )
}
