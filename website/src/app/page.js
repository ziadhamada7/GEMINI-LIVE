'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function SetupPage() {
  const router = useRouter();
  const [topic, setTopic] = useState('');
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  const handleFiles = (e) => {
    setFiles(Array.from(e.target.files));
  };

  const handleStart = async () => {
    if (!topic.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('topic', topic.trim());
      for (const f of files) {
        formData.append('files', f);
      }

      const res = await fetch(`${API_URL}/lesson`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (data.error) {
        setError(data.error);
        setLoading(false);
        return;
      }

      // Store the lesson plan and navigate to lesson page
      sessionStorage.setItem('lessonPlan', JSON.stringify(data.plan));
      sessionStorage.setItem('lessonId', data.lessonId);
      router.push('/lesson');
    } catch (err) {
      setError('Failed to connect: ' + err.message);
      setLoading(false);
    }
  };

  return (
    <>
      <div className="bg-canvas" aria-hidden="true" />

      <main className="setup-page">
        {/* Hero Header */}
        <header className="setup-header">
          <div className="logo">
            <div className="logo-icon">✦</div>
            <span className="logo-text">AI Tutor</span>
          </div>
          <h1>Your Personal AI Teacher</h1>
          <p>Enter a topic or upload your lecture materials, and the AI will teach you on a live whiteboard — just like a real tutor.</p>
        </header>

        {/* Setup Card */}
        <div className="setup-card">
          {/* Topic Input */}
          <div className="input-group">
            <label htmlFor="topic">📚 Lesson Topic</label>
            <input
              id="topic"
              type="text"
              placeholder="e.g. Newton's Laws of Motion, Photosynthesis, World War II …"
              value={topic}
              onChange={e => setTopic(e.target.value)}
              disabled={loading}
              autoFocus
            />
          </div>

          {/* File Upload */}
          <div className="input-group">
            <label>📎 Upload Materials <span className="label-hint">(optional)</span></label>
            <div
              className="upload-area"
              onClick={() => fileRef.current?.click()}
              role="button"
              tabIndex={0}
            >
              <input
                ref={fileRef}
                type="file"
                multiple
                accept=".pdf,.txt,.md,.doc,.docx"
                style={{ display: 'none' }}
                onChange={handleFiles}
              />
              {files.length > 0 ? (
                <div className="upload-files">
                  {files.map((f, i) => (
                    <span key={i} className="file-chip">{f.name}</span>
                  ))}
                </div>
              ) : (
                <div className="upload-placeholder">
                  <span className="upload-icon">📄</span>
                  <span>Click to upload PDFs, notes, or lecture slides</span>
                </div>
              )}
            </div>
          </div>

          {/* Error */}
          {error && <div className="setup-error">⚠️ {error}</div>}

          {/* Start Button */}
          <button
            className="start-btn"
            onClick={handleStart}
            disabled={!topic.trim() || loading}
          >
            {loading ? (
              <span className="btn-loading">
                <span className="spinner" />
                Preparing your lesson…
              </span>
            ) : (
              <>🎓 Start Lesson</>
            )}
          </button>
        </div>

        {/* Features */}
        <div className="features">
          <div className="feature">
            <span className="feature-icon">🎤</span>
            <h3>Voice Interaction</h3>
            <p>Interrupt anytime to ask questions</p>
          </div>
          <div className="feature">
            <span className="feature-icon">🖍️</span>
            <h3>Live Whiteboard</h3>
            <p>AI writes and draws in real-time</p>
          </div>
          <div className="feature">
            <span className="feature-icon">📐</span>
            <h3>Charts & Diagrams</h3>
            <p>Visual explanations with diagrams</p>
          </div>
        </div>
      </main>
    </>
  );
}
