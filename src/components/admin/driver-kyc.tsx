"use client";

import { Camera, CarFront, IdCard, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  KYC_STATUSES,
  KYC_STATUS_LABEL,
  PHONE_PLACEHOLDER,
  VEHICLE_TYPES,
  vehicleLabel,
  cashCustodyExceeded,
  formatSdg,
  type KycStatus,
  type VehicleType,
} from "@/lib/locale/sudan";
import type { StaffRow } from "@/lib/data/admin-ops";
import { cn } from "@/lib/utils";

export function CashCustodyBar({
  current,
  max,
}: {
  current: number;
  max: number;
}) {
  const blocked = cashCustodyExceeded(current, max);
  const ratio = max <= 0 ? (current > 0 ? 1 : 0) : Math.min(1, current / max);
  const width = `${Math.round(ratio * 100)}%`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium">العهدة الحالية</span>
        <span dir="ltr" className="tabular-nums">
          {formatSdg(current)} / {formatSdg(max)}
        </span>
      </div>
      <div
        className="bg-zinc-200 h-2.5 overflow-hidden rounded-full"
        role="meter"
        aria-label="العهدة الحالية"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={current}
      >
        <div
          className={cn("h-full rounded-full", blocked ? "bg-red-600" : "bg-brand")}
          style={{ width }}
        />
      </div>
      {blocked ? (
        <p role="alert" className="flex items-start gap-2 text-sm leading-relaxed text-red-700">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          تجاوز المندوب سقف العهدة النقدية. ممنوع من استلام شحنات الدفع عند الاستلام الجديدة.
        </p>
      ) : null}
    </div>
  );
}

const DOCUMENTS = [
  { title: "صورة سيلفي مباشرة", hint: "تُلتقط من كاميرا المندوب عند التحقق.", icon: Camera },
  { title: "البطاقة القومية", hint: "وجه البطاقة واضح وبدون قص.", icon: IdCard },
  { title: "رخصة المركبة", hint: "رخصة سارية باسم المندوب أو مالك المركبة.", icon: CarFront },
] as const;

export function KycDocuments() {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {DOCUMENTS.map((document) => {
        const Icon = document.icon;
        return (
          <div
            key={document.title}
            className="flex flex-col gap-3 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-4"
          >
            <Icon className="text-muted-foreground size-5" />
            <div>
              <p className="text-sm font-semibold">{document.title}</p>
              <p className="text-muted-foreground mt-1 text-xs leading-relaxed">{document.hint}</p>
            </div>
            <Button type="button" variant="outline" disabled className="mt-auto">
              رفع الملف
            </Button>
          </div>
        );
      })}
    </div>
  );
}

export function DriverKycFields({
  vehicleType,
  emergencyPhone,
  kycStatus,
  maxCashLimit,
  onVehicleType,
  onEmergencyPhone,
  onKycStatus,
  onMaxCashLimit,
}: {
  vehicleType: VehicleType | "";
  emergencyPhone: string;
  kycStatus: KycStatus;
  maxCashLimit: string;
  onVehicleType: (value: VehicleType) => void;
  onEmergencyPhone: (value: string) => void;
  onKycStatus: (value: KycStatus) => void;
  onMaxCashLimit: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border p-4">
      <div>
        <p className="text-sm font-semibold">التحقق والعهدة</p>
        <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
          نوع المركبة، رقم الطوارئ، وسقف النقد الذي يجوز للمندوب حمله.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">نوع المركبة</span>
        <div role="radiogroup" aria-label="نوع المركبة" className="grid gap-2 sm:grid-cols-3">
          {VEHICLE_TYPES.map((type) => {
            const active = vehicleType === type;
            return (
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onVehicleType(type)}
                className={cn(
                  "rounded-xl border px-3 py-2 text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  active ? "border-brand bg-brand/10 ring-brand/30 ring-2" : "bg-card hover:bg-muted/60",
                )}
              >
                {vehicleLabel(type)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-2 text-sm font-medium">
          رقم الطوارئ
          <Input
            dir="ltr"
            inputMode="tel"
            value={emergencyPhone}
            onChange={(event) => onEmergencyPhone(event.target.value)}
            placeholder={PHONE_PLACEHOLDER}
            className="h-10 text-start"
          />
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium">
          سقف العهدة (ج.س)
          <Input
            dir="ltr"
            inputMode="numeric"
            value={maxCashLimit}
            onChange={(event) => onMaxCashLimit(event.target.value)}
            className="h-10 text-start"
          />
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">حالة التحقق</span>
        <div role="radiogroup" aria-label="حالة التحقق" className="flex flex-wrap gap-2">
          {KYC_STATUSES.map((status) => {
            const active = kycStatus === status;
            return (
              <button
                key={status}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onKycStatus(status)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  active ? "border-brand bg-brand/10" : "bg-card",
                )}
              >
                {KYC_STATUS_LABEL[status]}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function DriverProfileBody({ staff }: { staff: StaffRow }) {
  const fieldDriver = staff.staffType !== "hub_operator";
  return (
    <div className="flex flex-col gap-5 px-6 py-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">{staff.fullName}</p>
        {staff.kycStatus ? (
          <span className="bg-muted rounded-full px-3 py-1 text-xs font-medium">
            {KYC_STATUS_LABEL[staff.kycStatus]}
          </span>
        ) : (
          <span className="text-muted-foreground text-xs">لم تُسجَّل حالة التحقق بعد</span>
        )}
      </div>
      {fieldDriver ? (
        <CashCustodyBar current={staff.currentCashInHand} max={staff.maxCashLimit} />
      ) : (
        <p className="text-muted-foreground text-sm">موظفو المخزن لا يحملون عهدة تحصيل.</p>
      )}
      {fieldDriver ? (
        <p className="text-sm">
          <span className="text-muted-foreground">المركبة الحالية: </span>
          <span className="font-semibold">
            {staff.activeVehicle
              ? vehicleLabel(staff.activeVehicle)
              : staff.vehicleType
                ? vehicleLabel(staff.vehicleType)
                : "—"}
          </span>
        </p>
      ) : null}
      <div>
        <p className="mb-3 text-sm font-semibold">مستندات التحقق</p>
        <KycDocuments />
      </div>
    </div>
  );
}
