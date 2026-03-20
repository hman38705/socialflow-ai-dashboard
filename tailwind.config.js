/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./{App,components/**/*.{js,ts,jsx,tsx}}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Manrope', 'sans-serif'],
      },
      colors: {
        dark: {
          bg: '#0d0f11',
          surface: '#161b22',
          border: 'rgba(255, 255, 255, 0.05)',
        },
        primary: {
          blue: '#3b82f6',
          teal: '#14b8a6',
        },
        gray: {
          subtext: '#8892b0', // A soft gray for subtext
        }
      },
      borderRadius: {
        '2xl': '20px',
        '3xl': '24px',
      },
      backdropBlur: {
        xs: '2px',
      }
    }
  },
  plugins: [],
}