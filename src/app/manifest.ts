import type { MetadataRoute } from "next";

/**
 * Installs as the driver app: it opens on /driver. The scope is the whole
 * origin so the sign-in redirect stays inside the installed window instead
 * of bouncing out to the browser.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/driver",
    name: "Rapid Driver",
    short_name: "Rapid",
    description: "Pickups, deliveries, and your wallet on the road.",
    start_url: "/driver",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#0a0a0a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
