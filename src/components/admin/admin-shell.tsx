"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Menu,
  Moon,
  PanelRightClose,
  PanelRightOpen,
  Route,
  ScanBarcode,
  Settings,
  ShieldAlert,
  Sun,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";

import { useAdminPrefs } from "@/components/admin/admin-prefs";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { signOut } from "@/lib/auth/actions";
import type { AdminMessages } from "@/lib/admin/messages";
import { cn } from "@/lib/utils";

type NavKey = keyof AdminMessages["shell"]["items"];

type NavItem = {
  href: string;
  labelKey: NavKey;
  hintKey: NavKey;
  icon: LucideIcon;
  exact?: boolean;
};

const NAV: readonly NavItem[] = [
  { href: "/admin", labelKey: "tower", hintKey: "towerHint", icon: LayoutDashboard, exact: true },
  { href: "/admin/hub", labelKey: "hub", hintKey: "hubHint", icon: ScanBarcode },
  { href: "/admin/orders", labelKey: "orders", hintKey: "ordersHint", icon: Route },
  { href: "/admin/exceptions", labelKey: "exceptions", hintKey: "exceptionsHint", icon: ShieldAlert },
  { href: "/admin/staff", labelKey: "staff", hintKey: "staffHint", icon: Users },
  { href: "/admin/finance", labelKey: "finance", hintKey: "financeHint", icon: Wallet },
  { href: "/admin/support", labelKey: "support", hintKey: "supportHint", icon: LifeBuoy },
  { href: "/admin/settings", labelKey: "settings", hintKey: "settingsHint", icon: Settings },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "R";
  const first = Array.from(words[0])[0] ?? "R";
  const second = words[1] ? (Array.from(words[1])[0] ?? "") : "";
  return `${first}${second}`.toUpperCase();
}

function Logo({ collapsed, copy }: { collapsed: boolean; copy: AdminMessages["shell"] }) {
  return (
    <Link
      href="/admin"
      aria-label={copy.logoHome}
      className="flex items-center gap-3 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-white/30"
    >
      <span className="bg-brand text-brand-foreground ring-gold/70 shadow-brand/30 flex size-9 shrink-0 items-center justify-center rounded-xl text-lg font-black shadow-lg ring-2">
        R
      </span>
      {collapsed ? null : (
        <span className="flex flex-col leading-none">
          <span className="text-base font-bold tracking-tight text-white">Rapid</span>
          <span className="mt-1 text-[0.7rem] text-neutral-400">{copy.portal}</span>
        </span>
      )}
    </Link>
  );
}

function NavLink({
  item,
  pathname,
  collapsed,
  label,
  hint,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
  label: string;
  hint: string;
  onNavigate?: () => void;
}) {
  const active = isActive(pathname, item);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : hint}
      aria-label={collapsed ? label : undefined}
      className={cn(
        "group pointer-events-auto relative flex h-11 min-h-11 cursor-pointer touch-manipulation items-center gap-3 rounded-lg px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-white/30",
        collapsed && "justify-center px-0",
        active ? "bg-brand/20 text-white" : "text-neutral-400 hover:bg-white/5 hover:text-white",
      )}
    >
      {active ? (
        <span aria-hidden="true" className="bg-gold absolute inset-y-2 -end-3 w-1 rounded-s-full" />
      ) : null}
      <Icon
        className={cn(
          "size-[1.15rem] shrink-0 transition-colors",
          active ? "text-gold" : "group-hover:text-white",
        )}
      />
      {collapsed ? null : <span className="truncate">{label}</span>}
    </Link>
  );
}

function PreferenceToggles() {
  const { copy, locale, theme, setLocale, setTheme } = useAdminPrefs();
  const shell = copy.shell;
  return (
    <div className="flex items-center gap-2">
      <div
        role="group"
        aria-label={shell.language}
        className="flex rounded-lg border border-white/10 p-0.5"
      >
        <button
          type="button"
          aria-pressed={locale === "ar"}
          onClick={() => setLocale("ar")}
          className={cn(
            "pointer-events-auto h-11 min-h-11 cursor-pointer touch-manipulation rounded-md px-3 text-xs font-bold outline-none focus-visible:ring-3 focus-visible:ring-white/30",
            locale === "ar" ? "bg-white text-ink-950" : "text-neutral-300 hover:text-white",
          )}
        >
          {shell.arabic}
        </button>
        <button
          type="button"
          aria-pressed={locale === "en"}
          onClick={() => setLocale("en")}
          className={cn(
            "pointer-events-auto h-11 min-h-11 cursor-pointer touch-manipulation rounded-md px-3 text-xs font-bold outline-none focus-visible:ring-3 focus-visible:ring-white/30",
            locale === "en" ? "bg-white text-ink-950" : "text-neutral-300 hover:text-white",
          )}
        >
          {shell.english}
        </button>
      </div>
      <button
        type="button"
        aria-pressed={theme === "dark"}
        aria-label={theme === "dark" ? shell.lightMode : shell.darkMode}
        title={theme === "dark" ? shell.lightMode : shell.darkMode}
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        className="pointer-events-auto flex size-11 min-h-11 min-w-11 cursor-pointer touch-manipulation items-center justify-center rounded-lg border border-white/10 text-neutral-200 outline-none hover:bg-white/10 focus-visible:ring-3 focus-visible:ring-white/30"
      >
        {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </button>
    </div>
  );
}

export function AdminShell({
  displayName,
  email,
  children,
}: {
  displayName: string;
  email: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { copy, dir, locale } = useAdminPrefs();
  const shell = copy.shell;
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen]);

  const current = NAV.find((item) => isActive(pathname, item)) ?? NAV[0];

  return (
    <div dir={dir} lang={locale} className="bg-background text-foreground flex min-h-dvh flex-1">
      <aside
        className={cn(
          "bg-ink-950 sticky top-0 hidden h-dvh shrink-0 flex-col border-e border-white/5 transition-[width] duration-200 md:flex",
          collapsed ? "w-[4.75rem]" : "w-72",
        )}
      >
        <div
          className={cn(
            "flex h-16 items-center border-b border-white/5 px-4",
            collapsed ? "justify-center" : "justify-between",
          )}
        >
          <Logo collapsed={collapsed} copy={shell} />
        </div>
        <div className="flex-1 overflow-y-auto py-4">
          <nav aria-label={shell.nav} className="flex flex-col gap-1 px-3">
            {collapsed ? null : (
              <p className="px-3 pb-2 text-[0.68rem] font-semibold tracking-wide text-neutral-500">
                {shell.group}
              </p>
            )}
            {NAV.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                pathname={pathname}
                collapsed={collapsed}
                label={shell.items[item.labelKey]}
                hint={shell.items[item.hintKey]}
              />
            ))}
          </nav>
        </div>
        <div className="border-t border-white/5 p-3">
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            aria-pressed={collapsed}
            aria-label={collapsed ? shell.expand : shell.collapse}
            title={collapsed ? shell.expand : shell.collapse}
            className={cn(
              "flex h-10 w-full items-center gap-3 rounded-xl px-3 text-sm text-neutral-400 outline-none transition-colors hover:bg-white/5 hover:text-white focus-visible:ring-3 focus-visible:ring-white/30",
              collapsed && "justify-center px-0",
            )}
          >
            {collapsed ? (
              <PanelRightOpen className="size-5 shrink-0" />
            ) : (
              <PanelRightClose className="size-5 shrink-0" />
            )}
            {collapsed ? null : <span>{shell.collapse}</span>}
          </button>
        </div>
      </aside>

      {mobileOpen ? (
        <div className="pointer-events-none fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label={shell.closeMenu}
            onClick={() => setMobileOpen(false)}
            className="pointer-events-auto absolute inset-0 z-0 animate-in bg-black/50 backdrop-blur-sm duration-200 fade-in-0"
          />
          <aside className="bg-ink-950 pointer-events-auto absolute inset-y-0 start-0 z-10 flex w-72 max-w-[85vw] animate-in flex-col shadow-2xl duration-200 rtl:slide-in-from-right ltr:slide-in-from-left">
            <div className="flex h-16 items-center justify-between border-b border-white/5 px-4">
              <Logo collapsed={false} copy={shell} />
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label={shell.closeMenu}
                className="pointer-events-auto flex size-11 min-h-11 min-w-11 cursor-pointer touch-manipulation items-center justify-center rounded-lg text-neutral-400 outline-none hover:bg-white/5 hover:text-white focus-visible:ring-3 focus-visible:ring-white/30"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-4">
              <nav aria-label={shell.nav} className="flex flex-col gap-1 px-3">
                <p className="px-3 pb-2 text-[0.68rem] font-semibold tracking-wide text-neutral-500">
                  {shell.group}
                </p>
                {NAV.map((item) => (
                  <NavLink
                    key={item.href}
                    item={item}
                    pathname={pathname}
                    collapsed={false}
                    label={shell.items[item.labelKey]}
                hint={shell.items[item.hintKey]}
                    onNavigate={() => setMobileOpen(false)}
                  />
                ))}
              </nav>
            </div>
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-ink-950 sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-white/10 px-3 text-white md:gap-3 md:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label={shell.openMenu}
            className="pointer-events-auto flex size-11 min-h-11 min-w-11 cursor-pointer touch-manipulation items-center justify-center rounded-lg border border-white/10 text-neutral-300 outline-none hover:bg-white/5 focus-visible:ring-3 focus-visible:ring-white/30 md:hidden"
          >
            <Menu className="size-5" />
          </button>
          <div className="flex min-w-0 flex-1 flex-col leading-tight">
            <p className="truncate text-sm font-bold md:text-base">
              Rapid <span className="text-gold">—</span> {shell.portal}
            </p>
            <p className="truncate text-xs text-neutral-400">{shell.items[current.labelKey]}</p>
          </div>
          <NotificationBell
            tone="dark"
            locale={locale}
            labels={{
              notifications: shell.notifications,
              empty: shell.noNotifications,
              markAllRead: shell.markAllRead,
            }}
          />
          <PreferenceToggles />
          <div className="flex items-center gap-3">
            <div className="hidden flex-col items-end leading-tight sm:flex">
              <span className="max-w-40 truncate text-sm font-semibold">{displayName}</span>
              {email ? (
                <span dir="ltr" className="max-w-40 truncate text-xs text-neutral-400">
                  {email}
                </span>
              ) : null}
            </div>
            <span
              aria-hidden="true"
              className="bg-brand text-brand-foreground ring-gold/60 hidden size-9 items-center justify-center rounded-full text-xs font-bold ring-2 sm:flex"
            >
              {initialsOf(displayName)}
            </span>
            <form action={signOut}>
              <button
                type="submit"
                className="pointer-events-auto flex h-11 min-h-11 cursor-pointer touch-manipulation items-center gap-2 rounded-lg border border-white/10 px-3 text-sm text-neutral-200 outline-none transition-colors hover:bg-white/10 focus-visible:ring-3 focus-visible:ring-white/30"
              >
                <LogOut className="size-4" />
                <span className="hidden sm:inline">{shell.signOut}</span>
              </button>
            </form>
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 py-6 md:px-8 md:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
