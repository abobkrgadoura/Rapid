import type { Metadata } from "next";

import { CreateOrderForm, OrderIntentHeader } from "@/components/merchant/create-order-form";
import { getMerchantOrderDefaults } from "@/lib/data/merchant-order-defaults";
import { orderIntent } from "@/lib/orders/create-order";

export const metadata: Metadata = {
  title: "إنشاء طلب",
};

export const instant = false;

export default async function NewMerchantOrderPage({
  searchParams,
}: PageProps<"/merchant/orders/new">) {
  const params = await searchParams;
  const intent = orderIntent(params.intent);
  const defaults = await getMerchantOrderDefaults();

  return (
    <div
      className={
        intent === "exchange"
          ? "mx-auto flex w-full max-w-5xl flex-col gap-6"
          : "mx-auto flex w-full max-w-3xl flex-col gap-6"
      }
    >
      <OrderIntentHeader intent={intent} />
      <CreateOrderForm key={intent} defaults={defaults} intent={intent} />
    </div>
  );
}
