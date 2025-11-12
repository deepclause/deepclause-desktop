/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/electron/renderer/index.html',
    './src/electron/renderer/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        deepclause: {
          primary: '#1A1A1A',
          'primary-dark': '#000000',
          secondary: '#4A4A4A',
          accent: '#F5F5F5',
          danger: '#DC3545',
          success: '#28A745',
        },
        bg: {
          darkest: '#FFFFFF',
          dark: '#FAFAFA',
          medium: '#F5F5F5',
          light: '#E8E8E8',
          hover: '#DDDDDD',
        },
        text: {
          primary: '#1A1A1A',
          secondary: '#666666',
          dim: '#999999',
        },
        border: {
          DEFAULT: '#DDDDDD',
          accent: '#1A1A1A',
        },
      },
      boxShadow: {
        'glow': '0 0 15px rgba(0, 0, 0, 0.08)',
        'soft': '0 2px 8px rgba(0, 0, 0, 0.08)',
        'medium': '0 4px 12px rgba(0, 0, 0, 0.1)',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'fade-in-up': 'fadeInUp 0.3s ease-out',
        'pulse-slow': 'pulse 1.5s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
};
