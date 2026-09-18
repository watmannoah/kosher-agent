import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kehilla Hotline — multi-agent kosher certification voice system',
  description:
    'A live multi-agent voice system for a fictional kosher certification hotline. Synthetic ' +
    'demonstration data.',
  robots: 'noindex, nofollow',
};

/**
 * Separate export, not a `metadata` field — Next 16 ignores viewport inside
 * `metadata` and warns at build time. The recipient opens this from an email,
 * most likely on a phone, so getting it wrong would cost the mobile layout.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col bg-ink text-bone antialiased">{children}</body>
    </html>
  );
}
