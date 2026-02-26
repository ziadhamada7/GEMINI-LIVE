/**
 * HEAD/health.js
 * Lightweight health check — HEAD /health
 */

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
export default function handler(req, res) {
    res.writeHead(200, {
        'Content-Type': 'application/json',
        'X-Service': 'Gemini Live API',
        'X-Status': 'ok',
    });
    res.end();
}
