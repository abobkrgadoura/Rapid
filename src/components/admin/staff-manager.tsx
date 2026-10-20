"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Ban,
  Banknote,
  CircleCheck,
  IdCard,
  Loader2,
  MapPin,
  MoreVertical,
  Package,
  Pencil,
  Phone,
  Plus,
  Search,
  Trash2,
  TriangleAlert,
  UserCheck,
} from "lucide-react";

import { useAdminPrefs } from "@/components/admin/admin-prefs";
import {
  createStaff,
  deactivateStaff,
  deleteStaff,
  reactivateStaff,
  updateStaff,
} from "@/actions/admin";
import { AdminDialog } from "@/components/admin/admin-modal";
import {
  CashCustodyBar,
  DriverKycFields,
  DriverProfileBody,
} from "@/components/admin/driver-kyc";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { toastError, toastSuccess } from "@/components/ui/toast";
import {
  isStaffType,
  STAFF_TYPE_OPTION_LABEL,
  STAFF_TYPES,
  staffTypeLabel,
  type StaffType,
} from "@/lib/admin/labels";
import { ADMIN_ERROR_MESSAGES, type AdminErrorCode } from "@/lib/admin/types";
import { formatPhoneInput } from "@/lib/auth/identifier";
import type { StaffDirectory, StaffRow } from "@/lib/data/admin-ops";
import { formatMoney } from "@/lib/format-money";
import {
  KYC_STATUS_LABEL,
  PHONE_PLACEHOLDER,
  SUDAN_HUBS,
  type KycStatus,
  type VehicleType,
} from "@/lib/locale/sudan";
import { cn } from "@/lib/utils";

const TYPE_TONE: Record<StaffType | "generic", string> = {
  delivery_driver: "bg-sky-100 text-sky-900 border-sky-200",
  pickup_driver: "bg-violet-100 text-violet-900 border-violet-200",
  hub_operator: "bg-indigo-100 text-indigo-900 border-indigo-200",
  generic: "bg-zinc-100 text-zinc-800 border-zinc-200",
};

type TypeFilter = "all" | StaffType;
type StatusFilter = "all" | "active" | "suspended";

type FormState =
  | { mode: "add" }
  | { mode: "edit"; staff: StaffRow }
  | null;

type Confirm = { kind: "deactivate" | "delete"; staff: StaffRow } | null;

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "؟";
  const first = Array.from(words[0])[0] ?? "؟";
  const second = words[1] ? (Array.from(words[1])[0] ?? "") : "";
  return `${first}${second}`;
}

export function StaffManager({
  directory,
  defaultMaxCash,
}: {
  directory: StaffDirectory;
  defaultMaxCash: number;
}) {
  const router = useRouter();
  const { copy } = useAdminPrefs();
  const staffCopy = copy.staff;
  const [refreshing, startRefresh] = useTransition();
  const refresh = () => startRefresh(() => router.refresh());

  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<FormState>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [profile, setProfile] = useState<StaffRow | null>(null);

  const rows = directory.rows;
  const needle = query.trim().toLowerCase();

  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        if (typeFilter !== "all" && row.staffType !== typeFilter) return false;
        if (statusFilter === "active" && !row.isActive) return false;
        if (statusFilter === "suspended" && row.isActive) return false;
        if (!needle) return true;
        return [row.fullName, row.email, row.phone, row.hubZone ?? ""].some((value) =>
          value.toLowerCase().includes(needle),
        );
      }),
    [rows, typeFilter, statusFilter, needle],
  );

  const activeCount = rows.filter((row) => row.isActive).length;
  const suspendedCount = rows.length - activeCount;

  const typeChips: ReadonlyArray<{ id: TypeFilter; label: string }> = [
    { id: "all", label: staffCopy.all },
    { id: "delivery_driver", label: staffCopy.delivery },
    { id: "pickup_driver", label: staffCopy.pickup },
    { id: "hub_operator", label: staffCopy.hub },
  ];

  return (
    <div className={cn("flex flex-col gap-6 transition-opacity", refreshing && "opacity-70")}>
      {directory.migrationApplied ? null : (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
        >
          <TriangleAlert className="mt-0.5 size-5 shrink-0" />
          <p className="leading-relaxed">
            لم يُطبَّق ملف قاعدة البيانات{" "}
            <span dir="ltr" className="font-mono font-semibold">
              0007_phase11_staff_management.sql
            </span>{" "}
            بعد. تظهر القائمة بدون النوع والمنطقة والحالة، ولن تعمل الإضافة والتعديل والإيقاف
            والحذف حتى يُطبَّق.
          </p>
        </div>
      )}

      {directory.migrationApplied && !directory.kycApplied ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
        >
          <TriangleAlert className="mt-0.5 size-5 shrink-0" />
          <p className="leading-relaxed">
            بيانات التحقق وسقف العهدة تُحفظ بعد تطبيق{" "}
            <span dir="ltr" className="font-mono font-semibold">
              0008_phase11_5_sudan_kyc.sql
            </span>
            . يمكن تعديل الاسم والهاتف الآن، وتظهر العهدة بقيمها الافتراضية.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid grid-cols-3 gap-3 sm:flex">
          <Summary label={staffCopy.total} value={rows.length} />
          <Summary label={staffCopy.active} value={activeCount} tone="good" />
          <Summary label={staffCopy.suspended} value={suspendedCount} tone={suspendedCount > 0 ? "bad" : "muted"} />
        </div>
        <Button
          type="button"
          variant="brand"
          size="lg"
          className="h-11 gap-2 rounded-xl px-5 font-bold"
          onClick={() => setForm({ mode: "add" })}
        >
          <Plus className="size-4" strokeWidth={3} />
          {staffCopy.add}
        </Button>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute inset-y-0 start-3 my-auto size-4" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={staffCopy.searchPlaceholder}
            aria-label={staffCopy.searchLabel}
            className="h-11 ps-9"
          />
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label={staffCopy.filterType}>
          {typeChips.map((chip) => (
            <Chip
              key={chip.id}
              active={typeFilter === chip.id}
              onClick={() => setTypeFilter(chip.id)}
            >
              {chip.label}
            </Chip>
          ))}
        </div>
        <div className="flex gap-2" role="group" aria-label={staffCopy.filterStatus}>
          <Chip active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>
            {staffCopy.allStatuses}
          </Chip>
          <Chip active={statusFilter === "active"} onClick={() => setStatusFilter("active")}>
            {staffCopy.active}
          </Chip>
          <Chip active={statusFilter === "suspended"} onClick={() => setStatusFilter("suspended")}>
            {staffCopy.suspended}
          </Chip>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted-foreground rounded-2xl border border-dashed px-4 py-12 text-center text-sm">
          {rows.length === 0
            ? "لا يوجد مناديب أو موظفون بعد. أضف أول عضو في الطاقم."
            : "لا توجد نتائج تطابق التصفية."}
        </p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((staff) => (
            <li key={staff.id}>
              <StaffCard
                staff={staff}
                onEdit={() => setForm({ mode: "edit", staff })}
                onDeactivate={() => setConfirm({ kind: "deactivate", staff })}
                onDelete={() => setConfirm({ kind: "delete", staff })}
                onProfile={() => setProfile(staff)}
                onReactivated={refresh}
              />
            </li>
          ))}
        </ul>
      )}

      <StaffFormDialog
        state={form}
        defaultMaxCash={defaultMaxCash}
        onClose={() => setForm(null)}
        onSaved={() => {
          setForm(null);
          refresh();
        }}
      />
      <AdminDialog
        open={profile !== null}
        onOpenChange={(open) => {
          if (!open) setProfile(null);
        }}
        title="ملف المندوب والتحقق"
        description="مستندات الهوية والمركبة، ومقارنة العهدة الحالية بالسقف."
        className="max-w-3xl"
      >
        {profile ? <DriverProfileBody key={profile.id} staff={profile} /> : null}
      </AdminDialog>

      <ConfirmDialog
        confirm={confirm}
        onClose={() => setConfirm(null)}
        onDone={() => {
          setConfirm(null);
          refresh();
        }}
        onSwitchToDeactivate={(staff) => setConfirm({ kind: "deactivate", staff })}
      />
    </div>
  );
}

function Summary({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: number;
  tone?: "good" | "bad" | "muted";
}) {
  const color =
    tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-destructive" : "text-foreground";
  return (
    <div className="bg-card min-w-28 rounded-2xl border px-4 py-2.5 text-center">
      <p className={cn("text-xl font-bold tabular-nums", color)}>{value}</p>
      <p className="text-muted-foreground text-xs">{label}</p>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "pointer-events-auto min-h-11 cursor-pointer touch-manipulation rounded-full border px-3.5 py-2 text-xs font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
        active
          ? "bg-ink-950 border-ink-950 text-white"
          : "bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function StaffCard({
  staff,
  onEdit,
  onDeactivate,
  onDelete,
  onProfile,
  onReactivated,
}: {
  staff: StaffRow;
  onEdit: () => void;
  onDeactivate: () => void;
  onDelete: () => void;
  onProfile: () => void;
  onReactivated: () => void;
}) {
  const { copy } = useAdminPrefs();
  const staffCopy = copy.staff;
  const [busy, setBusy] = useState(false);
  const tone = TYPE_TONE[staff.staffType ?? "generic"];

  async function reactivate() {
    setBusy(true);
    try {
      const result = await reactivateStaff(staff.id);
      if (result.ok) {
        toastSuccess("تم تفعيل الحساب", staff.fullName);
        onReactivated();
      } else {
        toastError("تعذّر تفعيل الحساب", ADMIN_ERROR_MESSAGES[result.error]);
      }
    } catch {
      toastError("تعذّر تفعيل الحساب", ADMIN_ERROR_MESSAGES.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      className={cn(
        "bg-card flex h-full flex-col gap-4 rounded-2xl border p-5 shadow-sm",
        !staff.isActive && "bg-zinc-50",
      )}
    >
      <header className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold",
            staff.isActive ? "bg-ink-950 text-gold" : "bg-zinc-200 text-zinc-500",
          )}
        >
          {initialsOf(staff.fullName)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h3
            className={cn(
              "truncate text-base leading-tight font-bold",
              !staff.isActive && "text-muted-foreground",
            )}
          >
            {staff.fullName}
          </h3>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn("rounded-full border px-2.5 py-0.5 text-xs font-medium", tone)}>
              {staffTypeLabel(staff.staffType)}
            </span>
            {staff.isActive ? (
              <span className="flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
                <CircleCheck className="size-3" />
                نشط
              </span>
            ) : (
              <span className="flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-800">
                <Ban className="size-3" />
                موقوف
              </span>
            )}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={staffCopy.actions(staff.fullName)}
            className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-8 shrink-0 items-center justify-center rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <MoreVertical className="size-4" />}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuItem onClick={onProfile}>
              <IdCard />
              {staffCopy.profile}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onEdit}>
              <Pencil />
              {staffCopy.edit}
            </DropdownMenuItem>
            {staff.isActive ? (
              <DropdownMenuItem onClick={onDeactivate}>
                <Ban />
                {staffCopy.deactivate}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={reactivate} disabled={busy}>
                <UserCheck />
                {staffCopy.reactivate}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 />
              {staffCopy.delete}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <dl className="text-muted-foreground flex flex-col gap-1.5 text-xs">
        <div className="flex items-center gap-2">
          <MapPin className="size-3.5 shrink-0" />
          <dt className="sr-only">المنطقة</dt>
          <dd>{staff.hubZone ?? "لم تُحدد منطقة"}</dd>
        </div>
        <div className="flex items-center gap-2">
          <Phone className="size-3.5 shrink-0" />
          <dt className="sr-only">الهاتف</dt>
          <dd dir="ltr">{staff.phone || "—"}</dd>
        </div>
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="w-3.5 shrink-0 text-center">@</span>
          <dt className="sr-only">البريد</dt>
          <dd dir="ltr" className="truncate">
            {staff.email || "—"}
          </dd>
        </div>
      </dl>

      <div className="mt-auto grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-zinc-50 px-3 py-2.5">
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <Package className="size-3.5" />
            شحنات نشطة
          </p>
          <p className="mt-1 text-lg font-bold tabular-nums">{staff.activeShipments}</p>
        </div>
        <div className="rounded-xl bg-zinc-50 px-3 py-2.5">
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <Banknote className="size-3.5" />
            عهدة COD
          </p>
          <p
            dir="ltr"
            className={cn(
              "mt-1 text-start text-lg font-bold tabular-nums",
              staff.custody !== "0.00" && "text-destructive",
            )}
          >
            {formatMoney(staff.custody, staff.currency)}
          </p>
        </div>
      </div>
      {staff.staffType === "hub_operator" ? null : (
        <div className="flex flex-col gap-2">
          {staff.kycStatus ? (
            <p className="text-muted-foreground text-xs">
              التحقق: {KYC_STATUS_LABEL[staff.kycStatus]}
              {staff.vehicleType ? ` · ${staff.vehicleType}` : ""}
            </p>
          ) : null}
          <CashCustodyBar current={staff.currentCashInHand} max={staff.maxCashLimit} />
        </div>
      )}
    </article>
  );
}

function Label({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="text-sm font-medium">
      {children}
    </label>
  );
}

function StaffFormDialog({
  state,
  defaultMaxCash,
  onClose,
  onSaved,
}: {
  state: FormState;
  defaultMaxCash: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { copy } = useAdminPrefs();
  return (
    <AdminDialog
      open={state !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={state?.mode === "edit" ? copy.staff.editTitle : copy.staff.addTitle}
      description={
        state?.mode === "edit"
          ? "عدّل الاسم والهاتف والمنطقة والنوع، ونوع المركبة ورقم الطوارئ وسقف العهدة. البريد وكلمة المرور لا يتغيران من هنا."
          : "أنشئ حسابًا جديدًا بصلاحياته، مع بيانات المركبة والطوارئ وسقف العهدة."
      }
    >
      {state ? (
        <StaffForm
          key={state.mode === "edit" ? state.staff.id : "add"}
          state={state}
          defaultMaxCash={defaultMaxCash}
          onCancel={onClose}
          onSaved={onSaved}
        />
      ) : null}
    </AdminDialog>
  );
}

function StaffForm({
  state,
  defaultMaxCash,
  onCancel,
  onSaved,
}: {
  state: NonNullable<FormState>;
  defaultMaxCash: number;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { copy } = useAdminPrefs();
  const staffCopy = copy.staff;
  const editing = state.mode === "edit" ? state.staff : null;
  const [fullName, setFullName] = useState(editing?.fullName ?? "");
  const [phone, setPhone] = useState(editing?.phone ?? "");
  const [email, setEmail] = useState(editing?.email ?? "");
  const [password, setPassword] = useState("");
  const [hubZone, setHubZone] = useState(editing?.hubZone ?? "");
  const [staffType, setStaffType] = useState<StaffType | "">(editing?.staffType ?? "");
  const [vehicleType, setVehicleType] = useState<VehicleType | "">(editing?.vehicleType ?? "");
  const [emergencyPhone, setEmergencyPhone] = useState(editing?.emergencyPhone ?? "");
  const [kycStatus, setKycStatus] = useState<KycStatus>(editing?.kycStatus ?? "pending");
  const [maxCashLimit, setMaxCashLimit] = useState(
    String(editing?.maxCashLimit ?? defaultMaxCash),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fieldDriver = staffType === "delivery_driver" || staffType === "pickup_driver";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (!isStaffType(staffType)) {
      setError(ADMIN_ERROR_MESSAGES.invalid_staff_type);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const kyc = {
        vehicleType,
        emergencyPhone,
        kycStatus,
        maxCashLimit,
      };
      if (editing) {
        const result = await updateStaff(editing.id, { fullName, phone, hubZone, staffType, ...kyc });
        if (!result.ok) {
          setError(ADMIN_ERROR_MESSAGES[result.error]);
          return;
        }
        toastSuccess(
          "تم حفظ التعديلات",
          result.kycSaved ? fullName.trim() : "الاسم والهاتف حُفظا. التحقق والعهدة ينتظران ملف 0008.",
        );
      } else {
        const result = await createStaff({
          fullName,
          phone,
          email,
          password,
          hubZone,
          staffType,
          ...kyc,
        });
        if (!result.ok) {
          setError(ADMIN_ERROR_MESSAGES[result.error]);
          return;
        }
        toastSuccess(
          result.mode === "created" ? "تمت إضافة الحساب" : "تم ربط الحساب بالطاقم",
          result.kycSaved ? fullName.trim() : "الحساب أُضيف. التحقق والعهدة ينتظران ملف 0008.",
        );
      }
      onSaved();
    } catch {
      setError(ADMIN_ERROR_MESSAGES.failed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5 px-6 py-5">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">نوع المندوب / الموظف</span>
        <div role="radiogroup" aria-label="نوع المندوب / الموظف" className="grid gap-2 sm:grid-cols-3">
          {STAFF_TYPES.map((type, index) => {
            const active = staffType === type;
            return (
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setStaffType(type)}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-xl border p-3 text-start text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                  active
                    ? "border-brand bg-brand/10 text-foreground ring-brand/30 ring-2"
                    : "bg-card hover:bg-muted/60",
                )}
              >
                <span className="text-muted-foreground text-xs">{index + 1}</span>
                <span className="font-semibold">{STAFF_TYPE_OPTION_LABEL[type]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="staff-name">الاسم بالكامل</Label>
        <Input
          id="staff-name"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          autoComplete="off"
          className="h-10"
          required
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="staff-phone">رقم الهاتف</Label>
          <Input
            id="staff-phone"
            type="tel"
            dir="ltr"
            inputMode="tel"
            value={phone}
            onChange={(event) => setPhone(formatPhoneInput(event.target.value))}
            onBlur={() => setPhone((current) => formatPhoneInput(current, true))}
            autoComplete="tel"
            autoCorrect="off"
            spellCheck={false}
            className="h-10 text-left"
            placeholder={PHONE_PLACEHOLDER}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="staff-zone">المنطقة / المخزن</Label>
          <Input
            id="staff-zone"
            list="staff-zone-options"
            value={hubZone}
            onChange={(event) => setHubZone(event.target.value)}
            autoComplete="off"
            className="h-10"
            placeholder="ولاية الخرطوم - المخزن الرئيسي"
            required
          />
          <datalist id="staff-zone-options">
            {SUDAN_HUBS.map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
        </div>
      </div>

      {fieldDriver ? (
        <DriverKycFields
          vehicleType={vehicleType}
          emergencyPhone={emergencyPhone}
          kycStatus={kycStatus}
          maxCashLimit={maxCashLimit}
          onVehicleType={setVehicleType}
          onEmergencyPhone={setEmergencyPhone}
          onKycStatus={setKycStatus}
          onMaxCashLimit={setMaxCashLimit}
        />
      ) : null}

      {editing ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="staff-email">البريد الإلكتروني</Label>
          <Input
            id="staff-email"
            dir="ltr"
            value={email}
            disabled
            className="h-10 text-start"
            readOnly
          />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="staff-email">البريد الإلكتروني (اختياري)</Label>
            <Input
              id="staff-email"
              dir="ltr"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="off"
              className="h-10 text-left"
              placeholder="driver@example.com"
            />
            <p className="text-muted-foreground text-xs leading-relaxed">
              الدخول يكون برقم الهاتف. أضف بريدًا فقط إذا أردت وسيلة دخول ثانية.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="staff-password">كلمة المرور</Label>
            <Input
              id="staff-password"
              dir="ltr"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              className="h-10 text-left"
              placeholder="8 أحرف على الأقل"
            />
            <p className="text-muted-foreground text-xs leading-relaxed">
              كلمة مرور مؤقتة يسلّمها المدير للمندوب، ويغيّرها بعد أول دخول.
            </p>
          </div>
        </div>
      )}

      <div aria-live="polite">
        {error ? (
          <p role="alert" className="bg-destructive/10 text-destructive rounded-xl px-4 py-3 text-sm leading-relaxed">
            {error}
          </p>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          {staffCopy.cancel}
        </Button>
        <Button
          type="submit"
          variant="brand"
          size="lg"
          className="h-10 gap-2 px-6 font-bold"
          disabled={saving}
        >
          {saving ? <Loader2 className="animate-spin" /> : null}
          {editing ? staffCopy.save : staffCopy.create}
        </Button>
      </div>
    </form>
  );
}

function ConfirmDialog({
  confirm,
  onClose,
  onDone,
  onSwitchToDeactivate,
}: {
  confirm: Confirm;
  onClose: () => void;
  onDone: () => void;
  onSwitchToDeactivate: (staff: StaffRow) => void;
}) {
  const { copy } = useAdminPrefs();
  return (
    <AdminDialog
      open={confirm !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={confirm?.kind === "delete" ? copy.staff.deleteTitle : copy.staff.deactivateTitle}
      className="max-w-md"
    >
      {confirm ? (
        <ConfirmBody
          key={`${confirm.kind}-${confirm.staff.id}`}
          confirm={confirm}
          onCancel={onClose}
          onDone={onDone}
          onSwitchToDeactivate={onSwitchToDeactivate}
        />
      ) : null}
    </AdminDialog>
  );
}

function ConfirmBody({
  confirm,
  onCancel,
  onDone,
  onSwitchToDeactivate,
}: {
  confirm: NonNullable<Confirm>;
  onCancel: () => void;
  onDone: () => void;
  onSwitchToDeactivate: (staff: StaffRow) => void;
}) {
  const { kind, staff } = confirm;
  const { copy } = useAdminPrefs();
  const staffCopy = copy.staff;
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<AdminErrorCode | null>(null);

  async function run() {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      const result = kind === "delete" ? await deleteStaff(staff.id) : await deactivateStaff(staff.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      const released = result.releasedDelivery + result.releasedPickup + result.repooledPickup;
      const detail =
        released > 0
          ? `أُعيدت ${released} شحنة إلى قائمة التوزيع.`
          : "لا توجد شحنات نشطة معه.";
      toastSuccess(kind === "delete" ? "تم حذف المندوب" : "تم إيقاف الحساب", `${staff.fullName} — ${detail}`);
      onDone();
    } catch {
      setError("failed");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      {kind === "delete" ? (
        <>
          <p className="text-base font-bold">هل أنت متأكد من حذف هذا المندوب؟</p>
          <p className="text-muted-foreground text-sm leading-relaxed">
            سيُحذف حساب <span className="text-foreground font-semibold">{staff.fullName}</span>{" "}
            ومحفظته نهائيًا، وتعود شحناته غير المكتملة إلى قائمة التوزيع. لا يمكن حذف مندوب له
            سجل مالي أو شحنات مُسلَّمة؛ أوقف حسابه بدلًا من ذلك.
          </p>
        </>
      ) : (
        <>
          <p className="text-base font-bold">إيقاف حساب {staff.fullName}؟</p>
          <ul className="text-muted-foreground flex list-disc flex-col gap-1.5 ps-5 text-sm leading-relaxed">
            <li>يفقد المندوب صلاحية الدخول وأي عملية تشغيل فورًا.</li>
            <li>
              تعود شحناته غير المسلَّمة إلى قائمة التوزيع
              {staff.activeShipments > 0 ? ` (حاليًا ${staff.activeShipments} شحنة)` : ""}.
            </li>
            <li>تبقى سجلات الشحنات والمحفظة والقيود المالية كما هي.</li>
            {staff.custody !== "0.00" ? (
              <li className="text-destructive font-medium">
                عليه عهدة نقدية {formatMoney(staff.custody, staff.currency)} يجب تسويتها.
              </li>
            ) : null}
          </ul>
        </>
      )}

      <div aria-live="polite">
        {error ? (
          <div role="alert" className="bg-destructive/10 text-destructive flex flex-col gap-2 rounded-xl px-4 py-3 text-sm leading-relaxed">
            <p>{ADMIN_ERROR_MESSAGES[error]}</p>
            {error === "has_history" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() => onSwitchToDeactivate(staff)}
              >
                {staffCopy.deleteInstead}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={working}>
          {staffCopy.cancel}
        </Button>
        <Button
          type="button"
          variant={kind === "delete" ? "destructive" : "brand"}
          size="lg"
          className="h-10 gap-2 px-5 font-bold"
          disabled={working}
          onClick={run}
        >
          {working ? <Loader2 className="animate-spin" /> : kind === "delete" ? <Trash2 /> : <Ban />}
          {kind === "delete" ? staffCopy.confirmDelete : staffCopy.confirmDeactivate}
        </Button>
      </div>
    </div>
  );
}
