import type { Config } from "tailwindcss";

/**
 * Rapid palette. #F4F7FB is the canvas, #082D52 the dark brand,
 * and #0F62FF the primary. Semantic tokens in src/app/globals.css
 * are what components paint with.
 */
const config = {
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#082D52",
          900: "#0A3A68",
          800: "#0E3A66",
        },
        gold: {
          DEFAULT: "oklch(0.62 0.11 85)",
          muted: "oklch(0.78 0.08 85)",
        },
        lux: "#0F62FF",
      },
    },
  },
} satisfies Config;

export default config;
