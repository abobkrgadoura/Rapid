/**
 * Sudan and Egypt recipient numbers.
 * Sudan local is 10 digits starting with 09 or 01. International is +249
 * plus those 9 digits without the leading zero.
 * Egypt mobile local is 11 digits starting with 010, 011, 012, or 015.
 * International is +20 plus those 10 digits without the leading zero.
 * A 10-digit 01… number stays Sudan; the Egyptian local form is one digit longer.
 */
const SUDAN_PHONE = /^(?:\+249|0)[19]\d{8}$/;
const EGYPT_PHONE = /^(?:\+201[0125]\d{8}|01[0125]\d{8})$/;

function latinDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => {
    const arabic = "٠١٢٣٤٥٦٧٨٩".indexOf(digit);
    if (arabic >= 0) return String(arabic);
    const persian = "۰۱۲۳۴۵۶۷۸۹".indexOf(digit);
    return persian >= 0 ? String(persian) : digit;
  });
}

function compactPhone(value: string): string {
  return latinDigits(value).trim().replace(/[\s().-]/g, "");
}

/** Sudan local or +249 only. Driver emergency numbers stay on this rule. */
export function normalizeSudanPhone(value: string): string | null {
  const compact = compactPhone(value);
  return SUDAN_PHONE.test(compact) ? compact : null;
}

export function normalizeRecipientPhone(value: string): string | null {
  const compact = compactPhone(value);
  return SUDAN_PHONE.test(compact) || EGYPT_PHONE.test(compact) ? compact : null;
}

export type RecipientDropoff = {
  customerName: string;
  phone: string;
  secondaryPhone: string;
  dropoffAddress: string;
};

/**
 * Orders do not have recipient columns. Name and phone are stored on the
 * first two lines of dropoff_address so the street address stays on its own
 * line for a later split. An optional secondary phone sits on its own line
 * with an `alt:` prefix, which older three-line records never used.
 */
export type DropoffMeta = {
  originalTracking?: string;
  newItemNote?: string;
  returnItemNote?: string;
};

/**
 * Extra lines after the street address. `alt:` is the secondary phone and is
 * parsed above. These prefixes are stripped when the address is displayed.
 */
function metaLines(meta?: DropoffMeta): string[] {
  if (!meta) return [];
  const lines: string[] = [];
  const tracking = meta.originalTracking?.trim();
  const nextItem = meta.newItemNote?.trim();
  const returning = meta.returnItemNote?.trim();
  if (tracking) lines.push(`ref:${tracking}`);
  if (nextItem) lines.push(`item:${nextItem}`);
  if (returning) lines.push(`back:${returning}`);
  return lines;
}

function visibleAddress(lines: string[]): string {
  return lines
    .filter((line) => !/^(ref|item|back):/i.test(line.trim()))
    .join("\n")
    .trim();
}

export function encodeRecipientDropoff(
  customerName: string,
  phone: string,
  dropoffAddress: string,
  secondaryPhone = "",
  meta?: DropoffMeta,
): string {
  const lines = [customerName, phone];
  const alt = secondaryPhone.trim();
  if (alt) lines.push(`alt:${alt}`);
  lines.push(dropoffAddress);
  lines.push(...metaLines(meta));
  return lines.join("\n");
}

export function decodeRecipientDropoff(stored: string): RecipientDropoff {
  const lines = stored.split("\n");
  const phone = lines[1]?.trim() ?? "";
  if (lines.length >= 3 && lines[0]?.trim() && isRecipientPhone(phone)) {
    const third = lines[2]?.trim() ?? "";
    const alt = third.startsWith("alt:") ? third.slice(4).trim() : "";
    if (alt && isRecipientPhone(alt) && lines.length >= 4) {
      return {
        customerName: lines[0].trim(),
        phone,
        secondaryPhone: alt,
        dropoffAddress: visibleAddress(lines.slice(3)),
      };
    }
    return {
      customerName: lines[0].trim(),
      phone,
      secondaryPhone: "",
      dropoffAddress: visibleAddress(lines.slice(2)),
    };
  }

  return {
    customerName: "",
    phone: "",
    secondaryPhone: "",
    dropoffAddress: stored.trim(),
  };
}

/** Pulls the optional exchange and return notes off the stored dropoff lines. */
export function decodeDropoffNotes(stored: string): Required<DropoffMeta> {
  let originalTracking = "";
  let newItemNote = "";
  let returnItemNote = "";
  for (const line of stored.split("\n")) {
    const match = /^(ref|item|back):(.*)$/i.exec(line.trim());
    if (!match) continue;
    const value = match[2].trim();
    if (!value) continue;
    const kind = match[1].toLowerCase();
    if (kind === "ref") originalTracking = value;
    else if (kind === "item") newItemNote = value;
    else returnItemNote = value;
  }
  return { originalTracking, newItemNote, returnItemNote };
}

export function isRecipientPhone(value: string): boolean {
  return normalizeRecipientPhone(value) !== null;
}
