/**
 * DELETE/session.js
 * Terminate a session — DELETE /session
 */

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
export default function handler(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('id');

    if (!sessionId) {
        res.json({ error: 'Missing session id query param' }, 400);
        return;
    }

    // In a real app you would invalidate the session in a store here.
    res.json({ message: 'Session terminated', sessionId });
}
