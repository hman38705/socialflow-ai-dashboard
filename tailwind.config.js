/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Fira Sans', 'system-ui', 'sans-serif'],
        mono: ['Fira Code', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Backed by the CSS custom properties in src/index.css (FE-002) via
        // Tailwind's `rgb(var(--x) / <alpha-value>)` function syntax — the
        // literal fraction is each color's previous default opacity, kept
        // so e.g. `bg-dark-surface` renders identically to before; an
        // opacity modifier (`bg-dark-surface/50`) still overrides it.
        // Base surfaces — deep cool-black with layered elevation
        'dark-bg': 'rgb(var(--color-dark-bg) / 1)',
        'dark-elev': 'rgb(var(--color-dark-elev) / 1)',
        'dark-surface': 'rgb(var(--color-dark-surface) / 0.72)',
        'dark-border': 'rgb(var(--color-dark-border) / 0.08)',
        // Aurora accent system
        'primary-blue': 'rgb(var(--color-primary-blue) / 1)',   // electric engagement blue
        'primary-teal': 'rgb(var(--color-primary-teal) / 1)',   // fresh cyan signal (was flat teal)
        'primary-purple': 'rgb(var(--color-primary-purple) / 1)', // violet
        'primary-rose': 'rgb(var(--color-primary-rose) / 1)',   // signature reach/AI accent
        // Semantic trend colors
        'trend-up': 'rgb(var(--color-trend-up) / 1)',
        'trend-down': 'rgb(var(--color-trend-down) / 1)',
        'gray-subtext': 'rgb(var(--color-gray-subtext) / 1)',
        'glass-white': 'rgb(var(--color-glass-white) / 0.03)',
      },
      backgroundImage: {
        'glass-gradient': 'linear-gradient(135deg, rgba(255, 255, 255, 0.06) 0%, rgba(255, 255, 255, 0) 60%)',
        'glow-conic': 'conic-gradient(from 180deg at 50% 50%, #4f83ff 0deg, #22d3ee 100deg, #8b5cf6 200deg, #f43f5e 300deg, #4f83ff 360deg)',
      },
      boxShadow: {
        'elev-1': '0 1px 2px rgba(0,0,0,0.3)',
        'elev-2': '0 8px 24px rgba(0,0,0,0.35)',
        'elev-3': '0 24px 48px rgba(0,0,0,0.45)',
        'glow-rose': '0 0 24px rgba(244, 63, 94, 0.35)',
        'glow-blue': '0 0 24px rgba(79, 131, 255, 0.35)',
      },
      animation: {
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 5px rgba(79, 131, 255, 0.2)' },
          '100%': { boxShadow: '0 0 20px rgba(79, 131, 255, 0.6)' },
        }
      }
    },
  },
  plugins: [],
}
