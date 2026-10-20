import type { Metadata } from "next";

import { MerchantOrdersBoard } from "@/components/merchant/merchant-orders-board";
import { OrderCreatedNotice } from "@/components/merchant/order-created-notice";
import { Card, CardContent } from "@/components/ui/card";
import { loadMerchantOrders } from "@/lib/data/merchant-orders";

export const metadata: Metadata = {
  title: "الطلبات",
};

export const instant = false;

export default async function MerchantOrdersPage({
  searchParams,
}: PageProps<"/merchant/orders">) {
  const params = await searchParams;
  const created = typeof params.created === "string" ? params.created : null;
  const orders = await loadMerchantOrders();

  return (
    <div className="flex flex-col gap-6">
      <OrderCreatedNotice code={created} />
      <Card>
        <CardContent>
          {orders.ok ? (
            <MerchantOrdersBoard rows={orders.data} />
          ) : (
            <p role="alert" className="text-destructive text-sm">
              تعذر تحميل الطلبات.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
