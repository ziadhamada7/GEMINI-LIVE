'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import Whiteboard from '@/components/Whiteboard';
import { useAudio } from '@/hooks/useAudio';
import { useLanguage } from '@/i18n/LanguageContext';
import { LANGUAGES } from '@/i18n/locales';

const WS_URL = process.env.NEXT_PUBLIC_API_WS_URL ?? 'wss://api-55200224265.europe-west1.run.app';

export default function LessonPage() {
    const { t, lang, setLang } = useLanguage();

    // Core state
    const [status, setStatus] = useState('loading');
    const [section, setSection] = useState(null);
    const [errors, setErrors] = useState([]);
    const [transcript, setTranscript] = useState([]);
    const [lessonTitle, setLessonTitle] = useState('');
    const [quiz, setQuiz] = useState(null);
    const [quizResult, setQuizResult] = useState(null);
    const [selectedAnswer, setSelectedAnswer] = useState(null);
    const [stepProgress, setStepProgress] = useState({ current: 0, total: 0 });
    const [volume, setVolume] = useState(1);
    const [sectionTitles, setSectionTitles] = useState([]);
    const [lessonSources, setLessonSources] = useState([]);
    const [planData, setPlanData] = useState(null); // Save original plan for outline
    const [activeTool, setActiveTool] = useState(null);
    const [lessonTimeMs, setLessonTimeMs] = useState(0);
    const [rotateDismissed, setRotateDismissed] = useState(false);

    // Dynamic board sizing
    const [boardWidth, setBoardWidth] = useState(880);
    const [boardHeight, setBoardHeight] = useState(520);
    const boardAreaRef = useRef(null);

    // Selection & Drawing Tool state
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectionRect, setSelectionRect] = useState(null);
    const [showCommentPopup, setShowCommentPopup] = useState(false);
    const [commentText, setCommentText] = useState('');
    const [isSendingExplain, setIsSendingExplain] = useState(false);
    const [penColor, setPenColor] = useState('#ef4444'); // Default red
    const selectionStartRef = useRef(null);
    const overlayRef = useRef(null);

    const wsRef = useRef(null);
    const boardRef = useRef(null);
    const transcriptRef = useRef(null);
    const retryTimerRef = useRef(null);
    const timerRef = useRef(null);
    const planRef = useRef(null);
    const lessonLangRef = useRef(lang);
    const { enqueueItem, clearAudioQueue, startMic, stopMic, micActive, setGainValue } = useAudio();

    // ── Dynamic board sizing ──────────────────────────────────────────────
    const ASPECT = 88 / 52; // ~1.692
    useEffect(() => {
        const el = boardAreaRef.current;
        if (!el) return;
        const compute = () => {
            // Available space minus padding (24px each side) and controls (~80px)
            const pad = 48;
            const controlsH = 80;
            const availW = el.clientWidth - pad;
            const availH = el.clientHeight - pad - controlsH;
            if (availW <= 0 || availH <= 0) return;
            let w, h;
            if (availW / availH > ASPECT) {
                // Height-constrained
                h = availH;
                w = Math.round(h * ASPECT);
            } else {
                // Width-constrained
                w = availW;
                h = Math.round(w / ASPECT);
            }
            // Clamp minimums
            w = Math.max(400, w);
            h = Math.max(Math.round(400 / ASPECT), h);
            setBoardWidth(w);
            setBoardHeight(h);
        };
        compute();
        const ro = new ResizeObserver(compute);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // ── Timer Logic ───────────────────────────────────────────────────────
    useEffect(() => {
        if (status === 'teaching' || status === 'listening' || status === 'answering') {
            timerRef.current = setInterval(() => {
                setLessonTimeMs(prev => prev + 1000);
            }, 1000);
        } else {
            clearInterval(timerRef.current);
        }
        return () => clearInterval(timerRef.current);
    }, [status]);

    const formatTime = (ms) => {
        const totalSec = Math.floor(ms / 1000);
        const m = Math.floor(totalSec / 60).toString().padStart(2, '0');
        const s = (totalSec % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    };

    const addTranscript = useCallback((role, text) => {
        setTranscript(prev => [...prev, { id: Date.now() + Math.random(), role, text }]);
        setTimeout(() => {
            if (transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
        }, 50);
    }, []);

    const handleVolumeChange = useCallback((e) => {
        const v = parseFloat(e.target.value);
        setVolume(v);
        setGainValue(v);
    }, [setGainValue]);

    // ── WebSocket logic (unchanged) ───────────────────────────────────────
    const connect = useCallback((plan, retryCount = 0) => {
        if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) return;

        if (wsRef.current) {
            wsRef.current.onclose = null;
            try { wsRef.current.close(); } catch { }
            wsRef.current = null;
        }

        const ws = new WebSocket(`${WS_URL}/teach`);
        wsRef.current = ws;

        ws.onopen = () => {
            setErrors([]);
            // Apply voice config if available in backend later. 
            // For now UI only as requested, sending original plan.
            const voice = localStorage.getItem('tutor_voice');
            ws.send(JSON.stringify({
                type: 'start',
                lessonPlan: plan,
                language: lessonLangRef.current,
                voice: voice // Optional parameter if backend supports it
            }));
        };

        ws.onmessage = (event) => {
            let msg;
            try { msg = JSON.parse(event.data); } catch { return; }

            switch (msg.type) {
                case 'status':
                    setStatus(msg.data);
                    break;
                case 'section':
                    setSection(msg.data);
                    setStepProgress({ current: 0, total: 0 });
                    break;
                case 'step_progress':
                    setStepProgress(msg.data);
                    break;
                case 'draw':
                    if (msg.commands) {
                        enqueueItem({ type: 'event', data: { type: 'draw', commands: msg.commands, animMs: msg.animMs || 0 } });
                    }
                    break;
                case 'freeze':
                    if (boardRef.current) boardRef.current.freeze();
                    break;
                case 'audio':
                    enqueueItem({ type: 'audio', b64Data: msg.data });
                    break;
                case 'text':
                    addTranscript('ai', msg.data);
                    break;
                case 'quiz':
                    setQuiz(msg.data);
                    setQuizResult(null);
                    setSelectedAnswer(null);
                    break;
                case 'quiz_result':
                    setQuizResult(msg.data);
                    if (msg.data.correct) {
                        setTimeout(() => { setQuiz(null); setQuizResult(null); setSelectedAnswer(null); }, 2500);
                    }
                    break;
                case 'error':
                    setErrors(prev => [...prev.slice(-9), { id: Date.now(), text: msg.data }]);
                    break;
            }
        };

        ws.onclose = (e) => {
            wsRef.current = null;
            if (e.code !== 1000 && retryCount < 3) {
                setStatus('loading');
                retryTimerRef.current = setTimeout(() => connect(plan, retryCount + 1), 2000);
            } else {
                setStatus('disconnected');
            }
        };
        ws.onerror = () => { };
    }, [enqueueItem, addTranscript]);

    useEffect(() => {
        const handleSyncEvent = (e) => {
            const ev = e.detail;
            if (ev?.type === 'draw' && boardRef.current) {
                boardRef.current.draw(ev.commands, ev.animMs);
            }
        };
        window.addEventListener('tutor_sync_event', handleSyncEvent);
        return () => window.removeEventListener('tutor_sync_event', handleSyncEvent);
    }, []);

    useEffect(() => {
        // Hydrate theme
        const savedTheme = localStorage.getItem('tutor_theme') || 'light-dot';
        document.body.className = savedTheme.includes('dark') ? 'theme-dark' : '';

        const planJson = sessionStorage.getItem('lessonPlan');
        const savedLang = sessionStorage.getItem('lessonLang');
        const savedSources = sessionStorage.getItem('lessonSources');

        if (savedLang && LANGUAGES[savedLang]) {
            setLang(savedLang);
            lessonLangRef.current = savedLang;
        }

        if (savedSources) {
            try { setLessonSources(JSON.parse(savedSources)); } catch { }
        }

        if (!planJson) {
            setStatus('error');
            setErrors([{ id: 1, text: t('lesson.noplan') }]);
            return;
        }
        try {
            const plan = JSON.parse(planJson);
            planRef.current = plan;
            setPlanData(plan);
            setLessonTitle(plan.title || 'Lesson');
            setSectionTitles((plan.sections || []).map(s => s.title));
            connect(plan);
        } catch {
            setStatus('error');
        }
        return () => {
            if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
            if (wsRef.current) {
                wsRef.current.onclose = null;
                wsRef.current.close();
            }
        };
    }, [connect, setLang, t]);

    const handleMicToggle = useCallback(async () => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        if (micActive) {
            stopMic();
            ws.send(JSON.stringify({ type: 'mic_off' }));
            return;
        }

        clearAudioQueue();
        ws.send(JSON.stringify({ type: 'mic_on' }));
        await new Promise(r => setTimeout(r, 300));
        try {
            await startMic((b64) => {
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({
                        type: 'audio', data: b64, mimeType: 'audio/pcm;rate=16000',
                    }));
                }
            });
        } catch (err) {
            ws.send(JSON.stringify({ type: 'mic_off' }));
        }
    }, [micActive, startMic, stopMic, clearAudioQueue]);

    const handlePause = useCallback(() => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        wsRef.current.send(JSON.stringify({ type: 'pause' }));
        clearAudioQueue();
        if (boardRef.current) boardRef.current.freeze();
    }, [clearAudioQueue]);

    const handlePlay = useCallback(() => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        wsRef.current.send(JSON.stringify({ type: 'play' }));
        // Clear user drawings when resuming the lesson
        if (boardRef.current && boardRef.current.clearUserDrawing) {
            boardRef.current.clearUserDrawing();
        }
    }, []);

    const handleStop = useCallback(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'stop' }));
        }
        stopMic();
        clearAudioQueue();
    }, [stopMic, clearAudioQueue]);

    const handleResume = useCallback(() => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        stopMic();
        wsRef.current.send(JSON.stringify({ type: 'resume' }));
    }, [stopMic]);

    const handleNavigate = useCallback((dirStep, dirSection) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        stopMic();
        clearAudioQueue();
        if (boardRef.current) boardRef.current.freeze();
        wsRef.current.send(JSON.stringify({ type: 'navigate', dirStep, dirSection }));
    }, [stopMic, clearAudioQueue]);

    const handleQuizAnswer = (i) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || selectedAnswer !== null) return;
        setSelectedAnswer(i);
        wsRef.current.send(JSON.stringify({ type: 'quiz_answer', answer: i }));
    };

    const goBack = () => { window.location.href = '/'; };

    const isTerminal = ['finished', 'stopped', 'disconnected', 'error'].includes(status);
    const isQA = ['listening', 'answering', 'confirming'].includes(status);
    const canToggleMic = status === 'teaching' || status === 'confirming' || (status === 'listening' && micActive);

    const handleToolSelect = useCallback((tool) => {
        if (activeTool === tool) {
            // Deactivate
            setActiveTool(null);
            if (tool === 'Select') {
                setSelectionMode(false);
                setSelectionRect(null);
                setShowCommentPopup(false);
                setCommentText('');
            }
        } else {
            // Activate: pause lesson first
            setActiveTool(tool);
            if (tool === 'Select') {
                setSelectionMode(true);
                if (status === 'teaching') handlePause();
            } else if (tool === 'Pen' || tool === 'Eraser') {
                setSelectionMode(false);
                setSelectionRect(null);
                setShowCommentPopup(false);
            }
        }
    }, [activeTool, status, handlePause]);

    const handleUserDrawStart = useCallback(() => {
        // Automatically pause when user begins to draw
        if (status === 'teaching' || status === 'listening') {
            handlePause();
        }
    }, [status, handlePause]);

    const handleOverlayMouseDown = useCallback((e) => {
        if (!selectionMode || showCommentPopup) return;
        const overlay = overlayRef.current;
        if (!overlay) return;
        const rect = overlay.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        selectionStartRef.current = { x, y };
        setSelectionRect({ x, y, w: 0, h: 0 });
    }, [selectionMode, showCommentPopup]);

    const handleOverlayMouseMove = useCallback((e) => {
        if (!selectionStartRef.current || !selectionMode) return;
        const overlay = overlayRef.current;
        if (!overlay) return;
        const rect = overlay.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const startX = selectionStartRef.current.x;
        const startY = selectionStartRef.current.y;
        setSelectionRect({
            x: Math.min(startX, x),
            y: Math.min(startY, y),
            w: Math.abs(x - startX),
            h: Math.abs(y - startY),
        });
    }, [selectionMode]);

    const handleOverlayMouseUp = useCallback(() => {
        if (!selectionStartRef.current || !selectionMode) return;
        selectionStartRef.current = null;
        // Show comment popup if selection is big enough
        if (selectionRect && selectionRect.w > 20 && selectionRect.h > 20) {
            setShowCommentPopup(true);
        } else {
            setSelectionRect(null);
        }
    }, [selectionMode, selectionRect]);

    const handleCancelSelection = useCallback(() => {
        setSelectionRect(null);
        setShowCommentPopup(false);
        setCommentText('');
    }, []);

    const handleSendExplain = useCallback(() => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !selectionRect) return;
        setIsSendingExplain(true);

        // Capture the selected area from the canvas
        // We need to map the overlay coords to canvas coords
        const wrapper = overlayRef.current?.parentElement;
        const canvasEl = boardRef.current?.getCanvasEl?.();
        if (!wrapper || !canvasEl) { setIsSendingExplain(false); return; }

        const wrapperRect = wrapper.getBoundingClientRect();
        const canvasDisplayW = canvasEl.offsetWidth;
        const canvasDisplayH = canvasEl.offsetHeight;
        const canvasActualW = boardWidth; // logical width
        const canvasActualH = boardHeight; // logical height

        // Scale overlay coords to logical canvas coords
        const scaleX = canvasActualW / canvasDisplayW;
        const scaleY = canvasActualH / canvasDisplayH;
        const cx = selectionRect.x * scaleX;
        const cy = selectionRect.y * scaleY;
        const cw = selectionRect.w * scaleX;
        const ch = selectionRect.h * scaleY;

        const imageBase64 = boardRef.current?.getCanvasSnapshot?.(cx, cy, cw, ch) || null;

        wsRef.current.send(JSON.stringify({
            type: 'explain_selection',
            image: imageBase64,
            comment: commentText.trim() || '',
        }));

        // Clean up
        setShowCommentPopup(false);
        setSelectionRect(null);
        setCommentText('');
        setSelectionMode(false);
        setActiveTool(null);
        setIsSendingExplain(false);
    }, [selectionRect, commentText]);

    const currentTheme = (typeof window !== 'undefined' ? localStorage.getItem('tutor_theme') : '') || 'light-dot';
    const isDark = currentTheme.includes('dark');

    const currentSectionIdx = section ? section.index : 1;
    const totalSections = planData?.sections?.length || 1;
    const overallProgressPct = Math.min(100, Math.round(((currentSectionIdx - 1) / totalSections) * 100));

    const isFirstSection = currentSectionIdx <= 1;
    const isLastSection = currentSectionIdx >= totalSections;
    const isFirstStepOfFirstSection = isFirstSection && (stepProgress.current <= 1);
    const isLastStepOfLastSection = isLastSection && (stepProgress.total > 0 && stepProgress.current >= stepProgress.total);

    return (
        <div className="lesson-layout">

            {/* ─── ROTATE PROMPT (mobile portrait) ─── */}
            {!rotateDismissed && (
                <div className="rotate-prompt">
                    <div className="rotate-icon">📱</div>
                    <p>Rotate your phone to landscape for the best whiteboard experience</p>
                    <button className="dismiss-btn" onClick={() => setRotateDismissed(true)}>
                        Continue in Portrait
                    </button>
                </div>
            )}

            {/* ─── TOP BAR ─── */}
            <header className="topbar">
                <div className="topbar-left">
                    <button onClick={goBack} className="ctrl-btn-icon" style={{ marginRight: '8px' }} title="Back Home">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
                    </button>
                    <div className="lesson-title">{lessonTitle}</div>
                    <div className="live-badge">Live Session</div>
                </div>
                <div className="topbar-right">
                    <div className={`ai-status-pill ${status === 'teaching' || status === 'answering' ? 'speaking' : ''}`}>
                        <div className="ai-dot"></div>
                        <span>{status === 'loading' ? 'Connecting...' : status === 'paused' ? 'Tutor Paused' : (status === 'teaching' || status === 'answering') ? 'AI Tutor Speaking...' : isQA ? 'Listening...' : status}</span>
                        {(status === 'teaching' || status === 'answering') && (
                            <div className="waveform">
                                <div className="wave-bar"></div>
                                <div className="wave-bar"></div>
                                <div className="wave-bar"></div>
                                <div className="wave-bar"></div>
                                <div className="wave-bar"></div>
                            </div>
                        )}
                    </div>
                </div>
            </header>

            {/* ─── LEFT TOOLBAR ─── */}
            <aside className="toolbar">
                {/* Select & Comment Tool */}
                <div
                    className={`tool-icon ${activeTool === 'Select' ? 'active' : ''}`}
                    onClick={() => handleToolSelect('Select')}
                    title="Select & Comment"
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" strokeDasharray="4 2" />
                        <path d="M9 14l2 2 4-4" />
                    </svg>
                </div>

                {/* Pen Tool */}
                <div
                    className={`tool-icon ${activeTool === 'Pen' ? 'active' : ''}`}
                    onClick={() => handleToolSelect('Pen')}
                    title="Pen tool"
                    style={{ position: 'relative' }}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 19l7-7 3 3-7 7-3-3z"></path><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path><path d="M2 2l7.586 7.586"></path><circle cx="11" cy="11" r="2"></circle>
                    </svg>

                    {/* Color Picker Flyout */}
                    {activeTool === 'Pen' && (
                        <div className="color-picker-flyout">
                            {['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#ffffff', '#000000'].map(c => (
                                <div
                                    key={c}
                                    className={`color-swatch ${penColor === c ? 'selected' : ''}`}
                                    style={{ backgroundColor: c }}
                                    onClick={(e) => { e.stopPropagation(); setPenColor(c); }}
                                    title={c}
                                />
                            ))}
                        </div>
                    )}
                </div>

                {/* Eraser Tool */}
                <div
                    className={`tool-icon ${activeTool === 'Eraser' ? 'active' : ''}`}
                    onClick={() => handleToolSelect('Eraser')}
                    title="Eraser"
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 20H7L3 16C2.5 15.5 2.5 14.5 3 14L13 4C13.5 3.5 14.5 3.5 15 4L20 9C20.5 9.5 20.5 10.5 20 11L11 20"></path><path d="M17 14L7 14"></path>
                    </svg>
                </div>

                <div className="tool-divider" />
                <div className="tool-icon" title="Settings">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
                </div>
            </aside>

            {/* ─── WHITEBOARD AREA ─── */}
            <main className="board-area" ref={boardAreaRef}>
                <div className={`whiteboard-wrapper board-texture-${currentTheme.split('-')[1] || currentTheme}`} style={{ position: 'relative', maxWidth: boardWidth + 'px' }}>
                    <Whiteboard
                        ref={boardRef}
                        width={boardWidth}
                        height={boardHeight}
                        activeTool={activeTool}
                        penColor={penColor}
                        onDrawStart={handleUserDrawStart}
                    />

                    {/* Selection Overlay */}
                    {selectionMode && (
                        <div
                            ref={overlayRef}
                            className="selection-overlay"
                            onMouseDown={handleOverlayMouseDown}
                            onMouseMove={handleOverlayMouseMove}
                            onMouseUp={handleOverlayMouseUp}
                            onMouseLeave={handleOverlayMouseUp}
                        >
                            {selectionRect && selectionRect.w > 2 && selectionRect.h > 2 && (
                                <div
                                    className="selection-rect"
                                    style={{
                                        left: selectionRect.x + 'px',
                                        top: selectionRect.y + 'px',
                                        width: selectionRect.w + 'px',
                                        height: selectionRect.h + 'px',
                                    }}
                                />
                            )}
                        </div>
                    )}

                    {/* Comment Popup */}
                    {showCommentPopup && selectionRect && (
                        <div
                            className="comment-popup"
                            style={{
                                left: Math.min(selectionRect.x + selectionRect.w + 12, 600) + 'px',
                                top: Math.max(selectionRect.y, 10) + 'px',
                            }}
                        >
                            <div className="comment-popup-header">
                                <span>💬 Comment</span>
                                <button className="comment-close-btn" onClick={handleCancelSelection}>✕</button>
                            </div>
                            <textarea
                                className="comment-input"
                                placeholder="Type your question about this area... (leave empty to just explain)"
                                value={commentText}
                                onChange={e => setCommentText(e.target.value)}
                                rows={3}
                                autoFocus
                            />
                            <div className="comment-actions">
                                <button
                                    className="comment-send-btn"
                                    onClick={handleSendExplain}
                                    disabled={isSendingExplain}
                                >
                                    {isSendingExplain ? 'Sending...' : 'Send'}
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2L11 13" /><path d="M22 2L15 22L11 13L2 9L22 2Z" /></svg>
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* ─── FLOATING CONTROLS ─── */}
                <div className="floating-controls" style={{ maxWidth: boardWidth + 'px' }}>

                    {/* Timer */}
                    <div className="timer">{formatTime(lessonTimeMs)}</div>
                    <div className="ctrl-divider"></div>

                    <div className="ctrl-group">
                        {/* Prev Section */}
                        <button className="ctrl-btn-icon" title="Previous Section" onClick={() => handleNavigate(0, -1)} disabled={isTerminal || isFirstSection} style={{ opacity: (isTerminal || isFirstSection) ? 0.4 : 1, cursor: (isTerminal || isFirstSection) ? 'not-allowed' : 'pointer' }}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" /></svg>
                        </button>
                        {/* Prev Step */}
                        <button className="ctrl-btn-icon" title="Previous Step" onClick={() => handleNavigate(-1, 0)} disabled={isTerminal || isFirstStepOfFirstSection} style={{ opacity: (isTerminal || isFirstStepOfFirstSection) ? 0.4 : 1, cursor: (isTerminal || isFirstStepOfFirstSection) ? 'not-allowed' : 'pointer' }}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
                        </button>

                        {/* Play/Pause */}
                        <button
                            className="ctrl-btn-icon"
                            title={status === 'paused' ? 'Play' : 'Pause'}
                            onClick={status === 'paused' ? handlePlay : handlePause}
                            disabled={isTerminal || status === 'idle'}
                            style={{ opacity: (isTerminal || status === 'idle') ? 0.4 : 1, cursor: (isTerminal || status === 'idle') ? 'not-allowed' : 'pointer', background: 'rgba(255, 255, 255, 0.1)', transform: 'scale(1.1)' }}
                        >
                            {status === 'paused' ?
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg> :
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
                            }
                        </button>

                        {/* Next Step */}
                        <button className="ctrl-btn-icon" title="Next Step" onClick={() => handleNavigate(1, 0)} disabled={isTerminal || isLastStepOfLastSection} style={{ opacity: (isTerminal || isLastStepOfLastSection) ? 0.4 : 1, cursor: (isTerminal || isLastStepOfLastSection) ? 'not-allowed' : 'pointer' }}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
                        </button>
                        {/* Next Section */}
                        <button className="ctrl-btn-icon" title="Next Section" onClick={() => handleNavigate(0, 1)} disabled={isTerminal || isLastSection} style={{ opacity: (isTerminal || isLastSection) ? 0.4 : 1, cursor: (isTerminal || isLastSection) ? 'not-allowed' : 'pointer' }}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 17l5-5-5-5M6 17l5-5-5-5" /></svg>
                        </button>

                        {isQA && (
                            <button className="ctrl-btn-icon" onClick={handleResume} title="Resume Lesson" style={{ color: 'var(--accent)' }}>
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                            </button>
                        )}
                    </div>

                    {/* Big Mic Button */}
                    <button
                        className={`mic-main-btn ${micActive ? 'recording' : ''}`}
                        onClick={handleMicToggle}
                        disabled={isTerminal || !canToggleMic}
                        title={micActive ? 'Stop Recording' : 'Ask Question (Mic)'}
                        style={{ opacity: (isTerminal || !canToggleMic) ? 0.5 : 1, cursor: (isTerminal || !canToggleMic) ? 'not-allowed' : 'pointer' }}
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
                    </button>

                    {/* Hide Stop Button when Terminal */}
                    {!isTerminal && (
                        <div className="ctrl-group">
                            <button className={`ctrl-btn-icon stop-btn ${isTerminal ? 'active' : ''}`} title="Stop Lesson" onClick={handleStop} disabled={isTerminal}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" color="var(--accent-red)"><rect x="4" y="4" width="16" height="16" rx="2" ry="2" /></svg>
                            </button>
                        </div>
                    )}

                    <div className="ctrl-divider" style={{ display: isTerminal ? 'none' : 'block' }}></div>

                    {/* Volume Control */}
                    <div className="ctrl-group">
                        <span style={{ display: 'flex', alignItems: 'center', color: 'var(--text-secondary)' }}>
                            {volume === 0 ? (
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" x2="17" y1="9" y2="15"></line><line x1="17" x2="23" y1="9" y2="15"></line></svg>
                            ) : volume < 0.5 ? (
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
                            ) : (
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>
                            )}
                        </span>
                        <input
                            type="range"
                            className="volume-slider"
                            min="0" max="1" step="0.05"
                            value={volume}
                            onChange={handleVolumeChange}
                            disabled={isTerminal}
                            style={{
                                background: `linear-gradient(to right, #3b82f6 ${volume * 100}%, rgba(128,128,128,0.2) ${volume * 100}%)`,
                                opacity: isTerminal ? 0.5 : 1
                            }}
                        />
                    </div>
                </div>

                {errors.length > 0 && (
                    <div className="error-toast">
                        <span>{errors[errors.length - 1].text}</span>
                        <button onClick={() => setErrors([])} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>✕</button>
                    </div>
                )}
            </main>

            {/* ─── RIGHT PANEL ─── */}
            <aside className="right-panel">
                {/* Lesson Outline */}
                <div className="panel-section">
                    <h3>Lesson Outline</h3>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px' }}>{overallProgressPct}% Complete</div>
                    <div className="outline-progress">
                        <div className="outline-progress-fill" style={{ width: `${overallProgressPct}%` }}></div>
                    </div>

                    <div className="outline-steps">
                        {sectionTitles.map((title, i) => {
                            const stepIdx = i + 1;
                            const isCompleted = stepIdx < currentSectionIdx;
                            const isActive = stepIdx === currentSectionIdx;
                            return (
                                <div key={i} className={`outline-step ${isCompleted ? 'completed' : ''} ${isActive ? 'active' : ''}`}>
                                    <div className="step-icon">{isCompleted ? '✓' : ''}</div>
                                    <span>{title}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Mini Quiz Container */}
                {quiz && (
                    <div className="panel-section">
                        <div className="mini-quiz-card">
                            <h4 style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" color="var(--accent-yellow)"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                                Mini Quiz
                            </h4>
                            <p style={{ fontSize: '0.85rem', marginBottom: '16px', lineHeight: 1.4 }}>{quiz.question}</p>
                            <div>
                                {quiz.options.map((opt, i) => (
                                    <button
                                        key={i}
                                        className={`quiz-opt ${quizResult ? (i === quiz.correctIndex ? ' correct' : selectedAnswer === i ? ' wrong' : '') : selectedAnswer === i ? ' selected' : ''}`}
                                        onClick={() => handleQuizAnswer(i)}
                                        disabled={selectedAnswer !== null}
                                    >
                                        <b style={{ marginRight: '8px' }}>{String.fromCharCode(65 + i)}.</b> {opt}
                                    </button>
                                ))}
                            </div>

                            {quizResult && !quizResult.correct && (
                                <button className="quiz-submit" onClick={() => { setQuiz(null); setQuizResult(null); }}>
                                    Dismiss and Continue
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* References */}
                <div className="panel-section" style={{ marginTop: 'auto' }}>
                    <h3>Source References</h3>
                    <div className="ref-list">
                        {lessonSources.length > 0 ? lessonSources.map((src, i) => (
                            <div className="ref-item" key={i} title={src.name}>
                                <div className="ref-name" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {src.type === 'PDF' ? (
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" color="var(--accent-red)"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>
                                    ) : src.type === 'Text' ? (
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" color="var(--accent-blue)"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="16" y2="13" /><line x1="8" y1="13" x2="12" y2="13" /><line x1="8" y1="17" x2="16" y2="17" /></svg>
                                    ) : (
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" color="var(--accent)"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                                    )}
                                    <span style={{ marginLeft: '6px' }}>{src.name}</span>
                                </div>
                                <span className="ref-meta">{src.type}</span>
                            </div>
                        )) : (
                            <div className="ref-item" style={{ opacity: 0.6 }}>
                                <div className="ref-name">No sources provided</div>
                            </div>
                        )}
                    </div>
                </div>
            </aside>



        </div>
    );
}
