"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

export function PlaceholderAction({
  label,
  note,
  icon,
  size = "default",
  align = "start",
}: {
  label: string;
  note: string;
  icon?: React.ReactNode;
  size?: "default" | "sm";
  align?: "start" | "end";
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div
      className={`flex flex-col gap-1 ${
        align === "end" ? "items-end" : "items-start"
      }`}
    >
      <Button
        type="button"
        variant="outline"
        size={size}
        onClick={() => setVisible(true)}
      >
        {icon}
        {label}
      </Button>
      {visible ? (
        <p className="text-muted-foreground max-w-56 text-xs">{note}</p>
      ) : null}
    </div>
  );
}
