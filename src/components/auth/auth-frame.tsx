import Link from "next/link";

export function AuthFrame({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div dir="rtl" lang="ar" className="relative flex min-h-dvh flex-1 flex-col bg-[#f6f7f9]">
      <div className="bg-brand absolute inset-x-0 top-0 h-1.5" />
      <div className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-[440px]">
          <div className="mb-8 flex items-center gap-3">
            <span className="bg-brand text-brand-foreground flex size-11 items-center justify-center rounded-2xl text-xl font-black shadow-lg shadow-brand/25">
              R
            </span>
            <span className="flex flex-col leading-none">
              <span className="text-xl font-bold tracking-tight text-neutral-950">Rapid</span>
              <span className="mt-1 text-xs text-neutral-500">للشحن السريع</span>
            </span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-neutral-950">{title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-neutral-500">{description}</p>
          <div className="mt-8">{children}</div>
          <p className="mt-6 text-center text-sm text-neutral-500">
            <Link href="/track" className="text-brand font-semibold hover:underline">
              أريد تتبع طلبي
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
