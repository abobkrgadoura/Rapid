/**
 * Login identifiers. An email stays an email. A phone is stored and sent to
 * Supabase as E.164.
 *
 * Local rules, applied only when the number does not already start with "+":
 * - Egypt mobiles are 11 digits and start with 010, 011, 012, or 015 → +20…
 * - Sudan numbers are 10 digits and start with 09 or 01 → +249…
 * A 10-digit 010 / 011 / 012 / 015 is Sudan, because the Egyptian form is
 * one digit longer. While the person is still typing, those 10 digits are
 * left alone so an Egyptian number is not rewritten early.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164 = /^\+[1-9]\d{7,14}$/;
const EGYPT_LOCAL = /^01[0125]\d{8}$/;
const SUDAN_LOCAL = /^0[19]\d{8}$/;
const AMBIGUOUS_LOCAL = /^01[0125]\d{7}$/;

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const EASTERN_INDIC = "۰۱۲۳۴۵۶۷۸۹";

export const AUTH_PHONE_HINT =
  "رقم سوداني من 10 أرقام يبدأ بـ 09 أو 01، أو رقم مصري من 11 رقمًا يبدأ بـ 010 أو 011 أو 012 أو 015، أو رقم دولي يبدأ بـ +.";

export type AuthIdentifier =
  | { kind: "email"; email: string }
  | { kind: "phone"; phone: string };

function toLatinDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => {
    const arabic = ARABIC_INDIC.indexOf(digit);
    return String(arabic !== -1 ? arabic : EASTERN_INDIC.indexOf(digit));
  });
}

/** Digits, with a single leading "+" when the person typed an international number. */
function compactPhoneChars(raw: string): string {
  const stripped = toLatinDigits(raw).replace(/[^\d+]/g, "");
  if (!stripped) return "";
  if (stripped.startsWith("+")) {
    return `+${stripped.slice(1).replace(/\D/g, "")}`.slice(0, 16);
  }
  const digits = stripped.replace(/\D/g, "");
  if (digits.startsWith("00")) {
    return `+${digits.slice(2)}`.slice(0, 16);
  }
  return digits.slice(0, 15);
}

/** Canonical E.164, or null when the value is not a finished phone number. */
export function formatAuthPhone(raw: string): string | null {
  const compact = compactPhoneChars(raw);
  if (!compact) return null;

  if (compact.startsWith("+")) {
    return E164.test(compact) ? compact : null;
  }

  if (EGYPT_LOCAL.test(compact)) {
    return `+20${compact.slice(1)}`;
  }

  if (SUDAN_LOCAL.test(compact)) {
    return `+249${compact.slice(1)}`;
  }

  if (/^249[19]\d{8}$/.test(compact)) {
    return `+${compact}`;
  }

  if (/^20(?:10|11|12|15)\d{8}$/.test(compact)) {
    return `+${compact}`;
  }

  return null;
}

/**
 * True when the typed digits can only mean one country, so the field may
 * rewrite them before the person leaves the input.
 */
function shouldSnapWhileTyping(compact: string): boolean {
  if (EGYPT_LOCAL.test(compact) || /^09\d{8}$/.test(compact)) return true;
  if (SUDAN_LOCAL.test(compact) && !AMBIGUOUS_LOCAL.test(compact)) return true;
  if (/^249[19]\d{8}$/.test(compact)) return true;
  if (/^20(?:10|11|12|15)\d{8}$/.test(compact)) return true;
  return false;
}

/**
 * What the input shows. `commit` is for blur and submit: a finished 10-digit
 * Sudan number that shares a prefix with Egypt is rewritten then.
 */
export function formatPhoneInput(raw: string, commit = false): string {
  const compact = compactPhoneChars(raw);
  if (!compact || compact.startsWith("+")) return compact;
  if (commit || shouldSnapWhileTyping(compact)) {
    return formatAuthPhone(compact) ?? compact;
  }
  return compact;
}

/** Phone or email field. Letters and "@" are left as an email address. */
export function formatIdentifierInput(raw: string, commit = false): string {
  const latin = toLatinDigits(raw);
  if (/[A-Za-z@]/.test(latin)) return commit ? latin.trim() : latin;
  return formatPhoneInput(latin, commit);
}

export function parseAuthIdentifier(raw: string): AuthIdentifier | null {
  const value = toLatinDigits(raw).trim();
  if (!value) return null;

  if (value.includes("@") || /[A-Za-z]/.test(value)) {
    const email = value.toLowerCase();
    if (email.length > 254 || !EMAIL.test(email)) return null;
    return { kind: "email", email };
  }

  const phone = formatAuthPhone(value);
  if (!phone) return null;
  return { kind: "phone", phone };
}

/** Profile rows may still hold the local form written before E.164 storage. */
export function phoneLookupValues(phone: string): string[] {
  const values = new Set<string>([phone]);
  if (/^\+249[19]\d{8}$/.test(phone)) values.add(`0${phone.slice(4)}`);
  if (/^\+20(?:10|11|12|15)\d{8}$/.test(phone)) values.add(`0${phone.slice(3)}`);
  return [...values];
}
