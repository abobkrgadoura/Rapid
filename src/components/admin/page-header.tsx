import type { LucideIcon } from "lucide-react";

export function AdminPageHeader({
  icon: Icon,
  title,
  description,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <div className="bg-brand text-brand-foreground ring-gold/50 flex size-11 shrink-0 items-center justify-center rounded-xl ring-2">
          <Icon className="size-5" />
        </div>
        <div className="flex flex-col gap-0.5">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {description ? (
            <p className="text-muted-foreground text-sm">{description}</p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
