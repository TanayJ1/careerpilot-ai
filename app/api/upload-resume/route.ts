import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY is not configured.' }, { status: 500 });
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'No PDF file received.' }, { status: 400 });
    if (file.type !== 'application/pdf') return NextResponse.json({ error: 'Only PDF resumes are supported.' }, { status: 400 });
    if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: 'Resume must be smaller than 10 MB.' }, { status: 400 });

    const ai = new GoogleGenAI({ apiKey });
    const store = await ai.fileSearchStores.create({ config: { displayName: `resume-${Date.now()}`, embeddingModel: 'models/gemini-embedding-001' } });
    let operation = await ai.fileSearchStores.uploadToFileSearchStore({ file, fileSearchStoreName: store.name, config: { displayName: file.name, chunkingConfig: { whiteSpaceConfig: { maxTokensPerChunk: 300, maxOverlapTokens: 40 } } } });
    while (!operation.done) {
      await new Promise(r => setTimeout(r, 1500));
      operation = await ai.operations.get({ operation });
    }
    return NextResponse.json({ storeName: store.name, fileName: file.name });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Resume indexing failed.' }, { status: 500 });
  }
}
