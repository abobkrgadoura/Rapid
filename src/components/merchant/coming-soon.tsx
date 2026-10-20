import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

/** Honest empty state for a shell destination that has no data behind it yet. */
export function ComingSoon({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <span className="bg-muted text-muted-foreground flex size-14 items-center justify-center rounded-2xl">
            <Icon className="size-7" />
          </span>
          <p className="font-semibold">قريبًا</p>
          <p className="text-muted-foreground max-w-sm text-sm leading-relaxed">
            {description}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
