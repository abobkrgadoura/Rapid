"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, type SignInState } from "@/lib/auth/actions";
import { formatIdentifierInput } from "@/lib/auth/identifier";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, null);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const emailLike = identifier.includes("@") || /[A-Za-z]/.test(identifier);

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="next" value={next} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="identifier">رقم الهاتف أو البريد الإلكتروني</Label>
        <Input
          id="identifier"
          name="identifier"
          type="text"
          dir="ltr"
          inputMode={emailLike ? "email" : "tel"}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          value={identifier}
          onChange={(event) => setIdentifier(formatIdentifierInput(event.target.value))}
          onBlur={() => setIdentifier((current) => formatIdentifierInput(current, true))}
          placeholder="+249912345678"
          aria-invalid={state?.error ? true : undefined}
          className="h-12 bg-white text-left text-base"
        />
        <p className="text-xs leading-relaxed text-neutral-500">
          رقم سوداني يبدأ بـ 09، أو مصري من 11 رقمًا يبدأ بـ 010 أو 011 أو 012 أو 015، أو بريد إلكتروني.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="password">كلمة السر</Label>
          <Link
            href="/login/forgot"
            className="text-brand text-sm font-medium hover:underline"
          >
            نسيت كلمة السر؟
          </Link>
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={state?.error ? true : undefined}
          className="h-12 bg-white text-base"
        />
      </div>
      {state?.error ? (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      ) : null}
      <Button
        type="submit"
        variant="brand"
        size="lg"
        className="h-12 w-full text-base font-bold"
        disabled={pending}
      >
        {pending ? "جارٍ تسجيل الدخول…" : "تسجيل الدخول"}
      </Button>
      <p className="text-center text-sm text-neutral-500">
        ليس لديك حساب؟{" "}
        <Link href="/register" className="text-brand font-semibold hover:underline">
          إنشاء حساب تاجر
        </Link>
      </p>
    </form>
  );
}
