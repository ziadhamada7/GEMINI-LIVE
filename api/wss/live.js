/**
 * wss/live.js
 * Real-time voice bridge between the browser and Google Gemini Live API.
 *
 * Browser → Server: raw PCM audio chunks (base64 encoded JSON messages)
 * Server  → Gemini: audio via the Live session
 * Gemini  → Server: LiveServerMessage objects (parsed by SDK)
 * Server  → Browser: JSON messages with text / audio
 *
 * Client → Server message protocol:
 *   { type: "audio", data: "<base64 PCM16>", mimeType: "audio/pcm;rate=16000" }
 *   { type: "text",  data: "hello" }
 *   { type: "end" }   ← signals end-of-turn (for text/manual turn management)
 *
 * Server → Client message protocol:
 *   { type: "audio",  data: "<base64 PCM16>", mimeType: "audio/pcm;rate=24000" }
 *   { type: "text",   data: "..." }
 *   { type: "status", data: "connected" | "listening" | "speaking" | "error" }
 *   { type: "error",  data: "description" }
 */

import { GoogleGenAI, Modality } from '@google/genai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Models confirmed to support bidiGenerateContent for this API key
const MODELS = [
    'gemini-2.5-flash-native-audio-preview-12-2025',
];

if (!GEMINI_API_KEY) {
    console.error('[wss/live] FATAL: GEMINI_API_KEY is not set in environment.');
}

const ai = new GoogleGenAI({
    apiKey: GEMINI_API_KEY,
    httpOptions: { apiVersion: 'v1beta' },
});

/**
 * Send a JSON message to a WebSocket client safely.
 * @param {import('ws').WebSocket} ws
 * @param {object} payload
 */
function sendToClient(ws, payload) {
    if (ws.readyState === 1 /* OPEN */) {
        ws.send(JSON.stringify(payload));
    }
}

/**
 * Convert a base64 string + mimeType into a Blob-like object compatible
 * with the SDK's sendRealtimeInput({ media }) parameter.
 * The SDK accepts objects with .arrayBuffer() → returns Buffer from base64.
 */
function base64ToBlob(b64, mimeType) {
    const buffer = Buffer.from(b64, 'base64');
    // The SDK's sendRealtimeInput in Node uses the media's arrayBuffer().
    // We create a minimal Blob-compatible object.
    return new Blob([buffer], { type: mimeType });
}

/**
 * Log a LiveServerMessage and dispatch its content to the client.
 * The SDK already parses the raw WebSocket message into a LiveServerMessage
 * before passing it to our onmessage callback.
 *
 * @param {import('ws').WebSocket} ws
 * @param {object} msg - LiveServerMessage
 */
function handleGeminiMessage(ws, msg) {
    try {
        // ── Server content (text + audio from model) ─────────────────────────
        if (msg.serverContent) {
            const { modelTurn, turnComplete } = msg.serverContent;

            if (modelTurn?.parts) {
                for (const part of modelTurn.parts) {
                    // Text part
                    if (part.text) {
                        sendToClient(ws, { type: 'text', data: part.text });
                    }

                    // Inline audio data (when responseModalities includes AUDIO)
                    if (part.inlineData?.data && part.inlineData?.mimeType) {
                        sendToClient(ws, {
                            type: 'audio',
                            data: part.inlineData.data,
                            mimeType: part.inlineData.mimeType,
                        });
                        sendToClient(ws, { type: 'status', data: 'speaking' });
                    }
                }
            }

            if (turnComplete) {
                sendToClient(ws, { type: 'status', data: 'listening' });
            }
        }

        // ── Setup complete ─────────────────────────────────────────────────────
        if (msg.setupComplete) {
            console.log('[wss/live] Gemini setup complete');
            sendToClient(ws, { type: 'status', data: 'connected' });
        }

        // ── Tool calls (for future use) ────────────────────────────────────────
        if (msg.toolCall) {
            console.log('[wss/live] Tool call received (not handled):', msg.toolCall);
        }
    } catch (err) {
        console.error('[wss/live] Error processing Gemini message:', err);
    }
}

/**
 * WebSocket handler for /live
 * @param {import('ws').WebSocket} ws
 * @param {import('http').IncomingMessage} req
 */
export default async function handler(ws, req) {
    console.log('[wss/live] Client connected');
    sendToClient(ws, { type: 'status', data: 'connecting' });

    let session = null;
    let isAlive = true;

    // ── Heartbeat (keep-alive pings) ─────────────────────────────────────────
    ws.on('pong', () => { isAlive = true; });
    const heartbeat = setInterval(() => {
        if (!isAlive) {
            console.warn('[wss/live] Heartbeat failed — terminating client');
            ws.terminate();
            return;
        }
        isAlive = false;
        if (ws.readyState === 1) ws.ping();
    }, 30_000);

    // ── Cleanup helper ────────────────────────────────────────────────────────
    function cleanup() {
        clearInterval(heartbeat);
        if (session) {
            try { session.close(); } catch { /* ignore */ }
            session = null;
        }
        console.log('[wss/live] Session cleaned up');
    }

    // ── Connect to Gemini Live API (try each model in order) ─────────────────
    // NOTE: gemini-2.5-flash-native-audio models are end-to-end audio models.
    // They do NOT support Modality.TEXT output or speechConfig.voiceConfig.
    const connectConfig = {
        responseModalities: [Modality.AUDIO],
        systemInstruction: {
            parts: [
                {
                    text: 'You are a helpful and friendly AI voice assistant. Respond concisely and naturally as if speaking out loud. Be engaging and conversational.',
                },
            ],
        },
    };

    let lastConnectError = null;
    for (const model of MODELS) {
        if (ws.readyState !== 1) break; // client already gone
        console.log(`[wss/live] Trying model: ${model}`);
        try {
            session = await ai.live.connect({
                model,
                config: connectConfig,
                callbacks: {
                    onopen: () => {
                        console.log(`[wss/live] WebSocket to Gemini opened (model: ${model})`);
                    },
                    onmessage: (msg) => {
                        console.log('[wss/live] << Gemini msg keys:', Object.keys(msg).join(', '));
                        handleGeminiMessage(ws, msg);
                    },
                    onerror: (err) => {
                        console.error('[wss/live] Gemini Live onerror — full object:', err);
                        const errMsg = err?.message ?? err?.error ?? String(err);
                        sendToClient(ws, { type: 'error', data: `Gemini error: ${errMsg}` });
                    },
                    onclose: (event) => {
                        const code = event?.code ?? 'unknown';
                        const reason = event?.reason ?? 'no reason';
                        console.warn(`[wss/live] Gemini WebSocket CLOSED — code=${code} reason=${reason}`);
                        sendToClient(ws, {
                            type: 'error',
                            data: `Gemini disconnected (code ${code}): ${reason}`,
                        });
                        sendToClient(ws, { type: 'status', data: 'disconnected' });
                        session = null;
                    },
                },
            });
            console.log(`[wss/live] ✓ Session established with model: ${model}`);
            lastConnectError = null;
            break; // success — stop trying
        } catch (err) {
            console.error(`[wss/live] Failed to connect with model ${model}:`, err.message);
            lastConnectError = err;
        }
    }

    if (!session) {
        const msg = lastConnectError?.message ?? 'All models failed';
        console.error('[wss/live] All models failed. Last error:', msg);
        sendToClient(ws, { type: 'error', data: `Cannot connect to Gemini: ${msg}` });
        ws.close();
        return;
    }

    // ── Handle incoming messages from the browser ─────────────────────────────
    ws.on('message', async (rawData) => {
        if (!session) {
            sendToClient(ws, { type: 'error', data: 'No active session' });
            return;
        }

        let msg;
        try {
            msg = JSON.parse(rawData.toString());
        } catch {
            console.warn('[wss/live] Received non-JSON message');
            return;
        }

        try {
            switch (msg.type) {
                case 'audio': {
                    // CRITICAL: SDK sendRealtimeInput({ media: Blob }) is broken in Node.js
                    // because Blob serializes as {} in JSON.stringify, sending [{}] to Gemini.
                    // Fix: send the raw wire JSON directly via the internal conn.
                    const mimeType = msg.mimeType ?? 'audio/pcm;rate=16000';
                    session.conn.send(JSON.stringify({
                        realtimeInput: {
                            mediaChunks: [{ mimeType, data: msg.data }],
                        },
                    }));
                    break;
                }

                case 'text': {
                    // Text message — use sendClientContent
                    session.sendClientContent({
                        turns: [{ role: 'user', parts: [{ text: msg.data }] }],
                        turnComplete: true,
                    });
                    break;
                }

                case 'end': {
                    // Signal end of user audio turn
                    session.sendClientContent({ turnComplete: true });
                    break;
                }

                default:
                    console.warn('[wss/live] Unknown message type:', msg.type);
            }
        } catch (err) {
            console.error('[wss/live] Error forwarding to Gemini:', err);
            sendToClient(ws, { type: 'error', data: 'Send error: ' + err.message });
        }
    });

    // ── WebSocket close / error ───────────────────────────────────────────────
    ws.on('close', (code) => {
        console.log(`[wss/live] Client disconnected (code=${code})`);
        cleanup();
    });

    ws.on('error', (err) => {
        console.error('[wss/live] Client WebSocket error:', err);
        cleanup();
    });
}
