/**
 * Sudan WhatsApp deep link. Local 09… / 01… numbers become 249…
 * Returns null when the number is not a Sudan mobile.
 */
export function whatsAppHref(phone: string, message: string): string | null {
  const digits = phone.replace(/\D/g, "");
  let intl = digits;
  if (intl.startsWith("00")) intl = intl.slice(2);
  if (intl.startsWith("0") && intl.length === 10) intl = `249${intl.slice(1)}`;
  if (!/^249[19]\d{8}$/.test(intl)) return null;
  return `https://wa.me/${intl}?text=${encodeURIComponent(message)}`;
}

export function deliveryWhatsAppMessage(input: {
  customerName: string;
  trackingCode: string;
  merchantName: string;
  amountLabel: string;
}): string {
  const name = input.customerName.trim() || "عميلنا";
  const merchant = input.merchantName.trim() || "المتجر";
  return `مرحباً ${name}، معك مندوب شركة Rapid للشحن 🚚. أنا في طريقي إليك لتسليم شحنتك رقم ${input.trackingCode} من متجر ${merchant} بمبلغ تحصيل ${input.amountLabel} ج.س. يرجى تأكيد تواجدك أو إرسال الموقع.`;
}
