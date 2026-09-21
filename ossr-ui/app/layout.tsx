import type { Metadata } from 'next';
import './globals.css';
import { Geist, Geist_Mono } from "next/font/google";
import { RootProvider } from 'fumadocs-ui/provider/next';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist-sans' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });

export const metadata: Metadata = {
  title: 'OSSR — Open Stacks Sponsor Relay',
  description: 'The open protocol for sponsored Stacks transactions. Move sBTC without holding STX.',
  icons: { icon: '/ossr.svg' },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`dark ${geist.variable} ${geistMono.variable}`}>
      <body className="flex min-h-screen flex-col antialiased">
        <RootProvider theme={{ defaultTheme: 'dark', enableSystem: false, forcedTheme: 'dark', hotKey: false }}>
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
