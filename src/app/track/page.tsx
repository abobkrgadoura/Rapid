import type { Metadata } from "next";
import Link from "next/link";

import { searchTracking } from "@/app/track/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const metadata: Metadata = {
  title: "تتبع شحنتك",
  description: "أدخل رقم تتبع الشحنة لمعرفة حالتها.",
};

export const instant = false;

export default async function TrackSearchPage({
  searchParams,
}: PageProps<"/track">) {
  const params = await searchParams;
  const invalid = params.error === "invalid";

  return (
    <div className="flex flex-1 flex-col">
      <section className="relative overflow-hidden bg-ink-950 text-white">
        <div
          aria-hidden
          className="bg-brand/40 pointer-events-none absolute -top-24 start-1/2 size-80 -translate-x-1/2 rounded-full blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-zinc-50 to-transparent"
        />
        <div className="relative mx-auto flex w-full max-w-3xl flex-col items-center px-4 pt-16 pb-28 text-center sm:pt-24">
          <p className="text-brand-foreground/80 mb-4 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide">
            Rapid · تتبع عام
          </p>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">تتبع شحنتك</h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-zinc-300 sm:text-base">
            اكتب الرقم الموجود على بوليصة الشحن أو في رسالة المتجر. نعرض حالة الشحنة فقط، دون عنوانك أو رقم هاتفك.
          </p>
          <form action={searchTracking} className="mt-10 w-full max-w-xl">
            <label htmlFor="tracking-code" className="sr-only">
              أدخل رقم تتبع الشحنة
            </label>
            <div className="flex flex-col gap-3 rounded-3xl bg-white p-3 shadow-2xl shadow-black/30 sm:flex-row sm:items-center">
              <Input
                id="tracking-code"
                name="code"
                required
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={64}
                dir="ltr"
                placeholder="أدخل رقم تتبع الشحنة"
                aria-invalid={invalid || undefined}
                className="h-14 w-full border-0 bg-transparent px-4 text-center font-mono text-lg tracking-wide text-neutral-950 shadow-none placeholder:font-sans placeholder:text-base placeholder:tracking-normal focus-visible:ring-0 sm:flex-1"
              />
              <Button type="submit" variant="brand" className="h-14 rounded-2xl px-8 text-base font-bold sm:shrink-0">
                تتبع شحنتك
              </Button>
            </div>
            {invalid ? (
              <p role="alert" className="mt-3 text-sm text-rose-200">
                رقم التتبع غير صحيح. تحقق من البوليصة وحاول مرة أخرى.
              </p>
            ) : null}
          </form>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-3xl gap-4 px-4 py-12 sm:grid-cols-3">
        {[
          ["١", "أدخل الرقم", "من البوليصة أو رسالة التاجر."],
          ["٢", "تابع الخطوات", "من إنشاء الطلب حتى التسليم."],
          ["٣", "جهّز المبلغ", "يظهر فقط إذا كان الدفع عند الاستلام."],
        ].map(([index, title, body]) => (
          <article key={title} className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <span className="bg-brand/10 text-brand flex size-9 items-center justify-center rounded-xl text-sm font-black">
              {index}
            </span>
            <h2 className="mt-4 font-bold text-neutral-950">{title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-zinc-500">{body}</p>
          </article>
        ))}
      </section>

      <p className="mt-auto pb-8 text-center text-sm text-zinc-500">
        <Link href="/login" className="text-brand font-semibold hover:underline">
          تسجيل الدخول للتجار
        </Link>
      </p>
    </div>
  );
}
