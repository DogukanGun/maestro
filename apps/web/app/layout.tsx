import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'AgentRaft — Live Swarm',
  description: 'Fault-tolerant multi-agent consensus, streamed live.',
};

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
