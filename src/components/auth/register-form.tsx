"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signUpMerchant, type SignUpState } from "@/lib/auth/actions";
import { formatIdentifierInput } from "@/lib/auth/identifier";

export function RegisterForm() {
  const [state, action, pending] = useActionState<SignUpState, FormData>(signUpMerchant, null);
  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [token, setToken] = useState("");
  const emailLike = identifier.includes("@") || /[A-Za-z]/.test(identifier);

  if (state?.confirmPhone) {
    return (
      <form action={action} className="flex flex-col gap-5">
        <input type="hidden" name="step" value="confirm" />
        <input type="hidden" name="phone" value={state.confirmPhone} />
        <p className="text-sm leading-relaxed text-neutral-600">
          أدخل رمز التأكيد للرقم{" "}
          <span dir="ltr" className="font-medium text-neutral-950">
            {state.confirmPhone}
          </span>
          . أثناء التطوير استخدم الرمز الثابت لرقم الاختبار من لوحة Supabase، دون إرسال رسالة.
        </p>
        <div className="flex flex-col gap-2">
          <Label htmlFor="token">رمز التأكيد</Label>
          <Input
            id="token"
            name="token"
            type="text"
            dir="ltr"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoCorrect="off"
            spellCheck={false}
            required
            value={token}
            onChange={(event) => setToken(event.target.value.replace(/\D/g, "").slice(0, 10))}
            placeholder="123456"
            aria-invalid={state.error ? true : undefined}
            className="h-12 bg-white text-left text-base tracking-widest"
          />
        </div>
        {state.error ? (
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
          {pending ? "جارٍ التأكيد…" : "تأكيد الحساب"}
        </Button>
        <Link href="/login" className="text-center text-sm font-medium text-neutral-600 hover:underline">
          العودة لتسجيل الدخول
        </Link>
      </form>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="fullName">الاسم بالكامل</Label>
        <Input
          id="fullName"
          name="fullName"
          type="text"
          autoComplete="name"
          required
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          aria-invalid={state?.error ? true : undefined}
          className="h-12 bg-white text-base"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="companyName">اسم النشاط (اختياري)</Label>
        <Input
          id="companyName"
          name="companyName"
          type="text"
          autoComplete="organization"
          value={companyName}
          onChange={(event) => setCompanyName(event.target.value)}
          className="h-12 bg-white text-base"
        />
      </div>
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
          رقم سوداني يبدأ بـ 09، أو مصري من 11 رقمًا يبدأ بـ 010 أو 011 أو 012 أو 015. الصيغة الدولية تبدأ بـ +.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">كلمة السر</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={state?.error ? true : undefined}
          className="h-12 bg-white text-base"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirmPassword">تأكيد كلمة السر</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          className="h-12 bg-white text-base"
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
        {pending ? "جارٍ إنشاء الحساب…" : "إنشاء حساب تاجر"}
      </Button>
      <p className="text-center text-sm text-neutral-500">
        لديك حساب؟{" "}
        <Link href="/login" className="text-brand font-semibold hover:underline">
          تسجيل الدخول
        </Link>
      </p>
    </form>
  );
}
