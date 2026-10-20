"use client";

import {
  Calendar,
  Car,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  FileText,
  HelpCircle,
  Home,
  Lock,
  LogOut,
  Mail,
  Map as MapIcon,
  MapPin,
  Package,
  PackageCheck,
  Phone,
  ScanBarcode,
  Scale,
  Search,
  ShieldCheck,
  User,
  X,
} from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";

import { useDriverName, useDriverProfile } from "@/components/driver/driver-frame";
import { DriverTopBar, iconButton } from "@/components/driver/driver-top-bar";
import { PickupFeedbackContext, type PickupNotice } from "@/components/driver/pickup/pickup-feedback";
import { PickupMerchantCard } from "@/components/driver/pickup/pickup-merchant-card";
import { PickupScanner } from "@/components/driver/pickup/pickup-scanner";
import { useDriverPrefs } from "@/components/driver/preferences";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { signOut } from "@/lib/auth/actions";
import type { SessionProfile } from "@/lib/auth/profile";
import type { DriverAlert, PickupMerchant } from "@/lib/data/driver-dashboard";
import { navigationHref } from "@/lib/driver/navigation";
import {
  isShipmentVisible,
  khartoumDay,
  matchesShipmentFilter,
  SHIPMENT_TAB_LABEL,
  SHIPMENT_TAB_STYLE,
  shipmentTab,
  isUrgentShipment,
  type PickupShipment,
  type PickupShipmentTab,
  type TaskFilter,
} from "@/lib/driver/pickup-shipments";

/**
 * Pickup driver app shell: home, tasks, map and profile. Deliveries are not
 * mixed into these screens, and no customer data reaches them.
 */

type TaskMode = "merchants" | "shipments";

const TASK_FILTERS: ReadonlyArray<{ id: TaskFilter; label: string }> = [
  { id: "all", label: "الكل" },
  { id: "urgent", label: "عاجلة" },
  { id: "new", label: "جديدة" },
  { id: "waiting", label: "قيد الانتظار" },
  { id: "picked", label: "تم الاستلام" },
  { id: "cancelled", label: "ملغاة" },
];

const CITY_NEEDLES = [
  "بورتسودان",
  "ود مدني",
  "عطبرة",
  "كسلا",
  "القضارف",
  "سنار",
  "كوستي",
  "الدمازين",
  "الأبيض",
  "نيالا",
  "الفاشر",
  "الجنينة",
  "دنقلا",
] as const;

/** City shown in the tasks filter. Khartoum localities stay under الخرطوم. */
function cityOf(merchant: PickupMerchant): string {
  const text = `${merchant.address} ${merchant.zone}`;
  if (
    text.includes("الخرطوم") ||
    text.includes("بحري") ||
    text.includes("أم درمان") ||
    text.includes("ام درمان") ||
    text.includes("شرق النيل")
  ) {
    return "الخرطوم";
  }
  for (const needle of CITY_NEEDLES) {
    if (text.includes(needle)) return needle;
  }
  return merchant.zone.replace(/^ولاية\s+/, "").trim();
}

/** Neighborhood when the address names one, otherwise the stored zone. */
function areaOf(merchant: PickupMerchant): string {
  for (const needle of ["شرق النيل", "أم درمان", "ام درمان", "بحري"] as const) {
    if (merchant.address.includes(needle)) return needle === "ام درمان" ? "أم درمان" : needle;
  }
  const zone = merchant.zone.trim();
  if (!zone || zone === "منطقة غير محددة") return "";
  return zone;
}

function uniqueLabels(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right, "ar"));
}

/**
 * Every merchant on this screen is still an open pickup, so "الكل" and
 * "قيد الانتظار" show the same rows. "جديدة" is only a request dated today.
 * Picked-up and cancelled rows are not on the dashboard payload.
 */
function matchesTaskFilter(merchant: PickupMerchant, filter: TaskFilter, today: string | null): boolean {
  if (filter === "all" || filter === "waiting") return true;
  if (filter === "picked" || filter === "cancelled") return false;
  const day = merchant.requestedAt ? khartoumDay(merchant.requestedAt) : null;
  // YYYY-MM-DD strings sort chronologically. Urgent = oldest request is before today.
  if (filter === "urgent") return day !== null && today !== null && day < today;
  return day !== null && day === today;
}

function FilterSelect({
  value,
  onChange,
  label,
  options,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  options: Array<{ value: string; label: string }>;
}) {
  const shown = options.find((option) => option.value === value)?.label ?? label;
  return (
    <label className="relative flex h-14 flex-1 items-center justify-between rounded-2xl border border-gray-100 bg-white px-4 text-sm font-semibold text-[#082D52] shadow-sm">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        className="absolute inset-0 z-10 h-full w-full cursor-pointer appearance-none bg-transparent px-4 text-sm font-semibold text-transparent outline-none [&>option]:text-[#082D52]"
      >
        <option value="">{label}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none truncate">{shown}</span>
      <ChevronDown className="pointer-events-none relative z-20 size-4 shrink-0" aria-hidden />
    </label>
  );
}

/**
 * One of this driver's shipments. Logistics and merchant fields only: the
 * `PickupShipment` type has no customer name, phone or dropoff location.
 */
function ShipmentCard({
  shipment,
  today,
}: {
  shipment: PickupShipment;
  today: string | null;
}) {
  const tab = shipmentTab(shipment);
  const urgent = isUrgentShipment(shipment, today);

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span dir="ltr" className="font-mono text-base font-bold text-[#082D52]">
          {shipment.trackingCode}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {urgent ? (
            <span className="rounded-full bg-[#FDECEC] px-3 py-1 text-xs font-bold text-red-500">
              عاجلة
            </span>
          ) : null}
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${SHIPMENT_TAB_STYLE[tab]}`}>
            {SHIPMENT_TAB_LABEL[tab]}
          </span>
        </span>
      </div>
      <p className="truncate text-sm font-bold text-gray-700">{shipment.merchantName}</p>
      {shipment.pickupAddress ? (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-500">
          <MapPin className="size-4 shrink-0 text-gray-400" aria-hidden />
          <span className="min-w-0 truncate">{shipment.pickupAddress}</span>
        </p>
      ) : null}
      <div className="flex items-center gap-4 text-xs font-semibold text-gray-500">
        <span className="flex items-center gap-1.5">
          <Scale className="size-4 text-gray-400" aria-hidden />
          الوزن: {shipment.weightKg === null ? "—" : `${shipment.weightKg} كجم`}
        </span>
        <span className="flex items-center gap-1.5">
          <Package className="size-4 text-gray-400" aria-hidden />
          عدد القطع: {shipment.piecesCount}
        </span>
      </div>
    </div>
  );
}

type MapPinData = {
  id: number;
  name: string;
  status: string;
  color: string;
  bg: string;
  top: string;
  left: string;
  parcels: number;
};

// Static mock data: pins are positioned by percentage on the CSS-drawn map.
const mapPins: MapPinData[] = [
  { id: 1, name: "متجر الأمانة", status: "تم الاستلام", color: "text-emerald-500", bg: "bg-emerald-100", top: "30%", left: "40%", parcels: 1 },
  { id: 2, name: "Gadoura Store", status: "قيد الانتظار", color: "text-orange-500", bg: "bg-orange-100", top: "50%", left: "60%", parcels: 2 },
  { id: 3, name: "صيدلية الحياة", status: "عاجلة", color: "text-red-500", bg: "bg-red-100", top: "65%", left: "35%", parcels: 4 },
];

function MapView({ onBack }: { onBack: () => void }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [selectedMerchant, setSelectedMerchant] = useState<any>(null);

  return (
    <>
      <div className="bg-[#082D52] relative z-10 flex min-h-20 items-center px-4 pt-[env(safe-area-inset-top)] pb-8">
        <button type="button" onClick={onBack} aria-label="رجوع" className={iconButton}>
          <ChevronRight className="size-6 text-white" />
        </button>
        <h1 className="mx-auto text-lg font-bold text-white">خريطة المتاجر</h1>
        <span className="size-11 shrink-0" aria-hidden />
      </div>

      <div className="relative z-20 -mt-6 flex-1 overflow-hidden rounded-t-[2rem] bg-[#E9EEF3]">
        {/* Mock map canvas (LTR so left/top percentages are stable in RTL pages) */}
        <div
          dir="ltr"
          className="relative h-[calc(100vh-5rem)] min-h-[32rem] w-full overflow-hidden"
          onClick={() => setSelectedMerchant(null)}
        >
          {/* Parks and water */}
          <div className="absolute -top-6 -left-8 h-40 w-48 rotate-6 rounded-[2.5rem] bg-emerald-100/80" />
          <div className="absolute right-[-3rem] bottom-24 h-44 w-56 -rotate-12 rounded-[3rem] bg-emerald-100/80" />
          <div className="absolute -right-10 top-24 h-24 w-64 rotate-[28deg] rounded-full bg-sky-200/80" />

          {/* City blocks */}
          <div
            aria-hidden
            className="absolute inset-0 opacity-70"
            style={{
              backgroundImage:
                "linear-gradient(to right, rgba(255,255,255,0.9) 0 10px, transparent 10px), linear-gradient(to bottom, rgba(255,255,255,0.9) 0 10px, transparent 10px)",
              backgroundSize: "88px 104px",
            }}
          />

          {/* Main roads */}
          <div className="absolute top-[22%] left-0 h-3.5 w-full -rotate-3 bg-white shadow-sm" />
          <div className="absolute top-[58%] left-0 h-4 w-full rotate-2 bg-white shadow-sm" />
          <div className="absolute top-0 left-[28%] h-full w-3.5 rotate-3 bg-white shadow-sm" />
          <div className="absolute top-0 left-[72%] h-full w-4 -rotate-6 bg-white shadow-sm" />
          <div className="absolute top-[40%] left-0 h-2 w-full rotate-12 bg-amber-100" />

          {/* Driver position */}
          <div
            className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
            style={{ top: "80%", left: "55%" }}
            aria-label="موقعك"
          >
            <span className="absolute inset-0 animate-ping rounded-full bg-blue-500/40" />
            <span className="relative block size-4 rounded-full border-[3px] border-white bg-[#0F62FF] shadow-lg" />
          </div>

          {/* Merchant pins */}
          {mapPins.map((pin) => {
            const selected = selectedMerchant?.id === pin.id;
            return (
              <button
                key={pin.id}
                type="button"
                aria-label={pin.name}
                aria-pressed={selected}
                onClick={(event) => {
                  event.stopPropagation();
                  setSelectedMerchant(selected ? null : pin);
                }}
                className={`absolute z-20 flex -translate-x-1/2 -translate-y-full cursor-pointer touch-manipulation flex-col items-center outline-none transition-transform duration-200 ${
                  selected ? "z-30 scale-125" : "hover:scale-110"
                }`}
                style={{ top: pin.top, left: pin.left }}
              >
                <span
                  className={`flex size-10 items-center justify-center rounded-full border-2 border-white shadow-lg ${pin.bg} ${selected ? "ring-4 ring-white/70" : ""}`}
                >
                  <MapPin className={`size-5 ${pin.color}`} aria-hidden />
                </span>
                <span
                  className={`-mt-1 size-2.5 rotate-45 border-r-2 border-b-2 border-white ${pin.bg}`}
                  aria-hidden
                />
                <span className="mt-0.5 rounded-full bg-white/95 px-2 py-0.5 text-[10px] font-bold whitespace-nowrap text-[#082D52] shadow">
                  {pin.name}
                </span>
              </button>
            );
          })}

          {/* Legend */}
          <div className="absolute top-4 left-4 z-10 flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-xs font-bold text-[#082D52] shadow">
            <MapIcon className="size-4 text-[#0F62FF]" aria-hidden />
            {mapPins.length} متاجر
          </div>
        </div>

        {/* Selected merchant card */}
        {selectedMerchant ? (
          <div className="absolute inset-x-4 bottom-28 z-40 animate-in fade-in slide-in-from-bottom-4 rounded-2xl bg-white p-4 shadow-xl duration-200">
            <div className="flex items-start gap-3">
              <span
                className={`flex size-12 shrink-0 items-center justify-center rounded-full ${selectedMerchant.bg}`}
              >
                <MapPin className={`size-6 ${selectedMerchant.color}`} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-bold text-[#082D52]">
                  {selectedMerchant.name}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${selectedMerchant.bg} ${selectedMerchant.color}`}
                  >
                    {selectedMerchant.status}
                  </span>
                  <span className="flex items-center gap-1 text-xs font-semibold text-gray-500">
                    <Package className="size-3.5 text-gray-400" aria-hidden />
                    {selectedMerchant.parcels} شحنات
                  </span>
                </div>
              </div>
              <button
                type="button"
                aria-label="إغلاق"
                onClick={() => setSelectedMerchant(null)}
                className="flex size-9 shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-full bg-gray-100 text-gray-500"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
            <button
              type="button"
              className="mt-3 flex min-h-11 w-full cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-xl bg-[#0F62FF] text-sm font-bold text-white"
            >
              <MapPin className="size-4" aria-hidden />
              بدء التوجيه
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}

function ProfileField({
  icon,
  label,
  value,
  children,
}: {
  icon: ReactNode;
  label: string;
  value?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-gray-100 py-2 last:border-none">
      <span className="flex min-w-0 items-center gap-2 text-sm text-gray-500">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      {children ?? (
        <span className="truncate text-sm font-semibold text-[#082D52]">{value}</span>
      )}
    </div>
  );
}

function ProfileView({
  profile,
  onBack,
}: {
  profile: SessionProfile;
  onBack: () => void;
}) {
  const sessionName = useDriverName();
  const driverName = profile.fullName?.trim() || sessionName || "أحمد محمد";
  const email = profile.email?.trim() || "a.mohamed@rapid.com";

  return (
    <>
      <div className="relative z-10 bg-[#082D52] pt-[env(safe-area-inset-top)]">
        <div className="flex h-20 items-center px-4">
        <button type="button" onClick={onBack} aria-label="رجوع" className={`${iconButton} -translate-y-4`}>
            <ChevronRight className="size-6 text-white" />
          </button>
          <img src="/logo-white.png" alt="Rapid" className="mx-auto -mt-7 h-32 object-contain" />
          <span className="size-10 shrink-0" aria-hidden />
        </div>
      </div>

      <div className="relative z-20 -mt-6 flex min-h-screen flex-1 flex-col rounded-t-[2rem] bg-[#F4F7FB] px-4 pt-8">
        <div className="flex flex-col items-center">
          <span className="flex size-20 items-center justify-center rounded-full border-4 border-white bg-[#082D52] text-white shadow-sm">
            <User className="size-10" aria-hidden />
          </span>
          <h2 className="mt-2 text-center text-xl font-bold text-[#082D52]">{driverName}</h2>
          <p className="mt-1 text-center text-sm text-gray-500">مندوب الاستلام</p>
        </div>

        <div className="mt-6">
          <section className="mb-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <h3 className="mb-3 flex items-center gap-2 border-b border-gray-100 pb-2 text-sm font-bold text-[#082D52]">
              <User className="size-4 text-[#0F62FF]" aria-hidden />
              معلومات المندوب
            </h3>
            <ProfileField
              icon={<User className="size-4 shrink-0 text-gray-400" aria-hidden />}
              label="الاسم الكامل"
              value={driverName}
            />
            <ProfileField
              icon={<Phone className="size-4 shrink-0 text-gray-400" aria-hidden />}
              label="رقم الهاتف"
            >
              <span dir="ltr" className="truncate text-sm font-semibold text-[#082D52]">
                +966 50 123 4567
              </span>
            </ProfileField>
            <ProfileField
              icon={<Mail className="size-4 shrink-0 text-gray-400" aria-hidden />}
              label="البريد الإلكتروني"
            >
              <span dir="ltr" className="truncate text-sm font-semibold text-[#082D52]">
                {email}
              </span>
            </ProfileField>
          </section>

          <section className="mb-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <h3 className="mb-3 flex items-center gap-2 border-b border-gray-100 pb-2 text-sm font-bold text-[#082D52]">
              <Car className="size-4 text-[#0F62FF]" aria-hidden />
              بيانات العمل
            </h3>
            <ProfileField
              icon={<FileText className="size-4 shrink-0 text-gray-400" aria-hidden />}
              label="الرقم الوظيفي"
            >
              <span dir="ltr" className="font-mono text-sm font-semibold text-[#082D52]">
                R1050
              </span>
            </ProfileField>
            <ProfileField
              icon={<MapPin className="size-4 shrink-0 text-gray-400" aria-hidden />}
              label="منطقة العمل"
              value="الرياض - حي الصحافة"
            />
            <ProfileField
              icon={<Car className="size-4 shrink-0 text-gray-400" aria-hidden />}
              label="نوع المركبة"
              value="سيارة"
            />
            <ProfileField
              icon={<FileText className="size-4 shrink-0 text-gray-400" aria-hidden />}
              label="رقم اللوحة"
              value="س ص ع 123"
            />
            <ProfileField
              icon={<Calendar className="size-4 shrink-0 text-gray-400" aria-hidden />}
              label="تاريخ الانضمام"
            >
              <span dir="ltr" className="text-sm font-semibold text-[#082D52]">
                2023-01-01
              </span>
            </ProfileField>
          </section>

          <section className="mb-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <h3 className="mb-3 flex items-center gap-2 border-b border-gray-100 pb-2 text-sm font-bold text-[#082D52]">
              <ShieldCheck className="size-4 text-[#0F62FF]" aria-hidden />
              بيانات إضافية
            </h3>
            <ProfileField
              icon={<Calendar className="size-4 shrink-0 text-gray-400" aria-hidden />}
              label="تاريخ الميلاد"
            >
              <span dir="ltr" className="text-sm font-semibold text-[#082D52]">
                1990-05-15
              </span>
            </ProfileField>
            <ProfileField
              icon={<ShieldCheck className="size-4 shrink-0 text-emerald-500" aria-hidden />}
              label="حالة الحساب"
            >
              <span className="flex items-center gap-1.5 text-sm font-bold text-emerald-600">
                <span className="size-2 rounded-full bg-emerald-500" aria-hidden />
                نشط
              </span>
            </ProfileField>
          </section>
        </div>

        <div className="flex flex-col rounded-2xl border border-gray-100 bg-white p-2 shadow-sm">
          <button
            type="button"
            className="flex min-h-14 w-full cursor-pointer touch-manipulation items-center justify-between gap-3 rounded-xl px-3 text-start"
          >
            <span className="flex items-center gap-3 font-bold text-[#082D52]">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#E8F1FF] text-[#0F62FF]">
                <Lock className="size-5" aria-hidden />
              </span>
              تعديل كلمة المرور
            </span>
            <ChevronLeft className="size-5 shrink-0 text-gray-400 ltr:rotate-180" aria-hidden />
          </button>
          <button
            type="button"
            className="flex min-h-14 w-full cursor-pointer touch-manipulation items-center justify-between gap-3 rounded-xl px-3 text-start"
          >
            <span className="flex items-center gap-3 font-bold text-[#082D52]">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#E8F1FF] text-[#0F62FF]">
                <HelpCircle className="size-5" aria-hidden />
              </span>
              الدعم والمساعدة
            </span>
            <ChevronLeft className="size-5 shrink-0 text-gray-400 ltr:rotate-180" aria-hidden />
          </button>
        </div>

        <button
          type="button"
          onClick={() => void signOut()}
          className="mb-20 mt-4 flex h-14 w-full cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 font-bold text-rose-600"
        >
          <LogOut className="size-5 shrink-0" aria-hidden />
          تسجيل الخروج
        </button>
      </div>
    </>
  );
}

const SHIPMENT_TABS = ["new", "waiting", "picked", "cancelled"] as const satisfies ReadonlyArray<PickupShipmentTab>;

function TasksView({
  merchants,
  shipments,
  shipmentsFailed,
  onBack,
}: {
  merchants: PickupMerchant[];
  shipments: PickupShipment[];
  shipmentsFailed: boolean;
  onBack: () => void;
}) {
  const [taskMode, setTaskMode] = useState<TaskMode>("merchants");
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("");
  const [area, setArea] = useState("");
  const [shipmentMerchant, setShipmentMerchant] = useState("");
  const [shipmentStatus, setShipmentStatus] = useState("");
  const today = khartoumDay(new Date().toISOString());
  const cities = uniqueLabels(merchants.map(cityOf));
  const areas = uniqueLabels(merchants.map(areaOf));
  const needle = query.trim();
  const visible = merchants.filter((merchant) => {
    if (!matchesTaskFilter(merchant, filter, today)) return false;
    if (city && cityOf(merchant) !== city) return false;
    if (area && areaOf(merchant) !== area) return false;
    if (!needle) return true;
    return `${merchant.companyName} ${merchant.address} ${merchant.zone}`.includes(needle);
  });
  // Active view: every pending parcel (whatever its date), plus parcels that
  // changed status today (Khartoum). Older collected rows are history.
  const activeShipments = shipments.filter((shipment) => isShipmentVisible(shipment, today));
  const visibleShipments = activeShipments.filter((shipment) => {
    if (!matchesShipmentFilter(shipment, filter, today)) return false;
    if (shipmentMerchant && shipment.merchantName !== shipmentMerchant) return false;
    if (shipmentStatus && !matchesShipmentFilter(shipment, shipmentStatus as TaskFilter, today)) {
      return false;
    }
    if (!needle) return true;
    return `${shipment.trackingCode} ${shipment.merchantName}`.toLowerCase().includes(needle.toLowerCase());
  });
  const toggleBase = "flex-1 py-2 rounded-lg font-bold text-sm transition-all";
  const toggleActive = "bg-white shadow-sm text-[#0F62FF]";
  const toggleInactive = "text-gray-500 hover:text-gray-700";

  return (
    <>
      <div className="bg-[#082D52] relative z-10 flex min-h-20 items-center px-4 pt-[env(safe-area-inset-top)] pb-8">
        <button type="button" onClick={onBack} aria-label="رجوع" className={iconButton}>
          <ChevronRight className="size-6 text-white" />
        </button>
        <h1 className="mx-auto text-lg font-bold text-white">قائمة المهام</h1>
        <span className="size-11 shrink-0" aria-hidden />
      </div>

      <div className="bg-[#F4F7FB] relative z-20 -mt-6 flex min-h-screen flex-1 flex-col gap-4 rounded-t-[2rem] p-4 pt-6 pb-32">
        <div className="flex bg-gray-200/60 p-1 rounded-xl mb-4">
          <button
            type="button"
            onClick={() => setTaskMode("merchants")}
            className={`${toggleBase} ${taskMode === "merchants" ? toggleActive : toggleInactive}`}
          >
            قائمة التجار
          </button>
          <button
            type="button"
            onClick={() => setTaskMode("shipments")}
            className={`${toggleBase} ${taskMode === "shipments" ? toggleActive : toggleInactive}`}
          >
            قائمة الشحنات
          </button>
        </div>

        <div className="flex w-full items-center gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {TASK_FILTERS.map((tab) => {
            const active = filter === tab.id;
            const urgentTab = tab.id === "urgent";
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={
                  urgentTab
                    ? `shrink-0 cursor-pointer touch-manipulation rounded-full border px-5 py-2 text-sm font-bold whitespace-nowrap text-red-500 ${
                        active ? "border-red-300 bg-red-100" : "border-red-200 bg-red-50"
                      }`
                    : active
                      ? "shrink-0 cursor-pointer touch-manipulation rounded-full bg-[#0F62FF] px-5 py-2 text-sm font-bold whitespace-nowrap text-white"
                      : "shrink-0 cursor-pointer touch-manipulation rounded-full border border-gray-100 bg-white px-5 py-2 text-sm font-semibold whitespace-nowrap text-gray-500"
                }
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="flex h-14 items-center rounded-2xl border border-gray-100 bg-white px-4 shadow-sm">
          <MapPin className="ml-2 size-5 shrink-0 text-gray-400" aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ابحث برقم التتبع أو اسم التاجر"
            className="min-w-0 flex-1 bg-transparent text-sm text-gray-700 outline-none"
          />
          <Search className="mr-2 size-5 shrink-0 text-gray-400" aria-hidden />
        </div>

        {taskMode === "merchants" ? (
          <>
            <div className="flex gap-3">
              <FilterSelect
                value={city}
                onChange={setCity}
                label="المدينة"
                options={cities.map((item) => ({ value: item, label: item }))}
              />
              <FilterSelect
                value={area}
                onChange={setArea}
                label="المنطقة"
                options={areas.map((item) => ({ value: item, label: item }))}
              />
            </div>

            {visible.length === 0 ? (
              <p className="py-10 text-center text-sm font-semibold text-gray-400">لا توجد مهام</p>
            ) : (
              visible.map((merchant) => (
                <PickupMerchantCard key={merchant.merchantId} merchant={merchant} />
              ))
            )}
          </>
        ) : (
          <>
            <div className="flex gap-3">
              <FilterSelect
                value={shipmentMerchant}
                onChange={setShipmentMerchant}
                label="التاجر"
                options={uniqueLabels(activeShipments.map((item) => item.merchantName)).map(
                  (name) => ({ value: name, label: name }),
                )}
              />
              <FilterSelect
                value={shipmentStatus}
                onChange={setShipmentStatus}
                label="الحالة"
                options={SHIPMENT_TABS.map((status) => ({
                  value: status,
                  label: SHIPMENT_TAB_LABEL[status],
                }))}
              />
            </div>

            {shipmentsFailed ? (
              <p
                role="alert"
                className="rounded-2xl bg-red-50 px-4 py-4 text-center text-sm font-semibold text-red-600"
              >
                تعذّر تحميل الشحنات. حاول مرة أخرى بعد قليل.
              </p>
            ) : visibleShipments.length === 0 ? (
              <p className="py-10 text-center text-sm font-semibold text-gray-400">لا توجد شحنات</p>
            ) : (
              visibleShipments.map((shipment) => (
                <ShipmentCard key={shipment.id} shipment={shipment} today={today} />
              ))
            )}
          </>
        )}
      </div>
    </>
  );
}

export function PickupTabs({
  todayCount,
  completedCount,
  waitingCount,
  urgentCount,
  merchants = [],
  shipments,
  shipmentsFailed,
  alerts,
  onDismissAlert,
  pickups,
}: {
  todayCount: number;
  completedCount: number;
  waitingCount: number;
  urgentCount: number;
  merchants?: PickupMerchant[];
  shipments: PickupShipment[];
  shipmentsFailed: boolean;
  alerts: DriverAlert[];
  onDismissAlert: (id: string) => void | Promise<void>;
  pickups: ReactNode;
}) {
  const driverName = useDriverName();
  const profile = useDriverProfile();
  const { t, prefs } = useDriverPrefs();
  const [notice, setNotice] = useState<PickupNotice | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [target, setTarget] = useState<PickupMerchant | null>(null);
  const [currentView, setCurrentView] = useState<"home" | "tasks" | "map" | "profile">("home");
  const report = useCallback((next: PickupNotice) => setNotice(next), []);

  const stats: ReadonlyArray<{
    label: string;
    value: number;
    tone: string;
    wash: string;
    icon: typeof ClipboardList;
  }> = [
    {
      label: t.tasksToday,
      value: todayCount,
      tone: "text-[#0F62FF]",
      wash: "bg-[#E8F1FF]",
      icon: ClipboardList,
    },
    {
      label: t.pickedUpStat,
      value: completedCount,
      tone: "text-emerald-600",
      wash: "bg-[#E7F8EF]",
      icon: PackageCheck,
    },
    {
      label: t.waitingNow,
      value: waitingCount,
      tone: "text-orange-500",
      wash: "bg-[#FFF1E6]",
      icon: Package,
    },
    {
      label: t.urgentTasks,
      value: urgentCount,
      tone: "text-red-500",
      wash: "bg-[#FDECEC]",
      icon: CircleAlert,
    },
  ];

  function startScan() {
    if (merchants.length === 1) {
      setTarget(merchants[0]);
      return;
    }
    setChooserOpen(true);
  }

  const maps =
    target === null
      ? null
      : navigationHref(prefs.navApp, {
          gpsUrl: target.gpsUrl,
          address: target.address,
          point: target.point,
        });

  return (
    <PickupFeedbackContext.Provider value={report}>
      <div className="bg-background flex flex-1 flex-col pb-28">
        {currentView === "home" && (
        <>
        <section className="relative z-10 bg-[#082D52] pt-[env(safe-area-inset-top)] pb-8">
          <DriverTopBar alerts={alerts} onDismissAlert={onDismissAlert} />
          <div className="flex flex-col items-start px-4 pt-6">
            <p className="max-w-full truncate text-2xl font-bold text-white">{driverName}</p>
            <p className="text-lg font-medium text-white">{t.pickupRole}</p>
          </div>
        </section>

        <div className="relative z-20 -mt-6 bg-[#F4F7FB] rounded-t-[2rem] pt-6 flex flex-col flex-1 pb-4">
          <div className="relative z-20 grid grid-cols-2 gap-3 px-4">
            {stats.map((stat) => {
              const Icon = stat.icon;
              return (
                <div
                  key={stat.label}
                  className={`flex flex-col items-center justify-center rounded-2xl p-4 shadow-sm ${stat.wash}`}
                >
                  <div className={`flex items-center gap-2 ${stat.tone}`}>
                    <span className="text-3xl leading-none font-bold tabular-nums">{stat.value}</span>
                    <Icon className="size-5" aria-hidden />
                  </div>
                  <span className={`mt-2 text-center text-xs font-semibold ${stat.tone}`}>
                    {stat.label}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="mt-6 px-4">
            <button
              type="button"
              onClick={startScan}
              className="flex h-14 w-full cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-2xl bg-[#0F62FF] text-lg font-bold text-white shadow-md rtl:flex-row-reverse"
            >
              <ScanBarcode className="size-6" aria-hidden />
              {t.scanMerchantBarcode}
            </button>
          </div>

          <h2 className="mt-6 px-4 text-center text-lg font-bold text-[#082D52] dark:text-white">
            {t.recentShipments}
          </h2>
          <div className="mt-3 flex flex-col gap-3 px-4">
            {notice ? (
              <div
                role="status"
                className="flex items-start gap-3 rounded-2xl bg-emerald-100 px-4 py-3 text-sm text-emerald-950 dark:bg-emerald-400/15 dark:text-emerald-200"
              >
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
                <p className="min-w-0 flex-1">
                  <span className="mb-1 inline-flex rounded-full bg-emerald-500 px-2 py-0.5 text-[11px] font-bold text-white">
                    {t.completed}
                  </span>
                  <span className="block">
                    {t.pickedUpNotice} {notice.count} {t.from} {notice.companyName}. {t.takeToHub}
                  </span>
                </p>
                <button
                  type="button"
                  onClick={() => setNotice(null)}
                  aria-label={t.dismiss}
                  className="-m-1 flex size-8 shrink-0 items-center justify-center rounded-lg"
                >
                  <X className="size-4" />
                </button>
              </div>
            ) : null}
            {pickups}
          </div>
        </div>
        </>
        )}
        {currentView === "tasks" && (
          <TasksView
            merchants={merchants}
            shipments={shipments}
            shipmentsFailed={shipmentsFailed}
            onBack={() => setCurrentView("home")}
          />
        )}
        {currentView === "map" && <MapView onBack={() => setCurrentView("home")} />}
        {currentView === "profile" && profile ? (
          <ProfileView profile={profile} onBack={() => setCurrentView("home")} />
        ) : null}
      </div>

      <nav className="pointer-events-auto fixed inset-x-0 bottom-0 z-50 flex h-[68px] items-center justify-center border-t border-gray-100 bg-white pb-[env(safe-area-inset-bottom)]">
        <div className="flex w-full max-w-sm items-center justify-between px-6">
          <div
            role="button"
            tabIndex={0}
            onClick={() => setCurrentView("home")}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setCurrentView("home");
              }
            }}
            className="flex cursor-pointer touch-manipulation flex-col items-center justify-center gap-1"
          >
            <Home className={`size-6 ${currentView === "home" ? "text-[#0F62FF]" : "text-gray-400"}`} />
            <span className={`text-[11px] font-bold ${currentView === "home" ? "text-[#0F62FF]" : "text-gray-400"}`}>
              الرئيسية
            </span>
          </div>
          <div
            role="button"
            tabIndex={0}
            onClick={() => setCurrentView("tasks")}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setCurrentView("tasks");
              }
            }}
            className="flex cursor-pointer touch-manipulation flex-col items-center justify-center gap-1"
          >
            <Package className={`size-6 ${currentView === "tasks" ? "text-[#0F62FF]" : "text-gray-400"}`} />
            <span className={`text-[11px] font-bold ${currentView === "tasks" ? "text-[#0F62FF]" : "text-gray-400"}`}>
              المهام
            </span>
          </div>
          <div
            role="button"
            tabIndex={0}
            onClick={() => setCurrentView("map")}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setCurrentView("map");
              }
            }}
            className="flex cursor-pointer touch-manipulation flex-col items-center justify-center gap-1"
          >
            <MapIcon className={`size-6 ${currentView === "map" ? "text-[#0F62FF]" : "text-gray-400"}`} />
            <span className={`text-[11px] font-bold ${currentView === "map" ? "text-[#0F62FF]" : "text-gray-400"}`}>
              الخريطة
            </span>
          </div>
          <div
            role="button"
            tabIndex={0}
            onClick={() => setCurrentView("profile")}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setCurrentView("profile");
              }
            }}
            className="flex cursor-pointer touch-manipulation flex-col items-center justify-center gap-1"
          >
            <User className={`size-6 ${currentView === "profile" ? "text-[#0F62FF]" : "text-gray-400"}`} />
            <span className={`text-[11px] font-bold ${currentView === "profile" ? "text-[#0F62FF]" : "text-gray-400"}`}>
              الملف
            </span>
          </div>
        </div>
      </nav>

      <Dialog open={chooserOpen} onOpenChange={setChooserOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.chooseMerchant}</DialogTitle>
            <DialogDescription>
              {merchants.length === 0 ? t.emptyPickups : t.scanMerchantBarcode}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {merchants.map((merchant) => (
              <button
                key={merchant.merchantId}
                type="button"
                onClick={() => {
                  setChooserOpen(false);
                  setTarget(merchant);
                }}
                className="flex min-h-14 w-full cursor-pointer touch-manipulation items-center justify-between gap-3 rounded-2xl border border-zinc-100 bg-white px-4 text-start"
              >
                <span className="min-w-0 truncate font-bold text-[#082D52]">{merchant.companyName}</span>
                <span className="text-sm font-semibold text-[#0F62FF] tabular-nums">
                  {merchant.pendingCount}
                </span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {target ? (
        <PickupScanner
          key={target.merchantId}
          merchantId={target.merchantId}
          companyName={target.companyName}
          pendingCount={target.pendingCount}
          pickupFee={target.pickupFee}
          address={target.address}
          phone={target.phone}
          mapsHref={maps}
          parcels={target.parcels}
          requestedAt={target.requestedAt}
          hideTrigger
          open
          onOpenChange={(next) => {
            if (!next) setTarget(null);
          }}
        />
      ) : null}
    </PickupFeedbackContext.Provider>
  );
}
