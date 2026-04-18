/** @type {import('tailwindcss').Config} */
// Brand palette resolves through CSS custom properties defined in styles.css,
// so the whole UI flips with prefers-color-scheme without class soup. The
// `<alpha-value>` placeholder is what lets utilities like `ring-brand-accent/60`
// keep expanding to an rgb(... / 0.6) value.
const rgbVar = (name) => `rgb(var(--brand-${name}) / <alpha-value>)`;

module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      colors: {
        brand: {
          bg: rgbVar('bg'),
          surface: rgbVar('surface'),
          line: rgbVar('line'),
          text: rgbVar('text'),
          muted: rgbVar('muted'),
          accent: rgbVar('accent'),
          low: rgbVar('low'),
          medium: rgbVar('medium'),
          high: rgbVar('high')
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace']
      }
    }
  },
  plugins: []
};
