'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/i18n/LanguageContext';
import { LANGUAGES } from '@/i18n/locales';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'https://api-55200224265.europe-west1.run.app';

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
  const [history, setHistory] = useState([]);

  const fileRef = useRef(null);

  useEffect(() => {
    // Load saved preferences if available
    const savedTheme = localStorage.getItem('tutor_theme');
    const savedVoice = localStorage.getItem('tutor_voice');
    if (savedTheme) setSelectedTheme(savedTheme);
    if (savedVoice) setSelectedVoice(savedVoice);

    // Load topic history
    try {
      const saved = JSON.parse(localStorage.getItem('topic_history') || '[]');
      setHistory(saved);
    } catch { setHistory([]); }

    // Apply body theme immediately for preview
    document.body.className = '';
    const themeObj = THEMES.find(t => t.id === (savedTheme || 'light-dot'));
    if (themeObj?.mode === 'dark') document.body.classList.add('theme-dark');
  }, []);

  const addToHistory = (topicName, plan) => {
    const entry = { topic: topicName, date: new Date().toLocaleDateString() };
    const updated = [entry, ...history.filter(h => h.topic !== topicName)].slice(0, 10);
    setHistory(updated);
    localStorage.setItem('topic_history', JSON.stringify(updated));
    // Store plan separately keyed by topic name
    if (plan) {
      try {
        localStorage.setItem('topic_plan_' + topicName, JSON.stringify(plan));
      } catch (e) { console.warn('Could not save plan to history:', e); }
    }
  };

  const removeFromHistory = (topicName) => {
    const updated = history.filter(h => h.topic !== topicName);
    setHistory(updated);
    localStorage.setItem('topic_history', JSON.stringify(updated));
    localStorage.removeItem('topic_plan_' + topicName);
  };

  const clearHistory = () => {
    // Also clear all saved plans
    history.forEach(h => localStorage.removeItem('topic_plan_' + h.topic));
    setHistory([]);
    localStorage.removeItem('topic_history');
  };

  const handleHistoryTopic = (topicName) => {
    // Check if we have a saved plan for this topic
    const savedPlan = localStorage.getItem('topic_plan_' + topicName);
    if (savedPlan) {
      try {
        const plan = JSON.parse(savedPlan);
        sessionStorage.setItem('lessonPlan', JSON.stringify(plan));
        sessionStorage.setItem('lessonId', `history-${Date.now()}`);
        sessionStorage.setItem('lessonLang', lang);
        sessionStorage.setItem('lessonSources', JSON.stringify([{ name: topicName, type: 'History' }]));
        setLoading(true);
        router.push('/lesson');
        return;
      } catch (e) { /* fall through to just fill input */ }
    }
    // No saved plan — just fill the input
    setTopic(topicName);
  };

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

      // Save custom topic to history (with plan)
      if (topic.trim()) addToHistory(topic.trim(), data.plan);

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

  const handlePredefinedTopic = async (topicId) => {
    setLoading(true);
    setError(null);
    try {
      // Fetch the pre-generated lesson plans
      const res = await fetch('/topics.json');
      const topicsData = await res.json();

      const plan = topicsData[topicId];
      if (!plan) {
        throw new Error('Lesson plan not found for this topic.');
      }

      // Store the lesson plan, language, and navigate to lesson page
      sessionStorage.setItem('lessonPlan', JSON.stringify(plan));
      sessionStorage.setItem('lessonId', `predef-${Date.now()}`);
      sessionStorage.setItem('lessonLang', lang);

      // Store source references
      sessionStorage.setItem('lessonSources', JSON.stringify([{ name: topicId, type: 'Predefined' }]));

      router.push('/lesson');
    } catch (err) {
      setError('Could not load predefined lesson: ' + err.message);
      setLoading(false);
    }
  };

  return (
    <main className="home-container">
      {/* Background decorations if any */}

      {/* Floating Topics */}
      <div className="floating-topic top-left" onClick={() => handlePredefinedTopic('Python Basics')}>
        <div className="topic-img python" />
        <span>Python Basics</span>
      </div>
      <div className="floating-topic bottom-left" onClick={() => handlePredefinedTopic('Ancient Egypt')}>
        <div className="topic-img egypt" />
        <span>Ancient Egypt</span>
      </div>
      <div className="floating-topic top-right" onClick={() => handlePredefinedTopic('Photosynthesis')}>
        <div className="topic-img photo" />
        <span>Photosynthesis</span>
      </div>
      <div className="floating-topic bottom-right" onClick={() => handlePredefinedTopic('Basic Algebra')}>
        <div className="topic-img math" />
        <span>Basic Algebra</span>
      </div>

      <div className="home-content">
        <header className="home-header">
          <div className="home-logo">
            <div className="logo-g">G</div>
            <span style={{ fontWeight: 600 }}>Smart Lecture</span> <span style={{ fontWeight: 300 }}>APP</span>
          </div>
          <p className="home-subtitle">Your Interactive AI Tutor for Live Learning</p>
        </header>

        <h1 className="home-title">What would you like to learn today?</h1>

        <div className="home-form-card glass-panel">

          <div className="home-input-row">
            <input
              type="text"
              placeholder="Enter a topic..."
              className="home-topic-input"
              value={topic}
              onChange={e => setTopic(e.target.value)}
              disabled={loading}
              autoFocus
            />
            <span className="home-or-text">or</span>
            <button className="home-upload-btn" onClick={() => fileRef.current?.click()} disabled={loading}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
              Upload PDF
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".pdf,.txt,.md,.doc,.docx"
              style={{ display: 'none' }}
              onChange={handleFiles}
            />
          </div>

          {files.length > 0 && (
            <div className="home-files-list">
              {files.map((f, i) => <span key={i} className="file-chip">{f.name}</span>)}
            </div>
          )}

          <div className="home-divider">
            <span>CHOOSE</span>
          </div>

          <div className="home-dropdowns-row">
            <div className="home-dropdown-group">
              <label>Language</label>
              <select className="home-select" value={lang} onChange={e => setLang(e.target.value)} disabled={loading}>
                <option value="" disabled>Select Language</option>
                {Object.entries(LANGUAGES).map(([code, meta]) => (
                  <option key={code} value={code}>{meta.label}</option>
                ))}
              </select>
            </div>
            <div className="home-dropdown-group">
              <label>AI Tutor</label>
              <select className="home-select" value={selectedVoice} onChange={e => handleVoiceChange(e.target.value)} disabled={loading}>
                <option value="" disabled>Select AI Professor</option>
                {VOICES.map(v => (
                  <option key={v.id} value={v.id}>{v.label} — {v.desc}</option>
                ))}
              </select>
            </div>
          </div>

          <button className="home-start-btn" onClick={handleStart} disabled={(!topic.trim() && files.length === 0) || loading}>
            {loading ? 'Starting Lesson...' : 'Start Lesson'}
          </button>

          {error && <div className="error-toast">⚠️ {error}</div>}
        </div>

        {/* ─── Topic History ─── */}
        {history.length > 0 && (
          <div className="history-section">
            <div className="history-header">
              <span className="history-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                Recent Topics
              </span>
              <button className="history-clear-btn" onClick={clearHistory}>Clear All</button>
            </div>
            <div className="history-chips">
              {history.map((h, i) => (
                <div key={i} className="history-chip" onClick={() => handleHistoryTopic(h.topic)}>
                  <span className="history-chip-text">{h.topic}</span>
                  <button
                    className="history-chip-remove"
                    onClick={e => { e.stopPropagation(); removeFromHistory(h.topic); }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
