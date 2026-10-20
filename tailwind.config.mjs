/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        ink: '#17201d',
        canvas: '#f4f6f1',
        sage: { 50: '#f2f7f2', 100: '#e1eee2', 500: '#4f8964', 600: '#3c7050', 700: '#315b42' },
        coral: '#e7795e'
      },
      boxShadow: { soft: '0 12px 36px rgba(29, 49, 40, 0.08)' }
    }
  },
  plugins: []
};
