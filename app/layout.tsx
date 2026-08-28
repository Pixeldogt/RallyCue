import type { Metadata } from 'next';
import { Cherry_Bomb_One, Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const cherryBombOne = Cherry_Bomb_One({
  variable: '--font-brand',
  weight: '400',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'RallyCue – Badminton-Ansagen',
  description: 'Spieler auf neun Felder verteilen und Begegnungen direkt aufrufen.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${cherryBombOne.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
