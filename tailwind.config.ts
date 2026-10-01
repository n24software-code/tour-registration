import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#1A2238',   // text, primary buttons
        paper: '#F5F6F2', // page background
        sun: '#E8A33D',   // morning tours
        dusk: '#2E4A7D',  // evening tours
        palm: '#1F6B52',  // success / boarded
        clay: '#B4412F',  // errors / cancelled
      },
      fontFamily: { sans: ['var(--font-readex)', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
} satisfies Config;
