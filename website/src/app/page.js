'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/i18n/LanguageContext';
import { LANGUAGES } from '@/i18n/locales';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function SetupPage() {
  const router = useRouter();
  const { t, lang, setLang } = useLanguage();
  const [topic, setTopic] = useState('');
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

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
      router.push('/lesson');
    } catch (err) {
      setError(t('setup.errorConnect') + err.message);
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
            <span className="logo-text">{t('setup.logo')}</span>
          </div>
          <h1>{t('setup.title')}</h1>
          <p>{t('setup.subtitle')}</p>
        </header>

        {/* Setup Card */}
        <div className="setup-card">
          {/* Language Selector */}
          <div className="input-group">
            <label htmlFor="language">{t('setup.langLabel')}</label>
            <select
              id="language"
              className="lang-select"
              value={lang}
              onChange={e => setLang(e.target.value)}
              disabled={loading}
            >
              {Object.entries(LANGUAGES).map(([code, meta]) => (
                <option key={code} value={code}>{meta.label}</option>
              ))}
            </select>
          </div>

          {/* Topic Input */}
          <div className="input-group">
            <label htmlFor="topic">{t('setup.topicLabel')}</label>
            <input
              id="topic"
              type="text"
              placeholder={t('setup.topicPlaceholder')}
              value={topic}
              onChange={e => setTopic(e.target.value)}
              disabled={loading}
              autoFocus
            />
          </div>

          {/* File Upload */}
          <div className="input-group">
            <label>{t('setup.uploadLabel')} <span className="label-hint">{t('setup.uploadHint')}</span></label>
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
                  <span>{t('setup.uploadPlaceholder')}</span>
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
            disabled={(!topic.trim() && files.length === 0) || loading}
          >
            {loading ? (
              <span className="btn-loading">
                <span className="spinner" />
                {t('setup.loading')}
              </span>
            ) : (
              <>{t('setup.startBtn')}</>
            )}
          </button>
        </div>

        {/* Features */}
        <div className="features">
          <div className="feature">
            <span className="feature-icon">🎤</span>
            <h3>{t('setup.feat1Title')}</h3>
            <p>{t('setup.feat1Desc')}</p>
          </div>
          <div className="feature">
            <span className="feature-icon">🖍️</span>
            <h3>{t('setup.feat2Title')}</h3>
            <p>{t('setup.feat2Desc')}</p>
          </div>
          <div className="feature">
            <span className="feature-icon">📐</span>
            <h3>{t('setup.feat3Title')}</h3>
            <p>{t('setup.feat3Desc')}</p>
          </div>
        </div>
      </main>
    </>
  );
}
