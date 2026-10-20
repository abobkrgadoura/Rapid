import { Badge } from "@/components/ui/badge";
import { paymentTypeLabel, type PaymentType } from "@/lib/orders/status";

export function PaymentBadge({ paymentType }: { paymentType: PaymentType }) {
  return (
    <Badge variant={paymentType === "cod" ? "secondary" : "outline"}>
      {paymentTypeLabel(paymentType)}
    </Badge>
  );
}
