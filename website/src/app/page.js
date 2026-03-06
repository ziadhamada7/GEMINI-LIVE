'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/i18n/LanguageContext';
import { LANGUAGES } from '@/i18n/locales';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// Theme & Voice options logic
const THEMES = [
  { id: 'light-dot', label: 'Light (Grid)', mode: 'light', texture: 'dot' },
  { id: 'dark-dot', label: 'Dark (Grid)', mode: 'dark', texture: 'dot' },
  { id: 'blueprint', label: 'Dark (Blueprint)', mode: 'dark', texture: 'blueprint' },
  { id: 'chalk', label: 'Dark (Chalkboard)', mode: 'dark', texture: 'chalk' },
  { id: 'paper', label: 'Light (Paper)', mode: 'light', texture: 'paper' },
];

const VOICES = [
  { id: 'Puck', label: 'Puck (Default)', desc: 'Friendly & energetic' },
  { id: 'Charon', label: 'Charon', desc: 'Deep & professional' },
  { id: 'Kore', label: 'Kore', desc: 'Calm & patient' },
  { id: 'Fenrir', label: 'Fenrir', desc: 'Professor style' },
  { id: 'Aoede', label: 'Aoede', desc: 'Warm & engaging' },
];

export default function SetupPage() {
  const router = useRouter();
  const { t, lang, setLang } = useLanguage();
  const [topic, setTopic] = useState('');
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // New UI Options
  const [selectedTheme, setSelectedTheme] = useState('light-dot');
  const [selectedVoice, setSelectedVoice] = useState('Puck');

  const fileRef = useRef(null);

  useEffect(() => {
    // Load saved preferences if available
    const savedTheme = localStorage.getItem('tutor_theme');
    const savedVoice = localStorage.getItem('tutor_voice');
    if (savedTheme) setSelectedTheme(savedTheme);
    if (savedVoice) setSelectedVoice(savedVoice);

    // Apply body theme immediately for preview
    document.body.className = '';
    const themeObj = THEMES.find(t => t.id === (savedTheme || 'light-dot'));
    if (themeObj?.mode === 'dark') document.body.classList.add('theme-dark');
  }, []);

  const handleThemeChange = (themeId) => {
    setSelectedTheme(themeId);
    localStorage.setItem('tutor_theme', themeId);

    document.body.className = '';
    const themeObj = THEMES.find(t => t.id === themeId);
    if (themeObj?.mode === 'dark') document.body.classList.add('theme-dark');
  };

  const handleVoiceChange = (voiceId) => {
    setSelectedVoice(voiceId);
    localStorage.setItem('tutor_voice', voiceId);
  };

  const handleFiles = (e) => {
    setFiles(Array.from(e.target.files));
  };

  const handleStart = async () => {
    if (!topic.trim() && files.length === 0) return;
    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('topic', topic.trim());
      formData.append('language', lang);
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

      // Store the lesson plan, language, and navigate to lesson page
      sessionStorage.setItem('lessonPlan', JSON.stringify(data.plan));
      sessionStorage.setItem('lessonId', data.lessonId);
      sessionStorage.setItem('lessonLang', lang);

      // Store source references
      const sourceRefs = files.length > 0
        ? files.map(f => ({ name: f.name, type: f.name.toLowerCase().endsWith('.pdf') ? 'PDF' : 'Text' }))
        : (topic.trim() ? [{ name: topic.trim(), type: 'Prompt' }] : []);
      sessionStorage.setItem('lessonSources', JSON.stringify(sourceRefs));

      // We also saved theme/voice to localStorage above, the lesson page will read them
      router.push('/lesson');
    } catch (err) {
      setError(t('setup.errorConnect') + err.message);
      setLoading(false);
    }
  };

  return (
    <>
      <main className="setup-page">
        {/* Hero Header */}
        <header className="setup-header">
          <div className="logo-icon">✦</div>
          <h1>AI Tutor Platform</h1>
          <p>Learn any topic naturally. Upload a document or type a subject, and your AI tutor will explain it live on a digital whiteboard.</p>
        </header>

        {/* Settings & Setup Card */}
        <div className="glass-panel setup-card">

          {/* Topic / File Upload */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '16px' }}>
            <div className="input-group">
              <label htmlFor="topic">What do you want to learn?</label>
              <input
                id="topic"
                type="text"
                placeholder="e.g. Quantum Mechanics, Cell Division..."
                value={topic}
                onChange={e => setTopic(e.target.value)}
                disabled={loading}
                autoFocus
              />
            </div>

            <div className="input-group">
              <label>Or Upload Source Material <span style={{ textTransform: 'none', fontWeight: 400, color: 'var(--text-muted)' }}>(PDF, TXT)</span></label>
              <div
                className="upload-area"
                onClick={() => fileRef.current?.click()}
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
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
                    {files.map((f, i) => (
                      <span key={i} className="file-chip">{f.name}</span>
                    ))}
                  </div>
                ) : (
                  <div>
                    <span className="upload-icon">📄</span>
                    <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Click to browse files</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div style={{ height: '1px', background: 'var(--border-subtle)', margin: '8px 0' }} />

          {/* Configuration Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px' }}>

            {/* Theme Selection */}
            <div className="input-group">
              <label>Board Theme</label>
              <div className="options-grid">
                {THEMES.map(th => (
                  <div
                    key={th.id}
                    className={`option-box ${selectedTheme === th.id ? 'active' : ''}`}
                    onClick={() => handleThemeChange(th.id)}
                  >
                    <div style={{
                      width: '20px', height: '20px', borderRadius: '50%', border: '1px solid var(--border-strong)',
                      background: th.mode === 'dark' ? '#1e293b' : '#ffffff',
                      boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.1)'
                    }} />
                    <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>{th.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Voice & Language Selection */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div className="input-group">
                <label htmlFor="language">Language</label>
                <select
                  id="language"
                  value={lang}
                  onChange={e => setLang(e.target.value)}
                  disabled={loading}
                >
                  {Object.entries(LANGUAGES).map(([code, meta]) => (
                    <option key={code} value={code}>{meta.label}</option>
                  ))}
                </select>
              </div>

              <div className="input-group">
                <label>AI Voice Persona</label>
                <select
                  value={selectedVoice}
                  onChange={e => handleVoiceChange(e.target.value)}
                  style={{ padding: '12px 16px', background: 'var(--bg-panel-solid)', color: 'var(--text-primary)', border: '1px solid var(--border-strong)', borderRadius: 'var(--r-md)' }}
                >
                  {VOICES.map(v => (
                    <option key={v.id} value={v.id}>{v.label} — {v.desc}</option>
                  ))}
                </select>
              </div>
            </div>

          </div>

          {/* Error */}
          {error && <div className="error-toast">⚠️ {error}</div>}

          {/* Start Button */}
          <button
            className="start-btn"
            onClick={handleStart}
            disabled={(!topic.trim() && files.length === 0) || loading}
            style={{ marginTop: '16px' }}
          >
            {loading ? 'Analyzing Content & Building Lesson...' : 'Start Live Session ✦'}
          </button>
        </div>

      </main>
    </>
  );
}
