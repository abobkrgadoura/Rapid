import type { Config } from "tailwindcss";

/**
 * Premium Rapid palette. Zinc-50 is the canvas, zinc-950 the sidebar,
 * and indigo-900 the primary. Muted gold is the only accent.
 * Semantic tokens in src/app/globals.css are what components paint with.
 */
const config = {
  theme: {
    extend: {
      colors: {
        ink: {
          950: "oklch(0.141 0.005 286)",
          900: "oklch(0.21 0.006 286)",
          800: "oklch(0.274 0.006 286)",
        },
        gold: {
          DEFAULT: "oklch(0.62 0.11 85)",
          muted: "oklch(0.78 0.08 85)",
        },
        lux: "oklch(0.359 0.144 278.7)",
      },
    },
  },
} satisfies Config;

export default config;
