import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams.get('q') || 'AI engineer Python';
    const url = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(q)}&limit=12`;
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) throw new Error(`Job source returned ${res.status}`);
    const data = await res.json();
    return NextResponse.json({ jobs: data.jobs || [], source: 'Remotive' });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Job search failed.' }, { status: 502 });
  }
}
