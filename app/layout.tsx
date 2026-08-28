import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CareerPilot AI — Agentic Job Research',
  description: 'A GenAI and agentic AI job research assistant with RAG-powered resume matching.'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
