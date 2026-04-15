import type { Metadata } from 'next';
import { Inter, Manrope } from 'next/font/google';
import './globals.css';

/**
 * Inter — body and label text. 400 / 500 / 600 weights match the Stitch
 * design tokens.
 */
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-inter',
  display: 'swap',
});

/**
 * Manrope — headlines and bold labels. 700 / 800 weights only.
 */
const manrope = Manrope({
  subsets: ['latin'],
  weight: ['700', '800'],
  variable: '--font-manrope',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Plansync — Rocketlane Project Plan Agent',
  description:
    'AI agent that reads a project plan CSV and creates it as a fully structured project in Rocketlane — phases, tasks, subtasks, milestones, and dependencies.',
  icons: {
    icon: '/favicon.ico',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${manrope.variable}`}>
      <head>
        {/*
          Material Symbols Outlined icon font.

          Loaded via <link> instead of @import because next/font/google
          injects its own @font-face declarations at the TOP of the final
          compiled CSS, which pushes any @import in globals.css out of the
          required top position. CSS spec then invalidates the @import
          silently and the Google Fonts stylesheet never loads — every
          icon in the app ends up rendering as its ligature name
          (e.g. "check_circle") instead of the glyph.

          next/font/google cannot be used here either — it only supports
          text fonts, not icon fonts.

          The ESLint rule @next/next/no-page-custom-font is designed for
          regular text fonts that should use next/font. It does NOT apply
          to icon fonts and is suppressed below.
        */}
        <link
          rel="preconnect"
          href="https://fonts.googleapis.com"
        />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap"
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
