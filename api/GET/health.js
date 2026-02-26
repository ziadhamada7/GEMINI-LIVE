/**
 * GET/health.js
 * Health check endpoint — GET /health
 */

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
export default function handler(req, res) {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        service: 'Gemini Live API',
        version: '1.0.0',
    });
}
