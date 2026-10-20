import type { HubErrorCode } from "@/lib/hub/types";

/**
 * Shapes and messages shared between the admin server actions and the admin
 * screens. Kept out of the "use server" file, which may only export async
 * functions.
 */

export type AdminErrorCode =
  | "unauthorized"
  | "forbidden"
  | "invalid"
  | "invalid_name"
  | "invalid_phone"
  | "invalid_vehicle"
  | "invalid_emergency_phone"
  | "invalid_kyc"
  | "invalid_cash_limit"
  | "cash_limit"
  | "invalid_email"
  | "weak_password"
  | "invalid_zone"
  | "invalid_staff_type"
  | "not_found"
  | "not_pending"
  | "not_at_hub"
  | "taken"
  | "same_driver"
  | "inactive"
  | "wrong_staff_type"
  | "needs_driver"
  | "locked"
  | "has_history"
  | "email_taken"
  | "phone_taken"
  | "phone_auth_disabled"
  | "service_key_missing"
  | "migration_pending"
  | "failed";

export type AdminResult<T> = ({ ok: true } & T) | { ok: false; error: AdminErrorCode };

export const ADMIN_ERROR_MESSAGES: Record<AdminErrorCode, string> = {
  unauthorized: "انتهت الجلسة. سجّل الدخول من جديد.",
  forbidden: "حسابك لا يملك صلاحية تنفيذ هذا الإجراء.",
  invalid: "البيانات المُدخلة غير صالحة.",
  invalid_name: "اكتب الاسم بالكامل (حرفان على الأقل).",
  invalid_phone:
    "اكتب رقمًا سودانيًا من 10 أرقام يبدأ بـ 09 أو 01، أو رقمًا مصريًا من 11 رقمًا يبدأ بـ 010 أو 011 أو 012 أو 015، أو رقمًا دوليًا يبدأ بـ +.",
  invalid_vehicle: "اختر نوع المركبة: دراجة نارية، سيارة فان، أو سيارة ملاكي.",
  invalid_emergency_phone: "اكتب رقم طوارئ سودانيًا من 10 أرقام يبدأ بـ 09 أو 01، أو بصيغة +249.",
  invalid_kyc: "اختر حالة التحقق: قيد المراجعة، موثّق، أو مرفوض.",
  invalid_cash_limit: "سقف العهدة مبلغ صحيح بالجنيه السوداني.",
  cash_limit:
    "تجاوز المندوب سقف العهدة النقدية، وممنوع من استلام شحنات الدفع عند الاستلام الجديدة.",
  invalid_email: "البريد الإلكتروني غير صالح.",
  weak_password: "كلمة المرور يجب ألا تقل عن 8 أحرف.",
  invalid_zone: "حدد المنطقة أو المخزن (حرفان على الأقل).",
  invalid_staff_type: "اختر نوع المندوب أو الموظف.",
  not_found: "لم يُعثر على الشحنة أو الحساب.",
  not_pending: "هذه الشحنة لم تعد بانتظار الاستلام.",
  not_at_hub: "هذه الشحنة ليست في مخزن الفرز بعد.",
  taken: "هذه الشحنة خرجت مع مندوب آخر.",
  same_driver: "هذا المندوب استلم الشحنة من التاجر، فيجب أن يوصلها مندوب آخر.",
  inactive: "هذا الحساب موقوف ولا يمكن تعيين شحنات له.",
  wrong_staff_type: "نوع هذا المندوب لا يناسب هذه المرحلة من الشحنة.",
  needs_driver: "هذه الحالة تحتاج مندوبًا معيّنًا على الشحنة أولًا.",
  locked: "الشحنة مُسلَّمة أو سُجّلت لها حركة مالية، ولا يمكن تغيير حالتها.",
  has_history:
    "لا يمكن حذف مندوب له سجل مالي أو شحنات مُسلَّمة. استخدم إيقاف الحساب بدلًا من ذلك.",
  email_taken: "هذا البريد مسجل بالفعل لحساب آخر.",
  phone_taken: "رقم الهاتف هذا مسجل بالفعل لحساب آخر.",
  phone_auth_disabled: "تسجيل الدخول بالهاتف غير مفعّل في Supabase. فعّل مزود الهاتف من لوحة Auth.",
  service_key_missing:
    "مفتاح SUPABASE_SERVICE_ROLE_KEY غير مضبوط، فلا يمكن إنشاء الحساب تلقائيًا. اطلب من الشخص التسجيل أولًا بنفس رقم الهاتف أو البريد من صفحة التسجيل ثم أعد المحاولة لربطه بالطاقم.",
  migration_pending:
    "لم يُطبَّق تحديث قاعدة البيانات بعد (0007 لإدارة الطاقم، أو 0008 للسودان والتحقق، أو 0012 لمراجعة الاستثناءات). هذه الميزة غير متاحة حتى يُطبَّق الملف.",
  failed: "حدث خطأ غير متوقع. حاول مرة أخرى.",
};

export type SkipReason = "not_found" | "not_pending" | "not_at_hub" | "same_driver" | "invalid";

export const SKIP_REASON_MESSAGES: Record<SkipReason, string> = {
  not_found: "غير موجودة",
  not_pending: "ليست بانتظار الاستلام",
  not_at_hub: "ليست في المخزن",
  same_driver: "نفس مندوب الاستلام",
  invalid: "غير صالحة",
};

export type DispatchOutcome = {
  assigned: string[];
  newlyOut: string[];
  skipped: Array<{ code: string; reason: SkipReason }>;
};

/** What the scanner shows for a parcel that was just handled. */
export type ScanInfo = {
  trackingCode: string;
  zone: string;
  sortCode: string;
  merchantName: string;
  paymentType: "cod" | "prepaid";
  cod: string | null;
  customerName: string;
  driverName: string | null;
};

export type InboundScan = { info: ScanInfo | null; alreadyReceived: boolean };
export type OutboundScan = { info: ScanInfo | null; alreadyLoaded: boolean };

export type OrderEditInput = {
  trackingCode: string;
  phone: string;
  address: string;
  codAmount: string;
  deliveryNotes: string;
};

export type StaffInput = {
  fullName: string;
  phone: string;
  email: string;
  password: string;
  hubZone: string;
  staffType: string;
  vehicleType: string;
  emergencyPhone: string;
  kycStatus: string;
  maxCashLimit: string;
};

export type StaffEditInput = {
  fullName: string;
  phone: string;
  hubZone: string;
  staffType: string;
  vehicleType: string;
  emergencyPhone: string;
  kycStatus: string;
  maxCashLimit: string;
};

export type StaffCreated = { staffId: string; mode: "created" | "linked"; kycSaved: boolean };
export type StaffUpdated = { staffId: string; kycSaved: boolean };
export type StaffReleased = {
  releasedDelivery: number;
  releasedPickup: number;
  repooledPickup: number;
};

/** Scanner results carry a ready-to-show Arabic message instead of a code. */
export type ScanResult<T> = ({ ok: true } & T) | { ok: false; message: string };

/** Arabic wording for the hub RPC errors the inbound scan can raise. */
export const HUB_ERROR_AR: Record<HubErrorCode, string> = {
  unauthorized: ADMIN_ERROR_MESSAGES.unauthorized,
  forbidden: ADMIN_ERROR_MESSAGES.forbidden,
  invalid_code: "هذا ليس رقم تتبع صالحًا. راجع الباركود وحاول مرة أخرى.",
  empty_batch: "امسح شحنة واحدة على الأقل.",
  not_found: "لا توجد شحنة بهذا الرقم.",
  wrong_merchant: "الشحنة تخص تاجرًا آخر.",
  not_pending: "الشحنة لم تعد بانتظار الاستلام.",
  not_picked_up: "لم يستلم مندوب الاستلام هذه الشحنة من التاجر بعد.",
  not_at_hub: "الشحنة ليست في مخزن الفرز بعد.",
  taken: ADMIN_ERROR_MESSAGES.taken,
  same_driver: ADMIN_ERROR_MESSAGES.same_driver,
  failed: ADMIN_ERROR_MESSAGES.failed,
};