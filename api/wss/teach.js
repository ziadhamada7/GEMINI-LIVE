/**
 * wss/teach.js — Fixed: proper session setup, robust multi-turn
 *
 * Bug fixed: _openSectionSession now waits for BOTH .then() AND setupComplete
 * before resolving, so the session is never null when we start speaking.
 */

import { GoogleGenAI, Modality } from '@google/genai';
import { buildVoiceSystemInstruction, buildQAInstruction } from '../prompts/lessonPlanner.js';
import { validateLessonPlan } from '../lib/validator.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY, httpOptions: { apiVersion: 'v1beta' } });

function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const S = {
    TEACHING: 'teaching', LISTENING: 'listening',
    ANSWERING: 'answering', CONFIRMING: 'confirming',
    STOPPED: 'stopped', FINISHED: 'finished',
};

class TeachingSession {
    constructor(ws) {
        this.ws = ws;
        this.state = null;
        this.plan = null;
        this.shouldStop = false;
        this.sectionIdx = 0;
        this.segmentIdx = 0;

        this._sectionSession = null;
        this._currentTurnResolve = null;
        this._interrupted = false;

        this.qaSession = null;
        this.qaReady = false;
        this._qaGreetingDone = false;
        this._pendingResume = null;

        this.drawnSegments = new Set();
        this.qaConnectId = 0;
    }

    setState(s) {
        this.state = s;
        send(this.ws, { type: 'status', data: s });
        console.log(`[teach] STATE → ${s}`);

        if (this._confirmTimeout) {
            clearTimeout(this._confirmTimeout);
            this._confirmTimeout = null;
        }

        if (s === S.CONFIRMING) {
            this._confirmTimeout = setTimeout(() => {
                if (this.state === S.CONFIRMING && !this.shouldStop) {
                    console.log('[teach] Auto-resuming from CONFIRMING state due to timeout');
                    this.handleResume();
                }
            }, 10000);
        }
    }

    _closeSectionSession() {
        if (this._sectionSession) {
            try { this._sectionSession.close(); } catch { }
            this._sectionSession = null;
        }
        // Unblock any waiting turn
        if (this._currentTurnResolve) {
            const r = this._currentTurnResolve;
            this._currentTurnResolve = null;
            r(true); // true = interrupted
        }
    }

    _closeQA() {
        if (this.qaSession) {
            try { this.qaSession.close(); } catch { }
            this.qaSession = null;
            this.qaReady = false;
            this._qaGreetingDone = false;
        }
        this.qaConnectId++; // Invalidate pending connects
    }

    stop() {
        this.shouldStop = true;
        this._interrupted = true;
        this._closeSectionSession();
        this._closeQA();
        this._pendingResume?.();
        send(this.ws, { type: 'freeze' });
        this.setState(S.STOPPED);
    }

    cleanup() {
        this.shouldStop = true;
        this._closeSectionSession();
        this._closeQA();
        this._pendingResume?.();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  LESSON FLOW
    // ═══════════════════════════════════════════════════════════════════════
    async startLesson(rawPlan) {
        const v = validateLessonPlan(rawPlan);
        if (!v.success) { send(this.ws, { type: 'error', data: v.error }); return; }
        this.plan = v.plan;
        console.log(`[teach] Plan: "${this.plan.title}" — ${this.plan.sections.length} sections`);

        for (let i = 0; i < this.plan.sections.length; i++) {
            if (this.shouldStop || this.ws.readyState !== 1) break;
            this.sectionIdx = i;
            const sec = this.plan.sections[i];

            console.log(`[teach] ── Section ${i + 1}/${this.plan.sections.length}: "${sec.title}" (${sec.steps.length} steps)`);
            send(this.ws, { type: 'section', data: { index: i + 1, title: sec.title, total: this.plan.sections.length } });
            send(this.ws, { type: 'draw', commands: [{ cmd: 'clear' }] });
            if (i > 0) await sleep(400);

            // Separate quiz steps from speech/draw steps
            const speechSteps = sec.steps.filter(s => s.cmd?.cmd !== 'quiz');
            const quizSteps = sec.steps.filter(s => s.cmd?.cmd === 'quiz');

            this.setState(S.TEACHING);
            await this._runSection(speechSteps, sec.title);

            if (this.shouldStop) break;

            for (const qs of quizSteps) {
                if (this.shouldStop) break;
                await this._runQuiz(qs.cmd);
            }

            if (i < this.plan.sections.length - 1) await sleep(1500);
        }

        if (!this.shouldStop && this.ws.readyState === 1) {
            this.setState(S.FINISHED);
        }
    }

    // ── Run section: iterate steps with simultaneous draw+speech ──────────
    async _runSection(steps, sectionTitle) {
        if (this.shouldStop) return;
        const sys = buildVoiceSystemInstruction(sectionTitle);

        let startFrom = 0;

        // Outer loop: re-opens session after each resume
        while (startFrom < steps.length && !this.shouldStop) {
            console.log(`[teach] Opening section session (from step ${startFrom + 1})...`);
            const ok = await this._openSectionSession(sys);
            if (!ok || this.shouldStop) break;

            let si = startFrom;
            let interrupted = false;

            // Inner loop: execute each step
            while (si < steps.length && !this.shouldStop && this._sectionSession) {
                this.segmentIdx = si;
                const step = steps[si];
                const stepId = `S${this.sectionIdx}_${si}`;

                console.log(`[teach] Step ${si + 1}/${steps.length}: speech="${(step.speech || '').slice(0, 50)}..." cmd=${step.cmd?.cmd || 'NONE'}`);

                // ── Send draw FIRST (arrives before audio starts) ────────
                if (step.cmd && !this.drawnSegments.has(stepId)) {
                    const chars = step.cmd.text ? step.cmd.text.length : 15;
                    const animTime = Math.max(800, chars * 70);
                    console.log(`[teach]   → Draw: ${step.cmd.cmd} (animMs: ${animTime})`);
                    send(this.ws, { type: 'draw', commands: [step.cmd], animMs: animTime });
                    this.drawnSegments.add(stepId);
                }

                // ── Then speak (audio streams simultaneously) ────────────
                if (step.speech && step.speech.trim()) {
                    const wasInterrupted = await this._speakTurn(step.speech);
                    if (wasInterrupted) {
                        interrupted = true;
                        console.log(`[teach]   Interrupted at step ${si + 1}`);
                        break;
                    }
                } else {
                    // Visual-only step — small pause to let animation play
                    await sleep(600);
                }

                if (!this._sectionSession) {
                    console.log(`[teach]   Gemini disconnected at step ${si + 1}, retrying...`);
                    break;
                }

                si++;
            }

            if (this.shouldStop) break;

            if (interrupted) {
                this._closeSectionSession();
                await this._waitForResume();
                if (this.shouldStop) break;
                startFrom = si;
                this.setState(S.TEACHING);
                console.log(`[teach] Resuming from step ${startFrom + 1}`);
            } else {
                console.log(`[teach] Reconnecting to resume at step ${si + 1}`);
                startFrom = si;
            }
        }

        this._closeSectionSession();
    }

    // ── Open one Gemini session, wait for BOTH .then() AND setupComplete ──
    _openSectionSession(sysPrompt) {
        return new Promise((resolve) => {
            this._closeSectionSession();
            this._interrupted = false;

            let sessionObj = null;   // set by .then()
            let setupDone = false;   // set by setupComplete message
            let resolved = false;

            const tryResolve = () => {
                if (resolved || !sessionObj || !setupDone) return;
                resolved = true;
                this._sectionSession = sessionObj;
                console.log('[teach] Section session fully ready');
                resolve(true);
            };

            ai.live.connect({
                model: MODEL,
                config: {
                    responseModalities: [Modality.AUDIO],
                    systemInstruction: { parts: [{ text: sysPrompt }] },
                },
                callbacks: {
                    onopen: () => { console.log('[teach] Section WS open'); },
                    onmessage: (msg) => {
                        if (msg.setupComplete) {
                            console.log('[teach] setupComplete received');
                            setupDone = true;
                            tryResolve();
                        }
                        if (msg.serverContent?.modelTurn?.parts) {
                            for (const part of msg.serverContent.modelTurn.parts) {
                                if (part.inlineData?.data) {
                                    send(this.ws, {
                                        type: 'audio',
                                        data: part.inlineData.data,
                                        mimeType: part.inlineData.mimeType,
                                    });
                                }
                            }
                        }
                        if (msg.serverContent?.turnComplete) {
                            console.log('[teach] Turn complete → resolving');
                            if (this._currentTurnResolve) {
                                const r = this._currentTurnResolve;
                                this._currentTurnResolve = null;
                                r(false); // false = not interrupted
                            }
                        }
                    },
                    onerror: (err) => {
                        console.error('[teach] Section error:', err?.message ?? err);
                        send(this.ws, { type: 'error', data: `Speech error: ${err?.message ?? err}` });
                        if (!resolved) { resolved = true; resolve(false); }
                        if (this._currentTurnResolve) {
                            const r = this._currentTurnResolve;
                            this._currentTurnResolve = null;
                            r(true);
                        }
                    },
                    onclose: () => {
                        console.log('[teach] Section session closed');
                        if (!resolved) { resolved = true; resolve(false); }
                        this._sectionSession = null;
                        if (this._currentTurnResolve) {
                            const r = this._currentTurnResolve;
                            this._currentTurnResolve = null;
                            r(this._interrupted);
                        }
                    },
                },
            }).then(s => {
                console.log(`[teach] .then() got session (setupDone=${setupDone})`);
                sessionObj = s;
                this._sectionSession = s; // set early so close works
                tryResolve();
            }).catch(err => {
                console.error('[teach] Section connect fail:', err.message);
                send(this.ws, { type: 'error', data: 'Connect fail: ' + err.message });
                if (!resolved) { resolved = true; resolve(false); }
            });
        });
    }

    // ── Speak one turn in the current session ─────────────────────────────
    _speakTurn(text) {
        return new Promise((resolve) => {
            if (!this._sectionSession || this._interrupted || this.shouldStop) {
                resolve(true); return;
            }
            this._currentTurnResolve = (interrupted) => {
                resolve(interrupted);
            };
            try {
                this._sectionSession.sendClientContent({
                    turns: [{ role: 'user', parts: [{ text }] }],
                    turnComplete: true,
                });
            } catch (err) {
                console.error('[teach] sendClientContent error:', err.message);
                this._currentTurnResolve = null;
                resolve(false);
            }
        });
    }

    _waitForResume() {
        return new Promise(resolve => { this._pendingResume = resolve; });
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  MIC
    // ═══════════════════════════════════════════════════════════════════════
    handleMicOn() {
        console.log(`[teach] handleMicOn, state=${this.state}`);
        if (this.state === S.STOPPED || this.state === S.FINISHED) return;

        if (this.state === S.TEACHING) {
            console.log(`[teach] INTERRUPT at segment ${this.segmentIdx + 1}`);
            this._interrupted = true;
            if (this._currentTurnResolve) {
                const r = this._currentTurnResolve;
                this._currentTurnResolve = null;
                r(true);
            }
            this._closeSectionSession(); // triggers onclose
            send(this.ws, { type: 'freeze' });
            this.setState(S.LISTENING);
            this._openQASession();
            return;
        }
        if (this.state === S.CONFIRMING) {
            this.setState(S.LISTENING);
        }
    }

    handleStudentAudio(data, mimeType) {
        if (this.state !== S.LISTENING && this.state !== S.CONFIRMING) return;
        if (!this.qaSession || !this.qaReady) return;
        try {
            this.qaSession.conn.send(JSON.stringify({
                realtimeInput: { mediaChunks: [{ mimeType, data }] },
            }));
        } catch (err) { console.error('[teach] Student audio error:', err.message); }
    }

    handleMicOff() {
        console.log(`[teach] handleMicOff, state=${this.state} — Gemini VAD handles turn detection`);
    }

    handleResume() {
        console.log('[teach] Resume requested');
        this._closeQA();
        if (this._pendingResume) {
            const r = this._pendingResume;
            this._pendingResume = null;
            r();
        }
    }

    // ── Q&A ───────────────────────────────────────────────────────────────
    async _openQASession() {
        const sectionTitle = this.plan?.sections?.[this.sectionIdx]?.title || 'the topic';
        const sys = buildQAInstruction(sectionTitle, this.plan?.title || 'the lesson');
        const currentConnectId = ++this.qaConnectId;
        try {
            let sessionObj = null;
            let setupDone = false;

            const session = await ai.live.connect({
                model: MODEL,
                config: { responseModalities: [Modality.AUDIO], systemInstruction: { parts: [{ text: sys }] } },
                callbacks: {
                    onopen: () => { },
                    onmessage: (msg) => {
                        if (msg.setupComplete) {
                            setupDone = true;
                            this.qaReady = true;
                            this._qaGreetingDone = false;
                            // Send greeting prompt
                            if (this.qaSession) {
                                this.qaSession.sendClientContent({
                                    turns: [{ role: 'user', parts: [{ text: 'Say warmly: "Go ahead — what\'s your question?" Then stop and listen.' }] }],
                                    turnComplete: true,
                                });
                            }
                        }
                        if (msg.serverContent?.modelTurn?.parts) {
                            for (const p of msg.serverContent.modelTurn.parts) {
                                if (p.inlineData?.data) {
                                    send(this.ws, { type: 'audio', data: p.inlineData.data, mimeType: p.inlineData.mimeType });
                                    if (this._qaGreetingDone && this.state === S.LISTENING) this.setState(S.ANSWERING);
                                    if (this.state === S.CONFIRMING) this.setState(S.ANSWERING);
                                }
                            }
                        }
                        if (msg.serverContent?.turnComplete) {
                            if (!this._qaGreetingDone) { this._qaGreetingDone = true; }
                            else if (this.state === S.ANSWERING) { this.setState(S.CONFIRMING); }
                        }
                    },
                    onerror: () => { this._closeQA(); this.handleResume(); },
                    onclose: () => { this.qaSession = null; this.qaReady = false; },
                },
            });

            if (currentConnectId !== this.qaConnectId || this.shouldStop) {
                try { session.close(); } catch { }
                return;
            }

            this.qaSession = session;
            // If setupComplete already fired, send greeting now
            if (setupDone && this.qaSession && !this._qaGreetingDone) {
                this.qaSession.sendClientContent({
                    turns: [{ role: 'user', parts: [{ text: 'Say warmly: "Go ahead — what\'s your question?" Then stop and listen.' }] }],
                    turnComplete: true,
                });
            }
        } catch (err) {
            console.error('[teach] QA fail:', err.message);
            send(this.ws, { type: 'error', data: 'QA failed: ' + err.message });
            this.handleResume();
        }
    }

    // ── Quiz ──────────────────────────────────────────────────────────────
    _runQuiz(q) {
        if (this.shouldStop) return Promise.resolve();
        send(this.ws, { type: 'quiz', data: { question: q.question, options: q.options, correctIndex: q.correctIndex ?? 0, explanation: q.explanation ?? '' } });
        return new Promise(r => {
            this._quizResolve = r;
            this._quizData = q;
            setTimeout(() => { if (this._quizData) { this._quizData = null; r(); } }, 30000);
        });
    }
    handleQuizAnswer(idx) {
        if (!this._quizData) return;
        const q = this._quizData;
        const correct = idx === (q.correctIndex ?? 0);
        send(this.ws, { type: 'quiz_result', data: { correct, explanation: q.explanation ?? '' } });
        this._quizData = null;
        this._quizResolve?.();
    }
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(ws) {
    console.log('[teach] Client connected');
    send(ws, { type: 'status', data: 'idle' });
    const s = new TeachingSession(ws);
    let alive = true;
    ws.on('pong', () => { alive = true; });
    const hb = setInterval(() => {
        if (!alive) { ws.terminate(); return; }
        alive = false;
        if (ws.readyState === 1) ws.ping();
    }, 30_000);
    ws.on('message', async (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        switch (msg.type) {
            case 'start': if (msg.lessonPlan) s.startLesson(msg.lessonPlan).catch(e => { console.error('[teach]', e); send(ws, { type: 'error', data: e.message }); }); break;
            case 'mic_on': s.handleMicOn(); break;
            case 'audio': s.handleStudentAudio(msg.data, msg.mimeType ?? 'audio/pcm;rate=16000'); break;
            case 'mic_off': s.handleMicOff(); break;
            case 'resume': s.handleResume(); break;
            case 'stop': s.stop(); break;
            case 'quiz_answer': s.handleQuizAnswer(msg.answer); break;
        }
    });
    ws.on('close', () => { clearInterval(hb); s.cleanup(); });
    ws.on('error', () => { clearInterval(hb); s.cleanup(); });
}
