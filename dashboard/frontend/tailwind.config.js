/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
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
        }
      },
      boxShadow: {
        dune: '0 20px 45px -20px rgba(245, 158, 11, 0.35)',
        glass: '0 20px 60px -24px rgba(15, 23, 42, 0.75)'
      },
      backgroundImage: {
        'dune-radial': 'radial-gradient(circle at top, rgba(245,158,11,0.18), transparent 40%), radial-gradient(circle at bottom right, rgba(251,146,60,0.12), transparent 32%)',
        'dune-grid': 'linear-gradient(rgba(148,163,184,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.06) 1px, transparent 1px)'
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-4px)' }
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' }
        }
      },
      animation: {
        float: 'float 4s ease-in-out infinite',
        shimmer: 'shimmer 2.5s linear infinite'
      }
    }
  },
  plugins: []
};
