import { create as createQrCode } from "qrcode";

import { cn } from "@/lib/utils";
import type { AwbFormat, AwbLanguage, AwbLayout } from "@/lib/merchant/settings";
import { awbPrintedNotes, composeAwbAddress } from "@/lib/orders/awb-lines";
import type { AwbSpecimen } from "@/lib/orders/awb-specimen";
import { trackingQrPayload } from "@/lib/orders/tracking-link";

/**
 * Visual AWB preview. The barcode marks are decorative. The QR code encodes
 * the public tracking URL for that shipment.
 * A6Label is the portrait 10×15 cm thermal sticker.
 * A4LandscapeLabel is a separate 20×14 cm landscape waybill for desktop printers.
 * Sizes inside a label use container query units so every slot stays proportional.
 */

type Specimen = AwbSpecimen;

const SPECIMENS: readonly Specimen[] = [
  {
    trackingCode: "RP3F9A21C0B7",
    zoneCode: "KRT",
    hubCode: "KRT-01",
    hubName: "Khartoum Hub",
    sector: "KRT-01",
    regionAr: "ولاية الخرطوم — الخرطوم",
    regionEn: "Khartoum State — Khartoum",
    streetAr: "شارع الجامعة",
    streetEn: "University St",
    buildingAr: "عمارة النيل الأزرق",
    buildingEn: "Blue Nile building",
    floorNumber: "٢",
    apartmentNumber: "٥",
    landmarkAr: "بجوار سوق الخرطوم",
    landmarkEn: "Beside Khartoum market",
    codAmount: "45000",
    customerAr: "سارة آدم",
    customerEn: "Sara Adam",
    customerPhone: "0912 345 678",
    customerPhone2: "0911 222 333",
    descriptionAr: "طقم أكواب زجاجية، مغلف بورق فقاعي",
    descriptionEn: "Glass cup set, wrapped in bubble paper",
    noteAr: "قابل للكسر — تعامل بحرص",
    noteEn: "Fragile — handle with care",
    internalNoteAr: "ملاحظة داخلية سرية لا تُطبع",
    internalNoteEn: "Private merchant note — do not print",
    pieces: "1",
    allowOpen: true,
    orderRef: "ORD-10421",
    created: "14 Oct, 2026",
    page: "1/1",
  },
  {
    trackingCode: "RP7C2E88D1A4",
    zoneCode: "OMD",
    hubCode: "OMD-02",
    hubName: "Omdurman Hub",
    sector: "OMD-02",
    regionAr: "ولاية الخرطوم — أم درمان",
    regionEn: "Khartoum State — Omdurman",
    streetAr: "شارع الموردة",
    streetEn: "Al Morada St",
    buildingAr: "عمارة ١٤",
    buildingEn: "building 14",
    floorNumber: "١",
    apartmentNumber: "٢",
    landmarkAr: "أمام سوق أم درمان",
    landmarkEn: "Opposite Omdurman market",
    codAmount: "12500",
    customerAr: "كريم حسن",
    customerEn: "Karim Hassan",
    customerPhone: "0912 000 111",
    customerPhone2: "0112 333 444",
    descriptionAr: "صندوق كتب — ٣ مجلدات",
    descriptionEn: "Box of books — 3 volumes",
    noteAr: "الاتصال قبل الوصول",
    noteEn: "Call before arrival",
    internalNoteAr: "ملاحظة داخلية سرية لا تُطبع",
    internalNoteEn: "Private merchant note — do not print",
    pieces: "3",
    allowOpen: true,
    orderRef: "ORD-10488",
    created: "14 Oct, 2026",
    page: "1/1",
  },
  {
    trackingCode: "RP1A90B33E6C",
    zoneCode: "PSD",
    hubCode: "PSD-04",
    hubName: "Port Sudan Hub",
    sector: "PSD-04",
    regionAr: "ولاية البحر الأحمر — بورتسودان",
    regionEn: "Red Sea — Port Sudan",
    streetAr: "شارع الميناء",
    streetEn: "Port St",
    buildingAr: "برج الساحل",
    buildingEn: "Coast Tower",
    floorNumber: "٣",
    apartmentNumber: "١٤",
    landmarkAr: "قرب ميناء بورتسودان",
    landmarkEn: "Near Port Sudan harbour",
    codAmount: "80000",
    customerAr: "منى عادل",
    customerEn: "Mona Adel",
    customerPhone: "0912 555 666",
    customerPhone2: "0910 777 888",
    descriptionAr: "جهاز إلكتروني في علبته الأصلية",
    descriptionEn: "Electronics in the original box",
    noteAr: "لا تُترك عند البواب",
    noteEn: "Do not leave with the doorman",
    internalNoteAr: "ملاحظة داخلية سرية لا تُطبع",
    internalNoteEn: "Private merchant note — do not print",
    pieces: "2",
    allowOpen: false,
    orderRef: "ORD-11002",
    created: "14 Oct, 2026",
    page: "1/1",
  },
  {
    trackingCode: "RP5D44F17C8E",
    zoneCode: "BAH",
    hubCode: "BAH-03",
    hubName: "Bahri Hub",
    sector: "BAH-03",
    regionAr: "ولاية الخرطوم — الخرطوم بحري",
    regionEn: "Khartoum State — Khartoum Bahri",
    streetAr: "شارع المعونة",
    streetEn: "Al Mauna St",
    buildingAr: "عمارة ٨",
    buildingEn: "building 8",
    floorNumber: "٤",
    apartmentNumber: "٦",
    landmarkAr: "بجوار سوق بحري",
    landmarkEn: "Beside Bahri market",
    codAmount: "6000",
    customerAr: "يوسف ناصر",
    customerEn: "Youssef Nasser",
    customerPhone: "0915 000 222",
    customerPhone2: "0115 777 888",
    descriptionAr: "ملابس مغلفة — كيس واحد",
    descriptionEn: "Packed clothing — one bag",
    noteAr: "الطابق الثالث، الجرس لا يعمل",
    noteEn: "Third floor, the bell does not work",
    internalNoteAr: "ملاحظة داخلية سرية لا تُطبع",
    internalNoteEn: "Private merchant note — do not print",
    pieces: "1",
    allowOpen: true,
    orderRef: "ORD-11090",
    created: "14 Oct, 2026",
    page: "1/1",
  },
];

function formatCod(amount: string): string {
  const whole = amount.replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "");
  return (whole || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

const COPY = {
  ar: {
    dir: "rtl" as const,
    type: "توصيل",
    currency: "ج.س",
    collect: "مبلغ التحصيل:",
    deliverTo: "توصيل إلى:",
    merchant: "التاجر:",
    zone: "المنطقة |",
    street: "العنوان |",
    landmark: "علامة مميزة |",
    shipment: "وصف الشحنة |",
    notes: "ملاحظات |",
    returnLabel: "موقع إرجاع الشحنة |",
    orderRef: "مرجع الطلب:",
    trackingNo: "رقم التتبع",
    openPackage: "فتح الشحنة",
    yes: "نعم",
    no: "لا",
    piece: "قطع",
    created: "Created:",
  },
  en: {
    dir: "ltr" as const,
    type: "Delivery",
    currency: "SDG",
    collect: "Amount to collect:",
    deliverTo: "Deliver to:",
    merchant: "Merchant:",
    zone: "Zone |",
    street: "Address |",
    landmark: "Landmark |",
    shipment: "Package description |",
    notes: "Notes |",
    returnLabel: "Return location |",
    orderRef: "Order reference:",
    trackingNo: "Tracking no.",
    openPackage: "Open package",
    yes: "Yes",
    no: "No",
    piece: "pcs",
    created: "Created:",
  },
};

function seeded(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return () => {
    hash = (Math.imul(hash, 1664525) + 1013904223) >>> 0;
    return hash / 2 ** 32;
  };
}

type Bar = { x: number; width: number };

function buildBars(seed: string): { bars: Bar[]; total: number } {
  const next = seeded(seed);
  const bars: Bar[] = [];
  let x = 0;
  let dark = true;
  while (x < 118) {
    const width = 1 + Math.floor(next() * 3);
    if (dark) bars.push({ x, width });
    x += width;
    dark = !dark;
  }
  return { bars, total: x };
}

function Barcode({
  code,
  className,
}: {
  code: string;
  className?: string;
}) {
  const barcode = buildBars(code);
  return (
    <svg
      viewBox={`0 0 ${barcode.total} 40`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className={cn("w-full", className)}
    >
      {barcode.bars.map((bar) => (
        <rect key={bar.x} x={bar.x} y={0} width={bar.width} height={40} fill="currentColor" />
      ))}
    </svg>
  );
}

const QR_QUIET = 2;

function QrCode({ trackingCode, className }: { trackingCode: string; className?: string }) {
  const qr = createQrCode(trackingQrPayload(trackingCode), { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  let path = "";
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (qr.modules.get(row, col)) path += `M${col} ${row}h1v1h-1z`;
    }
  }
  const span = size + QR_QUIET * 2;
  return (
    <svg
      viewBox={`${-QR_QUIET} ${-QR_QUIET} ${span} ${span}`}
      role="img"
      aria-label={trackingQrPayload(trackingCode)}
      shapeRendering="crispEdges"
      className={cn("bg-white text-black", className)}
    >
      <path d={path} fill="currentColor" />
    </svg>
  );
}

type LabelProps = {
  specimen: Specimen;
  language: AwbLanguage;
  merchantName: string;
  returnLocation: string;
  className?: string;
};

function resolved(specimen: Specimen, language: AwbLanguage) {
  const arabic = language === "ar";
  return {
    region: arabic ? specimen.regionAr : specimen.regionEn,
    address: composeAwbAddress(
      {
        street: arabic ? specimen.streetAr : specimen.streetEn,
        buildingName: arabic ? specimen.buildingAr : specimen.buildingEn,
        floorNumber: specimen.floorNumber,
        apartmentNumber: specimen.apartmentNumber,
      },
      language,
    ),
    landmark: arabic ? specimen.landmarkAr : specimen.landmarkEn,
    customer: arabic ? specimen.customerAr : specimen.customerEn,
    description: arabic ? specimen.descriptionAr : specimen.descriptionEn,
    note: awbPrintedNotes(
      arabic ? specimen.noteAr : specimen.noteEn,
      arabic ? specimen.internalNoteAr : specimen.internalNoteEn,
    ),
  };
}

function OutlinedBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex max-w-full items-center rounded-full border border-black px-[1.6cqw] py-[0.4cqw] text-[2.15cqw] leading-none font-bold">
      {children}
    </span>
  );
}

function MarkedLine({
  label,
  value,
  className,
  valueClassName,
}: {
  label: string;
  value: string;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <p data-awb-line={label} className={cn("text-[2.7cqw] leading-snug", className)}>
      <span className="font-bold">{label} </span>
      <span className={cn("font-semibold", valueClassName)}>{value}</span>
    </p>
  );
}

function Phones({
  primary,
  secondary,
  className,
}: {
  primary: string;
  secondary?: string;
  className?: string;
}) {
  return (
    <div
      dir="ltr"
      className={cn(
        "flex flex-col text-end text-[2.8cqw] leading-tight font-semibold tabular-nums",
        className,
      )}
    >
      <span>{primary}</span>
      {secondary ? <span>{secondary}</span> : null}
    </div>
  );
}

function HubStack({ hubName, sector }: { hubName: string; sector: string }) {
  return (
    <div dir="ltr" className="flex h-full min-h-[8cqw] flex-col gap-[0.45cqw] bg-white">
      <div className="flex flex-1 items-center justify-center bg-black px-[0.8cqw] py-[0.7cqw] text-center text-[2.2cqw] leading-tight font-bold text-white">
        {hubName}
      </div>
      <div className="flex flex-1 items-center justify-center bg-black px-[0.8cqw] py-[0.7cqw] text-center text-[2.5cqw] leading-none font-black tracking-wide text-white">
        {sector}
      </div>
    </div>
  );
}

function LabelFooter({
  created,
  page,
  showPage,
}: {
  created: string;
  page?: string;
  showPage?: boolean;
}) {
  return (
    <div data-awb-cell="footer" className="shrink-0 px-[1.6cqw] pt-[0.9cqw]">
      <div dir="ltr" className="grid grid-cols-3 items-center text-[2cqw] leading-none">
        <span className="font-semibold tabular-nums">{showPage ? page : ""}</span>
        <span className="text-center font-medium">Created: {created}</span>
        <span />
      </div>
      <div aria-hidden className="mt-[0.7cqw] border-t border-dashed border-black" />
    </div>
  );
}

function NotesRefRow({
  dir,
  notesLabel,
  note,
  orderRefLabel,
  orderRef,
  className,
}: {
  dir: "rtl" | "ltr";
  notesLabel: string;
  note: string;
  orderRefLabel: string;
  orderRef: string;
  className?: string;
}) {
  return (
    <div
      dir={dir}
      data-awb-cell="notes"
      className={cn(
        "flex shrink-0 flex-wrap items-baseline justify-between gap-x-[1.6cqw] gap-y-[0.2cqw] border-b border-black px-[1.6cqw] py-[0.65cqw]",
        className,
      )}
    >
      <MarkedLine label={notesLabel} value={note} className="min-w-0 text-[2.4cqw]" />
      <p className="shrink-0 text-[2.25cqw] leading-snug">
        <span className="font-bold">{orderRefLabel} </span>
        <span dir="ltr" className="font-semibold tabular-nums">
          {orderRef}
        </span>
      </p>
    </div>
  );
}

function ScanBand({
  dir,
  trackingLabel,
  code,
  qrClassName,
  className,
}: {
  dir: "rtl" | "ltr";
  trackingLabel: string;
  code: string;
  qrClassName: string;
  className?: string;
}) {
  return (
    <div
      dir="ltr"
      data-awb-cell="scan"
      className={cn("grid grid-cols-[1fr_auto] items-stretch border-b border-black", className)}
    >
      <div className="flex min-w-0 flex-col items-center justify-center gap-[0.4cqw] px-[1.4cqw] py-[1cqw]">
        <span dir={dir} className="text-[2.05cqw] leading-none font-bold">
          {trackingLabel}
        </span>
        <Barcode code={code} className="h-[8cqw] w-full" />
        <span className="max-w-full font-mono text-[1.8cqw] leading-none font-semibold tracking-[0.08em]">
          {code}
        </span>
      </div>
      <div className="flex items-center justify-center border-s border-black bg-white p-[1.2cqw]">
        <QrCode trackingCode={code} className={qrClassName} />
      </div>
    </div>
  );
}

/** Portrait thermal sticker, 10cm × 15cm. The cut line sits outside the border. */
function A6Label({
  specimen,
  language,
  merchantName,
  returnLocation,
  className,
}: LabelProps) {
  const copy = COPY[language];
  const text = resolved(specimen, language);
  const openBadge = `${copy.openPackage} : ${specimen.allowOpen ? copy.yes : copy.no}`;
  const pieceBadge = `${copy.piece} ${specimen.pieces}`;

  return (
    <div
      data-awb-label="a6"
      style={{ containerType: "inline-size" }}
      className={cn(
        "box-border flex w-full min-h-0 flex-col bg-white font-sans text-black",
        className,
      )}
    >
      <div className="awb-label flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
        <div className="flex flex-col items-center gap-[0.7cqw] border-b border-black px-[2.4cqw] pt-[1.5cqw] pb-[1cqw]">
          <div dir="ltr" className="w-full">
            <Barcode code={specimen.trackingCode} className="h-[15cqw]" />
          </div>
          <span
            dir="ltr"
            className="font-mono text-[3.6cqw] leading-none font-semibold tracking-[0.22em]"
          >
            {specimen.trackingCode}
          </span>
        </div>

        <div dir="ltr" className="grid grid-cols-3 items-center border-b border-black px-[1.4cqw] py-[1.1cqw]">
          <span className="text-start text-[4.4cqw] leading-none font-black tracking-tight">Rapid</span>
          <span className="text-center text-[5.2cqw] leading-none font-black tracking-wide">
            {specimen.zoneCode}
          </span>
          <span dir={copy.dir} className="text-end text-[3.8cqw] leading-none font-black">
            {copy.type}
          </span>
        </div>

        <div dir="ltr" className="grid min-h-[16cqw] grid-cols-[22%_1fr] border-b border-black">
          <div className="flex items-center justify-center bg-black px-[1cqw] py-[1.6cqw] text-[4.4cqw] leading-none font-black tracking-wide text-white">
            {specimen.hubCode}
          </div>
          <div dir={copy.dir} className="flex flex-col justify-center gap-[0.45cqw] px-[1.8cqw] py-[1.5cqw]">
            <span className="text-[2.5cqw] leading-none font-bold">{copy.collect}</span>
            <div className="flex items-baseline gap-[0.8cqw]">
              <span className="text-[clamp(1.5rem,10.5cqw,1.875rem)] leading-none font-extrabold tabular-nums">
                {formatCod(specimen.codAmount)}
              </span>
              <span className="text-[2.6cqw] leading-none font-bold">{copy.currency}</span>
            </div>
          </div>
        </div>

        <div dir="ltr" className="grid grid-cols-[2fr_3fr] border-b border-black">
          <div
            dir={copy.dir}
            data-awb-cell="merchant"
            className="flex flex-col gap-[0.4cqw] border-e border-black px-[1.6cqw] py-[1cqw]"
          >
            <span className="text-[2.3cqw] leading-none font-bold text-neutral-600">{copy.merchant}</span>
            <span className="text-[3.3cqw] leading-tight font-bold break-words">{merchantName}</span>
          </div>
          <div
            dir={copy.dir}
            data-awb-cell="customer"
            className="flex flex-col gap-[0.35cqw] px-[1.6cqw] py-[1cqw]"
          >
            <span className="text-[2.3cqw] leading-none font-bold text-neutral-600">{copy.deliverTo}</span>
            <span className="text-[3.4cqw] leading-tight font-bold">{text.customer}</span>
            <Phones primary={specimen.customerPhone} secondary={specimen.customerPhone2} />
          </div>
        </div>

        <div
          dir={copy.dir}
          data-awb-cell="address"
          className="flex shrink-0 flex-col gap-[0.35cqw] border-b border-black px-[1.6cqw] py-[0.75cqw]"
        >
          <MarkedLine label={copy.zone} value={text.region} />
          <MarkedLine label={copy.street} value={text.address} />
          <MarkedLine
            label={copy.landmark}
            value={text.landmark}
            className="text-[2.85cqw]"
            valueClassName="font-bold"
          />
        </div>

        <div
          dir={copy.dir}
          data-awb-cell="package"
          className="flex shrink-0 flex-col gap-[0.45cqw] border-b border-black px-[1.6cqw] py-[0.7cqw]"
        >
          <div className="flex flex-wrap gap-[0.7cqw]">
            <OutlinedBadge>{openBadge}</OutlinedBadge>
            <OutlinedBadge>{pieceBadge}</OutlinedBadge>
          </div>
          <MarkedLine label={copy.shipment} value={text.description} />
        </div>

        <NotesRefRow
          dir={copy.dir}
          notesLabel={copy.notes}
          note={text.note}
          orderRefLabel={copy.orderRef}
          orderRef={specimen.orderRef}
        />

        <ScanBand
          dir={copy.dir}
          trackingLabel={copy.trackingNo}
          code={specimen.trackingCode}
          qrClassName="size-[max(76px,22cqw)]"
          className="min-h-[92px] flex-1 border-b-0"
        />

        <div dir="ltr" className="grid min-h-[11cqw] shrink-0 grid-cols-[26%_1fr] border-t border-black">
          <HubStack hubName={specimen.hubName} sector={specimen.sector} />
          <div dir={copy.dir} className="flex flex-col justify-center gap-[0.35cqw] px-[1.6cqw] py-[0.8cqw]">
            <MarkedLine
              label={copy.returnLabel}
              value={returnLocation}
              valueClassName="font-bold break-words"
            />
          </div>
        </div>
      </div>
      <LabelFooter created={specimen.created} page={specimen.page} showPage />
    </div>
  );
}

/** Desktop waybill, 20cm × 14cm. The cut line sits outside the rounded border. */
function A4LandscapeLabel({
  specimen,
  language,
  merchantName,
  returnLocation,
  className,
}: LabelProps) {
  const copy = COPY[language];
  const text = resolved(specimen, language);
  const openBadge = `${copy.openPackage} : ${specimen.allowOpen ? copy.yes : copy.no}`;
  const pieceBadge = `${copy.piece} ${specimen.pieces}`;

  return (
    <div
      dir="ltr"
      data-awb-label="a4-landscape"
      style={{ containerType: "inline-size" }}
      className={cn(
        "box-border flex h-[14cm] w-[20cm] shrink-0 flex-col bg-white font-sans text-black",
        className,
      )}
    >
      <div className="awb-label flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
        <div className="grid grid-cols-[auto_1fr_auto] items-center border-b border-black">
          <div className="flex items-center justify-center p-[1cqw]">
            <QrCode trackingCode={specimen.trackingCode} className="size-[9cqw]" />
          </div>
          <div className="flex min-w-0 flex-col items-center gap-[0.4cqw] px-[1.2cqw] py-[0.7cqw]">
            <Barcode code={specimen.trackingCode} className="h-[8.5cqw]" />
            <span className="font-mono text-[2.4cqw] leading-none font-semibold tracking-[0.28em]">
              {specimen.trackingCode}
            </span>
          </div>
          <div className="flex items-center justify-end gap-[1.2cqw] px-[1.4cqw]">
            <span
              dir={copy.dir}
              className="bg-black px-[1.5cqw] py-[0.7cqw] text-[2.5cqw] leading-none font-bold text-white"
            >
              {copy.type}
            </span>
            <span className="text-[4.6cqw] leading-none font-black tracking-tight">Rapid</span>
          </div>
        </div>

        <div className="relative flex items-center border-b border-black px-[1.4cqw] py-[0.7cqw]">
          <div className="bg-black px-[1.6cqw] py-[0.6cqw] text-[3.2cqw] leading-none font-black tracking-wide text-white">
            {specimen.hubCode}
          </div>
          <div className="pointer-events-none absolute inset-x-0 text-center text-[3.6cqw] leading-none font-black tracking-wide">
            {specimen.zoneCode}
          </div>
          <div className="ms-auto font-mono text-[2.4cqw] leading-none font-semibold tracking-[0.14em]">
            {specimen.trackingCode}
          </div>
        </div>

        <div dir="ltr" className="grid shrink-0 grid-cols-[2fr_3fr] border-b border-black">
          <div
            dir={copy.dir}
            data-awb-cell="merchant"
            className="flex flex-col gap-[0.25cqw] border-e border-black px-[1.5cqw] py-[0.7cqw]"
          >
            <span className="text-[2cqw] leading-none font-bold text-neutral-600">{copy.merchant}</span>
            <span className="text-[2.7cqw] leading-tight font-bold break-words">{merchantName}</span>
          </div>
          <div
            dir={copy.dir}
            data-awb-cell="customer"
            className="flex flex-col gap-[0.2cqw] px-[1.5cqw] py-[0.7cqw]"
          >
            <span className="text-[2cqw] leading-none font-bold text-neutral-600">{copy.deliverTo}</span>
            <span className="text-[2.7cqw] leading-tight font-bold">{text.customer}</span>
            <Phones primary={specimen.customerPhone} secondary={specimen.customerPhone2} className="text-[2.3cqw]" />
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[68%_32%]">
          <div dir={copy.dir} className="flex min-h-0 min-w-0 flex-col border-e border-black">
            <div
              data-awb-cell="address"
              className="flex shrink-0 flex-col gap-[0.3cqw] border-b border-black px-[1.5cqw] py-[0.65cqw]"
            >
              <MarkedLine label={copy.zone} value={text.region} className="text-[2.6cqw]" />
              <MarkedLine label={copy.street} value={text.address} className="text-[2.6cqw]" />
              <MarkedLine
                label={copy.landmark}
                value={text.landmark}
                className="text-[2.7cqw]"
                valueClassName="font-bold"
              />
            </div>
            <div
              data-awb-cell="package"
              className="flex shrink-0 flex-col border-b border-black px-[1.5cqw] py-[0.6cqw]"
            >
              <MarkedLine label={copy.shipment} value={text.description} className="text-[2.6cqw]" />
            </div>
            <div dir="ltr" className="mt-auto grid min-h-[8cqw] grid-cols-[30%_1fr]">
              <HubStack hubName={specimen.hubName} sector={specimen.sector} />
              <div dir={copy.dir} className="flex flex-col justify-center px-[1.4cqw] py-[0.6cqw]">
                <MarkedLine
                  label={copy.returnLabel}
                  value={returnLocation}
                  valueClassName="font-bold break-words"
                />
              </div>
            </div>
          </div>

          <div dir={copy.dir} className="flex min-h-0 min-w-0 flex-col">
            <div className="flex min-h-[16cqw] flex-1 flex-col justify-center gap-[0.55cqw] border-b border-black bg-neutral-100 px-[1.5cqw] py-[1.5cqw]">
              <span className="text-[2.2cqw] leading-none font-bold">{copy.collect}</span>
              <div dir="ltr" className="flex items-baseline justify-end gap-[0.7cqw]">
                <span className="text-[2.3cqw] leading-none font-bold">SDG</span>
                <span className="text-[6.4cqw] leading-none font-extrabold tabular-nums">
                  {formatCod(specimen.codAmount)}
                </span>
              </div>
            </div>
            <div className="flex flex-col items-start gap-[0.45cqw] px-[1.3cqw] py-[0.8cqw]">
              <OutlinedBadge>{openBadge}</OutlinedBadge>
              <OutlinedBadge>{pieceBadge}</OutlinedBadge>
            </div>
          </div>
        </div>

        <NotesRefRow
          dir={copy.dir}
          notesLabel={copy.notes}
          note={text.note}
          orderRefLabel={copy.orderRef}
          orderRef={specimen.orderRef}
          className="border-t"
        />
        <ScanBand
          dir={copy.dir}
          trackingLabel={copy.trackingNo}
          code={specimen.trackingCode}
          qrClassName="size-[max(84px,11cqw)]"
          className="border-b-0"
        />
      </div>
      <LabelFooter created={specimen.created} />
    </div>
  );
}

const LAYOUT_CAPTION: Record<AwbLanguage, Record<AwbLayout, string>> = {
  ar: {
    one: "بوليصة واحدة في الورقة",
    one_print: "طباعة بوليصة واحدة على الورقة",
    two_different: "بوليصتان مختلفتان في الورقة",
    two_same: "بوليصتان متطابقتان في الورقة",
    four_different: "أربع بوالص مختلفة في الورقة",
  },
  en: {
    one: "One waybill on the sheet",
    one_print: "Print a single waybill on the sheet",
    two_different: "Two different waybills on the sheet",
    two_same: "Two identical waybills on the sheet",
    four_different: "Four different waybills on the sheet",
  },
};

export function AwbPreview({
  format,
  layout = "one",
  language = "ar",
  merchantName,
  returnLocation,
  specimen,
  sheet = false,
  className,
}: {
  format: AwbFormat;
  layout?: AwbLayout;
  language?: AwbLanguage;
  /** The merchant's own name. Falls back to a sample store. */
  merchantName?: string;
  /** Saved return location from merchant settings. Falls back to a sample. */
  returnLocation?: string;
  /** A real order. Sample labels are used when this is omitted. */
  specimen?: AwbSpecimen;
  /** Print size: A6 is 100×150 mm instead of the settings thumbnail. */
  sheet?: boolean;
  className?: string;
}) {
  const name = merchantName?.trim() || "Gadoura Store";
  const returns =
    returnLocation?.trim() ||
    (language === "ar" ? "موقع الإرجاع المحفوظ" : "Saved return location");
  const usingSavedReturn = Boolean(returnLocation?.trim());
  const sheetLayout = format === "a4" ? layout : "one";

  const labelAt = (index: number) => specimen ?? SPECIMENS[index] ?? SPECIMENS[0];

  const portrait = (index: number, slotClass: string) => (
    <A6Label
      specimen={labelAt(index)}
      language={language}
      merchantName={name}
      returnLocation={returns}
      className={slotClass}
    />
  );

  const landscape = (index: number, slotClass?: string) => (
    <A4LandscapeLabel
      specimen={labelAt(index)}
      language={language}
      merchantName={name}
      returnLocation={returns}
      className={slotClass}
    />
  );

  return (
    <figure
      className={cn("flex w-full min-w-0 flex-col items-center gap-3", className)}
      data-awb-build="131"
      aria-label={language === "ar" ? "معاينة بوليصة الشحن" : "Shipping label preview"}
    >
      <div
        key={`${format}-${sheetLayout}-${language}`}
        className={cn(
          "animate-in fade-in-0 w-full min-w-0 duration-300",
          format === "a6" && (sheet ? "mx-auto w-[100mm]" : "mx-auto max-w-[17rem]"),
        )}
      >
        {format === "a6" ? (
          <div className={cn("shadow-xl shadow-black/10", sheet && "shadow-none")}>
            {portrait(0, sheet ? "h-[150mm] w-[100mm]" : "aspect-[2/3]")}
          </div>
        ) : (
          <A4Sheet layout={sheetLayout} landscape={landscape} portrait={portrait} />
        )}
      </div>
      <figcaption className="awb-screen-only text-muted-foreground text-center text-xs">
        {format === "a6"
          ? language === "ar"
            ? "A6 حراري — ملصق واحد 100×150 مم"
            : "Thermal A6 — one 100×150 mm sticker"
          : sheetLayout === "four_different"
            ? `A4 — 21×29.7 ${language === "ar" ? "سم" : "cm"} — ${LAYOUT_CAPTION[language][sheetLayout]}`
            : language === "ar"
              ? `A4 — 21×29.7 سم — ملصق أفقي 20×14 سم — ${LAYOUT_CAPTION.ar[sheetLayout]}`
              : `A4 — 21×29.7 cm — landscape 20×14 cm label — ${LAYOUT_CAPTION.en[sheetLayout]}`}
        {" · "}
        {language === "ar" ? "العربية" : "English"}
        {" · "}
        {usingSavedReturn
          ? language === "ar"
            ? "موقع الإرجاع من إعداداتك"
            : "Return location from your settings"
          : language === "ar"
            ? "معاينة"
            : "Preview"}
      </figcaption>
    </figure>
  );
}

function CropMarks() {
  const tick = "awb-screen-only pointer-events-none absolute z-20 bg-zinc-900";
  return (
    <>
      <span aria-hidden className={cn(tick, "-top-3 left-[10mm] h-3 w-px")} />
      <span aria-hidden className={cn(tick, "top-[10mm] -left-3 h-px w-3")} />
      <span aria-hidden className={cn(tick, "-top-3 right-[10mm] h-3 w-px")} />
      <span aria-hidden className={cn(tick, "top-[10mm] -right-3 h-px w-3")} />
      <span aria-hidden className={cn(tick, "-bottom-3 left-[10mm] h-3 w-px")} />
      <span aria-hidden className={cn(tick, "bottom-[10mm] -left-3 h-px w-3")} />
      <span aria-hidden className={cn(tick, "-bottom-3 right-[10mm] h-3 w-px")} />
      <span aria-hidden className={cn(tick, "bottom-[10mm] -right-3 h-px w-3")} />
    </>
  );
}

/** True A4 portrait: 210mm × 297mm (794×1123 px at 96dpi). Never scaled to the column. */
function A4Canvas({ children }: { children: React.ReactNode }) {
  return (
    <div className="awb-preview-stage w-full min-w-0 overflow-auto rounded-xl bg-zinc-200 p-6 sm:p-8">
      <p className="awb-screen-only mb-5 text-center font-mono text-[11px] font-semibold tracking-[0.16em] text-zinc-600">
        A4 · 210 × 297 mm
      </p>
      <div className="awb-a4-page relative mx-auto box-border h-[297mm] w-[210mm] shrink-0 border-2 border-black bg-white shadow-[0_0_0_8px_#e4e4e7,0_18px_50px_rgba(0,0,0,0.16)]">
        <CropMarks />
        <div className="relative z-10 h-full w-full">{children}</div>
      </div>
    </div>
  );
}

function Slot({ children }: { children: React.ReactNode }) {
  return <div className="min-h-0 min-w-0 bg-white">{children}</div>;
}

function A4Sheet({
  layout,
  landscape,
  portrait,
}: {
  layout: AwbLayout;
  landscape: (index: number, slotClass?: string) => React.ReactNode;
  portrait: (index: number, slotClass: string) => React.ReactNode;
}) {
  if (layout === "one" || layout === "one_print") {
    return (
      <A4Canvas>
        <div
          className={cn(
            "flex h-full w-full justify-center",
            layout === "one" ? "items-start" : "items-center",
          )}
        >
          {landscape(0)}
        </div>
      </A4Canvas>
    );
  }

  if (layout === "two_same" || layout === "two_different") {
    const second = layout === "two_same" ? 0 : 1;
    return (
      <A4Canvas>
        <div className="flex h-full w-full flex-col items-center justify-between">
          {landscape(0)}
          {landscape(second)}
        </div>
      </A4Canvas>
    );
  }

  return (
    <A4Canvas>
      <div className="grid h-full w-full grid-cols-2 grid-rows-2 gap-[2mm] bg-zinc-300 p-[3mm]">
        <Slot>{portrait(0, "h-full min-h-0 overflow-hidden")}</Slot>
        <Slot>{portrait(1, "h-full min-h-0 overflow-hidden")}</Slot>
        <Slot>{portrait(2, "h-full min-h-0 overflow-hidden")}</Slot>
        <Slot>{portrait(3, "h-full min-h-0 overflow-hidden")}</Slot>
      </div>
    </A4Canvas>
  );
}
