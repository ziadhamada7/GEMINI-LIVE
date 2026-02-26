import { Geist, Patrick_Hand } from 'next/font/google';
import './globals.css';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' });
const patrick = Patrick_Hand({ weight: '400', subsets: ['latin'], variable: '--font-patrick', display: 'swap' });

export const metadata = {
  title: 'AI Tutor — Interactive Whiteboard',
  description: 'Learn any topic with an AI teacher on a live whiteboard. Real-time voice explanation and drawing.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${geist.variable} ${patrick.variable}`}>
      <body>{children}</body>
    </html>
  );
}
