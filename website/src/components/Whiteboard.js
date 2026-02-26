'use client';

import { useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';

// ─── Design System ────────────────────────────────────────────────────────────
const C = {
    bg: '#0d1117',
    dot: 'rgba(255,255,255,0.03)',
    title: '#60a5fa',
    text: '#dde4f0',
    muted: '#8899aa',
    bullet: '#a78bfa',
    yellow: '#fbbf24',
    green: '#34d399',
    red: '#f87171',
    blue: '#60a5fa',
    orange: '#fb923c',
    pink: '#f472b6',
    teal: '#2dd4bf',
    arrow: '#7dd3fc',
};

const F = {
    title: 'bold 25px "Patrick Hand", "Comic Sans MS", cursive',
    writeBd: 'bold 18px "Patrick Hand", "Comic Sans MS", cursive',
    write: '400 17px "Patrick Hand", "Comic Sans MS", cursive',
    bullet: '400 16px "Patrick Hand", "Comic Sans MS", cursive',
    mono: '600 17px "JetBrains Mono", monospace',
    monoLg: 'bold 28px "JetBrains Mono", monospace',
    label: '400 13px "Patrick Hand", cursive',
    labelBd: '600 13px "Inter", sans-serif',
    small: '400 12px "Inter", sans-serif',
};

// ─── Easing ───────────────────────────────────────────────────────────────────
function easeOut(t) { return 1 - Math.pow(1 - t, 2.5); }
function easeIn(t) { return t * t * t; }

// ─── RNG seeded per-render for consistent sketchy jitter ─────────────────────
let seed = 1;
function srnd() { seed = (seed * 16807 + 0) % 2147483647; return (seed - 1) / 2147483646; }
function jitter(n = 1) { return (srnd() - 0.5) * n * 2; }

// ─── Sketchy line (wobbly human feel) ────────────────────────────────────────
function sketchLine(ctx, x1, y1, x2, y2, color, lw = 1.5, wobble = 3) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.moveTo(x1 + jitter(0.5), y1 + jitter(0.5));
    const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 12);
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        ctx.lineTo(
            x1 + (x2 - x1) * t + jitter(wobble),
            y1 + (y2 - y1) * t + jitter(wobble)
        );
    }
    ctx.stroke();
}

// ─── Animated sketchy stroke via RAF ─────────────────────────────────────────
function animSketch(ctx, x1, y1, x2, y2, color, lw, wobble, durMs) {
    return new Promise(resolve => {
        const dx = x2 - x1, dy = y2 - y1;
        const dist = Math.hypot(dx, dy);
        const steps = Math.max(2, Math.ceil(dist / 10));
        const pts = Array.from({ length: steps + 1 }, (_, i) => {
            const t = i / steps;
            return [x1 + dx * t + jitter(wobble), y1 + dy * t + jitter(wobble)];
        });

        const start = performance.now();
        const safeDur = Math.max(1, durMs || 100);
        let drawn = 0;

        const frame = (now) => {
            try {
                const t = Math.min(1, (now - start) / safeDur);
                const et = easeOut(t);
                const end = Math.floor(et * pts.length) || 0;

                if (end > drawn) {
                    ctx.strokeStyle = color;
                    ctx.lineWidth = lw;
                    ctx.lineCap = 'round';
                    ctx.lineJoin = 'round';
                    ctx.beginPath();
                    // Draw from last drawn point (or 0) to current end
                    let startIdx = Math.max(0, drawn - 1);
                    ctx.moveTo(pts[startIdx][0], pts[startIdx][1]);
                    for (let i = startIdx + 1; i < end; i++) {
                        ctx.lineTo(pts[i][0], pts[i][1]);
                    }
                    ctx.stroke();
                    drawn = end;
                }

                if (t < 1) requestAnimationFrame(frame);
                else resolve();
            } catch (err) {
                console.error('[animSketch] error:', err);
                resolve();
            }
        };
        requestAnimationFrame(frame);
    });
}

// ─── Animated arc ─────────────────────────────────────────────────────────────
function animArc(ctx, cx, cy, r, color, lw, durMs) {
    return new Promise(resolve => {
        const start = performance.now();
        const safeDur = Math.max(1, durMs || 100);
        let lastAngle = -Math.PI / 2 + jitter(0.05);

        const frame = (now) => {
            try {
                const t = Math.min(1, (now - start) / safeDur);
                const et = easeOut(t);
                const targetAngle = -Math.PI / 2 + et * Math.PI * 2 + jitter(0.05);

                ctx.beginPath();
                ctx.strokeStyle = color;
                ctx.lineWidth = lw;
                ctx.lineCap = 'round';
                ctx.arc(cx, cy, r, lastAngle, targetAngle);
                ctx.stroke();

                lastAngle = targetAngle;

                if (t < 1) requestAnimationFrame(frame);
                else resolve();
            } catch (e) { console.error('[animArc]', e); resolve(); }
        };
        requestAnimationFrame(frame);
    });
}

// ─── Sketchy rect (4 animated sides) ────────────────────────────────────────
async function animRect(ctx, x, y, w, h, color, lw, durMs) {
    const segDur = durMs / 4;
    await animSketch(ctx, x + jitter(2), y + jitter(2), x + w + jitter(2), y + jitter(2), color, lw, 2, segDur);
    await animSketch(ctx, x + w + jitter(2), y + jitter(2), x + w + jitter(2), y + h + jitter(2), color, lw, 2, segDur);
    await animSketch(ctx, x + w + jitter(2), y + h + jitter(2), x + jitter(2), y + h + jitter(2), color, lw, 2, segDur);
    await animSketch(ctx, x + jitter(2), y + h + jitter(2), x + jitter(2), y + jitter(2), color, lw, 2, segDur);
}

// ─── Arrowhead ───────────────────────────────────────────────────────────────
function drawArrowHead(ctx, x, y, angle, size, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-size, -size * 0.45);
    ctx.lineTo(-size * 0.6, 0);
    ctx.lineTo(-size, size * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

// ─── Whiteboard Component ─────────────────────────────────────────────────────
const Whiteboard = forwardRef(function Whiteboard({ width = 900, height = 560 }, ref) {
    const canvasRef = useRef(null);
    const cursorRef = useRef({ x: 44, y: 58 });
    const animQueueRef = useRef([]);
    const isAnimatingRef = useRef(false);
    const frozenRef = useRef(false);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        ctx.scale(dpr, dpr);
        _clear(ctx);
    }, [width, height]);

    function _clear(ctx) {
        seed = 42;
        cursorRef.current = { yL: 58, yR: 58, maxY: 58 };
        ctx.fillStyle = C.bg;
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = C.dot;
        for (let gx = 0; gx < width; gx += 30)
            for (let gy = 0; gy < height; gy += 30) {
                ctx.beginPath();
                ctx.arc(gx, gy, 0.7, 0, Math.PI * 2);
                ctx.fill();
            }
    }

    function _scroll(ctx) {
        const c = cursorRef.current;
        if (c.maxY > height - 80) {
            const shift = 130;
            const dpr = window.devicePixelRatio || 1;
            const img = ctx.getImageData(0, shift * dpr, width * dpr, (height - shift) * dpr);

            ctx.fillStyle = C.bg;
            ctx.fillRect(0, 0, width, height);
            ctx.fillStyle = C.dot;
            for (let gx = 0; gx < width; gx += 30)
                for (let gy = 0; gy < height; gy += 30) {
                    ctx.beginPath();
                    ctx.arc(gx, gy, 0.7, 0, Math.PI * 2);
                    ctx.fill();
                }

            ctx.putImageData(img, 0, 0);
            c.yL = Math.max(58, c.yL - shift);
            c.yR = Math.max(58, c.yR - shift);
            c.maxY = Math.max(c.yL, c.yR);
        }
    }

    // ── Human handwriting: slow, per-character, natural variation ─────────
    function _handwrite(ctx, text, x, y, font, color, durationMs) {
        return new Promise(resolve => {
            if (!text) { resolve(); return; }
            const chars = [...text];
            let cx = x;
            let i = 0;
            // Natural wpm-based speed: ~60wpm → ~300ms/word → ~60ms/char avg
            const avgMs = durationMs > 0
                ? Math.max(5, Math.min(120, durationMs / chars.length)) // Min 5ms so it can keep up with fast speech
                : 55;

            const drawNext = () => {
                if (frozenRef.current) { resolve(); return; }
                if (i >= chars.length) { resolve(); return; }

                // Natural variation in pen speed (faster on vowels, slower on curves)
                const ch = chars[i];
                const isComplex = /[mwMWBDQO@]/.test(ch);
                const isSimple = /[il1!.,;: ]/.test(ch);
                const charMs = avgMs * (isComplex ? 1.4 : isSimple ? 0.6 : 1.0)
                    + (srnd() - 0.5) * 12; // random ±6ms

                // Micro jitter — simulates hand shake
                const jx = jitter(0.6);
                const jy = jitter(0.5);
                ctx.font = font;
                ctx.fillStyle = color;
                ctx.fillText(ch, cx + jx, y + jy);
                cx += ctx.measureText(ch).width;
                i++;

                // Occasional micro-pause (like lifting pen)
                const pause = srnd() < 0.05 ? charMs * 2.0 : charMs;
                setTimeout(drawNext, Math.max(2, pause)); // Don't delay more than 2ms physically if pause is small
            };
            setTimeout(drawNext, 0);
        });
    }

    // ── Process command ────────────────────────────────────────────────────
    async function _processCmd(cmd, animMs = 1200) {
        if (!canvasRef.current || frozenRef.current) return;
        const ctx = canvasRef.current.getContext('2d');
        const globalC = cursorRef.current;
        _scroll(ctx);
        // Simple LCG for consistent jitter between commands
        seed = (seed * 16807) % 2147483647;

        const isRight = cmd.col === 'right';
        const isFull = ['title', 'divider', 'newline', 'clear', 'summary'].includes(cmd.cmd);

        const startX = isRight && !isFull ? width / 2 + 20 : 44;
        const startY = isFull ? globalC.maxY : (isRight ? globalC.yR : globalC.yL);
        const maxW = isFull ? width - startX - 44 : width / 2 - 64;

        const c = { x: startX, y: startY };

        switch (cmd.cmd) {

            // ── TITLE ────────────────────────────────────────────────────────
            case 'title': {
                c.y += 8;
                const text = cmd.text || '';
                await _handwrite(ctx, text, c.x, c.y, F.title, C.title, animMs * 1.0);
                ctx.font = F.title;
                const tw = ctx.measureText(text).width;
                await animSketch(ctx, c.x, c.y + 9, c.x + tw + 6, c.y + 9, C.title + 'aa', 2, 2, 350);
                c.y += 44;
                break;
            }

            // ── HEADING ──────────────────────────────────────────────────────
            case 'heading': {
                c.y += 10;
                const text = cmd.text || '';
                await _handwrite(ctx, text, c.x, c.y, F.writeBd, C.blue, animMs);
                c.y += 32;
                break;
            }

            // ── SUBHEADING ───────────────────────────────────────────────────
            case 'subheading': {
                c.y += 4;
                const text = cmd.text || '';
                await _handwrite(ctx, text, c.x, c.y, F.write, C.muted, animMs);
                ctx.font = F.write;
                const tw = ctx.measureText(text).width;
                await animSketch(ctx, c.x, c.y + 4, c.x + tw, c.y + 4, C.muted + '88', 1.5, 1, 250);
                c.y += 28;
                break;
            }

            // ── WRITE (multiline robust) ─────────────────────────────────────
            case 'write': {
                const lines = (cmd.text || '').split('\n');
                const lineTime = animMs / lines.length;
                for (const raw of lines) {
                    if (!raw.trim()) { c.y += 16; continue; }
                    const isBullet = raw.trim().startsWith('•') || raw.trim().startsWith('-');
                    const text = isBullet ? raw.replace(/^[•\-]\s*/, '') : raw;
                    if (isBullet) {
                        ctx.strokeStyle = C.bullet;
                        ctx.lineWidth = 2;
                        ctx.lineCap = 'round';
                        ctx.beginPath();
                        ctx.moveTo(c.x + 3 + jitter(1), c.y - 5 + jitter(1));
                        ctx.lineTo(c.x + 10 + jitter(1), c.y - 5 + jitter(1));
                        ctx.stroke();
                        await _handwrite(ctx, text, c.x + 18, c.y, F.bullet, C.text, lineTime);
                    } else {
                        await _handwrite(ctx, text, c.x, c.y, F.write, C.text, lineTime);
                    }
                    c.y += 28;
                }
                c.y += 8;
                break;
            }

            // ── NUMBERED ─────────────────────────────────────────────────────
            case 'numbered': {
                const items = cmd.items || [];
                const itemTime = animMs / (items.length || 1);
                for (let i = 0; i < items.length; i++) {
                    const text = items[i];
                    await _handwrite(ctx, `${i + 1}.`, c.x, c.y, F.writeBd, C.blue, itemTime * 0.2);
                    await _handwrite(ctx, text, c.x + 24, c.y, F.write, C.text, itemTime * 0.8);
                    c.y += 28;
                }
                c.y += 8;
                break;
            }

            // ── EQUATION ────────────────────────────────────────────────────
            case 'equation': {
                const text = cmd.text || '';
                const lbl = cmd.label || '';
                c.y += 24;
                ctx.font = F.monoLg;
                const fw = ctx.measureText(text).width;
                const fx = c.x + Math.max(0, (maxW - fw) / 2);
                await _handwrite(ctx, text, fx, c.y, F.monoLg, C.green, animMs * 0.8);
                if (lbl) {
                    ctx.font = F.label;
                    ctx.fillStyle = C.green + 'aa';
                    const lw = ctx.measureText(lbl).width;
                    ctx.fillText(lbl, c.x + (maxW - lw) / 2, c.y + 24);
                }
                c.y += lbl ? 55 : 44;
                break;
            }

            // ── FORMULA BLOCK ────────────────────────────────────────────────
            case 'formula_block': {
                const text = cmd.text || '';
                const lbl = cmd.label || '';
                c.y += 20;
                const bh = lbl ? 85 : 60;
                const bw = maxW - 10;
                ctx.fillStyle = 'rgba(52,211,153,0.05)';
                ctx.fillRect(c.x, c.y - 32, bw, bh);
                await animRect(ctx, c.x, c.y - 32, bw, bh, C.green + '55', 1.5, 600);

                ctx.font = F.monoLg;
                const fw = ctx.measureText(text).width;
                const fx = c.x + Math.max(0, (bw - fw) / 2);
                await _handwrite(ctx, text, fx, c.y + 10, F.monoLg, C.green, animMs * 0.6);
                if (lbl) {
                    ctx.font = F.label;
                    ctx.fillStyle = C.green + 'aa';
                    const lw = ctx.measureText(lbl).width;
                    ctx.fillText(lbl, c.x + (bw - lw) / 2, c.y + 40);
                }
                c.y += bh + 50;
                break;
            }

            // ── BOX ───────────────────────────────────────────────────────────
            case 'box': {
                const text = cmd.text || '';
                const s = cmd.style || 'default';
                const styleMap = {
                    highlight: { fill: 'rgba(251,191,36,0.07)', border: C.yellow, text: C.yellow },
                    formula: { fill: 'rgba(52,211,153,0.07)', border: C.green, text: C.green },
                    important: { fill: 'rgba(248,113,113,0.07)', border: C.red, text: C.red },
                    default: { fill: 'rgba(255,255,255,0.04)', border: C.muted, text: C.text },
                };
                const sc = styleMap[s] || styleMap.default;
                const font = s === 'formula' ? F.mono : F.write;
                ctx.font = font;
                const tw = ctx.measureText(text).width;
                const bw = Math.min(tw + 52, maxW);
                const bh = 54;
                const by = c.y - 28;
                ctx.fillStyle = sc.fill;
                ctx.fillRect(c.x, by, bw, bh);
                await animRect(ctx, c.x, by, bw, bh, sc.border + '99', 2, 500);
                await _handwrite(ctx, text, c.x + 16, c.y + 4, font, sc.text, animMs * 0.8);
                c.y += bh + 24;
                break;
            }

            // ── CALLOUT ───────────────────────────────────────────────────────
            case 'callout': {
                const text = cmd.text || '';
                const s = cmd.style || 'default';
                const clr = s === 'highlight' ? C.yellow : s === 'important' ? C.red : C.muted;
                ctx.font = F.write;
                const tw = ctx.measureText(text).width;
                const bw = Math.min(tw + 28, maxW);
                const bh = 46;
                const by = c.y - 24;
                // Tail
                ctx.fillStyle = clr + '18';
                ctx.beginPath();
                ctx.moveTo(c.x - 14 + jitter(2), c.y - 6 + jitter(2));
                ctx.lineTo(c.x + jitter(2), by + 10 + jitter(2));
                ctx.lineTo(c.x + jitter(2), by + bh - 10 + jitter(2));
                ctx.closePath();
                ctx.fill();
                ctx.fillRect(c.x, by, bw, bh);
                await animRect(ctx, c.x, by, bw, bh, clr + '66', 1.5, 400);
                await _handwrite(ctx, text, c.x + 12, c.y + 4, F.write, clr, animMs * 0.7);
                c.y += bh + 24;
                break;
            }

            // ── UNDERLINE ────────────────────────────────────────────────────
            case 'underline': {
                const text = cmd.text || '';
                ctx.font = F.write;
                const tw = ctx.measureText(text).width;
                await _handwrite(ctx, text, c.x, c.y, F.write, C.yellow, animMs);
                await animSketch(ctx, c.x, c.y + 6, c.x + tw, c.y + 6, C.yellow + 'cc', 2, 2, 280);
                c.y += 32;
                break;
            }

            // ── ARROW (clean downward flow) ──────────────────────────────────────
            case 'arrow': {
                const lbl = cmd.label || '';
                const x = c.x + 60;
                const y1 = c.y + 10;
                const y2 = y1 + 50;

                // Draw downward sketchy line
                await animSketch(ctx, x, y1, x, y2, C.arrow, 2, 2, animMs * 0.8);
                // Arrowhead pointing down (angle PI/2)
                drawArrowHead(ctx, x, y2 + 2, Math.PI / 2, 10, C.arrow);
                if (lbl) {
                    ctx.font = F.label;
                    ctx.fillStyle = C.muted;
                    ctx.fillText(lbl, x + 20, y1 + 30);
                }
                c.y += 80;
                break;
            }

            // ── LIST (bullet points) ──────────────────────────────────────────
            case 'list': {
                const items = cmd.items || [];
                const title = cmd.title || '';
                if (title) {
                    await _handwrite(ctx, title, c.x, c.y + 10, F.writeBd, C.text, animMs * 0.2);
                    c.y += 36;
                }
                const itemTime = animMs / (items.length || 1);
                for (let li = 0; li < items.length; li++) {
                    const text = items[li];
                    // Sketchy bullet
                    ctx.fillStyle = C.blue;
                    ctx.beginPath();
                    ctx.arc(c.x + 10 + jitter(1), c.y - 6 + jitter(1), 3 + jitter(1), 0, Math.PI * 2);
                    ctx.fill();
                    // Text
                    await _handwrite(ctx, text, c.x + 28, c.y, F.write, C.text, itemTime * 0.8);
                    c.y += 32;
                }
                c.y += 10;
                break;
            }

            // ── CHECK (green mark) ───────────────────────────────────────────
            case 'check': {
                const text = cmd.text || '';
                const sy = c.y + 10;
                const sx = c.x + 10;
                // draw checkmark
                await animSketch(ctx, sx, sy, sx + 8, sy + 10, C.green, 3, 1, 200);
                await animSketch(ctx, sx + 8, sy + 10, sx + 24, sy - 12, C.green, 3, 1, 300);
                if (text) {
                    await _handwrite(ctx, text, sx + 40, sy + 4, F.write, C.green, animMs * 0.7);
                }
                c.y += 40;
                break;
            }

            // ── CROSS (red X) ────────────────────────────────────────────────
            case 'cross': {
                const text = cmd.text || '';
                const sy = c.y + 10;
                const sx = c.x + 10;
                // draw X
                await animSketch(ctx, sx, sy - 10, sx + 18, sy + 8, C.red, 3, 1, 200);
                await animSketch(ctx, sx + 18, sy - 10, sx, sy + 8, C.red, 3, 1, 200);
                if (text) {
                    await _handwrite(ctx, text, sx + 40, sy + 4, F.write, C.red, animMs * 0.7);
                }
                c.y += 40;
                break;
            }

            // ── CIRCLE (concept bubble, hand-drawn look) ──────────────────────
            case 'circle': {
                const text = cmd.text || '';
                const r = Math.max(45, Math.min(65, 25 + text.length * 4));
                const cx2 = c.x + r + 14;
                const cy2 = c.y + r + 10;

                // Draw circle twice for sketchy double-stroke feel
                await animArc(ctx, cx2 + jitter(2), cy2 + jitter(2), r + jitter(1), C.blue + 'cc', 2, 550);
                await animArc(ctx, cx2 + jitter(2), cy2 + jitter(2), r - 1 + jitter(1), C.blue + '44', 1, 400);

                // Wrap text inside
                ctx.font = F.label;
                const words = text.split(' ');
                const lines = [];
                let line = '';
                for (const w of words) {
                    const test = line ? `${line} ${w}` : w;
                    if (ctx.measureText(test).width > r * 1.5 && line) { lines.push(line); line = w; }
                    else line = test;
                }
                if (line) lines.push(line);
                const lh = 16;
                const startY = cy2 - (lines.length - 1) * lh / 2;
                for (let li = 0; li < lines.length; li++) {
                    const lw = ctx.measureText(lines[li]).width;
                    ctx.fillStyle = C.text;
                    ctx.fillText(lines[li], cx2 - lw / 2, startY + li * lh);
                }

                // Optional label below
                if (cmd.label) {
                    ctx.font = F.label;
                    ctx.fillStyle = C.muted;
                    const lw = ctx.measureText(cmd.label).width;
                    ctx.fillText(cmd.label, cx2 - lw / 2, cy2 + r + 16);
                }
                c.y += r * 2 + 40;
                break;
            }

            // ── CHART (bar, human-sketched) ───────────────────────────────────
            case 'chart': {
                const data = (cmd.data || []).slice(0, 8);
                const title = cmd.title || '';
                if (!data.length) break;
                const maxVal = Math.max(...data.map(d => d.value || 0), 1);
                const chartH = 100;
                const chartW = maxW - 16;
                const barW = Math.min(42, chartW / data.length - 8);
                const gap = (chartW - barW * data.length) / (data.length + 1);
                const baseY = c.y + chartH;
                const barColors = [C.blue, C.green, C.yellow, C.orange, C.pink, C.teal, C.red, C.muted];

                if (title) {
                    ctx.font = F.labelBd;
                    ctx.fillStyle = C.muted;
                    ctx.fillText(title, c.x, c.y - 8);
                }
                // Baseline (sketchy)
                sketchLine(ctx, c.x, baseY, c.x + chartW, baseY, C.muted + '44', 1, 2);

                for (let bi = 0; bi < data.length; bi++) {
                    const d = data[bi];
                    const bx = c.x + gap + bi * (barW + gap);
                    const fullH = ((d.value || 0) / maxVal) * chartH;
                    const col = barColors[bi % barColors.length];

                    await new Promise(res => {
                        const start = performance.now();
                        const dur = 320;
                        const frame = (now) => {
                            const t = easeOut(Math.min(1, (now - start) / dur));
                            const h = fullH * t;
                            ctx.fillStyle = col + '28';
                            ctx.fillRect(bx + 1, baseY - h, barW - 2, h);
                            // Sketchy top of bar
                            sketchLine(ctx, bx + jitter(1), baseY - h + jitter(1), bx + barW + jitter(1), baseY - h + jitter(1), col + 'cc', 2, 2);
                            if (t < 1) requestAnimationFrame(frame);
                            else {
                                sketchLine(ctx, bx + jitter(1), baseY + jitter(1), bx + jitter(1), baseY - fullH + jitter(1), col + '66', 1.5, 2);
                                sketchLine(ctx, bx + barW + jitter(1), baseY + jitter(1), bx + barW + jitter(1), baseY - fullH + jitter(1), col + '66', 1.5, 2);
                                ctx.font = F.labelBd;
                                ctx.fillStyle = col;
                                const vs = String(d.value);
                                const vw = ctx.measureText(vs).width;
                                ctx.fillText(vs, bx + barW / 2 - vw / 2, baseY - fullH - 5);
                                ctx.font = F.label;
                                ctx.fillStyle = C.muted;
                                const lbw = ctx.measureText(d.label || '').width;
                                ctx.fillText(d.label || '', bx + barW / 2 - lbw / 2, baseY + 18);
                                res();
                            }
                        };
                        requestAnimationFrame(frame);
                    });
                }
                c.y += chartH + 50;
                break;
            }

            // ── GRAPH (Math/Physics) ─────────────────────────────────────────
            case 'graph': {
                const type = cmd.type || 'direct'; // direct, inverse, exponential, bell, quadratic
                const gw = Math.min(maxW - 40, 200);
                const gh = 140;
                c.y += 20;

                if (cmd.title) {
                    ctx.font = F.labelBd;
                    ctx.fillStyle = C.muted;
                    ctx.fillText(cmd.title, c.x, c.y - 15);
                }

                const ox = c.x + 20; // origin X
                const oy = c.y + gh; // origin Y

                // Draw Axes (Y then X)
                await animSketch(ctx, ox, oy, ox, c.y, C.text, 2, 2, 300);
                await animSketch(ctx, ox - 4, c.y + 6, ox, c.y, C.text, 2, 1, 100);
                await animSketch(ctx, ox + 4, c.y + 6, ox, c.y, C.text, 2, 1, 100);

                await animSketch(ctx, ox, oy, ox + gw, oy, C.text, 2, 2, 300);
                await animSketch(ctx, ox + gw - 6, oy - 4, ox + gw, oy, C.text, 2, 1, 100);
                await animSketch(ctx, ox + gw - 6, oy + 4, ox + gw, oy, C.text, 2, 1, 100);

                // Labels
                ctx.font = F.label;
                ctx.fillStyle = C.muted;
                if (cmd.yAxis) {
                    ctx.save();
                    ctx.translate(ox - 15, c.y + gh / 2);
                    ctx.rotate(-Math.PI / 2);
                    ctx.textAlign = 'center';
                    ctx.fillText(cmd.yAxis, 0, 0);
                    ctx.restore();
                }
                if (cmd.xAxis) {
                    ctx.textAlign = 'center';
                    ctx.fillText(cmd.xAxis, ox + gw / 2, oy + 20);
                    ctx.textAlign = 'left';
                }

                // Draw curve based on type
                ctx.strokeStyle = C.blue;
                ctx.lineWidth = 3;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';

                const steps = 40;
                let pts = [];

                for (let i = 0; i <= steps; i++) {
                    const t = i / steps; // 0 to 1
                    let px, py;

                    switch (type) {
                        case 'direct':
                            px = ox + t * (gw - 20);
                            py = oy - t * (gh - 20);
                            break;
                        case 'inverse':
                            // y = 1/x curve
                            const xInv = 0.1 + t * 0.9;
                            px = ox + t * (gw - 20);
                            py = oy - ((0.1 / xInv) * (gh - 20));
                            break;
                        case 'exponential':
                            px = ox + t * (gw - 20);
                            py = oy - Math.pow(t, 2) * (gh - 20);
                            break;
                        case 'quadratic':
                            // Parabola starting from origin
                            px = ox + t * (gw - 20);
                            py = oy - Math.pow(t, 2) * (gh - 20);
                            break;
                        case 'bell':
                            px = ox + t * (gw - 20); // x from 0 to 1
                            const dist = t - 0.5;
                            py = oy - Math.exp(-(dist * dist) * 20) * (gh - 20);
                            break;
                        default:
                            px = ox + t * (gw - 20);
                            py = oy - t * (gh - 20);
                    }
                    pts.push({ x: px + jitter(1.5), y: py + jitter(1.5) });
                }

                // Animate drawing the points
                await new Promise(res => {
                    let idx = 0;
                    ctx.beginPath();
                    ctx.moveTo(pts[0].x, pts[0].y);
                    const drawFrame = () => {
                        for (let k = 0; k < 2; k++) { // draw 2 segments per frame
                            idx++;
                            if (idx < pts.length) {
                                ctx.lineTo(pts[idx].x, pts[idx].y);
                                ctx.stroke();
                            }
                        }
                        if (idx < pts.length) requestAnimationFrame(drawFrame);
                        else res();
                    };
                    requestAnimationFrame(drawFrame);
                });

                c.y += gh + 40;
                break;
            }

            // ── TRIANGLE (Formula e.g. V/I*R) ────────────────────────────────
            case 'triangle': {
                const tw = 120;
                const th = 104; // equilateral-ish
                const tx = c.x + Math.max(0, (maxW - tw) / 2);
                c.y += 20;

                const ptTop = { x: tx + tw / 2, y: c.y };
                const ptBL = { x: tx, y: c.y + th };
                const ptBR = { x: tx + tw, y: c.y + th };

                // Draw outer triangle
                await animSketch(ctx, ptTop.x, ptTop.y, ptBR.x, ptBR.y, C.text, 2, 2, 200);
                await animSketch(ctx, ptBR.x, ptBR.y, ptBL.x, ptBL.y, C.text, 2, 2, 200);
                await animSketch(ctx, ptBL.x, ptBL.y, ptTop.x, ptTop.y, C.text, 2, 2, 200);

                // Draw dividers (horizontal middle)
                const midY = c.y + th * 0.55;
                const midL = { x: tx + tw * 0.22, y: midY };
                const midR = { x: tx + tw * 0.78, y: midY };
                await animSketch(ctx, midL.x, midL.y, midR.x, midR.y, C.muted, 2, 1, 150);

                // Vertical bottom divider
                await animSketch(ctx, tx + tw / 2, midY, tx + tw / 2, c.y + th, C.muted, 2, 1, 150);

                ctx.textAlign = 'center';
                // Top text
                if (cmd.top) {
                    await _handwrite(ctx, cmd.top, tx + tw / 2 - ctx.measureText(cmd.top).width / 2, c.y + th * 0.35, F.title, C.blue, 200);
                }
                // Bottom Left text
                if (cmd.bottomLeft) {
                    await _handwrite(ctx, cmd.bottomLeft, tx + tw * 0.35 - ctx.measureText(cmd.bottomLeft).width / 2, c.y + th * 0.85, F.title, C.green, 200);
                }
                // Bottom Right text
                if (cmd.bottomRight) {
                    await _handwrite(ctx, cmd.bottomRight, tx + tw * 0.65 - ctx.measureText(cmd.bottomRight).width / 2, c.y + th * 0.85, F.title, C.pink, 200);
                }
                ctx.textAlign = 'left';

                if (cmd.caption) {
                    ctx.font = F.label;
                    ctx.fillStyle = C.muted;
                    const cw = ctx.measureText(cmd.caption).width;
                    ctx.fillText(cmd.caption, tx + tw / 2 - cw / 2, c.y + th + 25);
                }

                c.y += th + 50;
                break;
            }

            // ── TABLE ─────────────────────────────────────────────────────────
            case 'table': {
                const headers = (cmd.headers || []).slice(0, 5);
                const rows = (cmd.rows || []).slice(0, 6);
                const title = cmd.title || '';
                if (!headers.length) break;
                const cols = headers.length;
                const colW = Math.floor(Math.min(150, maxW / cols));
                const rowH = 28;
                const tableW = colW * cols;

                if (title) {
                    ctx.font = F.labelBd;
                    ctx.fillStyle = C.muted;
                    ctx.fillText(title, c.x, c.y - 8);
                    c.y += 18;
                }

                // Header bg
                ctx.fillStyle = 'rgba(96,165,250,0.08)';
                ctx.fillRect(c.x, c.y - 20, tableW, rowH);
                await animRect(ctx, c.x, c.y - 20, tableW, rowH * (rows.length + 1), C.muted + '33', 1, 600);

                for (let hi = 0; hi < cols; hi++) {
                    ctx.font = F.labelBd;
                    ctx.fillStyle = C.blue;
                    ctx.fillText(String(headers[hi]).slice(0, 18), c.x + hi * colW + 7, c.y - 5);
                    if (hi > 0) sketchLine(ctx, c.x + hi * colW, c.y - 20, c.x + hi * colW, c.y - 20 + rowH * (rows.length + 1), C.muted + '22', 1, 1);
                }
                for (let ri = 0; ri < rows.length; ri++) {
                    const ry = c.y + ri * rowH;
                    sketchLine(ctx, c.x, ry, c.x + tableW, ry, C.muted + '22', 1, 1);
                    const row = Array.isArray(rows[ri]) ? rows[ri] : Object.values(rows[ri]);
                    for (let ci = 0; ci < cols; ci++) {
                        ctx.font = F.label;
                        ctx.fillStyle = C.text + 'cc';
                        ctx.fillText(String(row[ci] ?? '').slice(0, 18), c.x + ci * colW + 7, ry + 17);
                    }
                }
                c.y += rowH * (rows.length + 1) + 18;
                break;
            }

            // ── SUMMARY / EXAMPLE / PRACTICE BLOCKS ─────────────────────────
            case 'summary':
            case 'example':
            case 'practice': {
                const title = cmd.cmd === 'summary' ? 'SUMMARY' : cmd.cmd === 'example' ? 'EXAMPLE' : 'PRACTICE';
                const color = cmd.cmd === 'summary' ? C.yellow : cmd.cmd === 'example' ? C.blue : C.pink;
                const text = cmd.text || '';
                c.y += 24;
                ctx.fillStyle = color + '11';
                const lines = text.split('\n');
                const bh = lines.length * 28 + 44;
                ctx.fillRect(c.x, c.y - 20, maxW, bh);
                await animRect(ctx, c.x, c.y - 20, maxW, bh, color + '66', 2, 500);
                await _handwrite(ctx, title, c.x + 16, c.y + 4, F.writeBd, color, animMs * 0.2);
                c.y += 32;
                const lineTime = (animMs * 0.8) / lines.length;
                for (const raw of lines) {
                    await _handwrite(ctx, raw, c.x + 16, c.y, F.write, C.text, lineTime);
                    c.y += 28;
                }
                c.y += 20;
                break;
            }

            // ── TREE (Hierarchical) ──────────────────────────────────────────
            case 'tree': {
                const root = cmd.root || 'Root';
                const children = cmd.children || [];
                await _handwrite(ctx, root, c.x, c.y, F.writeBd, C.text, animMs * 0.2);
                c.y += 28;
                const childTime = (animMs * 0.8) / children.length;
                for (let i = 0; i < children.length; i++) {
                    const ch = children[i];
                    const isLast = i === children.length - 1;
                    await animSketch(ctx, c.x + 8, c.y - 20, c.x + 8, c.y - 6, C.muted, 2, 1, Math.min(100, childTime * 0.1));
                    await animSketch(ctx, c.x + 8, c.y - 6, c.x + 24, c.y - 6, C.muted, 2, 1, Math.min(100, childTime * 0.1));
                    if (!isLast) sketchLine(ctx, c.x + 8, c.y - 6, c.x + 8, c.y + 16, C.muted, 2, 1);
                    await _handwrite(ctx, ch, c.x + 32, c.y, F.write, C.text, childTime * 0.8);
                    c.y += 28;
                }
                c.y += 8;
                break;
            }

            // ── GRID (Coordinate Sketch) ─────────────────────────────────────
            case 'grid': {
                c.y += 20;
                const gw = Math.min(200, maxW);
                const gh = 150;
                await animSketch(ctx, c.x + 10, c.y, c.x + 10, c.y + gh, C.muted, 2, 1, 300); // Y axis
                await animSketch(ctx, c.x + 10, c.y + gh, c.x + 10 + gw, c.y + gh, C.muted, 2, 1, 300); // X axis
                drawArrowHead(ctx, c.x + 10, c.y, -Math.PI / 2, 8, C.muted);
                drawArrowHead(ctx, c.x + 10 + gw, c.y + gh, 0, 8, C.muted);

                if (cmd.xlabel) ctx.fillText(cmd.xlabel, c.x + gw, c.y + gh + 16);
                if (cmd.ylabel) ctx.fillText(cmd.ylabel, c.x - 4, c.y - 8);

                if (cmd.curves && cmd.curves.length > 0) {
                    for (const curve of cmd.curves) {
                        ctx.strokeStyle = C.blue;
                        ctx.beginPath();
                        ctx.moveTo(c.x + 10, c.y + gh);
                        ctx.quadraticCurveTo(c.x + 10 + gw / 2, c.y + 10, c.x + 10 + gw, c.y + Math.random() * gh);
                        ctx.stroke();
                    }
                }
                c.y += gh + 32;
                break;
            }

            // ── BRACKET ──────────────────────────────────────────────────────
            case 'bracket': {
                const items = cmd.items || [];
                const label = cmd.label || '';
                const itemTime = animMs / items.length;
                let startY = c.y;
                for (const text of items) {
                    await _handwrite(ctx, text, c.x + 20, c.y, F.write, C.text, itemTime);
                    c.y += 28;
                }
                const endY = c.y - 28;
                const midY = startY + (endY - startY) / 2;

                // Draw '{'
                ctx.strokeStyle = C.muted;
                ctx.beginPath();
                ctx.moveTo(c.x + 12, startY - 14);
                ctx.bezierCurveTo(c.x + 2, startY - 14, c.x + 2, midY - 6, c.x - 6, midY - 6);
                ctx.bezierCurveTo(c.x + 2, midY - 6, c.x + 2, endY + 2, c.x + 12, endY + 2);
                ctx.stroke();

                if (label) {
                    await _handwrite(ctx, label, c.x + 16, endY + 24, F.labelBd, C.blue, 300);
                    c.y += 24;
                }
                c.y += 8;
                break;
            }

            // ── DIVIDER ────────────────────────────────────────────────────────
            case 'divider': {
                c.y += 10;
                await animSketch(ctx, c.x, c.y, c.x + maxW, c.y, C.muted + '33', 1, 3, 350);
                c.y += 18;
                break;
            }
            case 'newline': { c.y += 26; break; }
            case 'clear': { _clear(ctx); break; }

            // ── HIGHLIGHT ────────────────────────────────────────────────────
            case 'highlight': {
                const text = cmd.text || '';
                const colors = { yellow: C.yellow, green: C.green, blue: C.blue, red: C.red, orange: C.orange, pink: C.pink };
                const col = colors[cmd.color] || C.yellow;
                c.y += 8;
                ctx.font = F.write;
                const tw = ctx.measureText(text).width;
                ctx.fillStyle = col + '28';
                ctx.fillRect(c.x - 2, c.y - 16, tw + 12, 26);
                await _handwrite(ctx, text, c.x + 2, c.y, F.writeBd, col, animMs);
                c.y += 32;
                break;
            }

            // ── DEFINITION ───────────────────────────────────────────────────
            case 'definition': {
                const term = cmd.term || '';
                const meaning = cmd.meaning || '';
                c.y += 8;
                await _handwrite(ctx, term, c.x, c.y, F.writeBd, C.blue, animMs * 0.3);
                ctx.font = F.writeBd;
                const tw = ctx.measureText(term).width;
                await _handwrite(ctx, ':  ' + meaning, c.x + tw, c.y, F.write, C.text, animMs * 0.7);
                c.y += 32;
                break;
            }

            // ── COMPARISON / VS_BLOCK ────────────────────────────────────────
            case 'comparison':
            case 'vs_block': {
                const left = cmd.left || '';
                const right = cmd.right || '';
                c.y += 12;
                const bw = (maxW - 30) / 2;
                // Left box
                ctx.fillStyle = C.blue + '14';
                ctx.fillRect(c.x, c.y - 14, bw, 40);
                await animRect(ctx, c.x, c.y - 14, bw, 40, C.blue + '66', 1.5, 300);
                await _handwrite(ctx, left, c.x + 8, c.y + 8, F.writeBd, C.blue, animMs * 0.3);
                // VS
                ctx.font = F.labelBd;
                ctx.fillStyle = C.muted;
                ctx.fillText('vs', c.x + bw + 6, c.y + 10);
                // Right box
                ctx.fillStyle = C.orange + '14';
                ctx.fillRect(c.x + bw + 28, c.y - 14, bw, 40);
                await animRect(ctx, c.x + bw + 28, c.y - 14, bw, 40, C.orange + '66', 1.5, 300);
                await _handwrite(ctx, right, c.x + bw + 36, c.y + 8, F.writeBd, C.orange, animMs * 0.3);
                c.y += 50;
                break;
            }

            // ── TIMELINE ─────────────────────────────────────────────────────
            case 'timeline': {
                const points = cmd.points || [];
                if (!points.length) break;
                c.y += 20;
                const lineY = c.y + 10;
                await animSketch(ctx, c.x, lineY, c.x + maxW - 20, lineY, C.muted + '66', 2, 2, 400);
                const gap = (maxW - 40) / (points.length - 1 || 1);
                for (let pi = 0; pi < points.length; pi++) {
                    const px = c.x + 10 + pi * gap;
                    // Dot
                    ctx.beginPath();
                    ctx.arc(px, lineY, 5, 0, Math.PI * 2);
                    ctx.fillStyle = C.blue;
                    ctx.fill();
                    // Label
                    ctx.font = F.label;
                    ctx.fillStyle = C.text;
                    const lbl = String(points[pi]);
                    const lw = ctx.measureText(lbl).width;
                    ctx.fillText(lbl, px - lw / 2, lineY + 22);
                }
                c.y += 52;
                break;
            }

            // ── FLOW / PROCESS ───────────────────────────────────────────────
            case 'flow':
            case 'process': {
                const items = cmd.items || [];
                if (!items.length) break;
                c.y += 10;
                const isVert = cmd.cmd === 'flow';
                if (isVert) {
                    for (let fi = 0; fi < items.length; fi++) {
                        ctx.fillStyle = C.blue + '14';
                        ctx.fillRect(c.x + 10, c.y - 8, maxW - 40, 28);
                        await animRect(ctx, c.x + 10, c.y - 8, maxW - 40, 28, C.blue + '55', 1.5, 200);
                        await _handwrite(ctx, items[fi], c.x + 18, c.y + 8, F.write, C.text, animMs / items.length * 0.7);
                        c.y += 32;
                        if (fi < items.length - 1) {
                            await animSketch(ctx, c.x + maxW / 2, c.y - 4, c.x + maxW / 2, c.y + 10, C.arrow, 2, 1, 150);
                            // Arrow tip
                            await animSketch(ctx, c.x + maxW / 2 - 5, c.y + 5, c.x + maxW / 2, c.y + 10, C.arrow, 2, 1, 80);
                            await animSketch(ctx, c.x + maxW / 2 + 5, c.y + 5, c.x + maxW / 2, c.y + 10, C.arrow, 2, 1, 80);
                            c.y += 16;
                        }
                    }
                } else {
                    // Horizontal process
                    const boxW = Math.min(80, (maxW - items.length * 20) / items.length);
                    for (let fi = 0; fi < items.length; fi++) {
                        const bx = c.x + fi * (boxW + 20);
                        ctx.fillStyle = C.green + '14';
                        ctx.fillRect(bx, c.y, boxW, 28);
                        await animRect(ctx, bx, c.y, boxW, 28, C.green + '55', 1.5, 200);
                        ctx.font = F.label;
                        ctx.fillStyle = C.text;
                        ctx.fillText(String(items[fi]).slice(0, 12), bx + 6, c.y + 18);
                        if (fi < items.length - 1) {
                            await animSketch(ctx, bx + boxW + 4, c.y + 14, bx + boxW + 16, c.y + 14, C.arrow, 2, 1, 100);
                        }
                    }
                    c.y += 44;
                }
                c.y += 8;
                break;
            }

            // ── BADGE ────────────────────────────────────────────────────────
            case 'badge': {
                const text = cmd.text || '';
                const colors = { red: C.red, green: C.green, blue: C.blue, yellow: C.yellow, orange: C.orange, pink: C.pink };
                const col = colors[cmd.color] || C.red;
                c.y += 6;
                ctx.font = F.labelBd;
                const tw = ctx.measureText(text).width;
                ctx.fillStyle = col + '33';
                ctx.fillRect(c.x, c.y - 12, tw + 16, 22);
                ctx.fillStyle = col;
                ctx.fillText(text, c.x + 8, c.y + 4);
                c.y += 26;
                break;
            }

            // ── ICON_LABEL ───────────────────────────────────────────────────
            case 'icon_label': {
                const icon = cmd.icon || '•';
                const text = cmd.text || '';
                c.y += 6;
                ctx.font = F.title;
                ctx.fillStyle = C.text;
                ctx.fillText(icon, c.x, c.y + 4);
                await _handwrite(ctx, text, c.x + 32, c.y, F.write, C.text, animMs);
                c.y += 30;
                break;
            }

            // ── NOTE ─────────────────────────────────────────────────────────
            case 'note': {
                const text = cmd.text || '';
                c.y += 10;
                const lines = text.split('\n');
                const bh = lines.length * 24 + 20;
                ctx.fillStyle = C.yellow + '0a';
                ctx.fillRect(c.x, c.y - 10, maxW - 10, bh);
                sketchLine(ctx, c.x, c.y - 10, c.x, c.y - 10 + bh, C.yellow, 3, 1);
                for (const ln of lines) {
                    await _handwrite(ctx, ln, c.x + 12, c.y + 6, F.write, C.text, animMs / lines.length);
                    c.y += 24;
                }
                c.y += 16;
                break;
            }

            // ── QUOTE ────────────────────────────────────────────────────────
            case 'quote': {
                const text = cmd.text || '';
                const author = cmd.author || '';
                c.y += 10;
                ctx.font = F.title;
                ctx.fillStyle = C.muted + '44';
                ctx.fillText('"', c.x, c.y + 8);
                await _handwrite(ctx, text, c.x + 20, c.y, F.write, C.text + 'cc', animMs * 0.7);
                if (author) {
                    c.y += 28;
                    await _handwrite(ctx, '— ' + author, c.x + 20, c.y, F.label, C.muted, animMs * 0.3);
                }
                c.y += 30;
                break;
            }

            // ── CODE_BLOCK ───────────────────────────────────────────────────
            case 'code_block': {
                const text = cmd.text || '';
                const lines = text.split('\n');
                c.y += 10;
                const bh = lines.length * 22 + 16;
                ctx.fillStyle = '#1a1e26';
                ctx.fillRect(c.x, c.y - 8, maxW - 10, bh);
                await animRect(ctx, c.x, c.y - 8, maxW - 10, bh, C.muted + '44', 1, 400);
                for (const ln of lines) {
                    await _handwrite(ctx, ln, c.x + 12, c.y + 8, F.mono, C.green, animMs / lines.length);
                    c.y += 22;
                }
                c.y += 16;
                break;
            }

            // ── STEP_BLOCK ───────────────────────────────────────────────────
            case 'step_block': {
                const num = cmd.number || 1;
                const title = cmd.title || '';
                const text = cmd.text || '';
                c.y += 8;
                // Number circle
                ctx.beginPath();
                ctx.arc(c.x + 14, c.y + 2, 13, 0, Math.PI * 2);
                ctx.fillStyle = C.blue + '33';
                ctx.fill();
                ctx.font = F.writeBd;
                ctx.fillStyle = C.blue;
                ctx.fillText(String(num), c.x + 9, c.y + 8);
                // Title
                await _handwrite(ctx, title, c.x + 34, c.y + 4, F.writeBd, C.text, animMs * 0.3);
                c.y += 28;
                // Description
                await _handwrite(ctx, text, c.x + 34, c.y, F.write, C.muted, animMs * 0.7);
                c.y += 28;
                break;
            }

            // ── PROGRESS ─────────────────────────────────────────────────────
            case 'progress': {
                const val = cmd.value || 0;
                const label = cmd.label || '';
                c.y += 8;
                const barW = maxW - 20;
                const barH = 16;
                // Background track
                ctx.fillStyle = C.muted + '22';
                ctx.fillRect(c.x, c.y, barW, barH);
                // Fill
                const fillW = barW * (val / 100);
                ctx.fillStyle = C.green + '88';
                ctx.fillRect(c.x, c.y, fillW, barH);
                // Border
                await animRect(ctx, c.x, c.y, barW, barH, C.muted + '66', 1, 300);
                // Label
                if (label) {
                    ctx.font = F.label;
                    ctx.fillStyle = C.muted;
                    ctx.fillText(`${label} (${val}%)`, c.x, c.y + barH + 16);
                }
                c.y += barH + 28;
                break;
            }

            // ── EMPHASIS ─────────────────────────────────────────────────────
            case 'emphasis': {
                const text = cmd.text || '';
                c.y += 12;
                await _handwrite(ctx, text, c.x, c.y, F.title, C.yellow, animMs);
                c.y += 36;
                break;
            }

            // ── LABEL ────────────────────────────────────────────────────────
            case 'label': {
                const text = cmd.text || '';
                c.y += 4;
                ctx.font = F.label;
                ctx.fillStyle = C.muted;
                ctx.fillText(text, c.x, c.y);
                c.y += 18;
                break;
            }

            default: break;
        }

        if (cmd.cmd !== 'clear') {
            if (isFull) {
                globalC.yL = c.y; globalC.yR = c.y; globalC.maxY = c.y;
            } else {
                if (isRight) globalC.yR = c.y; else globalC.yL = c.y;
                globalC.maxY = Math.max(globalC.yL, globalC.yR);
            }
        }
    }

    // ── Queue ──────────────────────────────────────────────────────────────
    const enqueue = useCallback((cmd, animMs) => {
        animQueueRef.current.push({ cmd, animMs });
        if (!isAnimatingRef.current) drainQueue();
    }, []);

    async function drainQueue() {
        isAnimatingRef.current = true;
        while (animQueueRef.current.length > 0) {
            if (frozenRef.current) break;
            const item = animQueueRef.current.shift();
            try {
                await _processCmd(item.cmd, item.animMs);
            } catch (err) {
                console.error('[Whiteboard] Command crash:', item.cmd, err);
            }
        }
        isAnimatingRef.current = false;
    }

    // ── Public API ─────────────────────────────────────────────────────────
    useImperativeHandle(ref, () => ({
        draw(commands, animMs = 1200) {
            frozenRef.current = false;
            const cmds = Array.isArray(commands) ? commands : [commands];
            console.log('[Whiteboard] draw() called with', cmds.length, 'commands:', cmds.map(c => c?.cmd).join(', '));
            for (const cmd of cmds) if (cmd?.cmd) enqueue(cmd, animMs);
        },
        freeze() {
            frozenRef.current = true;
            animQueueRef.current = [];
            isAnimatingRef.current = false;
        },
        clear() {
            frozenRef.current = false;
            animQueueRef.current = [];
            isAnimatingRef.current = false;
            const canvas = canvasRef.current;
            if (canvas) _clear(canvas.getContext('2d'));
        },
    }), [enqueue]);

    return (
        <canvas
            ref={canvasRef}
            style={{ display: 'block', borderRadius: '14px', background: C.bg }}
        />
    );
});

export default Whiteboard;
