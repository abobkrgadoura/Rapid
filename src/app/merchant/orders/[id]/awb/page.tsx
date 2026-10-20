import type { Metadata } from "next";

import { AwbPreview } from "@/components/merchant/awb-preview";
import { MerchantOrderDetail } from "@/components/merchant/merchant-order-detail";
import { OrderAwbToolbar } from "@/components/merchant/order-awb-toolbar";
import { loadMerchantOrder } from "@/lib/data/merchant-orders";
import { getMerchantProfile } from "@/lib/data/merchant-profile";
import { orderToAwbSpecimen } from "@/lib/orders/awb-specimen";

type AwbPageProps = {
  params: Promise<{ id: string }>;
};

export const instant = false;

export async function generateMetadata({ params }: AwbPageProps): Promise<Metadata> {
  const { id } = await params;
  const result = await loadMerchantOrder(id);
  return { title: result.ok ? `بوليصة ${result.data.trackingCode}` : "البوليصة" };
}

export default async function MerchantOrderAwbPage({ params }: AwbPageProps) {
  const { id } = await params;
  const result = await loadMerchantOrder(id);

  if (!result.ok) {
    return (
      <MerchantOrderDetail view={{ status: result.reason === "not_found" ? "missing" : "error" }} />
    );
  }

  const order = result.data;
  const merchant = await getMerchantProfile();
  const format = merchant?.preferences.awbFormat ?? "a6";
  const layout = merchant?.preferences.awbLayout ?? "one";
  const language = merchant?.preferences.awbLanguage ?? "ar";

  return (
    <div className="merchant-awb-print flex flex-col gap-4">
      <OrderAwbToolbar orderId={order.id} format={format} />
      <AwbPreview
        format={format}
        layout={layout}
        language={language}
        merchantName={merchant?.companyName || undefined}
        returnLocation={merchant?.preferences.returnAddress || undefined}
        specimen={orderToAwbSpecimen(order)}
        sheet
      />
    </div>
  );
}
