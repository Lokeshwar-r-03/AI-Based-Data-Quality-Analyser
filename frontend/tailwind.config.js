/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f5f3ff",
          100: "#ede9fe",
          200: "#ddd6fe",
          300: "#c084fc",
          400: "#6366f1",
          500: "#6366f1",
          600: "#4f46e5",
          700: "#4338ca",
          800: "#3730a3",
          900: "#312e81",
        },
        slate: {
          950: "var(--bg-primary)",
          900: "var(--bg-surface)",
          850: "var(--bg-surface-accent)",
          800: "var(--border-primary)",
          700: "var(--border-secondary)",
          600: "var(--text-muted)",
          500: "var(--text-muted)",
          400: "var(--text-secondary)",
          350: "var(--text-secondary-bright)",
          300: "var(--text-primary-muted)",
          200: "var(--text-primary-soft)",
          100: "var(--text-primary)",
          50: "var(--bg-primary)",
        }
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
}
