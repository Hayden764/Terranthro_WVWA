/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink:              'var(--color-ink)',
        surface:          'var(--color-surface)',
        'surface-raised': 'var(--color-surface-raised)',
        border:           'var(--color-border)',
        parchment:        'var(--color-parchment)',
        muted:            'var(--color-muted)',
        ghost:            'var(--color-ghost)',
        'electric-blue':  'var(--color-electric-blue)',
        'vivid-green':    'var(--color-vivid-green)',
        crimson:          'var(--color-crimson)',
        amber:            'var(--color-amber)',
        violet:           'var(--color-violet)',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        serif: ['Cormorant Garamond', 'serif'],
        mono: ['ui-monospace', 'monospace'],
      }
    }
  },
  plugins: []
};
