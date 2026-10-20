"use client";

import { create as createQrCode } from "qrcode";

const QUIET = 2;

export function QrMark({ value, label }: { value: string; label: string }) {
  const qr = createQrCode(value, { errorCorrectionLevel: "M" });
  let path = "";
  const size = qr.modules.size;
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (qr.modules.get(row, col)) path += `M${col} ${row}h1v1h-1z`;
    }
  }
  const span = size + QUIET * 2;
  return (
    <svg
      viewBox={`${-QUIET} ${-QUIET} ${span} ${span}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className="size-52 bg-white text-black"
    >
      <path d={path} fill="currentColor" />
    </svg>
  );
}
