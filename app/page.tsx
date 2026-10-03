'use client';

import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { signIn, signOut } from 'next-auth/react';

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

type User = { name?: string | null; email?: string | null; image?: string | null };
type Resume = { fileName: string; uploadedAt: string };
type Msg = { role: 'user' | 'assistant'; content: string; tools?: string[] };
type ChatSummary = { id: string; title: string; updatedAt: string };

const SUGGESTIONS = [
  'Find remote AI engineer jobs that fit my resume',
  'What skills am I missing for backend roles?',
  'Summarise my strongest projects',
];

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [resume, setResume] = useState<Resume | null>(null);
  const [demo, setDemo] = useState(false);
  const [checking, setChecking] = useState(true);
  const [uploading, setUploading] = useState(false);

  const [message, setMessage] = useState('');
  const [thread, setThread] = useState<Msg[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobQuery, setJobQuery] = useState('AI engineer Python');
  const [jobsLoading, setJobsLoading] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  const canAsk = !!user || demo;

  useEffect(() => {
    fetch('/api/resume')
      .then(r => r.json())
      .then(d => {
        setUser(d.user);
        setResume(d.resume);
        if (d.user) refreshChats(true);
      })
      .catch(() => {})
      .finally(() => setChecking(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the thread scrolled to the newest message.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread, loading]);

  async function refreshChats(openLatest = false) {
    try {
      const res = await fetch('/api/chats');
      if (!res.ok) return;
      const d = await res.json();
      setChats(d.chats || []);
      if (openLatest && d.chats?.[0]) openChat(d.chats[0].id);
    } catch {}
  }

  async function openChat(id: string) {
    const res = await fetch(`/api/chats/${id}`);
    if (!res.ok) return;
    const d = await res.json();
    setChatId(id);
    setThread(d.chat.messages);
  }

  function newChat() {
    setChatId(null);
    setThread([]);
    setMessage('');
  }

  async function removeChat(id: string) {
    if (!confirm('Delete this chat?')) return;
    await fetch(`/api/chats/${id}`, { method: 'DELETE' });
    if (id === chatId) newChat();
    refreshChats();
  }

  async function uploadResume(file: File) {
    if (!file.name.toLowerCase().endsWith('.pdf')) return alert('Please upload a PDF resume.');
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/upload-resume', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setResume({ fileName: file.name, uploadedAt: new Date().toISOString() });
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function removeResume() {
    if (!confirm('Delete your saved resume, its search index and all chat history?')) return;
    await fetch('/api/resume', { method: 'DELETE' });
    setResume(null);
    setChats([]);
    newChat();
  }

  async function askAgent() {
    const text = message.trim();
    if (!text || loading) return;

    setThread(t => [...t, { role: 'user', content: text }]);
    setMessage('');
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, demo: demo && !user, chatId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Agent request failed');

      setThread(t => [...t, { role: 'assistant', content: data.answer || 'No answer returned.', tools: data.tools || [] }]);
      if (data.chatId) {
        setChatId(data.chatId);
        refreshChats();
      }
    } catch (e) {
      setThread(t => [...t, { role: 'assistant', content: e instanceof Error ? e.message : 'Agent request failed' }]);
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
        <div className="authbar">
          {user ? (
            <>
              <span>{user.name || user.email}</span>
              <button className="secondary" onClick={() => signOut({ callbackUrl: '/' })}>Sign out</button>
            </>
          ) : (
            !checking && <button className="secondary" onClick={() => signIn('google')}>Sign in with Google</button>
          )}
        </div>
        <div className="eyebrow">GENAI • RAG • AGENTIC AI</div>
        <h1>CareerPilot <span>AI</span></h1>
        <p>Upload your resume once, then let an AI agent research live remote jobs and explain which ones fit your background.</p>
      </header>

      <section className="grid two">
        <div className="card upload-card">
          <div className="section-head">
            <div><div className="label">01 / KNOWLEDGE</div><h2>Resume RAG</h2></div>
            <div className="status-dot" />
          </div>

          <input
            ref={fileInput}
            type="file"
            accept="application/pdf"
            hidden
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) uploadResume(f);
              e.target.value = '';
            }}
          />

          {checking ? (
            <div className="empty">Loading…</div>
          ) : !user && !demo ? (
            <div className="gate">
              <p>Sign in once and your resume and chats are remembered. No re-uploading.</p>
              <button className="primary" onClick={() => signIn('google')}>Continue with Google</button>
              <button className="secondary" onClick={() => setDemo(true)}>Try with a sample resume</button>
            </div>
          ) : !user && demo ? (
            <div className="saved">
              <div className="file-pill">✓ Sample resume loaded (demo mode)</div>
              <button className="secondary" onClick={() => signIn('google')}>Sign in to use your own</button>
            </div>
          ) : resume ? (
            <div className="saved">
              <div className="file-pill">✓ {resume.fileName} saved</div>
              <button className="secondary" onClick={() => fileInput.current?.click()} disabled={uploading}>
                {uploading ? 'Indexing…' : 'Replace resume'}
              </button>
              <button className="secondary" onClick={removeResume}>Delete my data</button>
            </div>
          ) : (
            <div className="dropzone" onClick={() => fileInput.current?.click()} style={{ cursor: 'pointer' }}>
              <strong>{uploading ? 'Indexing resume…' : 'Click to upload your PDF resume'}</strong>
              <span>Gemini File Search chunks and indexes it for semantic retrieval.</span>
            </div>
          )}

          <div className="pipeline"><span>PDF</span><i>→</i><span>Chunks</span><i>→</i><span>Embeddings</span><i>→</i><span>RAG</span></div>
        </div>

        <div className="card agent-card">
          <div className="section-head">
            <div><div className="label">02 / AGENT</div><h2>Ask CareerPilot</h2></div>
            <div className="badge">LIVE</div>
          </div>

          {thread.length === 0 && (
            <div className="chips">
              {SUGGESTIONS.map(s => (
                <button key={s} className="chip" onClick={() => setMessage(s)}>{s}</button>
              ))}
            </div>
          )}

          {(thread.length > 0 || loading) && (
            <div className="thread" ref={threadRef}>
              {thread.map((m, i) => (
                <div key={i} className={`msg ${m.role}`}>
                  {m.role === 'user' ? (
                    m.content
                  ) : (
                    <>
                      {m.tools && m.tools.length > 0 && (
                        <div className="tool-row">{m.tools.map((t, j) => <span key={`${t}-${j}`}>⚙ {t}</span>)}</div>
                      )}
                      <ReactMarkdown
                        components={{ a: props => <a {...props} target="_blank" rel="noreferrer" /> }}
                      >
                        {m.content}
                      </ReactMarkdown>
                    </>
                  )}
                </div>
              ))}
              {loading && <div className="msg assistant pending">Agent is researching…</div>}
            </div>
          )}

          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) askAgent();
            }}
            placeholder="Find the best AI jobs for me based on my resume…  (Ctrl+Enter to send)"
          />
          <button className="primary" onClick={askAgent} disabled={loading || !canAsk}>
            {loading ? 'Agent is researching…' : canAsk ? 'Run agent →' : 'Sign in or try the demo first'}
          </button>
          {demo && !user && <p className="hint">Demo chats are not saved. Sign in to keep your history.</p>}
        </div>
      </section>

      {user && (
        <section className="card">
          <div className="section-head">
            <div><div className="label">03 / HISTORY</div><h2>Your chats</h2></div>
            <button className="secondary" onClick={newChat}>+ New chat</button>
          </div>
          <div className="history-list">
            {chats.map(c => (
              <div key={c.id} className={`history-item ${c.id === chatId ? 'active' : ''}`}>
                <button className="title" onClick={() => openChat(c.id)}>
                  {c.title}
                  <br />
                  <small>{new Date(c.updatedAt).toLocaleString()}</small>
                </button>
                <button className="secondary" onClick={() => removeChat(c.id)}>Delete</button>
              </div>
            ))}
            {chats.length === 0 && <div className="empty">No saved chats yet. Ask the agent something and it will appear here.</div>}
          </div>
        </section>
      )}

      <section className="card jobs-card">
        <div className="section-head">
          <div><div className="label">04 / LIVE DATA</div><h2>Remote jobs</h2></div>
          <span className="source">Source: Remotive</span>
        </div>
        <div className="search-row">
          <input value={jobQuery} onChange={e => setJobQuery(e.target.value)} />
          <button className="secondary" onClick={loadJobs} disabled={jobsLoading}>{jobsLoading ? 'Searching…' : 'Search jobs'}</button>
        </div>
        <div className="jobs">
          {jobs.map(job => (
            <article className="job" key={job.id}>
              <div><h3>{job.title}</h3><p>{job.company_name} · {job.candidate_required_location || 'Remote'}</p></div>
              <a href={job.url} target="_blank" rel="noreferrer">View ↗</a>
            </article>
          ))}
          {jobs.length === 0 && <div className="empty">Search for a role above. The agent uses the same live source when it needs job data.</div>}
        </div>
      </section>

      <footer>Built with Gemini Flash-Lite · Gemini File Search · Next.js · Upstash Redis · Auth.js · Vercel · Remotive</footer>
    </main>
  );
}