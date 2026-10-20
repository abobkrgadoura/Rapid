import type { Metadata } from "next";

import { MerchantOrderDetail } from "@/components/merchant/merchant-order-detail";
import { loadMerchantOrder } from "@/lib/data/merchant-orders";
import { buildTimeline } from "@/lib/orders/timeline";

type MerchantOrderPageProps = {
  params: Promise<{ id: string }>;
};

export const instant = false;

export async function generateMetadata({
  params,
}: MerchantOrderPageProps): Promise<Metadata> {
  const { id } = await params;
  const result = await loadMerchantOrder(id);
  return { title: result.ok ? result.data.trackingCode : "تفاصيل الطلب" };
}

export default async function MerchantOrderPage({ params }: MerchantOrderPageProps) {
  const { id } = await params;
  const result = await loadMerchantOrder(id);

  if (!result.ok) {
    return (
      <MerchantOrderDetail view={{ status: result.reason === "not_found" ? "missing" : "error" }} />
    );
  }

  const order = result.data;
  return (
    <MerchantOrderDetail
      view={{
        status: "ready",
        order,
        steps: buildTimeline({
          status: order.status,
          createdAt: order.createdAt,
          pickedUpAt: order.pickedUpAt,
          inTransitAt: order.inTransitAt,
          deliveredAt: order.deliveredAt,
        }),
      }}
    />
  );
}
