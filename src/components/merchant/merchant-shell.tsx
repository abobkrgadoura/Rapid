"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarClock,
  ChevronDown,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Menu,
  PackageCheck,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Settings,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";

import { NotificationBell } from "@/components/notifications/notification-bell";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocale } from "@/components/i18n/locale-context";
import { signOut } from "@/lib/auth/actions";
import type { Messages } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Match only this exact path (the dashboard is a prefix of every route). */
  exact?: boolean;
};

type NavGroup = {
  label: string;
  items: readonly NavItem[];
};

function navGroups(copy: Messages["shell"]): readonly NavGroup[] {
  return [
    {
      label: copy.overview,
      items: [{ href: "/merchant", label: copy.home, icon: LayoutDashboard, exact: true }],
    },
    {
      label: copy.shipments,
      items: [
        { href: "/merchant/orders", label: copy.orders, icon: PackageCheck },
        { href: "/merchant/pickups", label: copy.pickups, icon: CalendarClock },
      ],
    },
    {
      label: copy.finance,
      items: [{ href: "/merchant/wallet", label: copy.wallet, icon: Wallet }],
    },
  ];
}

function settingsItem(copy: Messages["shell"]): NavItem {
  return {
    href: "/merchant/settings",
    label: copy.settings,
    icon: Settings,
  };
}

function supportItem(copy: Messages["shell"]): NavItem {
  return {
    href: "/merchant/support",
    label: copy.support,
    icon: LifeBuoy,
  };
}

const CREATE_ORDER_HREF = "/merchant/orders/new";

function isActive(pathname: string, item: NavItem): boolean {
  if (pathname === CREATE_ORDER_HREF && item.href === "/merchant/orders") return false;
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function titleFor(pathname: string, copy: Messages["shell"]): string {
  const groups = navGroups(copy);
  const settings = settingsItem(copy);
  if (pathname === CREATE_ORDER_HREF) return copy.createOrder;
  if (pathname.endsWith("/awb")) return copy.printAwb;
  if (pathname.startsWith("/merchant/orders/") && pathname !== CREATE_ORDER_HREF) {
    return copy.orderDetail;
  }
  if (pathname === "/merchant/onboarding") return copy.volume;
  if (pathname === "/merchant/support" || pathname.startsWith("/merchant/support/")) {
    return copy.support;
  }
  const match = groups.flatMap((group) => group.items).find((item) =>
    isActive(pathname, item),
  );
  if (match) return match.label;
  if (isActive(pathname, settings)) return settings.label;
  return copy.dashboard;
}

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "R";
  const first = Array.from(words[0])[0] ?? "R";
  const second = words[1] ? (Array.from(words[1])[0] ?? "") : "";
  return `${first}${second}`.toUpperCase();
}

function Logo({ collapsed, copy }: { collapsed: boolean; copy: Messages["shell"] }) {
  return (
    <Link
      href="/merchant"
      aria-label={copy.logoHome}
      className="flex items-center gap-3 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-white/30"
    >
      <span className="bg-brand text-brand-foreground ring-gold/70 flex size-9 shrink-0 items-center justify-center rounded-xl text-lg font-black shadow-lg shadow-brand/30 ring-2">
        R
      </span>
      {collapsed ? null : (
        <span className="flex flex-col leading-none">
          <span className="text-base font-bold tracking-tight text-white">
            Rapid
          </span>
          <span className="mt-1 text-[0.7rem] text-neutral-400">
            {copy.portal}
          </span>
        </span>
      )}
    </Link>
  );
}

function SidebarNav({
  pathname,
  collapsed,
  copy,
  onNavigate,
}: {
  pathname: string;
  collapsed: boolean;
  copy: Messages["shell"];
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label={copy.overview} className="flex flex-col gap-5 px-3">
      <Link
        href={CREATE_ORDER_HREF}
        onClick={onNavigate}
        aria-current={pathname === CREATE_ORDER_HREF ? "page" : undefined}
        title={collapsed ? copy.createOrder : undefined}
        className={cn(
          buttonVariants({ variant: "brand", size: "lg" }),
          "h-11 gap-2 rounded-xl text-sm font-bold",
          collapsed ? "px-0" : "w-full",
        )}
      >
        <Plus className="size-4" strokeWidth={3} />
        {collapsed ? null : <span>{copy.createOrder}</span>}
      </Link>
      {navGroups(copy).map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          {collapsed ? null : (
            <p className="px-3 pb-1 text-[0.68rem] font-semibold tracking-wide text-neutral-500">
              {group.label}
            </p>
          )}
          {group.items.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              pathname={pathname}
              collapsed={collapsed}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ))}
    </nav>
  );
}

function NavLink({
  item,
  pathname,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const active = isActive(pathname, item);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={cn(
        "group pointer-events-auto relative flex h-11 min-h-11 cursor-pointer touch-manipulation items-center gap-3 rounded-lg px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-white/30",
        collapsed && "justify-center px-0",
        active
          ? "bg-brand/15 text-white"
          : "text-neutral-400 hover:bg-white/5 hover:text-white",
      )}
    >
      {active ? (
        <span
          aria-hidden="true"
          className="bg-gold absolute inset-y-1.5 -end-3 w-1 rounded-s-full"
        />
      ) : null}
      <Icon
        className={cn(
          "size-[1.15rem] shrink-0 transition-colors",
          active ? "text-brand" : "group-hover:text-white",
        )}
      />
      {collapsed ? null : <span className="truncate">{item.label}</span>}
    </Link>
  );
}

function ProfileMenu({
  name,
  email,
  copy,
}: {
  name: string;
  email: string | null;
  copy: Messages["shell"];
}) {
  const [signingOut, startSignOut] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={copy.account}
        className={cn(
          buttonVariants({ variant: "outline", size: "lg" }),
          "h-10 gap-2 rounded-full ps-1 pe-3",
        )}
      >
        <span className="bg-neutral-900 flex size-8 items-center justify-center rounded-full text-xs font-bold text-white dark:bg-neutral-100 dark:text-neutral-900">
          {initialsOf(name)}
        </span>
        <span className="hidden max-w-32 truncate text-sm sm:inline">{name}</span>
        <ChevronDown className="text-muted-foreground size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <div className="flex flex-col gap-0.5 px-2 py-2">
          <span className="truncate text-sm font-semibold">{name}</span>
          {email ? (
            <span dir="ltr" className="text-muted-foreground truncate text-end text-xs">
              {email}
            </span>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/merchant/settings" />}>
          <Settings />
          {copy.settings}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={signingOut}
          onClick={() => startSignOut(() => signOut())}
        >
          <LogOut />
          {copy.signOut}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function MerchantShell({
  displayName,
  email,
  children,
}: {
  /** Company name, falling back to the person's name. */
  displayName: string;
  email: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { m, dir, locale } = useLocale();
  const copy = m.shell;
  const settings = settingsItem(copy);
  const support = supportItem(copy);
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

  if (pathname === "/merchant/onboarding") {
    return <div className="flex min-h-dvh flex-1 flex-col">{children}</div>;
  }

  return (
      <div className="flex min-h-dvh flex-1">
        {/* Desktop sidebar */}
        <aside
          className={cn(
            "sticky top-0 hidden h-dvh shrink-0 flex-col border-e border-white/5 bg-ink-950 transition-[width] duration-200 print:hidden md:flex",
            collapsed ? "w-[4.75rem]" : "w-64",
          )}
        >
          <div
            className={cn(
              "flex h-16 items-center border-b border-white/5 px-4",
              collapsed ? "justify-center" : "justify-between",
            )}
          >
            <Logo collapsed={collapsed} copy={copy} />
          </div>
          <div className="flex-1 overflow-y-auto py-4">
            <SidebarNav pathname={pathname} collapsed={collapsed} copy={copy} />
          </div>
          <div className="flex flex-col gap-1 border-t border-white/5 p-3">
            <NavLink item={support} pathname={pathname} collapsed={collapsed} />
            <NavLink
              item={settings}
              pathname={pathname}
              collapsed={collapsed}
            />
            <button
              type="button"
              onClick={() => setCollapsed((value) => !value)}
              aria-pressed={collapsed}
              aria-label={collapsed ? copy.expand : copy.collapse}
              title={collapsed ? copy.expand : copy.collapse}
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
              {collapsed ? null : <span>{copy.collapse}</span>}
            </button>
          </div>
        </aside>

        {/* Mobile drawer */}
        {mobileOpen ? (
          <div className="fixed inset-0 z-50 print:hidden md:hidden">
            <button
              type="button"
              aria-label={copy.closeMenu}
              onClick={() => setMobileOpen(false)}
              className="animate-in fade-in-0 absolute inset-0 bg-black/50 backdrop-blur-sm duration-200"
            />
            <aside
              className={cn(
                "animate-in absolute inset-y-0 start-0 flex w-72 max-w-[85vw] flex-col bg-ink-950 shadow-2xl duration-200",
                dir === "rtl" ? "slide-in-from-right" : "slide-in-from-left",
              )}
            >
              <div className="flex h-16 items-center justify-between border-b border-white/5 px-4">
                <Logo collapsed={false} copy={copy} />
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  aria-label={copy.closeMenu}
                  className="pointer-events-auto flex size-11 min-h-11 min-w-11 cursor-pointer touch-manipulation items-center justify-center rounded-lg text-neutral-400 outline-none hover:bg-white/5 hover:text-white focus-visible:ring-3 focus-visible:ring-white/30"
                >
                  <X className="size-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto py-4">
                <SidebarNav
                  pathname={pathname}
                  collapsed={false}
                  copy={copy}
                  onNavigate={() => setMobileOpen(false)}
                />
              </div>
              <div className="flex flex-col gap-1 border-t border-white/5 p-3">
                <NavLink
                  item={support}
                  pathname={pathname}
                  collapsed={false}
                  onNavigate={() => setMobileOpen(false)}
                />
                <NavLink
                  item={settings}
                  pathname={pathname}
                  collapsed={false}
                  onNavigate={() => setMobileOpen(false)}
                />
              </div>
            </aside>
          </div>
        ) : null}

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="bg-background sticky top-0 z-30 flex h-16 items-center gap-2 border-b px-3 print:hidden md:gap-3 md:px-6">
            <Button
              type="button"
              variant="outline"
              size="icon-lg"
              className="size-11 min-h-11 min-w-11 md:hidden"
              aria-label={copy.openMenu}
              onClick={() => setMobileOpen(true)}
            >
              <Menu />
            </Button>
            <p className="min-w-0 flex-1 truncate text-base font-semibold md:text-lg">
              {titleFor(pathname, copy)}
            </p>
            <Link
              href={CREATE_ORDER_HREF}
              className={cn(
                buttonVariants({ variant: "brand", size: "lg" }),
                "h-11 min-h-11 gap-2 rounded-full px-4 text-sm font-bold sm:px-5",
              )}
            >
              <Plus className="size-4" strokeWidth={3} />
              <span>{copy.createOrder}</span>
            </Link>
            <NotificationBell
              locale={locale}
              labels={{
                notifications: copy.notifications,
                empty: copy.noNotifications,
                markAllRead: copy.markAllRead,
              }}
            />
            <ProfileMenu name={displayName} email={email} copy={copy} />
          </header>
          <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6 print:max-w-none print:bg-white print:px-0 print:py-0 md:px-6 md:py-8">
            {children}
          </main>
        </div>
      </div>
  );
}
