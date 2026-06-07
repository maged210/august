import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Monochrome stage — ash, bone, graphite — over near-black charcoal.
        charcoal: "#08080B",
        graphite: "#3a3a40",
        ash: "#9a9a9f",
        bone: "#e8e6e1",
        // The one restrained cold accent. Used ONLY to signal active states.
        steel: "#6E8CA8",
      },
      fontFamily: {
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
