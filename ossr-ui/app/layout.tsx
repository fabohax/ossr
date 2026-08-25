import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'OSSR sBTC Sponsor',
  description: 'Testnet sBTC sponsored transfer interface for Open Stacks Sponsor Relay.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
