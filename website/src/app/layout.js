'use client';

import { Geist, Patrick_Hand } from 'next/font/google';
import './globals.css';
import { LanguageProvider } from '@/i18n/LanguageContext';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' });
const patrick = Patrick_Hand({ weight: '400', subsets: ['latin'], variable: '--font-patrick', display: 'swap' });

export default function RootLayout({ children }) {
  return (
    <html lang="en" dir="ltr" className={`${geist.variable} ${patrick.variable}`}>
      <head>
        <title>AI Tutor — Interactive Whiteboard</title>
        <meta name="description" content="Learn any topic with an AI teacher on a live whiteboard. Real-time voice explanation and drawing." />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <LanguageProvider>
          {children}
        </LanguageProvider>
      </body>
    </html>
  );
}
