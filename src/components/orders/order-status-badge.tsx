import { Badge } from "@/components/ui/badge";
import {
  orderStatusClass,
  orderStatusLabel,
  type OrderStatus,
} from "@/lib/orders/status";

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <Badge variant="outline" className={orderStatusClass(status)}>
      {orderStatusLabel(status)}
    </Badge>
  );
}
