import type { Metadata } from 'next';
import { Damion, Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const damion = Damion({
  variable: '--font-brand',
  weight: '400',
  subsets: ['latin'],
});

const appBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const pwaEnabled = process.env.NEXT_PUBLIC_ENABLE_PWA === 'true';

export const metadata: Metadata = {
  title: 'RallyCue',
  description: 'Spieler auf neun Felder verteilen und Begegnungen direkt aufrufen.',
  ...(pwaEnabled
    ? {
        manifest: `${appBasePath}/manifest.webmanifest`,
        icons: {
          icon: `${appBasePath}/rallycue-logo.png`,
          apple: `${appBasePath}/rallycue-logo.png`,
        },
        appleWebApp: {
          capable: true,
          statusBarStyle: 'default' as const,
          title: 'RallyCue',
        },
      }
    : {}),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${damion.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
