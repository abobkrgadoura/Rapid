import { AUTH_PHONE_HINT, formatAuthPhone } from "@/lib/auth/identifier";

/**
 * Merchant Settings Hub: option lists, the shape of `profiles.preferences`,
 * and input validation. Pure and shared: the form reads the option lists, the
 * server action runs the validators. The database re-checks the same rules
 * (migration 0005), so this file is the friendly layer, not the only one.
 */

export const BUSINESS_CATEGORIES = [
  { value: "electronics", label: "إلكترونيات" },
  { value: "fashion", label: "أزياء وملابس" },
  { value: "books", label: "كتب ومكتبات" },
  { value: "beauty", label: "مستحضرات تجميل" },
  { value: "home", label: "أدوات منزلية وديكور" },
  { value: "food", label: "أغذية ومشروبات" },
  { value: "health", label: "صحة وعناية" },
  { value: "toys", label: "ألعاب أطفال" },
  { value: "sports", label: "رياضة" },
  { value: "other", label: "أخرى" },
] as const;

export type BusinessCategory = (typeof BUSINESS_CATEGORIES)[number]["value"];

export const AWB_FORMATS = [
  {
    value: "a6",
    label: "A6 حراري",
    description: "ملصق 100×150 مم لطابعات الباركود الحرارية.",
  },
  {
    value: "a4",
    label: "A4 عادي",
    description: "ورقة A4 بطابعة مكتبية، أكثر من بوليصة في الصفحة.",
  },
] as const;

export type AwbFormat = (typeof AWB_FORMATS)[number]["value"];

export const AWB_LANGUAGES = [
  { value: "ar", label: "العربية" },
  { value: "en", label: "English" },
] as const;

export type AwbLanguage = (typeof AWB_LANGUAGES)[number]["value"];

/** How an A4 sheet is divided. A6 ignores this and stays one portrait sticker. */
export const AWB_LAYOUTS = [
  { value: "one", label: "بوليصة واحدة في الورقة" },
  { value: "one_print", label: "طباعة بوليصة واحدة على الورقة" },
  { value: "two_different", label: "بوليصتان مختلفتان في الورقة" },
  { value: "two_same", label: "بوليصتان متطابقتان في الورقة" },
  { value: "four_different", label: "أربع بوالص مختلفة في الورقة" },
] as const;

export type AwbLayout = (typeof AWB_LAYOUTS)[number]["value"];

export const TEAM_ROLES = [
  { value: "manager", label: "مدير" },
  { value: "member", label: "عضو" },
] as const;

export type TeamRole = (typeof TEAM_ROLES)[number]["value"];

export type TeamMember = {
  name: string;
  email: string;
  role: TeamRole;
};

export function isBusinessCategory(value: unknown): value is BusinessCategory {
  return BUSINESS_CATEGORIES.some((category) => category.value === value);
}

export function isAwbFormat(value: unknown): value is AwbFormat {
  return AWB_FORMATS.some((format) => format.value === value);
}

export function isAwbLanguage(value: unknown): value is AwbLanguage {
  return AWB_LANGUAGES.some((language) => language.value === value);
}

export function isAwbLayout(value: unknown): value is AwbLayout {
  return AWB_LAYOUTS.some((layout) => layout.value === value);
}

export function isTeamRole(value: unknown): value is TeamRole {
  return TEAM_ROLES.some((role) => role.value === value);
}

export function categoryLabel(value: string | null): string | null {
  return BUSINESS_CATEGORIES.find((category) => category.value === value)?.label ?? null;
}

// ---------------------------------------------------------------------------
// profiles.preferences
// ---------------------------------------------------------------------------

/** Stored JSON keys. Snake case on the wire, camel case in the app. */
export type StoredPreferences = {
  awb_format?: AwbFormat;
  awb_language?: AwbLanguage;
  awb_layout?: AwbLayout;
  auto_print?: boolean;
  whatsapp_notifications?: boolean;
  default_deposit?: number;
  platform_language?: AwbLanguage;
  team_members?: Array<{ name: string; email: string; role: TeamRole }>;
};

/**
 * Expected monthly shipment volume, chosen on the post-registration screen.
 * "شحنة واحدة فقط" is shown disabled and is never stored.
 */
export const MONTHLY_VOLUMES = [
  "under_100",
  "between_100_400",
  "over_400",
] as const;

export type MonthlyVolume = (typeof MONTHLY_VOLUMES)[number];

export function isMonthlyVolume(value: unknown): value is MonthlyVolume {
  return MONTHLY_VOLUMES.some((volume) => volume === value);
}

export type MerchantPreferences = {
  awbFormat: AwbFormat;
  awbLanguage: AwbLanguage;
  awbLayout: AwbLayout;
  /** Saved platform language. The merchant shell, buttons, and settings follow it. */
  platformLanguage: AwbLanguage;
  teamMembers: TeamMember[];
  autoPrint: boolean;
  whatsappNotifications: boolean;
  /** Canonical decimal text ("150.50") or "" when no default is set. */
  defaultDeposit: string;
  /**
   * Saved once on the company tab (and refreshed when an order is created).
   * The order form pre-fills these so the merchant does not retype them.
   * Held in preferences: migration 0005 accepts unknown JSON keys.
   */
  pickupAddress: string;
  returnAddress: string;
  pickupGpsUrl: string;
  monthlyVolume: MonthlyVolume | null;
};

export const DEFAULT_PREFERENCES: MerchantPreferences = {
  awbFormat: "a6",
  awbLanguage: "ar",
  awbLayout: "one",
  platformLanguage: "ar",
  teamMembers: [],
  autoPrint: false,
  whatsappNotifications: true,
  defaultDeposit: "",
  pickupAddress: "",
  returnAddress: "",
  pickupGpsUrl: "",
  monthlyVolume: null,
};

const MAX_DEPOSIT = 999_999_999.99;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function preferenceText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const text = value.trim();
  return text.length > 0 && text.length <= max ? text : "";
}

const TEAM_LIMIT = 8;

function readTeamMembers(value: unknown): TeamMember[] {
  if (!Array.isArray(value)) return [];
  const members: TeamMember[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const name = preferenceText(item.name, 80);
    const email = preferenceText(item.email, 120);
    if (!name || !email || !isTeamRole(item.role)) continue;
    members.push({ name, email, role: item.role });
    if (members.length === TEAM_LIMIT) break;
  }
  return members;
}

/**
 * Reads the JSONB bag defensively. Anything missing or of the wrong type falls
 * back to its default, so a malformed row can never break the settings page.
 */
export function readPreferences(raw: unknown): MerchantPreferences {
  if (!isRecord(raw)) return { ...DEFAULT_PREFERENCES, teamMembers: [] };

  const deposit = raw.default_deposit;
  return {
    awbFormat: isAwbFormat(raw.awb_format)
      ? raw.awb_format
      : DEFAULT_PREFERENCES.awbFormat,
    awbLanguage: isAwbLanguage(raw.awb_language)
      ? raw.awb_language
      : DEFAULT_PREFERENCES.awbLanguage,
    awbLayout: isAwbLayout(raw.awb_layout)
      ? raw.awb_layout
      : DEFAULT_PREFERENCES.awbLayout,
    platformLanguage: isAwbLanguage(raw.platform_language)
      ? raw.platform_language
      : DEFAULT_PREFERENCES.platformLanguage,
    teamMembers: readTeamMembers(raw.team_members),
    autoPrint:
      typeof raw.auto_print === "boolean"
        ? raw.auto_print
        : DEFAULT_PREFERENCES.autoPrint,
    whatsappNotifications:
      typeof raw.whatsapp_notifications === "boolean"
        ? raw.whatsapp_notifications
        : DEFAULT_PREFERENCES.whatsappNotifications,
    defaultDeposit:
      typeof deposit === "number" &&
      Number.isFinite(deposit) &&
      deposit > 0 &&
      deposit <= MAX_DEPOSIT
        ? deposit.toFixed(2)
        : "",
    pickupAddress: preferenceText(raw.pickup_address, 240),
    returnAddress: preferenceText(raw.return_address, 240),
    pickupGpsUrl: preferenceText(raw.pickup_gps_url, 2048),
    monthlyVolume: isMonthlyVolume(raw.monthly_volume) ? raw.monthly_volume : null,
  };
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type CompanyInput = {
  section: "company";
  companyName: string;
  websiteUrl: string;
  businessCategory: string;
  pickupAddress: string;
  returnAddress: string;
};

export type PersonalInput = {
  section: "personal";
  fullName: string;
  phone: string;
};

export type PlatformInput = {
  section: "platform";
  platformLanguage: string;
  autoPrint: boolean;
};

export type TeamInput = {
  section: "team";
  members: unknown;
};

export type ShippingInput = {
  section: "shipping";
  whatsappNotifications: boolean;
  defaultDeposit: string;
};

export type AwbInput = {
  section: "awb";
  awbFormat: string;
  awbLanguage: string;
  awbLayout: string;
};

export type MerchantProfileInput =
  | CompanyInput
  | PersonalInput
  | PlatformInput
  | TeamInput
  | ShippingInput
  | AwbInput;

export type SettingsField =
  | "companyName"
  | "phone"
  | "fullName"
  | "websiteUrl"
  | "businessCategory"
  | "pickupAddress"
  | "returnAddress"
  | "whatsappNotifications"
  | "defaultDeposit"
  | "awbFormat"
  | "awbLanguage"
  | "awbLayout"
  | "platformLanguage"
  | "autoPrint"
  | "teamMembers";

export type FieldErrors = Partial<Record<SettingsField, string>>;

/** Columns written to public.profiles for the company tab. */
export type CompanyColumns = {
  company_name: string;
  website_url: string | null;
  business_category: BusinessCategory | null;
};

export type PersonalColumns = {
  full_name: string;
  phone: string;
};

/** Addresses live in preferences, beside the company columns. */
export type SavedLocations = {
  pickup_address: string;
  return_address: string;
};

export type ParsedMerchantUpdate =
  | { section: "company"; columns: CompanyColumns; locations: SavedLocations }
  | { section: "personal"; columns: PersonalColumns }
  | { section: "preferences"; patch: StoredPreferences };

export type ParseResult =
  | { ok: true; update: ParsedMerchantUpdate }
  | { ok: false; errors: FieldErrors };

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const EASTERN_INDIC = "۰۱۲۳۴۵۶۷۸۹";

/** Merchants type on Arabic keyboards. Fold ٠-٩ and ۰-۹ to 0-9. */
export function toLatinDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => {
    const arabic = ARABIC_INDIC.indexOf(digit);
    return String(arabic !== -1 ? arabic : EASTERN_INDIC.indexOf(digit));
  });
}

function textField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Blank is allowed. A typed address must be long enough to navigate to. */
function optionalAddress(
  input: string,
): { ok: true; value: string } | { ok: false } {
  const value = input.trim().replace(/[^\S\n]+/g, " ");
  if (value.length === 0) return { ok: true, value: "" };
  if (value.length < 4 || value.length > 240) return { ok: false };
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return { ok: false };
  return { ok: true, value };
}

/** "example.com" is accepted and stored as https://example.com. */
function normalizeWebsite(input: string): string | null {
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(input)
    ? input
    : `https://${input}`;
  if (withScheme.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(withScheme)) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  // Needs a real host: "https://localhost" or a bare word is not a website.
  if (!url.hostname.includes(".")) return null;

  const normalized = url.toString();
  return normalized.length <= 2048 ? normalized : null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseTeamMembers(
  value: unknown,
): { ok: true; members: TeamMember[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: "قائمة الفريق غير صالحة." };
  }
  if (value.length > TEAM_LIMIT) {
    return { ok: false, error: `يمكن حفظ ${TEAM_LIMIT} أعضاء كحد أقصى.` };
  }
  const members: TeamMember[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      return { ok: false, error: "راجع بيانات أعضاء الفريق." };
    }
    const name = textField(item.name).replace(/\s+/g, " ");
    const email = textField(item.email).toLowerCase();
    if (name.length < 2 || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) {
      return { ok: false, error: "اكتب اسم كل عضو (حرفان على الأقل)." };
    }
    if (email.length > 120 || !EMAIL.test(email)) {
      return { ok: false, error: "اكتب بريدًا صحيحًا لكل عضو." };
    }
    if (!isTeamRole(item.role)) {
      return { ok: false, error: "اختر دور كل عضو من القائمة." };
    }
    members.push({ name, email, role: item.role });
  }
  return { ok: true, members };
}

/** Whole or two-decimal amount, as typed. Returns a JSON number or null. */
function parseDeposit(input: string): number | null {
  const text = toLatinDigits(input).replace(/[٫]/g, ".").replace(/[,٬\s]/g, "");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(text)) return null;
  const amount = Number(text);
  return Number.isFinite(amount) && amount <= MAX_DEPOSIT ? amount : null;
}

/**
 * Validates untrusted input from the client. The caller passes whatever the
 * browser sent, so every field is type-checked here rather than trusted.
 */
export function parseMerchantProfileInput(input: unknown): ParseResult {
  if (!isRecord(input)) {
    return { ok: false, errors: {} };
  }

  switch (input.section) {
    case "company": {
      const errors: FieldErrors = {};
      const companyName = textField(input.companyName);
      const websiteText = textField(input.websiteUrl);
      const categoryText = textField(input.businessCategory);

      if (companyName.length === 0) {
        errors.companyName = "اكتب اسم الشركة.";
      } else if (companyName.length > 120) {
        errors.companyName = "اسم الشركة لا يزيد عن 120 حرفًا.";
      }

      let websiteUrl: string | null = null;
      if (websiteText.length > 0) {
        websiteUrl = normalizeWebsite(websiteText);
        if (websiteUrl === null) {
          errors.websiteUrl = "اكتب رابطًا صحيحًا مثل example.com.";
        }
      }

      let businessCategory: BusinessCategory | null = null;
      if (categoryText.length > 0) {
        if (isBusinessCategory(categoryText)) {
          businessCategory = categoryText;
        } else {
          errors.businessCategory = "اختر مجالًا من القائمة.";
        }
      }

      const pickup = optionalAddress(textField(input.pickupAddress));
      const returnLocation = optionalAddress(textField(input.returnAddress));
      if (!pickup.ok) {
        errors.pickupAddress = "اكتب عنوان الاستلام (4 أحرف على الأقل) أو اتركه فارغًا.";
      }
      if (!returnLocation.ok) {
        errors.returnAddress =
          "اكتب موقع إرجاع الشحنة (4 أحرف على الأقل) أو اتركه فارغًا.";
      }

      if (Object.keys(errors).length > 0 || !pickup.ok || !returnLocation.ok) {
        return { ok: false, errors };
      }
      return {
        ok: true,
        update: {
          section: "company",
          columns: {
            company_name: companyName,
            website_url: websiteUrl,
            business_category: businessCategory,
          },
          locations: {
            pickup_address: pickup.value,
            return_address: returnLocation.value,
          },
        },
      };
    }

    case "personal": {
      const errors: FieldErrors = {};
      const fullName = textField(input.fullName).replace(/\s+/g, " ");
      const phone = formatAuthPhone(textField(input.phone));

      if (fullName.length < 2 || fullName.length > 80) {
        errors.fullName = "اكتب الاسم كما تريد أن يظهر في الحساب.";
      } else if (/[\u0000-\u001f\u007f]/.test(fullName)) {
        errors.fullName = "اكتب الاسم كما تريد أن يظهر في الحساب.";
      }
      if (!phone) {
        errors.phone = AUTH_PHONE_HINT;
      }
      if (Object.keys(errors).length > 0 || !phone) return { ok: false, errors };
      return {
        ok: true,
        update: {
          section: "personal",
          columns: { full_name: fullName, phone },
        },
      };
    }

    case "platform": {
      const errors: FieldErrors = {};
      if (!isAwbLanguage(input.platformLanguage)) {
        errors.platformLanguage = "اختر لغة المنصة.";
      }
      if (typeof input.autoPrint !== "boolean") {
        errors.autoPrint = "قيمة غير صالحة.";
      }
      if (Object.keys(errors).length > 0 || !isAwbLanguage(input.platformLanguage)) {
        return { ok: false, errors };
      }
      return {
        ok: true,
        update: {
          section: "preferences",
          patch: {
            platform_language: input.platformLanguage,
            auto_print: input.autoPrint === true,
          },
        },
      };
    }

    case "team": {
      const parsed = parseTeamMembers(input.members);
      if (!parsed.ok) {
        return { ok: false, errors: { teamMembers: parsed.error } };
      }
      return {
        ok: true,
        update: {
          section: "preferences",
          patch: { team_members: parsed.members },
        },
      };
    }

    case "shipping": {
      const errors: FieldErrors = {};
      if (typeof input.whatsappNotifications !== "boolean") {
        errors.whatsappNotifications = "قيمة غير صالحة.";
      }

      const depositText = textField(input.defaultDeposit);
      let deposit: number | null = 0;
      if (depositText.length > 0) {
        deposit = parseDeposit(depositText);
        if (deposit === null) {
          errors.defaultDeposit =
            "اكتب مبلغًا صحيحًا بحد أقصى خانتين عشريتين.";
        }
      }

      if (Object.keys(errors).length > 0 || deposit === null) {
        return { ok: false, errors };
      }
      return {
        ok: true,
        update: {
          section: "preferences",
          patch: {
            whatsapp_notifications: input.whatsappNotifications === true,
            default_deposit: deposit,
          },
        },
      };
    }

    case "awb": {
      const errors: FieldErrors = {};
      if (!isAwbFormat(input.awbFormat)) {
        errors.awbFormat = "اختر مقاس البوليصة.";
      }
      if (!isAwbLanguage(input.awbLanguage)) {
        errors.awbLanguage = "اختر لغة البوليصة.";
      }
      if (!isAwbLayout(input.awbLayout)) {
        errors.awbLayout = "اختر توزيع البوليصة على الورقة.";
      }
      if (
        Object.keys(errors).length > 0 ||
        !isAwbFormat(input.awbFormat) ||
        !isAwbLanguage(input.awbLanguage) ||
        !isAwbLayout(input.awbLayout)
      ) {
        return { ok: false, errors };
      }
      return {
        ok: true,
        update: {
          section: "preferences",
          patch: {
            awb_format: input.awbFormat,
            awb_language: input.awbLanguage,
            awb_layout: input.awbLayout,
          },
        },
      };
    }

    default:
      return { ok: false, errors: {} };
  }
}
