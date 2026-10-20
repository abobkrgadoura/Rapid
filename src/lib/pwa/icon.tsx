import { ImageResponse } from "next/og";

/**
 * App icon for the driver PWA: a dark rounded square with a double chevron
 * ("rapid"). The mark sits inside the central 60% so the same artwork also
 * works as a maskable icon, where the OS may crop to a circle.
 */
export function renderPwaIcon(size: number): ImageResponse {
  const mark = Math.round(size * 0.6);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0a",
        }}
      >
        <svg
          width={mark}
          height={mark}
          viewBox="0 0 100 100"
          fill="none"
          stroke="#ffffff"
          strokeWidth="10"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M28 26 L52 50 L28 74" />
          <path d="M54 26 L78 50 L54 74" />
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}
