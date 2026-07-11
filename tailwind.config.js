/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Fira Sans', 'system-ui', 'sans-serif'],
        mono: ['Fira Code', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Base surfaces — deep cool-black with layered elevation
        'dark-bg': '#070A14',
        'dark-elev': '#0C1122',
        'dark-surface': 'rgba(18, 23, 40, 0.72)',
        'dark-border': 'rgba(255, 255, 255, 0.08)',
        // Aurora accent system
        'primary-blue': '#4f83ff',   // electric engagement blue
        'primary-teal': '#22d3ee',   // fresh cyan signal (was flat teal)
        'primary-purple': '#8b5cf6', // violet
        'primary-rose': '#f43f5e',   // signature reach/AI accent
        // Semantic trend colors
        'trend-up': '#34d399',
        'trend-down': '#fb7185',
        'gray-subtext': '#94a3b8',
        'glass-white': 'rgba(255, 255, 255, 0.03)',
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
