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
  const driver = width === "narrow"

  return (
    <div className={`flex min-h-full flex-1 flex-col ${driver ? "bg-background" : "bg-muted/40"}`}>
      {driver ? null : (
        <header className="relative z-50 pointer-events-auto border-b bg-background">
          <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="text-sm font-semibold tracking-tight">Rapid</span>
              <span className="text-muted-foreground truncate text-sm">{title}</span>
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
      )}
      <main
        className={`mx-auto flex w-full flex-1 flex-col ${
          driver ? "max-w-lg bg-background px-0" : "max-w-6xl px-4 py-8"
        }`}
      >
        {children}
      </main>
    </div>
  )
}
