/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          green:    '#1B4332',
          greenMid: '#2D6A4F',
          greenLight:'#40916C',
          burgundy: '#6B1E1E',
          gold:     '#C9A84C',
          cream:    '#F8F4EE',
        }
      },
      fontFamily: {
        sans: ['Inter', 'Helvetica Neue', 'sans-serif'],
        display: ['Georgia', 'serif']
      }
    }
  },
  plugins: []
};
