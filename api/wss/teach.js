/**
 * wss/teach.js — Fixed: proper session setup, robust multi-turn
 *
 * Bug fixed: _openSectionSession now waits for BOTH .then() AND setupComplete
 * before resolving, so the session is never null when we start speaking.
 */

import { GoogleGenAI, Modality } from '@google/genai';
import { buildVoiceSystemInstruction, buildQAInstruction } from '../prompts/lessonPlanner.js';
import { validateLessonPlan } from '../lib/validator.js';
import { fetchImage } from '../lib/imageProxy.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY, httpOptions: { apiVersion: 'v1beta' } });

function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const S = {
    TEACHING: 'teaching', PAUSED: 'paused', LISTENING: 'listening',
    ANSWERING: 'answering', CONFIRMING: 'confirming',
    STOPPED: 'stopped', FINISHED: 'finished',
};

// Commands that represent complex content — add a brief thinking pause after
const COMPLEX_CMDS = new Set(['equation', 'formula_block', 'graph', 'triangle', 'table', 'code_block']);

class TeachingSession {
    constructor(ws) {
        this.ws = ws;
        this.state = null;
        this.plan = null;
        this.language = 'en';
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

        // Pause/Play
        this._paused = false;
        this._pauseResolve = null;

        // Section skip
        this._skipToSection = -1;
        this._skipToStep = -1;
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
        this._paused = false;
        this._pauseResolve?.();
        this._closeSectionSession();
        this._closeQA();
        this._pendingResume?.();
        send(this.ws, { type: 'freeze' });
        this.setState(S.STOPPED);
    }

    cleanup() {
        this.shouldStop = true;
        this._paused = false;
        this._pauseResolve?.();
        this._closeSectionSession();
        this._closeQA();
        this._pendingResume?.();
    }

    // ── Pause / Play ─────────────────────────────────────────────────────
    handlePause() {
        if (this.state !== S.TEACHING && this.state !== S.ANSWERING) return;
        console.log('[teach] INSTANT PAUSE — closing session immediately');
        this._paused = true;
        this._pausedAtStep = this.segmentIdx; // remember where we were
        // Close the Gemini session to stop audio streaming immediately
        this._interrupted = true;
        this._closeSectionSession();
        send(this.ws, { type: 'freeze' }); // freeze whiteboard animations
        this.setState(S.PAUSED);
    }

    handlePlay() {
        if (this.state !== S.PAUSED) return;
        console.log(`[teach] PLAY — resuming from step ${this._pausedAtStep + 1}`);
        this._paused = false;
        // Navigate to the step we paused at (restarts that step)
        this._skipToStep = this._pausedAtStep;
        this._interrupted = false;
        // Unblock any waiting resolve
        if (this._pauseResolve) {
            const r = this._pauseResolve;
            this._pauseResolve = null;
            r();
        }
        this._pendingResume?.();
        this.setState(S.TEACHING);
    }

    _waitIfPaused() {
        if (!this._paused) return Promise.resolve();
        return new Promise(resolve => { this._pauseResolve = resolve; });
    }

    // ── Navigation (Step / Section) ───────────────────────────────────────
    handleNavigate(dirStep, dirSection) {
        if (!this.plan || this.shouldStop) return;

        let targetSec = this._skipToSection >= 0 ? this._skipToSection : this.sectionIdx;
        let targetStep = this._skipToStep >= 0 ? this._skipToStep : this.segmentIdx;
        const currentSec = this.plan.sections[targetSec];
        const speechStepsLength = currentSec?.steps?.filter(s => s.cmd?.cmd !== 'quiz').length || 0;

        if (dirSection !== 0) {
            targetSec += dirSection;
            targetStep = 0;
        } else if (dirStep !== 0) {
            targetStep += dirStep;
            // Navigate across sections if out of bounds
            if (targetStep >= speechStepsLength) {
                targetSec += 1;
                targetStep = 0;
            } else if (targetStep < 0) {
                targetSec -= 1;
                if (targetSec >= 0) {
                    const prevSec = this.plan.sections[targetSec];
                    const prevSpeechStepsLength = prevSec?.steps?.filter(s => s.cmd?.cmd !== 'quiz').length || 0;
                    targetStep = Math.max(0, prevSpeechStepsLength - 1);
                }
            }
        }

        // Clamp boundaries
        if (targetSec < 0) {
            targetSec = 0;
            targetStep = 0;
        } else if (targetSec >= this.plan.sections.length) {
            return; // Don't skip past end
        }

        console.log(`[teach] NAVIGATE to section ${targetSec + 1}, step ${targetStep + 1}`);

        if (targetSec === this.sectionIdx) {
            this._skipToSection = -1;
            this._skipToStep = targetStep;
        } else {
            this._skipToSection = targetSec;
            this._skipToStep = targetStep;
        }

        this._paused = false;
        this._pauseResolve?.();
        this._interrupted = true;
        this._closeSectionSession();
        this._closeQA();
        this._pendingResume?.();
    }

    handleSkipSection(targetIdx) {
        if (!this.plan || this.shouldStop) return;
        const idx = Number(targetIdx);
        if (isNaN(idx) || idx < 0 || idx >= this.plan.sections.length) return;
        console.log(`[teach] SKIP to section ${idx + 1}`);
        this._skipToSection = idx;
        this._paused = false;
        this._pauseResolve?.();
        this._interrupted = true;
        this._closeSectionSession();
        this._closeQA();
        this._pendingResume?.();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  LESSON FLOW
    // ═══════════════════════════════════════════════════════════════════════
    async startLesson(rawPlan, language = 'en', voice = 'Puck') {
        const v = validateLessonPlan(rawPlan);
        if (!v.success) { send(this.ws, { type: 'error', data: v.error }); return; }
        this.plan = v.plan;
        this.language = language || 'en';
        this.voice = voice || 'Puck';
        console.log(`[teach] Plan: "${this.plan.title}" — ${this.plan.sections.length} sections, Language: ${this.language}, Voice: ${this.voice}`);

        let i = 0;
        while (i < this.plan.sections.length) {
            if (this.shouldStop || this.ws.readyState !== 1) break;

            let startStep = 0;
            let backwardsNav = false;
            let sameSection = false;
            let stepsToUndo = 0;

            // Handle section skip
            if (this._skipToSection >= 0) {
                i = this._skipToSection;
                startStep = Math.max(0, this._skipToStep || 0);
                this._skipToSection = -1;
                this._skipToStep = -1;
                this._interrupted = false;
                this.drawnSegments.clear();
            } else if (this._skipToStep >= 0) {
                // Navigating within the same section
                sameSection = true;
                if (this._skipToStep < this.segmentIdx) {
                    backwardsNav = true;
                    let undoCount = 0;
                    for (let j = this.segmentIdx; j >= this._skipToStep; j--) {
                        if (this.drawnSegments.has(`S${this.sectionIdx}_${j}`)) {
                            this.drawnSegments.delete(`S${this.sectionIdx}_${j}`);
                            undoCount++;
                        }
                    }
                    stepsToUndo = undoCount;
                }
                startStep = this._skipToStep;
                this._skipToStep = -1;
                this._interrupted = false;
            }

            this.sectionIdx = i;
            const sec = this.plan.sections[i];

            if (!sameSection) {
                console.log(`[teach] ── Section ${i + 1}/${this.plan.sections.length}: "${sec.title}" (${sec.steps.length} steps)`);
                send(this.ws, { type: 'section', data: { index: i + 1, title: sec.title, total: this.plan.sections.length } });
                send(this.ws, { type: 'draw', commands: [{ cmd: 'clear' }] });
                if (i > 0) await sleep(400);
            } else if (backwardsNav && stepsToUndo > 0) {
                send(this.ws, { type: 'draw', commands: [{ cmd: 'undo', steps: stepsToUndo }], animMs: 0 });
                await sleep(50);
            }

            // Separate quiz steps from speech/draw steps
            const speechSteps = sec.steps.filter(s => s.cmd?.cmd !== 'quiz');
            const quizSteps = sec.steps.filter(s => s.cmd?.cmd === 'quiz');

            this.setState(S.TEACHING);
            await this._runSection(speechSteps, sec.title, startStep);

            if (this.shouldStop) break;
            if (this._skipToSection >= 0 || this._skipToStep >= 0) continue; // skip was requested during section

            for (const qs of quizSteps) {
                if (this.shouldStop) break;
                await this._runQuiz(qs.cmd);
            }

            if (i < this.plan.sections.length - 1) await sleep(1500);
            i++;
        }

        if (!this.shouldStop && this.ws.readyState === 1) {
            this.setState(S.FINISHED);
        }
    }

    // ── Run section: iterate steps with simultaneous draw+speech ──────────
    async _runSection(steps, sectionTitle, initialStartStep = 0) {
        if (this.shouldStop) return;
        const sys = buildVoiceSystemInstruction(sectionTitle, this.language);

        let startFrom = initialStartStep;

        // Fast-forward drawings if starting mid-section
        if (initialStartStep > 0 && !this.shouldStop) {
            console.log(`[teach] Fast-forwarding drawings up to step ${initialStartStep}`);
            let fastDrawCmds = [];
            for (let j = 0; j < initialStartStep; j++) {
                const st = steps[j];
                const stepId = `S${this.sectionIdx}_${j}`;
                if (st.cmd && !this.drawnSegments.has(stepId)) {
                    // pre-fetch images if any
                    if (st.cmd.cmd === 'image' && st.cmd.query) {
                        const enhancedQuery = `${this.plan?.title || ''} ${st.cmd.query}`.trim();
                        const dataUrl = await fetchImage(enhancedQuery);
                        if (dataUrl) st.cmd.dataUrl = dataUrl;
                    }
                    if (st.cmd) fastDrawCmds.push(st.cmd);
                    this.drawnSegments.add(stepId);
                }
            }
            if (fastDrawCmds.length > 0) {
                send(this.ws, { type: 'draw', commands: fastDrawCmds, animMs: 0 }); // instant draw
                await sleep(50); // fast sleep to prevent delay
            }
        }

        // Outer loop: re-opens session after each resume
        while (startFrom < steps.length && !this.shouldStop) {
            console.log(`[teach] Opening section session (from step ${startFrom + 1})...`);
            const ok = await this._openSectionSession(sys);
            if (!ok || this.shouldStop) break;

            let si = startFrom;
            let interrupted = false;

            // Inner loop: execute each step
            while (si < steps.length && !this.shouldStop && this._sectionSession && this._skipToSection < 0 && this._skipToStep < 0) {
                // ── Pause gate ────────────────────────────────────────────
                await this._waitIfPaused();
                if (this.shouldStop || this._skipToSection >= 0 || this._skipToStep >= 0) break;

                this.segmentIdx = si;
                const step = steps[si];
                const stepId = `S${this.sectionIdx}_${si}`;

                // ── Send step progress to frontend ───────────────────────
                send(this.ws, { type: 'step_progress', data: { current: si + 1, total: steps.length } });

                console.log(`[teach] Step ${si + 1}/${steps.length}: speech="${(step.speech || '').slice(0, 50)}..." cmd=${step.cmd?.cmd || 'NONE'}`);

                // Send draw FIRST (arrives before audio starts) ────────
                if (step.cmd && !this.drawnSegments.has(stepId)) {
                    // Pre-fetch image if needed
                    if (step.cmd.cmd === 'image' && step.cmd.query) {
                        const enhancedQuery = `${this.plan?.title || ''} ${step.cmd.query}`.trim();
                        const dataUrl = await fetchImage(enhancedQuery);
                        if (dataUrl) {
                            step.cmd.dataUrl = dataUrl;
                        } else {
                            console.warn(`[teach] Image fetch failed for "${step.cmd.query}", skipping drawing only`);
                            step.cmd = null;
                        }
                    }

                    if (step.cmd) {
                        const chars = step.cmd.text ? step.cmd.text.length : 15;
                        const animTime = Math.max(800, chars * 70);
                        console.log(`[teach]   → Draw: ${step.cmd.cmd} (animMs: ${animTime})`);
                        send(this.ws, { type: 'draw', commands: [step.cmd], animMs: animTime });
                        this.drawnSegments.add(stepId);
                    }
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

                // ── Smart pacing: pause after complex content ────────────
                if (step.cmd && COMPLEX_CMDS.has(step.cmd.cmd)) {
                    await sleep(1200);
                }

                if (!this._sectionSession) {
                    console.log(`[teach]   Gemini disconnected at step ${si + 1}, retrying...`);
                    break;
                }

                si++;
            }
            if (this.shouldStop) break;

            // If we broke out because of a skip, stop trying to resume this section
            if (this._skipToSection >= 0 || this._skipToStep >= 0) break;

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

            const requestConfig = {
                responseModalities: [Modality.AUDIO],
                systemInstruction: { parts: [{ text: sysPrompt }] },
            };
            if (this.voice) {
                requestConfig.speechConfig = {
                    voiceConfig: {
                        prebuiltVoiceConfig: {
                            voiceName: this.voice
                        }
                    }
                };
            }

            ai.live.connect({
                model: MODEL,
                config: requestConfig,
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

            // Wrap teaching note with directive so Gemini explains naturally
            let langSuffix = '';
            if (this.language !== 'en') {
                if (this.language === 'ar-eg') langSuffix = ' in Egyptian Arabic dialect (عامية مصرية — use ده/دي/كده/عشان/يعني)';
                else if (this.language === 'ar-sa') langSuffix = ' in Saudi Arabic dialect (عامية سعودية — use هذا/كذا/وش/يعني/زين)';
                else langSuffix = ` in ${this.language}`;
            }
            const prompt = `[TEACHING NOTE] ${text}\n\nExplain this concept naturally in 1-3 sentences${langSuffix}. Then STOP.`;

            try {
                this._sectionSession.sendClientContent({
                    turns: [{ role: 'user', parts: [{ text: prompt }] }],
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

    // ── Explain Selection ─────────────────────────────────────────────────
    async handleExplainSelection(imageBase64, comment) {
        console.log(`[teach] Explain selection — comment: "${(comment || '').slice(0, 60)}"`);

        // Pause if currently teaching
        if (this.state === S.TEACHING) {
            this.handlePause();
        }

        // Close any existing QA session
        this._closeQA();

        const sectionTitle = this.plan?.sections?.[this.sectionIdx]?.title || 'the topic';
        const lessonTitle = this.plan?.title || 'the lesson';

        let langSuffix = '';
        if (this.language !== 'en') {
            if (this.language === 'ar-eg') langSuffix = ' Respond in Egyptian Arabic dialect (عامية مصرية).';
            else if (this.language === 'ar-sa') langSuffix = ' Respond in Saudi Arabic dialect.';
            else langSuffix = ` Respond in ${this.language}.`;
        }

        const userPrompt = comment && comment.trim()
            ? `The student selected a part of the whiteboard and asked: "${comment}". Look at the image and answer their question. Be concise but helpful (2-4 sentences).${langSuffix}`
            : `The student selected a part of the whiteboard and wants you to explain it. Look at the image and explain what you see clearly and concisely (2-4 sentences).${langSuffix}`;

        const sys = `You are a helpful AI tutor teaching "${lessonTitle}", currently on the section "${sectionTitle}". The student has highlighted a specific area on the whiteboard and wants your explanation. Be concise and helpful.${langSuffix}`;

        this.setState(S.LISTENING);

        const currentConnectId = ++this.qaConnectId;
        try {
            const requestConfig = {
                responseModalities: [Modality.AUDIO],
                systemInstruction: { parts: [{ text: sys }] },
            };
            if (this.voice) {
                requestConfig.speechConfig = {
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: this.voice } },
                };
            }

            const session = await ai.live.connect({
                model: MODEL,
                config: requestConfig,
                callbacks: {
                    onopen: () => { },
                    onmessage: (msg) => {
                        if (msg.setupComplete) {
                            this.qaReady = true;
                            // Send the image + question
                            if (this.qaSession) {
                                const parts = [];
                                if (imageBase64) {
                                    parts.push({ inlineData: { mimeType: 'image/png', data: imageBase64 } });
                                }
                                parts.push({ text: userPrompt });
                                this.qaSession.sendClientContent({
                                    turns: [{ role: 'user', parts }],
                                    turnComplete: true,
                                });
                            }
                        }
                        if (msg.serverContent?.modelTurn?.parts) {
                            for (const p of msg.serverContent.modelTurn.parts) {
                                if (p.inlineData?.data) {
                                    send(this.ws, { type: 'audio', data: p.inlineData.data, mimeType: p.inlineData.mimeType });
                                    if (this.state === S.LISTENING) this.setState(S.ANSWERING);
                                }
                            }
                        }
                        if (msg.serverContent?.turnComplete) {
                            if (this.state === S.ANSWERING) { this.setState(S.CONFIRMING); }
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
        } catch (err) {
            console.error('[teach] Explain selection fail:', err.message);
            send(this.ws, { type: 'error', data: 'Explain failed: ' + err.message });
        }
    }

    // ── Q&A ───────────────────────────────────────────────────────────────
    async _openQASession() {
        const sectionTitle = this.plan?.sections?.[this.sectionIdx]?.title || 'the topic';
        const sys = buildQAInstruction(sectionTitle, this.plan?.title || 'the lesson', this.language);
        const currentConnectId = ++this.qaConnectId;
        try {
            let sessionObj = null;
            let setupDone = false;

            const requestConfig = {
                responseModalities: [Modality.AUDIO],
                systemInstruction: { parts: [{ text: sys }] }
            };
            if (this.voice) {
                requestConfig.speechConfig = {
                    voiceConfig: {
                        prebuiltVoiceConfig: {
                            voiceName: this.voice
                        }
                    }
                };
            }

            const session = await ai.live.connect({
                model: MODEL,
                config: requestConfig,
                callbacks: {
                    onopen: () => { },
                    onmessage: (msg) => {
                        if (msg.setupComplete) {
                            setupDone = true;
                            this.qaReady = true;
                            this._qaGreetingDone = false;
                            // Send greeting prompt
                            if (this.qaSession) {
                                const greetPrompt = this.language.startsWith('ar')
                                    ? `رحب بالطالب بلطف: "${this.language === 'ar-eg' ? 'اتفضل، اسأل سؤالك' : 'تفضل، اسأل'}" واوقف.`
                                    : this.language === 'fr' ? 'Dites chaleureusement : "Allez-y, posez votre question." Puis arrêtez-vous.'
                                        : this.language === 'es' ? 'Diga cálidamente: "Adelante, haz tu pregunta." Luego deténgase.'
                                            : this.language === 'de' ? 'Sagen Sie warm: "Bitte, stellen Sie Ihre Frage." Dann stoppen Sie.'
                                                : 'Say warmly: "Go ahead — what\'s your question?" Then stop and listen.';
                                this.qaSession.sendClientContent({
                                    turns: [{ role: 'user', parts: [{ text: greetPrompt }] }],
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
                const greetPrompt = this.language.startsWith('ar')
                    ? `رحب بالطالب بلطف: "${this.language === 'ar-eg' ? 'اتفضل، اسأل سؤالك' : 'تفضل، اسأل'}" واوقف.`
                    : this.language === 'fr' ? 'Dites chaleureusement : "Allez-y, posez votre question." Puis arrêtez-vous.'
                        : this.language === 'es' ? 'Diga cálidamente: "Adelante, haz tu pregunta." Luego deténgase.'
                            : this.language === 'de' ? 'Sagen Sie warm: "Bitte, stellen Sie Ihre Frage." Dann stoppen Sie.'
                                : 'Say warmly: "Go ahead — what\'s your question?" Then stop and listen.';
                this.qaSession.sendClientContent({
                    turns: [{ role: 'user', parts: [{ text: greetPrompt }] }],
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
            case 'start': if (msg.lessonPlan) s.startLesson(msg.lessonPlan, msg.language, msg.voice).catch(e => { console.error('[teach]', e); send(ws, { type: 'error', data: e.message }); }); break;
            case 'mic_on': s.handleMicOn(); break;
            case 'audio': s.handleStudentAudio(msg.data, msg.mimeType ?? 'audio/pcm;rate=16000'); break;
            case 'mic_off': s.handleMicOff(); break;
            case 'resume': s.handleResume(); break;
            case 'pause': s.handlePause(); break;
            case 'play': s.handlePlay(); break;
            case 'navigate': s.handleNavigate(msg.dirStep || 0, msg.dirSection || 0); break;
            case 'skip_section': s.handleSkipSection(msg.index); break;
            case 'stop': s.stop(); break;
            case 'quiz_answer': s.handleQuizAnswer(msg.answer); break;
            case 'explain_selection': s.handleExplainSelection(msg.image, msg.comment).catch(e => { console.error('[teach]', e); send(ws, { type: 'error', data: e.message }); }); break;
        }
    });
    ws.on('close', () => { clearInterval(hb); s.cleanup(); });
    ws.on('error', () => { clearInterval(hb); s.cleanup(); });
}
