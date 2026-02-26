/**
 * POST/session.js
 * Create a new session token — POST /session
 */
import crypto from 'node:crypto';

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
export default function handler(req, res) {
    const sessionId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    res.json({
        sessionId,
        createdAt,
        expiresAt,
        wsUrl: `/live?session=${sessionId}`,
    });
}
