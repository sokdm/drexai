import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111318",
        cloud: "#f7f8fb",
        line: "rgb(226 232 240 / 0.9)",
        brand: { DEFAULT: "#2563eb", soft: "#dbeafe", dark: "#60a5fa" },
        mint: "#14b8a6",
        amber: "#f59e0b"
      },
      boxShadow: { soft: "0 18px 60px rgb(15 23 42 / 0.12)" }
    }
  },
  plugins: []
} satisfies Config;
