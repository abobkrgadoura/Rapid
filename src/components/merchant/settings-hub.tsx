"use client";

import { useState, useTransition } from "react";
import {
  Building2,
  CheckCircle2,
  Printer,
  SlidersHorizontal,
  Truck,
  UserRound,
  Users,
  X,
} from "lucide-react";

import { updateMerchantProfile } from "@/actions/merchant";
import type { UpdateMerchantProfileResult } from "@/actions/merchant";
import { useLocale } from "@/components/i18n/locale-context";
import { AwbPreview } from "@/components/merchant/awb-preview";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { MerchantProfile } from "@/lib/data/merchant-profile";
import { formatPhoneInput } from "@/lib/auth/identifier";
import {
  AWB_FORMATS,
  AWB_LANGUAGES,
  AWB_LAYOUTS,
  BUSINESS_CATEGORIES,
  TEAM_ROLES,
  isAwbFormat,
  isAwbLayout,
  isTeamRole,
  type AwbFormat,
  type AwbLanguage,
  type AwbLayout,
  type FieldErrors,
  type MerchantProfileInput,
  type SettingsField,
  type TeamMember,
  type TeamRole,
} from "@/lib/merchant/settings";

type SaveState =
  | { status: "idle" }
  | { status: "saved" }
  | { status: "error"; message: string; fieldErrors: FieldErrors };

const IDLE: SaveState = { status: "idle" };

function useSectionSave() {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<SaveState>(IDLE);

  function save(input: MerchantProfileInput) {
    setState(IDLE);
    startTransition(async () => {
      let result: UpdateMerchantProfileResult;
      try {
        result = await updateMerchantProfile(input);
      } catch {
        result = {
          ok: false,
          error: "تعذر الاتصال بالخادم. حاول مرة أخرى.",
          fieldErrors: {},
        };
      }
      setState(
        result.ok
          ? { status: "saved" }
          : {
              status: "error",
              message: result.error,
              fieldErrors: result.fieldErrors,
            },
      );
    });
  }

  const fieldErrors: FieldErrors = state.status === "error" ? state.fieldErrors : {};

  return {
    pending,
    state,
    save,
    fieldErrors,
    touch: () => setState((current) => (current.status === "saved" ? IDLE : current)),
  };
}

function invalid(errors: FieldErrors, field: SettingsField) {
  return errors[field] ? true : undefined;
}

function SaveBar({ pending, state }: { pending: boolean; state: SaveState }) {
  const { m } = useLocale();
  return (
    <CardFooter className="flex flex-wrap items-center gap-3 border-t">
      <Button type="submit" variant="brand" size="lg" disabled={pending}>
        {pending ? m.settings.saving : m.settings.save}
      </Button>
      <div aria-live="polite" className="text-sm">
        {state.status === "saved" ? (
          <span className="text-emerald-700 flex items-center gap-1.5 dark:text-emerald-400">
            <CheckCircle2 className="size-4" />
            {m.settings.saved}
          </span>
        ) : null}
        {state.status === "error" ? (
          <span role="alert" className="text-destructive">
            {state.message}
          </span>
        ) : null}
      </div>
    </CardFooter>
  );
}

function PlatformForm({ profile }: { profile: MerchantProfile }) {
  const { locale, m, setLocale } = useLocale();
  const copy = m.settings.platform;
  const { pending, state, save, fieldErrors, touch } = useSectionSave();
  const [language, setLanguage] = useState<AwbLanguage>(locale);
  const [autoPrint, setAutoPrint] = useState(profile.preferences.autoPrint);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save({ section: "platform", platformLanguage: language, autoPrint });
      }}
      onChange={touch}
      noValidate
    >
      <Card>
        <CardHeader>
          <CardTitle>{copy.title}</CardTitle>
          <CardDescription>{copy.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field data-invalid={invalid(fieldErrors, "platformLanguage")}>
              <FieldTitle>{copy.language}</FieldTitle>
              <div className="grid max-w-sm grid-cols-2 gap-2">
                {AWB_LANGUAGES.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    aria-pressed={language === item.value}
                    disabled={pending}
                    onClick={() => {
                      setLanguage(item.value);
                      setLocale(item.value);
                      save({
                        section: "platform",
                        platformLanguage: item.value,
                        autoPrint,
                      });
                    }}
                    className={
                      language === item.value
                        ? "border-brand bg-brand/10 text-foreground h-10 rounded-lg border text-sm font-semibold"
                        : "border-input text-muted-foreground hover:text-foreground h-10 rounded-lg border text-sm font-medium"
                    }
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {fieldErrors.platformLanguage ? (
                <FieldError>{fieldErrors.platformLanguage}</FieldError>
              ) : null}
            </Field>
            <Field orientation="horizontal" data-invalid={invalid(fieldErrors, "autoPrint")}>
              <FieldContent>
                <FieldLabel htmlFor="autoPrint">{copy.autoPrint}</FieldLabel>
                <FieldDescription>{copy.autoPrintHint}</FieldDescription>
              </FieldContent>
              <Switch
                id="autoPrint"
                checked={autoPrint}
                onCheckedChange={(next) => {
                  setAutoPrint(next);
                  touch();
                }}
                disabled={pending}
              />
            </Field>
          </FieldGroup>
        </CardContent>
        <SaveBar pending={pending} state={state} />
      </Card>
    </form>
  );
}

function ShippingForm({ profile }: { profile: MerchantProfile }) {
  const { m } = useLocale();
  const copy = m.settings.shipping;
  const { pending, state, save, fieldErrors, touch } = useSectionSave();
  const [whatsapp, setWhatsapp] = useState(profile.preferences.whatsappNotifications);
  const [deposit, setDeposit] = useState(profile.preferences.defaultDeposit);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save({ section: "shipping", whatsappNotifications: whatsapp, defaultDeposit: deposit });
      }}
      onChange={touch}
      noValidate
    >
      <Card>
        <CardHeader>
          <CardTitle>{copy.title}</CardTitle>
          <CardDescription>{copy.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field
              orientation="horizontal"
              data-invalid={invalid(fieldErrors, "whatsappNotifications")}
            >
              <FieldContent>
                <FieldLabel htmlFor="whatsappNotifications">{copy.whatsapp}</FieldLabel>
                <FieldDescription>{copy.whatsappHint}</FieldDescription>
              </FieldContent>
              <Switch
                id="whatsappNotifications"
                checked={whatsapp}
                onCheckedChange={(next) => {
                  setWhatsapp(next);
                  touch();
                }}
                disabled={pending}
              />
            </Field>
            <Field data-invalid={invalid(fieldErrors, "defaultDeposit")}>
              <FieldLabel htmlFor="defaultDeposit">{copy.deposit}</FieldLabel>
              <Input
                id="defaultDeposit"
                inputMode="decimal"
                dir="ltr"
                autoComplete="off"
                disabled={pending}
                value={deposit}
                onChange={(event) => setDeposit(event.target.value)}
                aria-invalid={invalid(fieldErrors, "defaultDeposit")}
                className="max-w-48 text-start"
              />
              <FieldDescription>{copy.depositHint}</FieldDescription>
              {fieldErrors.defaultDeposit ? (
                <FieldError>{fieldErrors.defaultDeposit}</FieldError>
              ) : null}
            </Field>
          </FieldGroup>
        </CardContent>
        <SaveBar pending={pending} state={state} />
      </Card>
    </form>
  );
}

function PersonalForm({ profile }: { profile: MerchantProfile }) {
  const { m } = useLocale();
  const copy = m.settings.personal;
  const { pending, state, save, fieldErrors, touch } = useSectionSave();
  const [fullName, setFullName] = useState(profile.fullName ?? "");
  const [phone, setPhone] = useState(profile.phone);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save({ section: "personal", fullName, phone });
      }}
      onChange={touch}
      noValidate
    >
      <Card>
        <CardHeader>
          <CardTitle>{copy.title}</CardTitle>
          <CardDescription>{copy.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <div className="grid gap-5 md:grid-cols-2">
              <Field data-invalid={invalid(fieldErrors, "fullName")}>
                <FieldLabel htmlFor="fullName">{copy.name}</FieldLabel>
                <Input
                  id="fullName"
                  autoComplete="name"
                  required
                  maxLength={80}
                  disabled={pending}
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  aria-invalid={invalid(fieldErrors, "fullName")}
                />
                {fieldErrors.fullName ? <FieldError>{fieldErrors.fullName}</FieldError> : null}
              </Field>
              <Field>
                <FieldLabel htmlFor="email">{copy.email}</FieldLabel>
                <Input
                  id="email"
                  value={profile.email ?? ""}
                  readOnly
                  tabIndex={-1}
                  dir="ltr"
                  className="bg-muted text-start"
                />
                <FieldDescription>{copy.emailHint}</FieldDescription>
              </Field>
              <Field data-invalid={invalid(fieldErrors, "phone")}>
                <FieldLabel htmlFor="personalPhone">{copy.phone}</FieldLabel>
                <Input
                  id="personalPhone"
                  type="tel"
                  dir="ltr"
                  autoComplete="tel"
                  required
                  disabled={pending}
                  value={phone}
                  onChange={(event) => setPhone(formatPhoneInput(event.target.value))}
                  onBlur={() => setPhone((current) => formatPhoneInput(current, true))}
                  aria-invalid={invalid(fieldErrors, "phone")}
                  placeholder={copy.phonePlaceholder}
                  className="text-left"
                />
                <FieldDescription>{copy.phoneHint}</FieldDescription>
                {fieldErrors.phone ? <FieldError>{fieldErrors.phone}</FieldError> : null}
              </Field>
            </div>
          </FieldGroup>
        </CardContent>
        <SaveBar pending={pending} state={state} />
      </Card>
    </form>
  );
}

function CompanyForm({ profile }: { profile: MerchantProfile }) {
  const { m } = useLocale();
  const copy = m.settings.company;
  const categoryItems = BUSINESS_CATEGORIES.map((item) => ({
    value: item.value,
    label: m.settings.categories[item.value],
  }));
  const { pending, state, save, fieldErrors, touch } = useSectionSave();
  const [companyName, setCompanyName] = useState(profile.companyName);
  const [websiteUrl, setWebsiteUrl] = useState(profile.websiteUrl);
  const [pickupAddress, setPickupAddress] = useState(profile.preferences.pickupAddress);
  const [returnAddress, setReturnAddress] = useState(profile.preferences.returnAddress);
  const [category, setCategory] = useState<string | null>(profile.businessCategory);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save({
          section: "company",
          companyName,
          websiteUrl,
          businessCategory: category ?? "",
          pickupAddress,
          returnAddress,
        });
      }}
      onChange={touch}
      noValidate
      className="flex flex-col gap-6"
    >
      <Card>
        <CardHeader>
          <CardTitle>{copy.title}</CardTitle>
          <CardDescription>{copy.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <div className="grid gap-5 md:grid-cols-2">
              <Field data-invalid={invalid(fieldErrors, "companyName")}>
                <FieldLabel htmlFor="companyName">{copy.name}</FieldLabel>
                <Input
                  id="companyName"
                  autoComplete="organization"
                  required
                  maxLength={120}
                  disabled={pending}
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                  aria-invalid={invalid(fieldErrors, "companyName")}
                />
                {fieldErrors.companyName ? (
                  <FieldError>{fieldErrors.companyName}</FieldError>
                ) : null}
              </Field>
              <Field data-invalid={invalid(fieldErrors, "businessCategory")}>
                <FieldLabel htmlFor="businessCategory">{copy.category}</FieldLabel>
                <Select
                  items={categoryItems}
                  value={category}
                  onValueChange={(next) => {
                    setCategory(next);
                    touch();
                  }}
                  disabled={pending}
                >
                  <SelectTrigger
                    id="businessCategory"
                    className="w-full"
                    aria-invalid={invalid(fieldErrors, "businessCategory")}
                  >
                    <SelectValue placeholder={copy.categoryPlaceholder} />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    {categoryItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fieldErrors.businessCategory ? (
                  <FieldError>{fieldErrors.businessCategory}</FieldError>
                ) : null}
              </Field>
              <Field className="md:col-span-2" data-invalid={invalid(fieldErrors, "websiteUrl")}>
                <FieldLabel htmlFor="websiteUrl">{copy.website}</FieldLabel>
                <Input
                  id="websiteUrl"
                  type="text"
                  inputMode="url"
                  dir="ltr"
                  autoComplete="url"
                  disabled={pending}
                  value={websiteUrl}
                  onChange={(event) => setWebsiteUrl(event.target.value)}
                  aria-invalid={invalid(fieldErrors, "websiteUrl")}
                  className="text-start"
                />
                <FieldDescription>{copy.websiteHint}</FieldDescription>
                {fieldErrors.websiteUrl ? <FieldError>{fieldErrors.websiteUrl}</FieldError> : null}
              </Field>
            </div>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{copy.placesTitle}</CardTitle>
          <CardDescription>{copy.placesDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field data-invalid={invalid(fieldErrors, "pickupAddress")}>
              <FieldLabel htmlFor="pickupAddress">{copy.pickup}</FieldLabel>
              <Input
                id="pickupAddress"
                autoComplete="street-address"
                maxLength={240}
                disabled={pending}
                value={pickupAddress}
                onChange={(event) => setPickupAddress(event.target.value)}
                aria-invalid={invalid(fieldErrors, "pickupAddress")}
              />
              {fieldErrors.pickupAddress ? (
                <FieldError>{fieldErrors.pickupAddress}</FieldError>
              ) : null}
            </Field>
            <Field data-invalid={invalid(fieldErrors, "returnAddress")}>
              <FieldLabel htmlFor="returnAddress">{copy.returnAddress}</FieldLabel>
              <Input
                id="returnAddress"
                autoComplete="street-address"
                maxLength={240}
                disabled={pending}
                value={returnAddress}
                onChange={(event) => setReturnAddress(event.target.value)}
                aria-invalid={invalid(fieldErrors, "returnAddress")}
              />
              <FieldDescription>{copy.returnHint}</FieldDescription>
              {fieldErrors.returnAddress ? (
                <FieldError>{fieldErrors.returnAddress}</FieldError>
              ) : null}
            </Field>
          </FieldGroup>
        </CardContent>
        <SaveBar pending={pending} state={state} />
      </Card>
    </form>
  );
}

function TeamForm({ profile }: { profile: MerchantProfile }) {
  const { m } = useLocale();
  const copy = m.settings.team;
  const roleItems = TEAM_ROLES.map((item) => ({
    value: item.value,
    label: item.value === "manager" ? copy.manager : copy.member,
  }));
  const { pending, state, save, fieldErrors, touch } = useSectionSave();
  const [members, setMembers] = useState<TeamMember[]>(profile.preferences.teamMembers);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("member");

  function addMember() {
    const nextName = name.trim().replace(/\s+/g, " ");
    const nextEmail = email.trim().toLowerCase();
    if (nextName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) return;
    if (members.length >= 8) return;
    setMembers((current) => [...current, { name: nextName, email: nextEmail, role }]);
    setName("");
    setEmail("");
    setRole("member");
    touch();
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save({ section: "team", members });
      }}
      onChange={touch}
      noValidate
    >
      <Card>
        <CardHeader>
          <CardTitle>{copy.title}</CardTitle>
          <CardDescription>{copy.description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="border-border flex items-center justify-between gap-3 rounded-xl border px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {profile.fullName || profile.companyName || copy.account}
              </p>
              {profile.email ? (
                <p dir="ltr" className="text-muted-foreground truncate text-end text-xs">
                  {profile.email}
                </p>
              ) : null}
            </div>
            <span className="bg-brand/10 text-brand shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold">
              {copy.owner}
            </span>
          </div>

          {members.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {members.map((member, index) => (
                <li
                  key={`${member.email}-${index}`}
                  className="border-border flex items-center justify-between gap-3 rounded-xl border px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{member.name}</p>
                    <p dir="ltr" className="text-muted-foreground truncate text-end text-xs">
                      {member.email}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-muted-foreground text-xs">
                      {member.role === "manager" ? copy.manager : copy.member}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${copy.remove} ${member.name}`}
                      disabled={pending}
                      onClick={() => {
                        setMembers((current) => current.filter((_, item) => item !== index));
                        touch();
                      }}
                    >
                      <X />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">{copy.empty}</p>
          )}

          <FieldGroup>
            <div className="grid gap-3 md:grid-cols-[1fr_1fr_9rem_auto] md:items-end">
              <Field>
                <FieldLabel htmlFor="memberName">{copy.name}</FieldLabel>
                <Input
                  id="memberName"
                  value={name}
                  disabled={pending}
                  maxLength={80}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="memberEmail">{copy.email}</FieldLabel>
                <Input
                  id="memberEmail"
                  type="email"
                  dir="ltr"
                  value={email}
                  disabled={pending}
                  onChange={(event) => setEmail(event.target.value)}
                  className="text-start"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="memberRole">{copy.role}</FieldLabel>
                <Select
                  items={roleItems}
                  value={role}
                  onValueChange={(next) => {
                    if (isTeamRole(next)) setRole(next);
                  }}
                  disabled={pending}
                >
                  <SelectTrigger id="memberRole" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    {roleItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Button type="button" variant="outline" disabled={pending} onClick={addMember}>
                {copy.add}
              </Button>
            </div>
            {fieldErrors.teamMembers ? <FieldError>{fieldErrors.teamMembers}</FieldError> : null}
          </FieldGroup>
        </CardContent>
        <SaveBar pending={pending} state={state} />
      </Card>
    </form>
  );
}

function AwbForm({ profile }: { profile: MerchantProfile }) {
  const { m } = useLocale();
  const copy = m.settings.awb;
  const { pending, state, save, fieldErrors, touch } = useSectionSave();
  const [format, setFormat] = useState<AwbFormat>(profile.preferences.awbFormat);
  const [language, setLanguage] = useState<AwbLanguage>(profile.preferences.awbLanguage);
  const [layout, setLayout] = useState<AwbLayout>(profile.preferences.awbLayout);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <form
        className="max-w-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          save({ section: "awb", awbFormat: format, awbLanguage: language, awbLayout: layout });
        }}
        noValidate
      >
        <Card>
          <CardHeader>
            <CardTitle>{copy.title}</CardTitle>
            <CardDescription>{copy.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field data-invalid={invalid(fieldErrors, "awbLanguage")}>
                <FieldTitle>{copy.language}</FieldTitle>
                <div className="grid max-w-sm grid-cols-2 gap-2">
                  {AWB_LANGUAGES.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      aria-pressed={language === item.value}
                      disabled={pending}
                      onClick={() => {
                        setLanguage(item.value);
                        touch();
                      }}
                      className={
                        language === item.value
                          ? "border-brand bg-brand/10 text-foreground h-10 rounded-lg border text-sm font-semibold"
                          : "border-input text-muted-foreground hover:text-foreground h-10 rounded-lg border text-sm font-medium"
                      }
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                {fieldErrors.awbLanguage ? (
                  <FieldError>{fieldErrors.awbLanguage}</FieldError>
                ) : null}
              </Field>

              <Field data-invalid={invalid(fieldErrors, "awbFormat")}>
                <FieldTitle>{copy.size}</FieldTitle>
                <RadioGroup
                  value={format}
                  onValueChange={(next) => {
                    if (isAwbFormat(next)) {
                      setFormat(next);
                      touch();
                    }
                  }}
                  disabled={pending}
                  aria-label={copy.size}
                >
                  {AWB_FORMATS.map((item) => (
                    <FieldLabel key={item.value} htmlFor={`awb-${item.value}`}>
                      <Field orientation="horizontal">
                        <RadioGroupItem id={`awb-${item.value}`} value={item.value} />
                        <FieldContent>
                          <FieldTitle>{m.settings.formats[item.value].label}</FieldTitle>
                          <FieldDescription>
                            {m.settings.formats[item.value].description}
                          </FieldDescription>
                        </FieldContent>
                      </Field>
                    </FieldLabel>
                  ))}
                </RadioGroup>
                {fieldErrors.awbFormat ? <FieldError>{fieldErrors.awbFormat}</FieldError> : null}
              </Field>

              {format === "a4" ? (
                <Field data-invalid={invalid(fieldErrors, "awbLayout")}>
                  <FieldTitle>{copy.layout}</FieldTitle>
                  <RadioGroup
                    value={layout}
                    onValueChange={(next) => {
                      if (isAwbLayout(next)) {
                        setLayout(next);
                        touch();
                      }
                    }}
                    disabled={pending}
                    aria-label={copy.layout}
                  >
                    {AWB_LAYOUTS.map((item) => (
                      <FieldLabel key={item.value} htmlFor={`layout-${item.value}`}>
                        <Field orientation="horizontal">
                          <RadioGroupItem id={`layout-${item.value}`} value={item.value} />
                          <FieldContent>
                            <FieldTitle>{m.settings.layouts[item.value]}</FieldTitle>
                          </FieldContent>
                        </Field>
                      </FieldLabel>
                    ))}
                  </RadioGroup>
                  {fieldErrors.awbLayout ? <FieldError>{fieldErrors.awbLayout}</FieldError> : null}
                </Field>
              ) : null}
            </FieldGroup>
          </CardContent>
          <SaveBar pending={pending} state={state} />
        </Card>
      </form>

      <Card className="min-w-0 bg-muted/40">
        <CardHeader>
          <CardTitle>{copy.previewTitle}</CardTitle>
          <CardDescription>{copy.previewDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <AwbPreview
            format={format}
            layout={layout}
            language={language}
            merchantName={profile.companyName || undefined}
            returnLocation={
              profile.preferences.returnAddress ||
              profile.preferences.pickupAddress ||
              undefined
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}

export function SettingsIntro() {
  const { m } = useLocale();
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-bold tracking-tight">{m.settings.title}</h1>
      <p className="text-muted-foreground text-sm">{m.settings.subtitle}</p>
    </div>
  );
}

export function SettingsUnavailable() {
  const { m } = useLocale();
  return (
    <div className="flex flex-col gap-6">
      <SettingsIntro />
      <p
        role="alert"
        className="border-destructive/30 bg-destructive/5 text-destructive rounded-xl border px-4 py-3 text-sm"
      >
        {m.settings.loadError}
      </p>
    </div>
  );
}

export function SettingsHub({ profile }: { profile: MerchantProfile }) {
  const { m } = useLocale();
  const tabs = m.settings.tabs;
  return (
    <Tabs defaultValue="platform" className="gap-6">
      <TabsList className="h-auto w-full flex-wrap justify-start">
        <TabsTrigger value="platform" className="px-4 py-2">
          <SlidersHorizontal />
          {tabs.platform}
        </TabsTrigger>
        <TabsTrigger value="shipping" className="px-4 py-2">
          <Truck />
          {tabs.shipping}
        </TabsTrigger>
        <TabsTrigger value="personal" className="px-4 py-2">
          <UserRound />
          {tabs.personal}
        </TabsTrigger>
        <TabsTrigger value="company" className="px-4 py-2">
          <Building2 />
          {tabs.company}
        </TabsTrigger>
        <TabsTrigger value="team" className="px-4 py-2">
          <Users />
          {tabs.team}
        </TabsTrigger>
        <TabsTrigger value="awb" className="px-4 py-2">
          <Printer />
          {tabs.awb}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="platform">
        <PlatformForm profile={profile} />
      </TabsContent>
      <TabsContent value="shipping">
        <ShippingForm profile={profile} />
      </TabsContent>
      <TabsContent value="personal">
        <PersonalForm profile={profile} />
      </TabsContent>
      <TabsContent value="company">
        <CompanyForm profile={profile} />
      </TabsContent>
      <TabsContent value="team">
        <TeamForm profile={profile} />
      </TabsContent>
      <TabsContent value="awb">
        <AwbForm profile={profile} />
      </TabsContent>
    </Tabs>
  );
}
