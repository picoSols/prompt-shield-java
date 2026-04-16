/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      colors: {
        brand: {
          bg: '#0b0d12',
          surface: '#14171f',
          line: '#1f2430',
          text: '#e6e8ef',
          muted: '#8b92a3',
          accent: '#f29848', // echoes the CV accent
          low: '#55c28a',
          medium: '#e8b84e',
          high: '#e8615a'
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
