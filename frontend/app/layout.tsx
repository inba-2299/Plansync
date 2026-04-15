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
      {/*
        NOTE on Material Symbols Outlined: it's an icon font (not a regular
        text font), so next/font/google does NOT support it. Instead it's
        loaded via @import in app/globals.css with the @import statement
        placed at the very top of the file (before @tailwind directives)
        per CSS spec. This avoids the @next/next/no-page-custom-font lint
        warning that would fire on <link rel="stylesheet"> tags.
      */}
      <body className="antialiased">{children}</body>
    </html>
  );
}
