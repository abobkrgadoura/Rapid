import Link from "next/link";

export default function TrackLayout({ children }: LayoutProps<"/track">) {
  return (
    <div dir="rtl" lang="ar" className="flex min-h-dvh flex-1 flex-col bg-zinc-50 text-neutral-950">
      <header className="border-b border-white/10 bg-ink-950 text-white">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-4">
          <Link href="/track" className="flex items-center gap-3">
            <span className="bg-brand text-brand-foreground flex size-9 items-center justify-center rounded-xl text-base font-black shadow-lg shadow-brand/30">
              R
            </span>
            <span className="flex flex-col leading-none">
              <span className="text-base font-bold tracking-tight">Rapid</span>
              <span className="mt-1 text-[11px] text-zinc-400">للشحن السريع</span>
            </span>
          </Link>
          <span className="text-sm text-zinc-400">تتبع الشحنات</span>
        </div>
      </header>
      {children}
    </div>
  );
}
