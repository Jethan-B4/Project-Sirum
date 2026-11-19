/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--bg) / <alpha-value>)',
        surface: 'rgb(var(--sf) / <alpha-value>)',
        'surface-2': 'rgb(var(--sf2) / <alpha-value>)',
        tx: 'rgb(var(--tx) / <alpha-value>)',
        mu: 'rgb(var(--mu) / <alpha-value>)',
        line: 'rgb(var(--ln) / <alpha-value>)',
        accent: 'rgb(var(--ac) / <alpha-value>)',
        'accent-strong': 'rgb(var(--acb) / <alpha-value>)',
        'accent-soft': 'rgb(var(--ac-soft) / <alpha-value>)',
      },
      fontFamily: {
        // Resolved from the --font-ui CSS variable set by ThemeProvider.
        ui: ['var(--font-ui)'],
        serif: ['serif'],
        mono: ['monospace'],
      },
    },
  },
  plugins: [],
};
