import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kehilla Hotline — multi-agent kosher certification voice system',
  description:
    'A live multi-agent voice system for a fictional kosher certification hotline. Synthetic ' +
    'demonstration data.',
  // The recipient opens this from an email, most likely on a phone.
  viewport: 'width=device-width, initial-scale=1',
  robots: 'noindex, nofollow',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col bg-ink text-bone antialiased">{children}</body>
    </html>
  );
}
