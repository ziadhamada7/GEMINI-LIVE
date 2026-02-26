/**
 * server.js — Gemini Live API Server
 * Production-grade HTTP + WebSocket server with file-based routing.
 *
 * Route structure:
 *   REST  → api/{METHOD}/{file}.js  → exports default handler(req, res, params)
 *   WSS   → api/wss/{file}.js       → exports default handler(ws, req, wss)
 *
 * e.g.
 *   GET  /health        → GET/health.js
 *   POST /chat          → POST/chat.js
 *   WSS  /live          → wss/live.js
 */

import 'dotenv/config';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ─── Constants ───────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT ?? '3001', 10);
const HOST = process.env.HOST ?? '0.0.0.0';
const API_DIR = path.join(__dirname);
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

// ─── Route Registry ──────────────────────────────────────────────────────────
/** @type {Map<string, import('./types.js').HttpHandler>} key = "METHOD:/path" */
const httpRoutes = new Map();

/** @type {Map<string, import('./types.js').WssHandler>} key = "/path" */
const wssRoutes = new Map();

// ─── Route Loader ────────────────────────────────────────────────────────────
async function loadRoutes() {
    // Load HTTP method routes
    for (const method of METHODS) {
        const dir = path.join(API_DIR, method);
        let files;
        try {
            files = await readdir(dir);
        } catch {
            continue; // folder doesn't exist — skip
        }

        for (const file of files) {
            if (!file.endsWith('.js')) continue;
            const routeName = '/' + file.replace(/\.js$/, '');
            const moduleUrl = pathToFileURL(path.join(dir, file)).href;
            try {
                const mod = await import(moduleUrl);
                if (typeof mod.default !== 'function') {
                    console.warn(`[router] ${method}${routeName} — missing default export, skipping`);
                    continue;
                }
                httpRoutes.set(`${method}:${routeName}`, mod.default);
                console.log(`[router] Registered  ${method.padEnd(7)} ${routeName}`);
            } catch (err) {
                console.error(`[router] Failed to load ${method}${routeName}:`, err.message);
            }
        }
    }

    // Load WSS routes
    const wssDir = path.join(API_DIR, 'wss');
    let wssFiles;
    try {
        wssFiles = await readdir(wssDir);
    } catch {
        wssFiles = [];
    }
    for (const file of wssFiles) {
        if (!file.endsWith('.js')) continue;
        const routeName = '/' + file.replace(/\.js$/, '');
        const moduleUrl = pathToFileURL(path.join(wssDir, file)).href;
        try {
            const mod = await import(moduleUrl);
            if (typeof mod.default !== 'function') {
                console.warn(`[wss router] wss${routeName} — missing default export, skipping`);
                continue;
            }
            wssRoutes.set(routeName, mod.default);
            console.log(`[router] Registered  WSS     ${routeName}`);
        } catch (err) {
            console.error(`[wss router] Failed to load ${routeName}:`, err.message);
        }
    }
}

// ─── Request Parser ──────────────────────────────────────────────────────────
function parseRequest(req) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    return { pathname: url.pathname, searchParams: url.searchParams };
}

async function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString();
            try {
                resolve(raw ? JSON.parse(raw) : {});
            } catch {
                resolve(raw);
            }
        });
        req.on('error', reject);
    });
}

// ─── CORS Helper ─────────────────────────────────────────────────────────────
function setCors(res) {
    res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN ?? '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
}

// ─── HTTP Request Handler ─────────────────────────────────────────────────────
async function onRequest(req, res) {
    setCors(res);
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const { pathname } = parseRequest(req);
    const key = `${req.method}:${pathname}`;
    const handler = httpRoutes.get(key);

    if (!handler) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found', path: pathname }));
        return;
    }

    // Attach helpers for convenience
    // Only pre-read body for non-multipart content types.
    // Handlers that need raw access (e.g. multipart uploads) should read req themselves.
    const ct = req.headers['content-type'] || '';
    if (!ct.includes('multipart/form-data')) {
        req.body = await readBody(req);
    }
    res.json = (data, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
    };
    res.send = (text, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'text/plain' });
        res.end(String(text));
    };

    try {
        await handler(req, res);
    } catch (err) {
        console.error(`[server] Unhandled error in ${key}:`, err);
        if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal Server Error' }));
        }
    }
}

// ─── HTTP Server ─────────────────────────────────────────────────────────────
const server = http.createServer(onRequest);

// ─── WebSocket Server ─────────────────────────────────────────────────────────
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
    const { pathname } = parseRequest(req);
    const handler = wssRoutes.get(pathname);

    if (!handler) {
        console.warn(`[wss] No route for: ${pathname}`);
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
        ws.routePath = pathname;
        handler(ws, req, wss);
    });
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
await loadRoutes();

server.listen(PORT, HOST, () => {
    const env = process.env.NODE_ENV ?? 'development';
    console.log(`\n🚀 Gemini Live API Server`);
    console.log(`   ENV  : ${env}`);
    console.log(`   HTTP : http://localhost:${PORT}`);
    console.log(`   WS   : ws://localhost:${PORT}`);
    console.log(`   Routes loaded: ${httpRoutes.size} HTTP, ${wssRoutes.size} WSS\n`);
});

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
function shutdown(signal) {
    console.log(`\n[server] ${signal} received — shutting down gracefully...`);
    server.close(() => {
        console.log('[server] HTTP server closed.');
        process.exit(0);
    });
    // Force exit after 5 seconds
    setTimeout(() => process.exit(1), 5000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
    console.error('[server] Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
    console.error('[server] Unhandled rejection:', reason);
});
