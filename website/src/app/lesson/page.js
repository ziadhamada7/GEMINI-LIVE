'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import Whiteboard from '@/components/Whiteboard';
import { useAudio } from '@/hooks/useAudio';

const WS_URL = process.env.NEXT_PUBLIC_API_WS_URL ?? 'ws://localhost:3001';

export default function LessonPage() {
    const [status, setStatus] = useState('loading');
    const [section, setSection] = useState(null);
    const [errors, setErrors] = useState([]);
    const [transcript, setTranscript] = useState([]);
    const [lessonTitle, setLessonTitle] = useState('');
    const [quiz, setQuiz] = useState(null);
    const [quizResult, setQuizResult] = useState(null);
    const [selectedAnswer, setSelectedAnswer] = useState(null);

    // New state for improvements
    const [stepProgress, setStepProgress] = useState({ current: 0, total: 0 });
    const [volume, setVolume] = useState(1);
    const [showIntro, setShowIntro] = useState(null); // { index, title }
    const [sectionTitles, setSectionTitles] = useState([]);

    const wsRef = useRef(null);
    const boardRef = useRef(null);
    const transcriptRef = useRef(null);
    const retryTimerRef = useRef(null);
    const planRef = useRef(null);
    const { enqueueItem, clearAudioQueue, startMic, stopMic, micActive, setGainValue } = useAudio();

    const addTranscript = useCallback((role, text) => {
        setTranscript(prev => [...prev, { id: Date.now() + Math.random(), role, text }]);
        setTimeout(() => {
            if (transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
        }, 50);
    }, []);


    // ── Volume change handler ─────────────────────────────────────────────
    const handleVolumeChange = useCallback((e) => {
        const v = parseFloat(e.target.value);
        setVolume(v);
        setGainValue(v);
    }, [setGainValue]);

    // ── WebSocket with retry ──────────────────────────────────────────────
    const connect = useCallback((plan, retryCount = 0) => {
        if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) return;

        if (wsRef.current) {
            wsRef.current.onclose = null;
            try { wsRef.current.close(); } catch { }
            wsRef.current = null;
        }

        console.log(`[ws] Connecting to ${WS_URL}/teach (attempt ${retryCount + 1})...`);
        const ws = new WebSocket(`${WS_URL}/teach`);
        wsRef.current = ws;

        ws.onopen = () => {
            console.log('[ws] Connected!');
            setErrors([]);
            ws.send(JSON.stringify({ type: 'start', lessonPlan: plan }));
        };

        ws.onmessage = (event) => {
            let msg;
            try { msg = JSON.parse(event.data); } catch { return; }

            switch (msg.type) {
                case 'status':
                    console.log('[ws] Status:', msg.data);
                    setStatus(msg.data);
                    break;
                case 'section':
                    setSection(msg.data);
                    setStepProgress({ current: 0, total: 0 });
                    // Section intro animation
                    setShowIntro({ index: msg.data.index, title: msg.data.title });
                    setTimeout(() => setShowIntro(null), 2000);
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
            console.warn('[ws] Closed, code:', e.code);
            wsRef.current = null;
            if (e.code !== 1000 && retryCount < 3) {
                console.log(`[ws] Retrying in 2s... (attempt ${retryCount + 2})`);
                setStatus('loading');
                retryTimerRef.current = setTimeout(() => connect(plan, retryCount + 1), 2000);
            } else {
                setStatus('disconnected');
            }
        };

        ws.onerror = () => { };
    }, [enqueueItem, addTranscript]);

    // ── Sync Event Listener ──────────────────────────────────────────────
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

    // ── Mount ─────────────────────────────────────────────────────────────
    useEffect(() => {
        const planJson = sessionStorage.getItem('lessonPlan');
        if (!planJson) {
            setStatus('error');
            setErrors([{ id: 1, text: 'No lesson plan found. Go back and create one.' }]);
            return;
        }
        try {
            const plan = JSON.parse(planJson);
            planRef.current = plan;
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Mic Toggle ────────────────────────────────────────────────────────
    const handleMicToggle = useCallback(async () => {
        console.log('[mic] Toggle. micActive:', micActive, 'status:', status);
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
            console.error('[mic] Mic failed:', err);
            ws.send(JSON.stringify({ type: 'mic_off' }));
        }
    }, [micActive, startMic, stopMic, clearAudioQueue, status]);

    // ── Pause / Play ──────────────────────────────────────────────────────
    const handlePause = useCallback(() => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ type: 'pause' }));
        clearAudioQueue();
    }, [clearAudioQueue]);

    const handlePlay = useCallback(() => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ type: 'play' }));
    }, []);

    // ── Section Skip ──────────────────────────────────────────────────────
    const handleSkipSection = useCallback((idx) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        clearAudioQueue();
        if (boardRef.current) boardRef.current.clear();
        ws.send(JSON.stringify({ type: 'skip_section', index: idx }));
    }, [clearAudioQueue]);

    const handlePrevSection = useCallback(() => {
        if (!section || section.index <= 1) return;
        handleSkipSection(section.index - 2); // 0-indexed
    }, [section, handleSkipSection]);

    const handleNextSection = useCallback(() => {
        if (!section || !planRef.current) return;
        if (section.index >= planRef.current.sections.length) return;
        handleSkipSection(section.index); // current index = next 0-indexed
    }, [section, handleSkipSection]);

    // ── Resume (Continue Lesson from Q&A) ─────────────────────────────────
    const handleResume = useCallback(() => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        stopMic();
        wsRef.current.send(JSON.stringify({ type: 'resume' }));
    }, [stopMic]);

    // ── Stop ──────────────────────────────────────────────────────────────
    const handleStop = useCallback(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'stop' }));
        }
        stopMic();
        clearAudioQueue();
    }, [stopMic, clearAudioQueue]);

    // ── Quiz ──────────────────────────────────────────────────────────────
    const handleQuizAnswer = (i) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        if (selectedAnswer !== null) return;
        setSelectedAnswer(i);
        wsRef.current.send(JSON.stringify({ type: 'quiz_answer', answer: i }));
    };

    const goBack = () => { window.location.href = '/'; };

    // ── Derived UI state ──────────────────────────────────────────────────
    const statusLabels = {
        loading: '⏳ Connecting…', idle: 'Ready', teaching: '🎓 Teaching',
        paused: '⏸ Paused',
        listening: '👂 Listening…', answering: '💬 Answering…',
        confirming: '🤔 Your turn…', stopped: '⏹ Stopped',
        finished: '✅ Complete', error: '⚠ Error', disconnected: '🔌 Disconnected',
    };

    const isTerminal = ['finished', 'stopped', 'disconnected', 'error'].includes(status);
    const isQA = ['listening', 'answering', 'confirming'].includes(status);
    const canToggleMic = status === 'teaching' || status === 'confirming' || (status === 'listening' && micActive);
    const micState = micActive ? 'recording' : isQA ? 'qa' : 'idle';
    const progress = section ? `${section.index} / ${section.total}` : '';
    const stepPct = stepProgress.total > 0 ? Math.round((stepProgress.current / stepProgress.total) * 100) : 0;

    // ── Keyboard Shortcuts ────────────────────────────────────────────────
    useEffect(() => {
        const handleKey = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            switch (e.code) {
                case 'Space':
                    e.preventDefault();
                    if (status === 'teaching') handlePause();
                    else if (status === 'paused') handlePlay();
                    break;
                case 'KeyM':
                    if (canToggleMic) handleMicToggle();
                    break;
                case 'ArrowLeft':
                    handlePrevSection();
                    break;
                case 'ArrowRight':
                    handleNextSection();
                    break;
            }
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [status, handlePause, handlePlay, handleMicToggle, handlePrevSection, handleNextSection, canToggleMic]);

    return (
        <>
            <div className="bg-canvas" aria-hidden="true" />
            <main className="lesson-page">
                {/* Header */}
                <header className="lesson-header">
                    <button className="back-btn" onClick={goBack}>← Back</button>
                    <div className="lesson-title-area">
                        <h1>{lessonTitle}</h1>
                        {section && <span className="section-title">{section.title}</span>}
                    </div>
                    <div className="lesson-meta">
                        <span className={`status-pill ${status}`}>{statusLabels[status] ?? status}</span>
                        {progress && <span className="progress-pill">{progress}</span>}
                    </div>
                </header>

                {/* Step Progress Bar */}
                {stepProgress.total > 0 && (
                    <div className="step-progress-bar">
                        <div className="step-progress-fill" style={{ width: `${stepPct}%` }} />
                        <span className="step-progress-label">{stepProgress.current}/{stepProgress.total} steps</span>
                    </div>
                )}

                {/* Whiteboard */}
                <div className="whiteboard-container">
                    <Whiteboard ref={boardRef} width={880} height={520} />

                    {/* Section Intro Overlay */}
                    {showIntro && (
                        <div className="section-intro-overlay">
                            <div className="section-intro-card">
                                <span className="section-intro-number">Section {showIntro.index}</span>
                                <h2 className="section-intro-title">{showIntro.title}</h2>
                            </div>
                        </div>
                    )}
                </div>

                {/* Quiz Overlay */}
                {quiz && (
                    <div className="quiz-overlay">
                        <div className="quiz-card">
                            <div className="quiz-header">
                                <span className="quiz-icon">🧠</span>
                                <h3>Quick Check!</h3>
                            </div>
                            <p className="quiz-question">{quiz.question}</p>
                            <div className="quiz-options">
                                {quiz.options.map((opt, i) => (
                                    <button
                                        key={i}
                                        className={`quiz-option${quizResult ? (i === quiz.correctIndex ? ' correct' : selectedAnswer === i ? ' wrong' : '') : ''}`}
                                        onClick={() => handleQuizAnswer(i)}
                                        disabled={selectedAnswer !== null}
                                    >
                                        <span className="quiz-letter">{String.fromCharCode(65 + i)}</span>
                                        {opt}
                                    </button>
                                ))}
                            </div>
                            {quizResult && (
                                <div className={`quiz-feedback ${quizResult.correct ? 'correct' : 'wrong'}`}>
                                    {quizResult.correct ? '✅ Correct!' : `❌ ${quizResult.explanation || ''}`}
                                </div>
                            )}
                            {quizResult && !quizResult.correct && (
                                <button className="quiz-dismiss" onClick={() => { setQuiz(null); setQuizResult(null); }}>Continue</button>
                            )}
                        </div>
                    </div>
                )}

                {/* Transcript */}
                {transcript.length > 0 && (
                    <div className="lesson-transcript" ref={transcriptRef}>
                        {transcript.map(t => (
                            <div key={t.id} className={`tx-msg ${t.role}`}>
                                <span className="tx-role">{t.role === 'ai' ? '🤖' : '🧑'}</span>
                                <span className="tx-text">{t.text}</span>
                            </div>
                        ))}
                    </div>
                )}


                {/* Errors */}
                {errors.length > 0 && (
                    <div className="error-log" role="log">
                        <div className="error-log-header">
                            <span>⚠ Errors</span>
                            <button className="error-log-clear" onClick={() => setErrors([])}>clear</button>
                        </div>
                        {errors.map(e => <div key={e.id} className="error-entry">{e.text}</div>)}
                    </div>
                )}

                {/* ─── Bottom Controls ─── */}
                <div className="lesson-controls">
                    {/* Section Nav — Previous */}
                    <button
                        className="ctrl-btn nav"
                        onClick={handlePrevSection}
                        disabled={isTerminal || !section || section.index <= 1}
                        title="Previous section (←)"
                    >
                        ⏮
                    </button>

                    {/* Pause / Play */}
                    {(status === 'teaching' || status === 'paused') && (
                        <button
                            className={`ctrl-btn pause-play ${status === 'paused' ? 'paused' : ''}`}
                            onClick={status === 'paused' ? handlePlay : handlePause}
                            title={status === 'paused' ? 'Resume (Space)' : 'Pause (Space)'}
                        >
                            {status === 'paused' ? '▶' : '⏸'}
                            <span>{status === 'paused' ? 'Play' : 'Pause'}</span>
                        </button>
                    )}

                    {/* Mic — interrupt or talk */}
                    <button
                        className={`mic-circle ${micState}`}
                        onClick={handleMicToggle}
                        disabled={isTerminal || !canToggleMic}
                        title={
                            micActive ? 'Stop recording'
                                : status === 'teaching' ? 'Ask a question (M)'
                                    : status === 'confirming' ? 'Ask a follow-up'
                                        : 'Microphone'
                        }
                    >
                        <div className="mic-ring" />
                        <span className="mic-icon">{micActive ? '⏹' : '🎤'}</span>
                    </button>

                    {/* Continue Lesson — visible during Q&A states */}
                    {isQA && (
                        <button className="ctrl-btn resume" onClick={handleResume}>
                            ▶ <span>Continue Lesson</span>
                        </button>
                    )}

                    {/* Section Nav — Next */}
                    <button
                        className="ctrl-btn nav"
                        onClick={handleNextSection}
                        disabled={isTerminal || !section || !planRef.current || section.index >= planRef.current.sections.length}
                        title="Next section (→)"
                    >
                        ⏭
                    </button>

                    {/* Volume Slider */}
                    <div className="volume-control">
                        <span className="volume-icon">{volume === 0 ? '🔇' : volume < 0.5 ? '🔉' : '🔊'}</span>
                        <input
                            type="range"
                            className="volume-slider"
                            min="0" max="1" step="0.05"
                            value={volume}
                            onChange={handleVolumeChange}
                            title={`Volume: ${Math.round(volume * 100)}%`}
                        />
                    </div>


                    {/* Stop */}
                    <button className="ctrl-btn stop" onClick={handleStop} disabled={isTerminal}>
                        ⏹ <span>Stop</span>
                    </button>

                    {/* Home */}
                    {(status === 'finished' || status === 'stopped') && (
                        <button className="ctrl-btn done" onClick={goBack}>🏠 <span>Home</span></button>
                    )}
                </div>
            </main>
        </>
    );
}
