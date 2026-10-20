"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordReset, type ResetPasswordState } from "@/lib/auth/actions";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<ResetPasswordState, FormData>(
    requestPasswordReset,
    null,
  );

  return (
    <form action={action} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">البريد الإلكتروني</Label>
        <Input
          id="email"
          name="email"
          type="email"
          dir="ltr"
          autoComplete="email"
          required
          placeholder="name@company.com"
          aria-invalid={state?.error ? true : undefined}
          className="h-12 bg-white text-start text-base"
        />
      </div>
      {state?.error ? (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      ) : null}
      {state?.message ? (
        <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
          {state.message}
        </p>
      ) : null}
      <Button
        type="submit"
        variant="brand"
        size="lg"
        className="h-12 w-full text-base font-bold"
        disabled={pending}
      >
        {pending ? "جارٍ الإرسال…" : "إرسال رابط الاستعادة"}
      </Button>
      <Link href="/login" className="text-center text-sm font-medium text-neutral-600 hover:underline">
        العودة لتسجيل الدخول
      </Link>
    </form>
  );
}
