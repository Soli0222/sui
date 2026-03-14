import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: "hsl(var(--card))",
        border: "hsl(var(--border))",
        muted: "hsl(var(--muted))",
        accent: "hsl(var(--accent))",
        primary: "hsl(var(--primary))",
        secondary: "hsl(var(--secondary))",
        success: "hsl(var(--success))",
        danger: "hsl(var(--danger))",
      },
      fontFamily: {
        sans: ["'IBM Plex Sans JP'", "system-ui", "sans-serif"],
      },
      boxShadow: {
        glow: "0 24px 60px hsla(201, 76%, 74%, 0.1)",
      },
    },
  },
  plugins: [],
} satisfies Config;
