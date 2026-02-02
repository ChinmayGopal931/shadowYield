import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        background: {
          DEFAULT: '#0a0a0f',
          card: '#12121a',
          elevated: '#1a1a24',
        },
        accent: {
          DEFAULT: '#8b5cf6',
          secondary: '#6366f1',
        },
        foreground: {
          DEFAULT: '#f4f4f5',
          muted: '#a1a1aa',
        },
        privacy: {
          encrypted: '#10b981',
          warning: '#f59e0b',
        },
        border: {
          subtle: '#27272a',
          DEFAULT: '#3f3f46',
        },
      },
      fontFamily: {
        sans: ['GothamPro', 'system-ui', 'sans-serif'],
        mono: ['GothamPro', 'monospace'],
      },
      animation: {
        'glow': 'glow 2s ease-in-out infinite alternate',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 5px rgba(139, 92, 246, 0.5)' },
          '100%': { boxShadow: '0 0 20px rgba(139, 92, 246, 0.8)' },
        },
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config
