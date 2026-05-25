/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx,css}",
  ],
  theme: {
    extend: {
      colors: {
        darkBg: '#080b11',
        glassBg: 'rgba(17, 24, 39, 0.45)',
        glassBorder: 'rgba(255, 255, 255, 0.08)',
        neonCyan: '#00f2fe',
        neonPurple: '#a100ff',
        neonPink: '#ff007f',
        neonGreen: '#39ff14',
        neonYellow: '#ffea00',
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'sans-serif'],
        display: ['"Space Grotesk"', 'sans-serif'],
      },
      backdropBlur: {
        xs: '2px',
      },
      boxShadow: {
        'neon-cyan': '0 0 15px rgba(0, 242, 254, 0.4)',
        'neon-purple': '0 0 15px rgba(161, 0, 255, 0.4)',
        'neon-pink': '0 0 15px rgba(255, 0, 127, 0.4)',
        'neon-green': '0 0 15px rgba(57, 255, 20, 0.4)',
        'neon-yellow': '0 0 15px rgba(255, 234, 0, 0.4)',
        'glass': '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
      },
      animation: {
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow-cyan': 'glowCyan 2s ease-in-out infinite alternate',
        'float': 'float 6s ease-in-out infinite',
        'glow-pulse': 'glowPulse 2s infinite',
      },
      keyframes: {
        glowCyan: {
          '0%': { boxShadow: '0 0 5px rgba(0, 242, 254, 0.2)' },
          '100%': { boxShadow: '0 0 20px rgba(0, 242, 254, 0.6)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        glowPulse: {
          '0%, 100%': { opacity: '0.6', transform: 'scale(1)' },
          '50%': { opacity: '1', transform: 'scale(1.02)' },
        }
      }
    },
  },
  plugins: [],
}
