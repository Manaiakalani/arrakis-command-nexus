/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },
      colors: {
        dune: {
          night: '#020617',
          background: '#0f172a',
          panel: '#1e293b',
          border: '#334155',
          sand: '#fbbf24',
          amber: '#f59e0b',
          ember: '#d97706',
          spice: '#fb923c',
          success: '#10b981',
          warning: '#d97706',
          danger: '#ef4444',
          text: '#f8fafc',
          muted: '#94a3b8'
        },
        th: {
          bg:          'rgb(var(--th-bg) / <alpha-value>)',
          'bg-s':      'rgb(var(--th-bg-s) / <alpha-value>)',
          surface:     'rgb(var(--th-surface) / <alpha-value>)',
          'surface-s': 'rgb(var(--th-surface-s) / <alpha-value>)',
          border:      'rgb(var(--th-border) / <alpha-value>)',
          'border-m':  'rgb(var(--th-border-m) / <alpha-value>)',
          text:        'rgb(var(--th-text) / <alpha-value>)',
          'text-s':    'rgb(var(--th-text-s) / <alpha-value>)',
          'text-m':    'rgb(var(--th-text-m) / <alpha-value>)',
        }
      },
      boxShadow: {
        dune: '0 20px 45px -20px rgba(245, 158, 11, 0.35)',
        glass: 'var(--glass-shadow)',
        'glass-light': 'var(--glass-shadow)',
      },
      backgroundImage: {
        'dune-radial': 'var(--dune-radial)',
        'dune-grid': 'linear-gradient(var(--grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--grid-line) 1px, transparent 1px)'
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-4px)' }
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' }
        },
        'pulse-slow': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' }
        }
      },
      animation: {
        float: 'float 4s ease-in-out infinite',
        shimmer: 'shimmer 2.5s linear infinite',
        'pulse-slow': 'pulse-slow 2s ease-in-out infinite'
      }
    }
  },
  plugins: []
};
