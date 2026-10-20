import { Package } from "lucide-react";

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function CustomerPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <div className="bg-primary text-primary-foreground flex size-10 items-center justify-center rounded-lg">
          <Package className="size-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Your shipments
          </h1>
          <p className="text-muted-foreground text-sm">
            Signed-in customers land here after login.
          </p>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Nothing to show yet</CardTitle>
          <CardDescription>
            Shipment history will appear here. Anyone can still follow a
            tracking code from the public tracking page.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
