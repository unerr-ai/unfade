import type { Config } from "tailwindcss";

export default {
  content: ["./src/server/pages/**/*.ts", "./src/server/components/**/*.ts"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        canvas: "var(--canvas)",
        substrate: "var(--substrate)",
        surface: "var(--surface)",
        raised: "var(--raised)",
        overlay: "var(--overlay)",
        foreground: "var(--foreground)",
        muted: "var(--muted)",
        border: "var(--border-color)",
        accent: "var(--accent)",
        "accent-dim": "var(--accent-dim)",
        cyan: "var(--cyan)",
        success: "var(--success)",
        warning: "var(--warning)",
        error: "var(--error)",
      },
      fontFamily: {
        heading: ["'Space Grotesk'", "sans-serif"],
        body: ["'Inter'", "sans-serif"],
        mono: ["'JetBrains Mono'", "monospace"],
      },
      borderRadius: {
        DEFAULT: "8px",
      },
    },
  },
  plugins: [],
} satisfies Config;
