import './globals.css';
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = { title: '차오름학원', description: '차오름학원 통합 학원 관리' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#1c2b4a' };
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
