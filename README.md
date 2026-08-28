# CareerPilot AI

An agentic AI job research assistant built with Gemini 3.7 Flash, Gemini File Search (RAG), Next.js, Vercel, and the Remotive public jobs API.

## Features
- Upload a PDF resume and index it into Gemini File Search.
- Semantic RAG retrieval over resume content.
- Agentic tool calling for live remote job search.
- Explainable job-fit recommendations grounded in resume evidence.
- Responsive web UI.

## Local setup

```bash
npm install
copy .env.example .env.local
# add GEMINI_API_KEY to .env.local
npm run dev
```

Open http://localhost:3000.

## Architecture

User → Next.js → Gemini Interactions API → File Search (RAG) + search_jobs tool → Remotive → recommendation.

Remotive's public API provides delayed remote job listings and requires attribution/linking back to the listing source.
