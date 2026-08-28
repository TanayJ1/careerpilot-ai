'use client';

import { useState } from 'react';

type Job = {
  id: string;
  title: string;
  company_name: string;
  candidate_required_location?: string;
  url: string;
  publication_date?: string;
  description?: string;
  tags?: string[];
};

export default function Home() {
  const [storeName, setStoreName] = useState('');
  const [resumeName, setResumeName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [answer, setAnswer] = useState('');
  const [tools, setTools] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobQuery, setJobQuery] = useState('AI engineer Python');
  const [jobsLoading, setJobsLoading] = useState(false);

  async function uploadResume(file: File) {
    if (!file.name.toLowerCase().endsWith('.pdf')) return alert('Please upload a PDF resume.');
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/upload-resume', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setStoreName(data.storeName);
      setResumeName(file.name);
      setAnswer('Resume indexed. Ask me to find jobs that match your background.');
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function askAgent() {
    if (!message.trim()) return;
    setLoading(true);
    setAnswer('');
    setTools([]);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, storeName: storeName || null })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Agent request failed');
      setAnswer(data.answer || 'No answer returned.');
      setTools(data.tools || []);
    } catch (e) {
      setAnswer(e instanceof Error ? e.message : 'Agent request failed');
    } finally {
      setLoading(false);
    }
  }

  async function loadJobs() {
    setJobsLoading(true);
    try {
      const res = await fetch(`/api/jobs?q=${encodeURIComponent(jobQuery)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Job search failed');
      setJobs(data.jobs || []);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Job search failed');
    } finally {
      setJobsLoading(false);
    }
  }

  return (
    <main className="shell">
      <header className="hero">
        <div className="eyebrow">GENAI • RAG • AGENTIC AI</div>
        <h1>CareerPilot <span>AI</span></h1>
        <p>Upload your resume, then let an AI agent research live remote jobs and explain which ones fit your background.</p>
      </header>

      <section className="grid two">
        <div className="card upload-card">
          <div className="section-head"><div><div className="label">01 / KNOWLEDGE</div><h2>Resume RAG</h2></div><div className="status-dot" /></div>
          <label className="dropzone">
            <input type="file" accept="application/pdf" onChange={e => e.target.files?.[0] && uploadResume(e.target.files[0])} />
            <strong>{uploading ? 'Indexing resume…' : 'Drop your PDF resume here'}</strong>
            <span>Gemini File Search chunks and indexes it for semantic retrieval.</span>
          </label>
          {resumeName && <div className="file-pill">✓ {resumeName} indexed</div>}
          <div className="pipeline"><span>PDF</span><i>→</i><span>Chunks</span><i>→</i><span>Embeddings</span><i>→</i><span>RAG</span></div>
        </div>

        <div className="card agent-card">
          <div className="section-head"><div><div className="label">02 / AGENT</div><h2>Ask CareerPilot</h2></div><div className="badge">LIVE</div></div>
          <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="Find the best AI jobs for me based on my resume…" />
          <button className="primary" onClick={askAgent} disabled={loading}>{loading ? 'Agent is researching…' : 'Run agent →'}</button>
          {tools.length > 0 && <div className="tool-row">{tools.map((t, i) => <span key={`${t}-${i}`}>⚙ {t}</span>)}</div>}
          {answer && <div className="answer">{answer}</div>}
        </div>
      </section>

      <section className="card jobs-card">
        <div className="section-head"><div><div className="label">03 / LIVE DATA</div><h2>Remote jobs</h2></div><span className="source">Source: Remotive</span></div>
        <div className="search-row"><input value={jobQuery} onChange={e => setJobQuery(e.target.value)} /><button className="secondary" onClick={loadJobs} disabled={jobsLoading}>{jobsLoading ? 'Searching…' : 'Search jobs'}</button></div>
        <div className="jobs">
          {jobs.map(job => <article className="job" key={job.id}>
            <div><h3>{job.title}</h3><p>{job.company_name} · {job.candidate_required_location || 'Remote'}</p></div>
            <a href={job.url} target="_blank" rel="noreferrer">View ↗</a>
          </article>)}
          {jobs.length === 0 && <div className="empty">Search for a role above. The agent uses the same live source when it needs job data.</div>}
        </div>
      </section>

      <footer>Built with Gemini 3.7 Flash · Gemini File Search · Next.js · Vercel · Remotive</footer>
    </main>
  );
}
