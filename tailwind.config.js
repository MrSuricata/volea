/** @type {import('tailwindcss').Config} */
// Tailwind 3.4.17 compilado en el build (antes: Play CDN que generaba el CSS en
// el navegador). Mismo motor que el CDN, así las clases se comportan igual.
// NO pasar a v4: exige Chrome 111+/Safari 16.4+ y rompe los Smart TV (ver el
// plugin legacy en vite.config.ts).
// El theme.extend es copia literal de la config inline que vivía en index.html.
// OJO: el compilador solo ve clases escritas enteras en el código; una clase
// armada con template (`bg-${color}-500`) no se genera. Lo vigila
// src/utils/tailwindClases.test.ts.
export default {
  // Los tests no se renderizan: sin el '!' sus clases de ejemplo inflaban el CSS de producción.
  content: ['./index.html', './src/**/*.{ts,tsx}', '!./src/**/*.test.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Lexend', 'sans-serif'],
        body: ['Montserrat', 'sans-serif'],
      },
      colors: {
        navy: {
          50: '#f0f4ff',
          100: '#e0e8ff',
          200: '#b8c9ff',
          300: '#7a9bff',
          400: '#4a6fd4',
          500: '#1a3a6b',
          600: '#0d2b52',
          700: '#001F3F',
          800: '#001830',
          900: '#001020',
        },
        lime: {
          50: '#fdfff0',
          100: '#f5ffe0',
          200: '#e8ffb8',
          300: '#d4ff70',
          400: '#ccff00',
          500: '#B8E934',
          600: '#9acc00',
          700: '#7aa300',
          800: '#5c7a00',
          900: '#3d5200',
        },
      },
    },
  },
};
