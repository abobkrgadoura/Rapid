import type { MerchantOrderDetail } from "@/lib/data/merchant-orders";

/** One waybill's text. Sample labels and a real order share this shape. */
export type AwbSpecimen = {
  trackingCode: string;
  zoneCode: string;
  hubCode: string;
  hubName: string;
  sector: string;
  regionAr: string;
  regionEn: string;
  streetAr: string;
  streetEn: string;
  buildingAr: string;
  buildingEn: string;
  floorNumber: string;
  apartmentNumber: string;
  landmarkAr: string;
  landmarkEn: string;
  codAmount: string;
  customerAr: string;
  customerEn: string;
  customerPhone: string;
  customerPhone2: string;
  descriptionAr: string;
  descriptionEn: string;
  noteAr: string;
  noteEn: string;
  internalNoteAr: string;
  internalNoteEn: string;
  pieces: string;
  allowOpen: boolean;
  orderRef: string;
  created: string;
  page: string;
};

type Zone = Pick<
  AwbSpecimen,
  "zoneCode" | "hubCode" | "hubName" | "sector" | "regionAr" | "regionEn"
>;

function zoneFor(address: string): Zone {
  const text = address.toLowerCase();
  if (address.includes("أم درمان") || text.includes("omdurman")) {
    return {
      zoneCode: "OMD",
      hubCode: "OMD-01",
      hubName: "Omdurman Hub",
      sector: "OMD-01",
      regionAr: "ولاية الخرطوم — أم درمان",
      regionEn: "Khartoum State — Omdurman",
    };
  }
  if (address.includes("بحري") || text.includes("bahri")) {
    return {
      zoneCode: "BAH",
      hubCode: "BAH-01",
      hubName: "Bahri Hub",
      sector: "BAH-01",
      regionAr: "ولاية الخرطوم — الخرطوم بحري",
      regionEn: "Khartoum State — Bahri",
    };
  }
  if (address.includes("بورتسودان") || text.includes("port sudan")) {
    return {
      zoneCode: "PSD",
      hubCode: "PSD-01",
      hubName: "Port Sudan Hub",
      sector: "PSD-01",
      regionAr: "ولاية البحر الأحمر — بورتسودان",
      regionEn: "Red Sea — Port Sudan",
    };
  }
  if (address.includes("الخرطوم") || text.includes("khartoum")) {
    return {
      zoneCode: "KRT",
      hubCode: "KRT-01",
      hubName: "Khartoum Hub",
      sector: "KRT-01",
      regionAr: "ولاية الخرطوم — الخرطوم",
      regionEn: "Khartoum State — Khartoum",
    };
  }
  return {
    zoneCode: "SD",
    hubCode: "SD-01",
    hubName: "Sudan Hub",
    sector: "SD-01",
    regionAr: "السودان",
    regionEn: "Sudan",
  };
}

/** Whole pounds for the COD box. The sticker has no cents place. */
function codPounds(canonical: string, collect: boolean): string {
  if (!collect) return "0";
  const [whole = "0", fraction = "00"] = canonical.split(".");
  const carry = Number(fraction.slice(0, 2).padEnd(2, "0")) >= 50;
  if (!carry) return whole.replace(/^0+(?=\d)/, "") || "0";
  return (BigInt(whole) + BigInt(1)).toString();
}

/** Fills a waybill from one merchant order. Private notes stay on the specimen so the label can strip them. */
export function orderToAwbSpecimen(order: MerchantOrderDetail): AwbSpecimen {
  const extras = order.extras;
  const zone = zoneFor(`${order.dropoffAddress} ${extras?.landmark ?? ""}`);
  const customer = order.customerName.trim() || "—";
  const description = extras?.productDescription.trim() || "شحنة";
  const note = extras?.deliveryNotes.trim() || "";
  const internal = extras?.internalNotes.trim() || "";
  const building = extras?.buildingName.trim() || "";
  const landmark = extras?.landmark.trim() || "—";

  return {
    ...zone,
    trackingCode: order.trackingCode,
    streetAr: order.dropoffAddress || "—",
    streetEn: order.dropoffAddress || "—",
    buildingAr: building,
    buildingEn: building,
    floorNumber: extras?.floorNumber.trim() || "",
    apartmentNumber: extras?.apartmentNumber.trim() || "",
    landmarkAr: landmark,
    landmarkEn: landmark,
    codAmount: codPounds(order.productPrice, order.paymentType === "cod"),
    customerAr: customer,
    customerEn: customer,
    customerPhone: order.phone || "—",
    customerPhone2: order.secondaryPhone,
    descriptionAr: description,
    descriptionEn: description,
    noteAr: note,
    noteEn: note,
    internalNoteAr: internal,
    internalNoteEn: internal,
    pieces: String(extras?.piecesCount ?? 1),
    allowOpen: extras?.allowOpening ?? false,
    orderRef: order.originalTracking || order.trackingCode,
    created: order.createdLabel,
    page: "1/1",
  };
}
