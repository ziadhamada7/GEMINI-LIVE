'use client';

import { useRef, useState, useEffect, useCallback } from 'react';

// ─── Constants ───────────────────────────────────────────────────────────────────
const SAMPLE_RATE_IN = 16000;
const SAMPLE_RATE_OUT = 24000;
const PRE_BUFFER_MS = 300; // accumulate 300ms of audio before playing
const PRE_BUFFER_SAMPLES = (PRE_BUFFER_MS / 1000) * SAMPLE_RATE_OUT;

// ─── Helpers ─────────────────────────────────────────────────────────────────────

/** Base64 PCM16 → Float32 */
function base64ToFloat32(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const int16 = new Int16Array(bytes.buffer);
    const f32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 32768.0;
    return f32;
}

/** Float32 → Base64 PCM16 */
function float32ToBase64(f32) {
    const int16 = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
        const s = Math.max(-1, Math.min(1, f32[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    const bytes = new Uint8Array(int16.buffer);
    let bin = '';
    for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
}

// ─── useAudio Hook ───────────────────────────────────────────────────────────────

/**
 * Audio hook with pre-buffering to prevent stuttering.
 * Accumulates audio chunks into a buffer, then plays smooth continuous audio.
 *
 * Calls onAudioStarted() when the FIRST audio chunk begins playing
 * (for sync: client clock starts here).
 */
export function useAudio() {
    const audioCtxRef = useRef(null);
    const gainNodeRef = useRef(null);
    const mediaStreamRef = useRef(null);
    const processorRef = useRef(null);
    const [micActive, setMicActive] = useState(false);
    const onAudioChunkRef = useRef(null);

    // Pre-buffer system
    const bufferRef = useRef([]);
    const bufferAudioSamplesRef = useRef(0);
    const isPlayingRef = useRef(false);
    const isFirstChunkRef = useRef(true);
    const nextPlayTimeRef = useRef(0);

    // Event tracking: schedule timeouts for synced events
    const scheduledEventsRef = useRef([]);

    // ── AudioContext ────────────────────────────────────────────────────────────
    const ensureCtx = useCallback(async () => {
        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
            audioCtxRef.current = new AudioContext({ sampleRate: SAMPLE_RATE_OUT });
            // Create gain node for volume control
            gainNodeRef.current = audioCtxRef.current.createGain();
            gainNodeRef.current.connect(audioCtxRef.current.destination);
        }
        if (audioCtxRef.current.state === 'suspended') {
            await audioCtxRef.current.resume();
        }
        return audioCtxRef.current;
    }, []);

    // ── Flush buffer: schedule all accumulated audio as one AudioBuffer ──────
    const flushBuffer = useCallback(() => {
        const ctx = audioCtxRef.current;
        if (!ctx || bufferRef.current.length === 0) return;

        // Separate audio from events, calculate the exact start time of events within this block
        const chunks = bufferRef.current;
        bufferRef.current = [];
        bufferAudioSamplesRef.current = 0;

        const totalSamples = chunks.reduce((n, c) => (c instanceof Float32Array ? n + c.length : n), 0);
        let merged = new Float32Array(totalSamples);
        let offset = 0;
        let eventSchedules = [];

        for (const item of chunks) {
            if (item instanceof Float32Array) {
                merged.set(item, offset);
                offset += item.length;
            } else if (item && item.type === 'event') {
                // The event happens exactly at the current relative offset in the merged buffer
                const timeOffset = offset / SAMPLE_RATE_OUT;
                eventSchedules.push({ event: item.data, delayOffset: timeOffset });
            }
        }

        const now = ctx.currentTime;
        const startAt = Math.max(now, nextPlayTimeRef.current);
        const actualDelayMs = Math.max(0, startAt - now) * 1000;

        // Schedule events to fire exactly when their part of the audio starts playing
        for (const ev of eventSchedules) {
            const timeout = setTimeout(() => {
                if (window.dispatchEvent) {
                    window.dispatchEvent(new CustomEvent('tutor_sync_event', { detail: ev.event }));
                }
            }, actualDelayMs + (ev.delayOffset * 1000));
            scheduledEventsRef.current.push(timeout);
        }

        if (totalSamples > 0) {
            const audioBuffer = ctx.createBuffer(1, merged.length, SAMPLE_RATE_OUT);
            audioBuffer.copyToChannel(merged, 0);

            const source = ctx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(gainNodeRef.current || ctx.destination);

            source.start(startAt);
            nextPlayTimeRef.current = startAt + audioBuffer.duration;

            source.onended = () => {
                isPlayingRef.current = bufferRef.current.length > 0;
            };
            isPlayingRef.current = true;
        }

        if (isFirstChunkRef.current) {
            isFirstChunkRef.current = false;
        }
    }, []);

    // ── Enqueue Item (Audio or Event) ──────────────────────────────────────────
    const enqueueItem = useCallback(async (item) => {
        await ensureCtx();

        if (item.type === 'audio' && item.b64Data) {
            const float32 = base64ToFloat32(item.b64Data);
            bufferRef.current.push(float32);
            bufferAudioSamplesRef.current += float32.length;
        } else if (item.type === 'event') {
            bufferRef.current.push(item);
        }

        // Pre-buffer: wait until we have enough audio samples, then flush
        if (isFirstChunkRef.current && bufferAudioSamplesRef.current < PRE_BUFFER_SAMPLES) {
            // If only events (no audio yet), force flush after 400ms so draws are never stuck
            if (item.type === 'event') {
                setTimeout(() => {
                    if (isFirstChunkRef.current && bufferRef.current.length > 0) {
                        flushBuffer();
                    }
                }, 400);
            }
            return;
        }

        flushBuffer();
    }, [ensureCtx, flushBuffer]);

    // ── Clear queue ────────────────────────────────────────────────────────────
    const clearAudioQueue = useCallback(() => {
        bufferRef.current = [];
        bufferAudioSamplesRef.current = 0;
        isPlayingRef.current = false;
        isFirstChunkRef.current = true;
        nextPlayTimeRef.current = 0;

        scheduledEventsRef.current.forEach(clearTimeout);
        scheduledEventsRef.current = [];

        // Stop all playing audio
        if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
            audioCtxRef.current.close().catch(() => { });
            audioCtxRef.current = null;
        }
    }, []);

    // ── Set audio started callback (Removed as replaced by window events) ──────
    const setOnAudioStarted = useCallback((fn) => { }, []);

    // ── Volume Control ────────────────────────────────────────────────────────
    const setGainValue = useCallback((v) => {
        if (gainNodeRef.current) {
            gainNodeRef.current.gain.setValueAtTime(Math.max(0, Math.min(2, v)), audioCtxRef.current?.currentTime || 0);
        }
    }, []);

    // ── Reset first chunk flag (for new sections) ─────────────────────────────
    const resetBuffer = useCallback(async () => {
        bufferRef.current = [];
        bufferAudioSamplesRef.current = 0;
        isFirstChunkRef.current = true;
        nextPlayTimeRef.current = 0;
        scheduledEventsRef.current.forEach(clearTimeout);
        scheduledEventsRef.current = [];
        await ensureCtx(); // ensure fresh context
    }, [ensureCtx]);

    // ── Start Mic ──────────────────────────────────────────────────────────────
    const startMic = useCallback(async (onChunk) => {
        onAudioChunkRef.current = onChunk;
        const micCtx = new AudioContext({ sampleRate: SAMPLE_RATE_IN });
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: { sampleRate: SAMPLE_RATE_IN, channelCount: 1, echoCancellation: true, noiseSuppression: true },
        });
        mediaStreamRef.current = stream;

        const source = micCtx.createMediaStreamSource(stream);
        const processor = micCtx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
            const pcm = e.inputBuffer.getChannelData(0);
            onAudioChunkRef.current?.(float32ToBase64(pcm));
        };

        source.connect(processor);
        processor.connect(micCtx.destination);
        setMicActive(true);
    }, []);

    // ── Stop Mic ───────────────────────────────────────────────────────────────
    const stopMic = useCallback(() => {
        if (processorRef.current) {
            processorRef.current.disconnect();
            processorRef.current = null;
        }
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(t => t.stop());
            mediaStreamRef.current = null;
        }
        setMicActive(false);
    }, []);

    // ── Cleanup ────────────────────────────────────────────────────────────────
    useEffect(() => {
        return () => {
            stopMic();
            if (audioCtxRef.current) audioCtxRef.current.close().catch(() => { });
        };
    }, [stopMic]);

    return {
        enqueueItem,
        clearAudioQueue,
        resetBuffer,
        setOnAudioStarted,
        setGainValue,
        startMic,
        stopMic,
        micActive,
    };
}
