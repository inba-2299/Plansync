import type { Config } from 'tailwindcss';

/**
 * Plansync Tailwind theme — ported from the Google Stitch design tokens.
 *
 * The palette is Material 3 inspired (surface containers + tonal variants).
 * Primary blue is #173ce5 — close to Rocketlane's IBM Carbon brand blue
 * (#0F62FE) but a touch more vivid. We adopt the Stitch palette directly
 * because it gives us a coherent set across the whole app rather than
 * mixing-and-matching.
 *
 * Fonts:
 *   - Manrope (700, 800) for headlines and bold labels
 *   - Inter (400, 500, 600) for body and most UI
 *   - JetBrains Mono / SF Mono via the system mono stack for code/api keys
 */

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // ---------- Material 3-style tonal palette (from Stitch) ----------
        primary: {
          DEFAULT: '#173ce5',
          container: '#3c59fd',
          fixed: '#dee0ff',
          'fixed-dim': '#bbc3ff',
          'on-fixed': '#000f5d',
          'on-fixed-variant': '#002ccd',
        },
        secondary: {
          DEFAULT: '#4648d4',
          container: '#6063ee',
          fixed: '#e1e0ff',
          'fixed-dim': '#c0c1ff',
          'on-fixed': '#07006c',
          'on-fixed-variant': '#2f2ebe',
        },
        tertiary: {
          DEFAULT: '#6a1edb',
          container: '#8343f4',
          fixed: '#eaddff',
          'fixed-dim': '#d2bbff',
          'on-fixed': '#25005a',
          'on-fixed-variant': '#5a00c6',
        },
        surface: {
          DEFAULT: '#faf8ff',
          bright: '#faf8ff',
          dim: '#d2d9f4',
          variant: '#dae2fd',
          tint: '#2848ee',
          'container-lowest': '#ffffff',
          'container-low': '#f2f3ff',
          container: '#eaedff',
          'container-high': '#e2e7ff',
          'container-highest': '#dae2fd',
        },
        'on-surface': {
          DEFAULT: '#131b2e',
          variant: '#434655',
        },
        'on-primary': '#ffffff',
        'on-secondary': '#ffffff',
        'on-tertiary': '#ffffff',
        'on-background': '#131b2e',
        background: '#faf8ff',
        outline: {
          DEFAULT: '#737686',
          variant: '#c3c6d7',
        },
        error: {
          DEFAULT: '#ba1a1a',
          container: '#ffdad6',
          'on-container': '#93000a',
        },
        'on-error': '#ffffff',
        // Status accent colors used in journey stepper, progress feed, completion card
        success: '#198038',
        warning: '#d12771',
        info: '#08bdba',
        // Reflection card uses tertiary purple
      },
      fontFamily: {
        // CSS variables are populated by next/font/google in app/layout.tsx
        headline: ['var(--font-manrope)', 'Manrope', 'system-ui', 'sans-serif'],
        body: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        label: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          'monospace',
        ],
      },
      borderRadius: {
        DEFAULT: '0.25rem',
        sm: '0.25rem',
        lg: '0.5rem',
        xl: '0.75rem',
        '2xl': '1rem',
        '3xl': '1.5rem',
        '4xl': '2rem',
      },
      boxShadow: {
        // Stitch uses tinted shadows (color/10 etc.) for depth without weight
        'card-sm': '0 1px 2px 0 rgb(23 60 229 / 0.04), 0 1px 4px 0 rgb(23 60 229 / 0.04)',
        card: '0 2px 8px -1px rgb(23 60 229 / 0.06), 0 4px 12px -2px rgb(23 60 229 / 0.04)',
        'card-lg':
          '0 8px 24px -4px rgb(23 60 229 / 0.08), 0 16px 32px -8px rgb(23 60 229 / 0.06)',
        'card-xl':
          '0 16px 48px -8px rgb(23 60 229 / 0.12), 0 24px 64px -16px rgb(23 60 229 / 0.08)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 200ms ease-out',
        'slide-up': 'slideUp 250ms ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
