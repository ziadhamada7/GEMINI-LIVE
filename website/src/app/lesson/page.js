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

    const wsRef = useRef(null);
    const boardRef = useRef(null);
    const transcriptRef = useRef(null);
    const retryTimerRef = useRef(null);
    const { enqueueItem, clearAudioQueue, startMic, stopMic, micActive } = useAudio();

    const addTranscript = useCallback((role, text) => {
        setTranscript(prev => [...prev, { id: Date.now() + Math.random(), role, text }]);
        setTimeout(() => {
            if (transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
        }, 50);
    }, []);

    // ── WebSocket with retry ──────────────────────────────────────────────
    const connect = useCallback((plan, retryCount = 0) => {
        if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) return;

        // Clean up old connection cleanly without triggering auto-retry
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
            // Auto-retry if not a clean close and haven't retried too many times
            if (e.code !== 1000 && retryCount < 3) {
                console.log(`[ws] Retrying in 2s... (attempt ${retryCount + 2})`);
                setStatus('loading');
                retryTimerRef.current = setTimeout(() => connect(plan, retryCount + 1), 2000);
            } else {
                setStatus('disconnected');
            }
        };

        ws.onerror = () => {
            // console.error('[ws] Connection error'); // Muted: onclose will fire after this and handle retries
        };
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
            setLessonTitle(plan.title || 'Lesson');
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

    // ── Mic Toggle (smart: stays on during Q&A) ───────────────────────────
    const handleMicToggle = useCallback(async () => {
        console.log('[mic] Toggle. micActive:', micActive, 'status:', status);
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            console.warn('[mic] No WS connection');
            return;
        }

        if (micActive) {
            // Student pressed mic off — stop recording
            console.log('[mic] Stopping mic');
            stopMic();
            ws.send(JSON.stringify({ type: 'mic_off' }));
            return;
        }

        // Start mic
        console.log('[mic] Starting...');
        clearAudioQueue(); // stop teacher audio
        ws.send(JSON.stringify({ type: 'mic_on' }));

        // Wait briefly for server to set up QA
        await new Promise(r => setTimeout(r, 300));

        try {
            await startMic((b64) => {
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({
                        type: 'audio', data: b64, mimeType: 'audio/pcm;rate=16000',
                    }));
                }
            });
            console.log('[mic] Recording started');
        } catch (err) {
            console.error('[mic] Mic failed:', err);
            ws.send(JSON.stringify({ type: 'mic_off' }));
        }
    }, [micActive, startMic, stopMic, clearAudioQueue, status]);

    // ── Resume (Continue Lesson) ──────────────────────────────────────────
    const handleResume = useCallback(() => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        console.log('[lesson] Resume requested');
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
        listening: '👂 Listening…', answering: '💬 Answering…',
        confirming: '🤔 Your turn…', stopped: '⏹ Stopped',
        finished: '✅ Complete', error: '⚠ Error', disconnected: '🔌 Disconnected',
    };

    const isTerminal = ['finished', 'stopped', 'disconnected', 'error'].includes(status);
    const isQA = ['listening', 'answering', 'confirming'].includes(status);

    // Mic button: enabled during teaching (to interrupt) + confirming (to ask more)
    // During listening, mic is already on
    // During answering, disabled (AI is talking)
    const canToggleMic = status === 'teaching' || status === 'confirming' || (status === 'listening' && micActive);

    // Visual mic state
    const micState = micActive ? 'recording' : isQA ? 'qa' : 'idle';

    const progress = section ? `${section.index} / ${section.total}` : '';

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

                {/* Whiteboard */}
                <div className="whiteboard-container">
                    <Whiteboard ref={boardRef} width={880} height={520} />
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
                    {/* Mic — interrupt or talk */}
                    <button
                        className={`mic-circle ${micState}`}
                        onClick={handleMicToggle}
                        disabled={isTerminal || !canToggleMic}
                        title={
                            micActive ? 'Stop recording'
                                : status === 'teaching' ? 'Ask a question'
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
