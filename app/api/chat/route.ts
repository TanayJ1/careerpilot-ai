import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

export const runtime = 'nodejs';
export const maxDuration = 60;

const jobTool = {
  type: 'function' as const,
  name: 'search_jobs',
  description: 'Search live remote job listings. Use when the user asks to find or compare current jobs.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Job role, skills, or keywords.' }
    },
    required: ['query']
  }
};

async function searchJobs(query: string) {
  const url = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}&limit=10`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Remotive returned ${res.status}`);
  const data = await res.json();
  return (data.jobs || []).slice(0, 10).map((job: any) => ({
    id: job.id,
    title: job.title,
    company: job.company_name,
    location: job.candidate_required_location,
    url: job.url,
    published: job.publication_date,
    description: String(job.description || '').replace(/<[^>]*>/g, '').slice(0, 1400),
    tags: job.tags || []
  }));
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY is not configured.' }, { status: 500 });
    const body = await request.json();
    const message = String(body.message || '').trim();
    const storeName = body.storeName ? String(body.storeName) : '';
    if (!message) return NextResponse.json({ error: 'Message is required.' }, { status: 400 });

    const ai = new GoogleGenAI({ apiKey });
    const tools: any[] = [jobTool];
    if (storeName) tools.push({ type: 'file_search', file_search_store_names: [storeName] });

    const system = `You are CareerPilot, an AI career research agent. You help users find and evaluate software and AI jobs using live remote job data and the user's uploaded resume. When a resume is available, use File Search to retrieve relevant evidence before making fit claims. Use search_jobs for current job listings. Never invent experience. Prefer concise, practical recommendations with a match rationale and skill gaps. Mention that live listings are sourced from Remotive when job results are used.`;

    let interaction = await ai.interactions.create({ model: 'gemini-3.7-flash', input: message, system_instruction: system, tools });
    const usedTools: string[] = [];

    for (let round = 0; round < 5; round++) {
      const calls = interaction.steps.filter((s: any) => s.type === 'function_call');
      if (!calls.length) break;
      const results = [];
      for (const call of calls as any[]) {
        if (call.name === 'search_jobs') {
          usedTools.push('search_jobs');
          const result = await searchJobs(String(call.arguments?.query || message));
          results.push({ type: 'function_result', name: call.name, call_id: call.id, result: [{ type: 'text', text: JSON.stringify(result) }] });
        }
      }
      if (!results.length) break;
      interaction = await ai.interactions.create({ model: 'gemini-3.7-flash', previousInteractionId: interaction.id, input: results, tools });
    }

    const output = interaction.output_text || 'I could not produce a result.';
    return NextResponse.json({ answer: output, tools: [...new Set(usedTools)], source: 'Remotive' });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Agent request failed.' }, { status: 500 });
  }
}
