import { CreateOrderForm } from "@/components/merchant/create-order-form";
import { OrdersLoadError, RecentOrdersHeading } from "@/components/merchant/merchant-orders-board";
import { MerchantOrdersTable } from "@/components/merchant/merchant-orders-table";
import { Card, CardContent } from "@/components/ui/card";
import { getMerchantOrderDefaults } from "@/lib/data/merchant-order-defaults";
import { loadMerchantOrders } from "@/lib/data/merchant-orders";

export const instant = false;

export default async function MerchantPage() {
  const [orders, defaults] = await Promise.all([
    loadMerchantOrders(),
    getMerchantOrderDefaults(),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <CreateOrderForm defaults={defaults} intent="delivery" />
      <section className="flex flex-col gap-3">
        <RecentOrdersHeading />
        <Card>
          <CardContent>
            {orders.ok ? (
              <MerchantOrdersTable rows={orders.data} />
            ) : (
              <OrdersLoadError />
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
