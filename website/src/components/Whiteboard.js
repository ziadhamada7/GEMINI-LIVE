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

// Arabic-friendly font stacks — "Cairo" matches the handwriting aesthetic
const F = {
    title: 'bold 25px "Patrick Hand", "Cairo", cursive',
    writeBd: 'bold 18px "Patrick Hand", "Cairo", cursive',
    write: '400 17px "Patrick Hand", "Cairo", cursive',
    bullet: '400 16px "Patrick Hand", "Cairo", cursive',
    mono: '600 17px "JetBrains Mono", monospace',
    monoLg: 'bold 28px "JetBrains Mono", monospace',
    label: '400 13px "Patrick Hand", "Cairo", cursive',
    labelBd: '600 13px "Inter", "Cairo", sans-serif',
    small: '400 12px "Inter", "Cairo", sans-serif',
};

// ─── Auto-fit text helper ─────────────────────────────────────────────────────
// Shrinks font size first; if still too wide at minSize, wraps into multi-line.
// Returns { font, lines, lineHeight, fontSize }.
function _fitText(ctx, text, maxWidth, baseFont, minSize = 10) {
    const match = baseFont.match(/^(.*?)(\d+)(px.*)$/);
    if (!match) return { font: baseFont, lines: [text], lineHeight: 20, fontSize: 16 };

    const prefix = match[1];       // e.g. "bold "
    let size = parseInt(match[2]);  // e.g. 18
    const suffix = match[3];       // e.g. 'px "Patrick Hand", ...'

    // Step 1: Try reducing font size until text fits in one line
    while (size > minSize) {
        const font = `${prefix}${size}${suffix}`;
        ctx.font = font;
        if (ctx.measureText(text).width <= maxWidth) {
            return { font, lines: [text], lineHeight: Math.ceil(size * 1.35), fontSize: size };
        }
        size--;
    }

    // Step 2: At minimum size, wrap into multiple lines word-by-word
    const finalFont = `${prefix}${minSize}${suffix}`;
    ctx.font = finalFont;
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';
    for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        if (ctx.measureText(testLine).width > maxWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
        } else {
            currentLine = testLine;
        }
    }
    if (currentLine) lines.push(currentLine);
    // If a single word is wider than maxWidth, it stays on its own line (won't break mid-word)
    return { font: finalFont, lines, lineHeight: Math.ceil(minSize * 1.35), fontSize: minSize };
}

// ─── Easing ───────────────────────────────────────────────────────────────────
function easeOut(t) { return 1 - Math.pow(1 - t, 2.5); }
function easeIn(t) { return t * t * t; }

// ─── RNG seeded per-render for consistent sketchy jitter ─────────────────────
let seed = 1;
function srnd() { seed = (seed * 16807 + 0) % 2147483647; return (seed - 1) / 2147483646; }
function jitter(n = 1) { return (srnd() - 0.5) * n * 2; }

// ─── Arabic / RTL helpers ────────────────────────────────────────────────────
const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
function _hasArabic(text) { return ARABIC_RE.test(text); }
function _isArabicChar(ch) { return ARABIC_RE.test(ch); }

/**
 * Split text into directional segments: { text, isArabic }
 * Groups consecutive Arabic chars (including spaces between Arabic words) together,
 * and Latin chars together, so Arabic segments can be drawn as full strings.
 */
function _splitBidiSegments(text) {
    if (!text) return [];
    const segments = [];
    let current = '';
    let currentIsArabic = null;

    for (const ch of text) {
        const isAr = _isArabicChar(ch);
        // Spaces: attach to the current segment direction
        if (ch === ' ') {
            current += ch;
            continue;
        }
        if (currentIsArabic === null) {
            currentIsArabic = isAr;
            current = ch;
        } else if (isAr === currentIsArabic) {
            current += ch;
        } else {
            if (current.trim()) segments.push({ text: current, isArabic: currentIsArabic });
            else if (current) {
                // Trailing space — attach to previous
                if (segments.length > 0) segments[segments.length - 1].text += current;
            }
            current = ch;
            currentIsArabic = isAr;
        }
    }
    if (current) segments.push({ text: current, isArabic: currentIsArabic ?? false });
    return segments;
}

/**
 * Split Arabic text into words for word-by-word animation.
 */
function _splitArabicWords(text) {
    const words = [];
    let current = '';
    for (const ch of text) {
        if (ch === ' ') {
            if (current) words.push(current);
            words.push(' ');
            current = '';
        } else {
            current += ch;
        }
    }
    if (current) words.push(current);
    return words;
}

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
        if (durMs <= 0) {
            ctx.strokeStyle = color;
            ctx.lineWidth = lw;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(x1 + jitter(0.5), y1 + jitter(0.5));
            ctx.lineTo(x2 + jitter(0.5), y2 + jitter(0.5));
            ctx.stroke();
            resolve();
            return;
        }
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
        if (durMs <= 0) {
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = lw;
            ctx.lineCap = 'round';
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.stroke();
            resolve();
            return;
        }
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
    if (durMs <= 0) {
        ctx.strokeStyle = color;
        ctx.lineWidth = lw;
        ctx.lineJoin = 'round';
        ctx.strokeRect(x, y, w, h);
        return;
    }
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
const Whiteboard = forwardRef(function Whiteboard({ width = 900, height = 560, activeTool = null, penColor = '#ef4444', onDrawStart }, ref) {
    const canvasRef = useRef(null);
    const userCanvasRef = useRef(null);
    const cursorRef = useRef({ x: 44, y: 58 });
    const animQueueRef = useRef([]);
    const historyRef = useRef([]);
    const isAnimatingRef = useRef(false);
    const frozenRef = useRef(false);

    useEffect(() => {
        const dpr = window.devicePixelRatio || 1;
        // Main AI Canvas
        const canvas = canvasRef.current;
        if (canvas) {
            const ctx = canvas.getContext('2d');
            canvas.width = width * dpr;
            canvas.height = height * dpr;
            canvas.style.width = width + 'px';
            canvas.style.height = height + 'px';
            ctx.scale(dpr, dpr);
            _clear(ctx);
        }
        // User Drawing Canvas Overlay
        const userCanvas = userCanvasRef.current;
        if (userCanvas) {
            const uCtx = userCanvas.getContext('2d');
            userCanvas.width = width * dpr;
            userCanvas.height = height * dpr;
            userCanvas.style.width = width + 'px';
            userCanvas.style.height = height + 'px';
            uCtx.scale(dpr, dpr);
            uCtx.lineCap = 'round';
            uCtx.lineJoin = 'round';
        }
    }, [width, height]);

    function _clear(ctx) {
        seed = 42;
        cursorRef.current = { yL: 58, yR: 58, maxY: 58 };
        historyRef.current = [];
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

    function _scroll(ctx, forceShift = 0) {
        const c = cursorRef.current;
        if (c.maxY > height - 80 || forceShift > 0) {
            const shift = forceShift > 0 ? forceShift : 130;
            const dpr = window.devicePixelRatio || 1;

            // Safari/Firefox throw errors on non-integer bounds for getImageData
            const sx = 0;
            const sy = Math.floor(shift * dpr);
            const sw = Math.floor(width * dpr);
            const sh = Math.floor((height - shift) * dpr);

            const img = ctx.getImageData(sx, sy, sw, sh);

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

    // ── Human handwriting animation ──────────────────────────────────────
    // Arabic: clip-based progressive reveal (preserves ligatures + bidi)
    // Latin:  char-by-char (original handwriting feel)
    // When rtl=true, x is the RIGHT edge. When rtl=false, x is the LEFT edge.
    function _handwrite(ctx, text, x, y, font, color, durationMs, rtl = false) {
        return new Promise(resolve => {
            if (!text) { resolve(); return; }

            if (durationMs <= 0) {
                ctx.font = font;
                ctx.fillStyle = color;
                if (rtl) {
                    ctx.direction = 'rtl';
                    ctx.textAlign = 'right';
                    ctx.fillText(text, x, y);
                    ctx.textAlign = 'left';
                    ctx.direction = 'ltr';
                } else {
                    ctx.fillText(text, x, y);
                }
                resolve();
                return;
            }

            const hasAr = _hasArabic(text);

            if (hasAr) {
                // ── Arabic: progressive offscreen reveal (glitch-free) ──
                // Draw perfectly once, then copy slices to avoid overlapping anti-aliasing
                const dpr = window.devicePixelRatio || 1;
                ctx.font = font;
                const tw = ctx.measureText(text).width;

                const offCanvas = document.createElement('canvas');
                const padX = 20;
                const padY = 40;
                const oW = Math.ceil(tw) + padX * 2;
                const oH = padY * 2;

                offCanvas.width = oW * dpr;
                offCanvas.height = oH * dpr;
                const oCtx = offCanvas.getContext('2d');
                oCtx.scale(dpr, dpr);

                oCtx.font = font;
                oCtx.fillStyle = color;
                oCtx.textBaseline = 'alphabetic';

                if (rtl) {
                    oCtx.direction = 'rtl';
                    oCtx.textAlign = 'right';
                    oCtx.fillText(text, oW - padX, padY);
                } else {
                    oCtx.direction = 'ltr';
                    oCtx.textAlign = 'left';
                    oCtx.fillText(text, padX, padY);
                }

                const steps = Math.max(6, Math.min(30, Math.floor(tw / 10)));
                const stepWidth = oW / steps;
                const baseMs = durationMs > 0 ? Math.max(8, Math.min(100, durationMs / steps)) : 30;

                let step = 0;
                const drawStep = () => {
                    if (frozenRef.current) { resolve(); return; }
                    if (step >= steps) { resolve(); return; }

                    step++;
                    const prevW = Math.floor((step - 1) * stepWidth);
                    const curW = (step === steps) ? oW : Math.floor(step * stepWidth);
                    const sliceW = curW - prevW;

                    if (sliceW > 0) {
                        const destY = y - padY;
                        if (rtl) {
                            // Reveal right-to-left
                            const srcX = oW - curW;
                            const destX = x - padX - tw + srcX;
                            ctx.drawImage(offCanvas, srcX * dpr, 0, sliceW * dpr, oH * dpr, destX, destY, sliceW, oH);
                        } else {
                            // Reveal left-to-right
                            const srcX = prevW;
                            const destX = x - padX + srcX;
                            ctx.drawImage(offCanvas, srcX * dpr, 0, sliceW * dpr, oH * dpr, destX, destY, sliceW, oH);
                        }
                    }

                    const variance = (srnd() - 0.5) * baseMs * 0.4;
                    const pause = srnd() < 0.05 ? baseMs * 2.0 : baseMs + variance;
                    setTimeout(drawStep, Math.max(5, pause));
                };
                setTimeout(drawStep, 0);

            } else {
                // ── Latin char-by-char rendering (original logic) ────
                ctx.font = font;
                const chars = [...text];
                let cx = x;
                if (rtl) {
                    cx = x - ctx.measureText(text).width;
                }

                let i = 0;
                const avgMs = durationMs > 0
                    ? Math.max(5, Math.min(120, durationMs / chars.length))
                    : 55;

                const drawNext = () => {
                    if (frozenRef.current) { resolve(); return; }
                    if (i >= chars.length) { resolve(); return; }

                    const ch = chars[i];
                    const isComplex = /[mwMWBDQO@]/.test(ch);
                    const isSimple = /[il1!.,;: ]/.test(ch);
                    const charMs = avgMs * (isComplex ? 1.4 : isSimple ? 0.6 : 1.0)
                        + (srnd() - 0.5) * 12;

                    const jx = jitter(0.6);
                    const jy = jitter(0.5);
                    ctx.font = font;
                    ctx.fillStyle = color;
                    ctx.fillText(ch, cx + jx, y + jy);
                    cx += ctx.measureText(ch).width;
                    i++;

                    const pause = srnd() < 0.05 ? charMs * 2.0 : charMs;
                    setTimeout(drawNext, Math.max(2, pause));
                };
                setTimeout(drawNext, 0);
            }
        });
    }

    // ── Draw text with glow effect (RTL-aware) ─────────────────────────────
    function _drawGlow(ctx, text, x, y, font, glowColor, rtl = false) {
        ctx.save();
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = 12;
        ctx.font = font;
        ctx.fillStyle = 'transparent';
        if (rtl) {
            ctx.direction = 'rtl';
            ctx.textAlign = 'right';
        }
        ctx.fillText(text, x, y);
        ctx.restore();
    }

    // ── RTL-aware underline ────────────────────────────────────────────────
    async function _drawUnderline(ctx, text, x, y, font, color, maxW, rtl, animMs) {
        ctx.font = font;
        const tw = ctx.measureText(text).width;
        if (rtl) {
            // Underline from right (x) to left (x - tw)
            await animSketch(ctx, x, y, x - tw - 6, y, color, 2, 2, animMs);
        } else {
            await animSketch(ctx, x, y, x + tw + 6, y, color, 2, 2, animMs);
        }
    }

    // ── Process command ────────────────────────────────────────────────────
    async function _processCmd(cmd, animMs = 1200) {
        if (!canvasRef.current || frozenRef.current) return;
        const ctx = canvasRef.current.getContext('2d');
        const globalC = cursorRef.current;
        _scroll(ctx);
        // Simple LCG for consistent jitter between commands
        seed = (seed * 16807) % 2147483647;

        if (cmd.cmd !== 'clear' && cmd.cmd !== 'undo') {
            historyRef.current.push({
                imgData: ctx.getImageData(0, 0, width * (window.devicePixelRatio || 1), height * (window.devicePixelRatio || 1)),
                cursor: { ...globalC }
            });
            if (historyRef.current.length > 50) historyRef.current.shift();
        }

        const isRight = cmd.col === 'right';
        const isFull = ['title', 'divider', 'newline', 'clear', 'undo', 'summary'].includes(cmd.cmd);

        const startX = isRight && !isFull ? width / 2 + 20 : 44;
        const startY = isFull ? globalC.maxY : (isRight ? globalC.yR : globalC.yL);
        const maxW = isFull ? width - startX - 44 : width / 2 - 64;

        const c = { x: startX, y: startY };

        switch (cmd.cmd) {

            // ── CLEAR ────────────────────────────────────────────────────────
            case 'clear': {
                _clear(ctx);
                break;
            }

            // ── UNDO ─────────────────────────────────────────────────────────
            case 'undo': {
                const steps = cmd.steps || 1;
                for (let i = 0; i < steps; i++) {
                    if (historyRef.current.length > 0) {
                        const state = historyRef.current.pop();
                        ctx.putImageData(state.imgData, 0, 0);
                        Object.assign(globalC, state.cursor);
                    }
                }
                break;
            }

            // ── TITLE ────────────────────────────────────────────────────────
            case 'title': {
                c.y += 8;
                const text = cmd.text || '';
                const rtl = _hasArabic(text);
                const textX = rtl ? c.x + maxW : c.x;
                // Text glow effect
                _drawGlow(ctx, text, textX, c.y, F.title, C.title, rtl);
                await _handwrite(ctx, text, textX, c.y, F.title, C.title, animMs * 1.0, rtl);
                await _drawUnderline(ctx, text, textX, c.y + 9, F.title, C.title + 'aa', maxW, rtl, 350);
                c.y += 44;
                break;
            }

            // ── HEADING ──────────────────────────────────────────────────────
            case 'heading': {
                c.y += 10;
                const text = cmd.text || '';
                const rtl = _hasArabic(text);
                const textX = rtl ? c.x + maxW : c.x;
                _drawGlow(ctx, text, textX, c.y, F.writeBd, C.blue, rtl);
                await _handwrite(ctx, text, textX, c.y, F.writeBd, C.blue, animMs, rtl);
                await _drawUnderline(ctx, text, textX, c.y + 6, F.writeBd, C.blue + '66', maxW, rtl, 300);
                c.y += 32;
                break;
            }

            // ── SUBHEADING ───────────────────────────────────────────────────
            case 'subheading': {
                c.y += 4;
                const text = cmd.text || '';
                const rtl = _hasArabic(text);
                const textX = rtl ? c.x + maxW : c.x;
                await _handwrite(ctx, text, textX, c.y, F.write, C.muted, animMs, rtl);
                await _drawUnderline(ctx, text, textX, c.y + 4, F.write, C.muted + '88', maxW, rtl, 250);
                c.y += 28;
                break;
            }

            // ── WRITE (multiline robust) ─────────────────────────────────────
            case 'write': {
                const lines = (cmd.text || '').split('\n');
                const lineTime = animMs / lines.length;
                const rtl = _hasArabic(cmd.text || '');
                for (const raw of lines) {
                    if (!raw.trim()) { c.y += 16; continue; }
                    const isBullet = raw.trim().startsWith('•') || raw.trim().startsWith('-');
                    const text = isBullet ? raw.replace(/^[•\-]\s*/, '') : raw;
                    if (isBullet) {
                        if (rtl) {
                            // RTL: bullet on right, text to left
                            const bulletX = c.x + maxW - 10;
                            ctx.strokeStyle = C.bullet;
                            ctx.lineWidth = 2;
                            ctx.lineCap = 'round';
                            ctx.beginPath();
                            ctx.moveTo(bulletX - 7 + jitter(1), c.y - 5 + jitter(1));
                            ctx.lineTo(bulletX + jitter(1), c.y - 5 + jitter(1));
                            ctx.stroke();
                            await _handwrite(ctx, text, bulletX - 18, c.y, F.bullet, C.text, lineTime, true);
                        } else {
                            ctx.strokeStyle = C.bullet;
                            ctx.lineWidth = 2;
                            ctx.lineCap = 'round';
                            ctx.beginPath();
                            ctx.moveTo(c.x + 3 + jitter(1), c.y - 5 + jitter(1));
                            ctx.lineTo(c.x + 10 + jitter(1), c.y - 5 + jitter(1));
                            ctx.stroke();
                            await _handwrite(ctx, text, c.x + 18, c.y, F.bullet, C.text, lineTime);
                        }
                    } else {
                        const textX = rtl ? c.x + maxW : c.x;
                        await _handwrite(ctx, text, textX, c.y, F.write, C.text, lineTime, rtl);
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
                const rtl = items.length > 0 && _hasArabic(items[0]);
                for (let i = 0; i < items.length; i++) {
                    const text = items[i];
                    if (rtl) {
                        const numX = c.x + maxW;
                        await _handwrite(ctx, `.${i + 1}`, numX, c.y, F.writeBd, C.blue, itemTime * 0.2, true);
                        await _handwrite(ctx, text, numX - 24, c.y, F.write, C.text, itemTime * 0.8, true);
                    } else {
                        await _handwrite(ctx, `${i + 1}.`, c.x, c.y, F.writeBd, C.blue, itemTime * 0.2);
                        await _handwrite(ctx, text, c.x + 24, c.y, F.write, C.text, itemTime * 0.8);
                    }
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
                c.y += lbl ? 65 : 44; // Give it more breathing room
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
                const rtl = _hasArabic(text);
                const s = cmd.style || 'default';
                const styleMap = {
                    highlight: { fill: 'rgba(251,191,36,0.07)', border: C.yellow, text: C.yellow },
                    formula: { fill: 'rgba(52,211,153,0.07)', border: C.green, text: C.green },
                    important: { fill: 'rgba(248,113,113,0.07)', border: C.red, text: C.red },
                    default: { fill: 'rgba(255,255,255,0.04)', border: C.muted, text: C.text },
                };
                const sc = styleMap[s] || styleMap.default;
                const baseFont = s === 'formula' ? F.mono : F.write;
                const pad = 16;
                const bw = maxW;
                const fit = _fitText(ctx, text, bw - pad * 2, baseFont);
                const bh = fit.lines.length * fit.lineHeight + 30;
                const by = c.y - 28;
                const bx = rtl ? c.x + maxW - bw : c.x;
                ctx.fillStyle = sc.fill;
                ctx.fillRect(bx, by, bw, bh);
                await animRect(ctx, bx, by, bw, bh, sc.border + '99', 2, 500);
                const lineTime = (animMs * 0.8) / fit.lines.length;
                let ly = c.y + 4;
                for (const ln of fit.lines) {
                    const textX = rtl ? bx + bw - pad : bx + pad;
                    await _handwrite(ctx, ln, textX, ly, fit.font, sc.text, lineTime, rtl);
                    ly += fit.lineHeight;
                }
                c.y += bh + 24;
                break;
            }

            // ── CALLOUT ───────────────────────────────────────────────────────
            case 'callout': {
                const text = cmd.text || '';
                const rtl = _hasArabic(text);
                const s = cmd.style || 'default';
                const clr = s === 'highlight' ? C.yellow : s === 'important' ? C.red : C.muted;
                const pad = 12;
                const bw = maxW;
                const fit = _fitText(ctx, text, bw - pad * 2, F.write);
                const bh = fit.lines.length * fit.lineHeight + 24;
                const by = c.y - 24;
                const bx = rtl ? c.x + maxW - bw : c.x;
                ctx.fillStyle = clr + '18';
                if (rtl) {
                    ctx.beginPath();
                    ctx.moveTo(bx + bw + 14 + jitter(2), c.y - 6 + jitter(2));
                    ctx.lineTo(bx + bw + jitter(2), by + 10 + jitter(2));
                    ctx.lineTo(bx + bw + jitter(2), by + bh - 10 + jitter(2));
                    ctx.closePath();
                    ctx.fill();
                } else {
                    ctx.beginPath();
                    ctx.moveTo(bx - 14 + jitter(2), c.y - 6 + jitter(2));
                    ctx.lineTo(bx + jitter(2), by + 10 + jitter(2));
                    ctx.lineTo(bx + jitter(2), by + bh - 10 + jitter(2));
                    ctx.closePath();
                    ctx.fill();
                }
                ctx.fillRect(bx, by, bw, bh);
                await animRect(ctx, bx, by, bw, bh, clr + '66', 1.5, 400);
                const lineTime = (animMs * 0.7) / fit.lines.length;
                let ly = c.y + 4;
                for (const ln of fit.lines) {
                    const textX = rtl ? bx + bw - pad : bx + pad;
                    await _handwrite(ctx, ln, textX, ly, fit.font, clr, lineTime, rtl);
                    ly += fit.lineHeight;
                }
                c.y += bh + 24;
                break;
            }

            // ── UNDERLINE ────────────────────────────────────────────────────
            case 'underline': {
                const text = cmd.text || '';
                const rtl = _hasArabic(text);
                const textX = rtl ? c.x + maxW : c.x;
                await _handwrite(ctx, text, textX, c.y, F.write, C.yellow, animMs, rtl);
                await _drawUnderline(ctx, text, textX, c.y + 6, F.write, C.yellow + 'cc', maxW, rtl, 280);
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
                const rtl = _hasArabic(title || (items[0] || ''));
                if (title) {
                    const titleX = rtl ? c.x + maxW : c.x;
                    await _handwrite(ctx, title, titleX, c.y + 10, F.writeBd, C.text, animMs * 0.2, rtl);
                    c.y += 36;
                }
                const itemTime = animMs / (items.length || 1);
                for (let li = 0; li < items.length; li++) {
                    const text = items[li];
                    if (rtl) {
                        // RTL: bullet on right, text to left
                        const bulletX = c.x + maxW - 10;
                        ctx.fillStyle = C.blue;
                        ctx.beginPath();
                        ctx.arc(bulletX + jitter(1), c.y - 6 + jitter(1), 3 + jitter(1), 0, Math.PI * 2);
                        ctx.fill();
                        await _handwrite(ctx, text, bulletX - 18, c.y, F.write, C.text, itemTime * 0.8, true);
                    } else {
                        ctx.fillStyle = C.blue;
                        ctx.beginPath();
                        ctx.arc(c.x + 10 + jitter(1), c.y - 6 + jitter(1), 3 + jitter(1), 0, Math.PI * 2);
                        ctx.fill();
                        await _handwrite(ctx, text, c.x + 28, c.y, F.write, C.text, itemTime * 0.8);
                    }
                    c.y += 32;
                }
                c.y += 10;
                break;
            }

            // ── CHECK (green mark) ───────────────────────────────────────────
            case 'check': {
                const text = cmd.text || '';
                const rtl = _hasArabic(text);
                const sy = c.y + 10;
                if (rtl) {
                    const sx = c.x + maxW - 10;
                    await animSketch(ctx, sx, sy, sx - 8, sy + 10, C.green, 3, 1, 200);
                    await animSketch(ctx, sx - 8, sy + 10, sx - 24, sy - 12, C.green, 3, 1, 300);
                    if (text) await _handwrite(ctx, text, sx - 40, sy + 4, F.write, C.green, animMs * 0.7, true);
                } else {
                    const sx = c.x + 10;
                    // draw checkmark
                    await animSketch(ctx, sx, sy, sx + 8, sy + 10, C.green, 3, 1, 200);
                    await animSketch(ctx, sx + 8, sy + 10, sx + 24, sy - 12, C.green, 3, 1, 300);
                    if (text) {
                        await _handwrite(ctx, text, sx + 40, sy + 4, F.write, C.green, animMs * 0.7);
                    }
                }
                c.y += 40;
                break;
            }

            // ── CROSS (red X) ────────────────────────────────────────────────
            case 'cross': {
                const text = cmd.text || '';
                const rtl = _hasArabic(text);
                const sy = c.y + 10;
                if (rtl) {
                    const sx = c.x + maxW - 10;
                    await animSketch(ctx, sx, sy - 10, sx - 18, sy + 8, C.red, 3, 1, 200);
                    await animSketch(ctx, sx - 18, sy - 10, sx, sy + 8, C.red, 3, 1, 200);
                    if (text) await _handwrite(ctx, text, sx - 40, sy + 4, F.write, C.red, animMs * 0.7, true);
                } else {
                    const sx = c.x + 10;
                    // draw X
                    await animSketch(ctx, sx, sy - 10, sx + 18, sy + 8, C.red, 3, 1, 200);
                    await animSketch(ctx, sx + 18, sy - 10, sx, sy + 8, C.red, 3, 1, 200);
                    if (text) {
                        await _handwrite(ctx, text, sx + 40, sy + 4, F.write, C.red, animMs * 0.7);
                    }
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

                // Wrap text inside with auto-fit
                const fit = _fitText(ctx, text, r * 1.5, F.label, 9);
                ctx.font = fit.font;
                const startY = cy2 - (fit.lines.length - 1) * fit.lineHeight / 2;
                for (let li = 0; li < fit.lines.length; li++) {
                    const lw = ctx.measureText(fit.lines[li]).width;
                    ctx.fillStyle = C.text;
                    ctx.fillText(fit.lines[li], cx2 - lw / 2, startY + li * fit.lineHeight);
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

                const isRTL = _hasArabic(title) || data.some(d => _hasArabic(d.label));

                if (title) {
                    ctx.font = F.labelBd;
                    ctx.fillStyle = C.muted;
                    if (isRTL) {
                        ctx.textAlign = 'right';
                        ctx.fillText(title, c.x + chartW, c.y - 8);
                        ctx.textAlign = 'left';
                    } else {
                        ctx.fillText(title, c.x, c.y - 8);
                    }
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

                // Detect RTL from title or first header/row
                let isRTL = _hasArabic(title) || _hasArabic(String(headers[0] || ''));
                if (!isRTL && rows.length > 0) {
                    const firstRow = Array.isArray(rows[0]) ? rows[0] : Object.values(rows[0]);
                    isRTL = _hasArabic(String(firstRow[0] || ''));
                }

                const cols = headers.length;
                const colW = Math.floor(Math.min(150, maxW / cols));
                const rowH = 28;
                const tableW = colW * cols;
                const tableX = isRTL ? c.x + maxW - tableW : c.x;

                if (title) {
                    ctx.font = F.labelBd;
                    ctx.fillStyle = C.muted;
                    if (isRTL) {
                        ctx.textAlign = 'right';
                        ctx.fillText(title, c.x + maxW, c.y - 8);
                        ctx.textAlign = 'left';
                    } else {
                        ctx.fillText(title, tableX, c.y - 8);
                    }
                    c.y += 18;
                }

                // Header bg
                ctx.fillStyle = 'rgba(96,165,250,0.08)';
                ctx.fillRect(tableX, c.y - 20, tableW, rowH);
                await animRect(ctx, tableX, c.y - 20, tableW, rowH * (rows.length + 1), C.muted + '33', 1, 600);

                for (let hi = 0; hi < cols; hi++) {
                    const renderCol = isRTL ? (cols - 1 - hi) : hi;
                    const cellX = tableX + renderCol * colW;
                    const headerText = String(headers[hi]);
                    const fitH = _fitText(ctx, headerText, colW - 14, F.labelBd, 9);
                    ctx.font = fitH.font;
                    ctx.fillStyle = C.blue;

                    if (isRTL) {
                        ctx.textAlign = 'right';
                        ctx.fillText(fitH.lines[0], cellX + colW - 7, c.y - 5);
                    } else {
                        ctx.textAlign = 'left';
                        ctx.fillText(fitH.lines[0], cellX + 7, c.y - 5);
                    }

                    if (renderCol > 0) {
                        sketchLine(ctx, cellX, c.y - 20, cellX, c.y - 20 + rowH * (rows.length + 1), C.muted + '22', 1, 1);
                    }
                }
                ctx.textAlign = 'left'; // reset

                for (let ri = 0; ri < rows.length; ri++) {
                    const ry = c.y + ri * rowH;
                    sketchLine(ctx, tableX, ry, tableX + tableW, ry, C.muted + '22', 1, 1);
                    const row = Array.isArray(rows[ri]) ? rows[ri] : Object.values(rows[ri]);

                    for (let ci = 0; ci < cols; ci++) {
                        const renderCol = isRTL ? (cols - 1 - ci) : ci;
                        const cellX = tableX + renderCol * colW;
                        const cellText = String(row[ci] ?? '');
                        const fitC = _fitText(ctx, cellText, colW - 14, F.label, 9);
                        ctx.font = fitC.font;
                        ctx.fillStyle = C.text + 'cc';

                        if (isRTL) {
                            ctx.textAlign = 'right';
                            ctx.fillText(fitC.lines[0], cellX + colW - 7, ry + 17);
                        } else {
                            ctx.textAlign = 'left';
                            ctx.fillText(fitC.lines[0], cellX + 7, ry + 17);
                        }
                    }
                }
                ctx.textAlign = 'left'; // reset
                c.y += rowH * (rows.length + 1) + 32; // Give it more breathing room below the table
                break;
            }

            // ── SUMMARY / EXAMPLE / PRACTICE BLOCKS ─────────────────────────
            case 'summary':
            case 'example':
            case 'practice': {
                const titleLabel = cmd.cmd === 'summary' ? 'SUMMARY' : cmd.cmd === 'example' ? 'EXAMPLE' : 'PRACTICE';
                const color = cmd.cmd === 'summary' ? C.yellow : cmd.cmd === 'example' ? C.blue : C.pink;
                const text = cmd.text || '';
                const rtl = _hasArabic(text);
                c.y += 24;
                ctx.fillStyle = color + '11';
                const lines = text.split('\n');
                const bh = lines.length * 28 + 44;
                ctx.fillRect(c.x, c.y - 20, maxW, bh);
                await animRect(ctx, c.x, c.y - 20, maxW, bh, color + '66', 2, 500);
                const labelX = rtl ? c.x + maxW - 16 : c.x + 16;
                await _handwrite(ctx, titleLabel, labelX, c.y + 4, F.writeBd, color, animMs * 0.2, rtl);
                c.y += 32;
                const lineTime = (animMs * 0.8) / lines.length;
                for (const raw of lines) {
                    const lineX = rtl ? c.x + maxW - 16 : c.x + 16;
                    await _handwrite(ctx, raw, lineX, c.y, F.write, C.text, lineTime, rtl);
                    c.y += 28;
                }
                c.y += 20;
                break;
            }

            // ── TREE (Hierarchical) ──────────────────────────────────────────
            case 'tree': {
                const root = cmd.root || 'Root';
                const children = cmd.children || [];
                const rtl = _hasArabic(root) || (children.length > 0 && _hasArabic(children[0]));
                const rootX = rtl ? c.x + maxW : c.x;
                await _handwrite(ctx, root, rootX, c.y, F.writeBd, C.text, animMs * 0.2, rtl);
                c.y += 28;
                const childTime = (animMs * 0.8) / children.length;
                for (let i = 0; i < children.length; i++) {
                    const ch = children[i];
                    const isLast = i === children.length - 1;
                    if (rtl) {
                        const branchX = c.x + maxW - 8;
                        await animSketch(ctx, branchX, c.y - 20, branchX, c.y - 6, C.muted, 2, 1, Math.min(100, childTime * 0.1));
                        await animSketch(ctx, branchX, c.y - 6, branchX - 16, c.y - 6, C.muted, 2, 1, Math.min(100, childTime * 0.1));
                        if (!isLast) sketchLine(ctx, branchX, c.y - 6, branchX, c.y + 16, C.muted, 2, 1);
                        await _handwrite(ctx, ch, branchX - 24, c.y, F.write, C.text, childTime * 0.8, true);
                    } else {
                        await animSketch(ctx, c.x + 8, c.y - 20, c.x + 8, c.y - 6, C.muted, 2, 1, Math.min(100, childTime * 0.1));
                        await animSketch(ctx, c.x + 8, c.y - 6, c.x + 24, c.y - 6, C.muted, 2, 1, Math.min(100, childTime * 0.1));
                        if (!isLast) sketchLine(ctx, c.x + 8, c.y - 6, c.x + 8, c.y + 16, C.muted, 2, 1);
                        await _handwrite(ctx, ch, c.x + 32, c.y, F.write, C.text, childTime * 0.8);
                    }
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
                const isRTL = items.some(t => _hasArabic(t)) || _hasArabic(label);
                const itemTime = animMs / items.length;
                let startY = c.y;

                for (const text of items) {
                    const txtX = isRTL ? c.x + maxW - 20 : c.x + 20;
                    await _handwrite(ctx, text, txtX, c.y, F.write, C.text, itemTime, isRTL);
                    c.y += 28;
                }
                const endY = c.y - 28;
                const midY = startY + (endY - startY) / 2;

                // Draw '{'
                ctx.strokeStyle = C.muted;
                ctx.beginPath();
                if (isRTL) {
                    const bx = c.x + maxW - 12;
                    ctx.moveTo(bx, startY - 14);
                    ctx.bezierCurveTo(bx + 10, startY - 14, bx + 10, midY - 6, bx + 18, midY - 6);
                    ctx.bezierCurveTo(bx + 10, midY - 6, bx + 10, endY + 2, bx, endY + 2);
                } else {
                    ctx.moveTo(c.x + 12, startY - 14);
                    ctx.bezierCurveTo(c.x + 2, startY - 14, c.x + 2, midY - 6, c.x - 6, midY - 6);
                    ctx.bezierCurveTo(c.x + 2, midY - 6, c.x + 2, endY + 2, c.x + 12, endY + 2);
                }
                ctx.stroke();

                if (label) {
                    const lblX = isRTL ? c.x + maxW - 16 : c.x + 16;
                    await _handwrite(ctx, label, lblX, endY + 24, F.labelBd, C.blue, 300, isRTL);
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
                const rtl = _hasArabic(text);
                const colors = { yellow: C.yellow, green: C.green, blue: C.blue, red: C.red, orange: C.orange, pink: C.pink };
                const col = colors[cmd.color] || C.yellow;
                c.y += 8;
                const fit = _fitText(ctx, text, maxW - 14, F.writeBd);
                const lineTime = animMs / fit.lines.length;
                for (let li = 0; li < fit.lines.length; li++) {
                    const ln = fit.lines[li];
                    ctx.font = fit.font;
                    const tw = ctx.measureText(ln).width;
                    const hlX = rtl ? c.x + maxW - tw - 12 : c.x - 2;
                    ctx.fillStyle = col + '28';
                    ctx.fillRect(hlX, c.y - 16, tw + 12, 26);
                    const textX = rtl ? c.x + maxW : c.x + 2;
                    await _handwrite(ctx, ln, textX, c.y, fit.font, col, lineTime, rtl);
                    c.y += fit.lineHeight + 6;
                }
                c.y += 10;
                break;
            }

            // ── DEFINITION ───────────────────────────────────────────────────
            case 'definition': {
                const term = cmd.term || '';
                const meaning = cmd.meaning || '';
                const rtl = _hasArabic(term) || _hasArabic(meaning);
                c.y += 8;
                if (rtl) {
                    // RTL: term on right, meaning on left side
                    const textX = c.x + maxW;
                    await _handwrite(ctx, term, textX, c.y, F.writeBd, C.blue, animMs * 0.3, true);
                    ctx.font = F.writeBd;
                    const termW = ctx.measureText(term).width;
                    const colonTxt = ' :  ';
                    await _handwrite(ctx, colonTxt, textX - termW, c.y, F.write, C.text, 0, true);
                    const colonW = ctx.measureText(colonTxt).width;
                    await _handwrite(ctx, meaning, textX - termW - colonW, c.y, F.write, C.text, animMs * 0.7, true);
                } else {
                    await _handwrite(ctx, term, c.x, c.y, F.writeBd, C.blue, animMs * 0.3);
                    ctx.font = F.writeBd;
                    const tw = ctx.measureText(term).width;
                    await _handwrite(ctx, ':  ' + meaning, c.x + tw, c.y, F.write, C.text, animMs * 0.7);
                }
                c.y += 32;
                break;
            }

            // ── COMPARISON / VS_BLOCK ────────────────────────────────────────
            case 'comparison':
            case 'vs_block': {
                const left = cmd.left || '';
                const right = cmd.right || '';
                const rtlL = _hasArabic(left);
                const rtlR = _hasArabic(right);
                c.y += 12;
                const bw = (maxW - 30) / 2;
                const pad = 8;

                // Auto-fit with wrapping
                const fitL = _fitText(ctx, left, bw - pad * 2, F.writeBd);
                const fitR = _fitText(ctx, right, bw - pad * 2, F.writeBd);
                const maxLines = Math.max(fitL.lines.length, fitR.lines.length);
                const lh = Math.max(fitL.lineHeight, fitR.lineHeight);
                const boxH = maxLines * lh + 16;

                // Left box
                ctx.fillStyle = C.blue + '14';
                ctx.fillRect(c.x, c.y - 14, bw, boxH);
                await animRect(ctx, c.x, c.y - 14, bw, boxH, C.blue + '66', 1.5, 300);
                const lineTimeL = (animMs * 0.3) / fitL.lines.length;
                let lyL = c.y + 4;
                for (const ln of fitL.lines) {
                    const leftX = rtlL ? c.x + bw - pad : c.x + pad;
                    await _handwrite(ctx, ln, leftX, lyL, fitL.font, C.blue, lineTimeL, rtlL);
                    lyL += lh;
                }
                // VS
                ctx.font = F.labelBd;
                ctx.fillStyle = C.muted;
                ctx.fillText('vs', c.x + bw + 6, c.y - 14 + boxH / 2 + 4);
                // Right box
                const bx2 = c.x + bw + 28;
                ctx.fillStyle = C.orange + '14';
                ctx.fillRect(bx2, c.y - 14, bw, boxH);
                await animRect(ctx, bx2, c.y - 14, bw, boxH, C.orange + '66', 1.5, 300);
                const lineTimeR = (animMs * 0.3) / fitR.lines.length;
                let lyR = c.y + 4;
                for (const ln of fitR.lines) {
                    const rightX = rtlR ? bx2 + bw - pad : bx2 + pad;
                    await _handwrite(ctx, ln, rightX, lyR, fitR.font, C.orange, lineTimeR, rtlR);
                    lyR += lh;
                }
                c.y += boxH + 10;
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
                    // Label (auto-fit to gap between dots)
                    const labelMaxW = Math.max(30, gap - 8);
                    const fit = _fitText(ctx, points[pi], labelMaxW, F.label, 9);
                    ctx.font = fit.font;
                    let ly = lineY + 18;
                    for (const ln of fit.lines) {
                        const lw2 = ctx.measureText(ln).width;
                        ctx.fillText(ln, px - lw2 / 2, ly);
                        ly += fit.lineHeight;
                    }
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

                const isRTL = items.some(item => _hasArabic(item));
                const isVert = cmd.cmd === 'flow';

                if (isVert) {
                    for (let fi = 0; fi < items.length; fi++) {
                        const itemText = items[fi];
                        const boxW = maxW - 40;
                        const boxX = isRTL ? c.x + maxW - boxW : c.x + 10;
                        const pad = 8;
                        const fit = _fitText(ctx, itemText, boxW - pad * 2, F.write);
                        const boxH = fit.lines.length * fit.lineHeight + 12;

                        ctx.fillStyle = C.blue + '14';
                        ctx.fillRect(boxX, c.y - 8, boxW, boxH);
                        await animRect(ctx, boxX, c.y - 8, boxW, boxH, C.blue + '55', 1.5, 200);
                        // Text logic
                        const lineTime = (animMs / items.length * 0.7) / fit.lines.length;
                        let ly = c.y + 4;
                        for (const ln of fit.lines) {
                            const textX = isRTL ? boxX + boxW - pad : boxX + pad;
                            await _handwrite(ctx, ln, textX, ly, fit.font, C.text, lineTime, isRTL);
                            ly += fit.lineHeight;
                        }
                        c.y += boxH + 8;

                        // Downward arrow
                        if (fi < items.length - 1) {
                            const arrX = isRTL ? boxX + boxW / 2 : c.x + maxW / 2;
                            await animSketch(ctx, arrX, c.y - 4, arrX, c.y + 10, C.arrow, 2, 1, 150);
                            await animSketch(ctx, arrX - 5, c.y + 5, arrX, c.y + 10, C.arrow, 2, 1, 80);
                            await animSketch(ctx, arrX + 5, c.y + 5, arrX, c.y + 10, C.arrow, 2, 1, 80);
                            c.y += 16;
                        }
                    }
                } else {
                    // Horizontal process - fit text within evenly distributed boxes
                    const hPad = 8;
                    const arrowGap = 24;
                    const totalArrowSpace = (items.length - 1) * arrowGap;
                    const boxW = Math.floor((maxW - totalArrowSpace) / items.length);

                    let currX = isRTL ? c.x + maxW : c.x;

                    // Pre-compute fits and find max lines for uniform box height
                    const fits = items.map(text => _fitText(ctx, String(text), boxW - hPad * 2, F.label, 9));
                    const maxFitLines = Math.max(...fits.map(f => f.lines.length));
                    const fitLh = fits[0].lineHeight;
                    const boxH = maxFitLines * fitLh + 10;

                    for (let fi = 0; fi < items.length; fi++) {
                        const bx = isRTL ? currX - boxW : currX;
                        const fit = fits[fi];

                        ctx.fillStyle = C.green + '14';
                        ctx.fillRect(bx, c.y, boxW, boxH);
                        await animRect(ctx, bx, c.y, boxW, boxH, C.green + '55', 1.5, 200);

                        // Draw each line centered in the box
                        let ly = c.y + 8 + (maxFitLines - fit.lines.length) * fitLh / 2;
                        for (const ln of fit.lines) {
                            ctx.font = fit.font;
                            ctx.fillStyle = C.text;
                            const strW = ctx.measureText(ln).width;
                            const textX = bx + (boxW - strW) / 2;
                            if (isRTL) {
                                ctx.textAlign = 'right';
                                ctx.fillText(ln, textX + strW, ly);
                                ctx.textAlign = 'left';
                            } else {
                                ctx.fillText(ln, textX, ly);
                            }
                            ly += fitLh;
                        }

                        currX = isRTL ? currX - boxW : currX + boxW;

                        if (fi < items.length - 1) {
                            // Arrow
                            if (isRTL) {
                                await animSketch(ctx, currX - 4, c.y + boxH / 2, currX - arrowGap + 4, c.y + boxH / 2, C.arrow, 2, 1, 100);
                                drawArrowHead(ctx, currX - arrowGap + 4, c.y + boxH / 2, Math.PI, 6, C.arrow);
                            } else {
                                await animSketch(ctx, currX + 4, c.y + boxH / 2, currX + arrowGap - 4, c.y + boxH / 2, C.arrow, 2, 1, 100);
                                drawArrowHead(ctx, currX + arrowGap - 4, c.y + boxH / 2, 0, 6, C.arrow);
                            }
                            currX = isRTL ? currX - arrowGap : currX + arrowGap;
                        }
                    }
                    c.y += boxH + 14;
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
                const fit = _fitText(ctx, text, maxW - 16, F.labelBd, 9);
                ctx.font = fit.font;
                const tw = ctx.measureText(fit.lines[0]).width;
                const badgeH = fit.lines.length * fit.lineHeight + 8;
                ctx.fillStyle = col + '33';
                ctx.fillRect(c.x, c.y - 12, Math.min(tw + 16, maxW), badgeH);
                ctx.fillStyle = col;
                let ly = c.y + 4;
                for (const ln of fit.lines) {
                    ctx.fillText(ln, c.x + 8, ly);
                    ly += fit.lineHeight;
                }
                c.y += badgeH + 8;
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
                const rtl = _hasArabic(text);
                c.y += 10;
                const lines = text.split('\n');
                const bh = lines.length * 24 + 20;
                ctx.fillStyle = C.yellow + '0a';
                ctx.fillRect(c.x, c.y - 10, maxW - 10, bh);
                if (rtl) {
                    sketchLine(ctx, c.x + maxW - 10, c.y - 10, c.x + maxW - 10, c.y - 10 + bh, C.yellow, 3, 1);
                } else {
                    sketchLine(ctx, c.x, c.y - 10, c.x, c.y - 10 + bh, C.yellow, 3, 1);
                }
                for (const ln of lines) {
                    const lineX = rtl ? c.x + maxW - 22 : c.x + 12;
                    await _handwrite(ctx, ln, lineX, c.y + 6, F.write, C.text, animMs / lines.length, rtl);
                    c.y += 24;
                }
                c.y += 16;
                break;
            }

            // ── QUOTE ────────────────────────────────────────────────────────
            case 'quote': {
                const text = cmd.text || '';
                const author = cmd.author || '';
                const rtl = _hasArabic(text);
                c.y += 10;
                ctx.font = F.title;
                ctx.fillStyle = C.muted + '44';
                if (rtl) {
                    ctx.fillText('"', c.x + maxW, c.y + 8);
                    await _handwrite(ctx, text, c.x + maxW - 20, c.y, F.write, C.text + 'cc', animMs * 0.7, true);
                    if (author) {
                        c.y += 28;
                        await _handwrite(ctx, '— ' + author, c.x + maxW - 20, c.y, F.label, C.muted, animMs * 0.3, true);
                    }
                } else {
                    ctx.fillText('"', c.x, c.y + 8);
                    await _handwrite(ctx, text, c.x + 20, c.y, F.write, C.text + 'cc', animMs * 0.7);
                    if (author) {
                        c.y += 28;
                        await _handwrite(ctx, '— ' + author, c.x + 20, c.y, F.label, C.muted, animMs * 0.3);
                    }
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


            // ── IMAGE ────────────────────────────────────────────────────────
            case 'image': {
                if (!cmd.dataUrl) break;
                // Allow larger images, minus some padding
                const maxImgW = maxW - 20;
                const maxImgH = 260;
                c.y += 24; // Ensure we don't overlap previous blocks

                await new Promise((resolve) => {
                    const img = new Image();
                    img.onload = () => {
                        let iw = img.width, ih = img.height;
                        const scale = Math.min(maxImgW / iw, maxImgH / ih, 1);
                        iw = Math.round(iw * scale);
                        ih = Math.round(ih * scale);

                        const gCtx = canvasRef.current.getContext('2d');
                        const padding = 10;
                        const pbom = cmd.caption ? 36 : 14;

                        // Prevent drawing off-screen by pre-scrolling
                        const totalNeededH = ih + padding + pbom + 40;
                        if (c.y + totalNeededH > height) {
                            const shift = (c.y + totalNeededH) - height + 40;
                            cursorRef.current.maxY = Math.max(cursorRef.current.maxY, c.y);
                            _scroll(gCtx, shift);
                            c.y -= shift;
                        }

                        let opacity = 0;
                        let drawnFrame = false;

                        const fadeIn = () => {
                            if (!canvasRef.current || frozenRef.current) { resolve(); return; }

                            opacity += 0.08;
                            if (opacity > 1) opacity = 1;

                            // Center horizontally in its column
                            const ix = c.x + (maxImgW - iw) / 2;
                            const iy = c.y;

                            gCtx.save();
                            gCtx.globalAlpha = opacity;

                            // 1. Draw Photo Paper / Polaroid Background
                            gCtx.shadowColor = 'rgba(0,0,0,0.3)';
                            gCtx.shadowBlur = 12;
                            gCtx.shadowOffsetY = 6;
                            gCtx.fillStyle = '#ffffff';
                            gCtx.fillRect(ix - padding, iy - padding, iw + padding * 2, ih + padding + pbom);

                            gCtx.shadowColor = 'transparent';

                            // 2. Draw Image
                            gCtx.drawImage(img, ix, iy, iw, ih);

                            // 3. Inner border holding the picture
                            gCtx.strokeStyle = 'rgba(0,0,0,0.08)';
                            gCtx.lineWidth = 1;
                            gCtx.strokeRect(ix, iy, iw, ih);

                            // 4. "Tape" stuck to the top center
                            gCtx.fillStyle = 'rgba(235, 230, 180, 0.75)'; // Transparent yellowish masking tape
                            gCtx.rotate(-0.02); // slight rotation for tape
                            gCtx.fillRect(ix + iw / 2 - 30, iy - padding - 8, 60, 22);
                            gCtx.rotate(0.02); // restore

                            // 5. Draw Caption centered at the bottom of the polaroid
                            if (cmd.caption) {
                                gCtx.font = F.label;
                                gCtx.fillStyle = '#444';
                                gCtx.textAlign = 'center';
                                gCtx.fillText(cmd.caption, ix + iw / 2, iy + ih + 22);
                                gCtx.textAlign = 'left';
                            }

                            gCtx.restore();

                            if (opacity < 1) {
                                requestAnimationFrame(fadeIn);
                            } else {
                                c.y += totalNeededH;
                                resolve();
                            }
                        };
                        fadeIn();
                    };
                    img.onerror = () => {
                        console.warn('[Whiteboard] Failed to load image');
                        resolve();
                    };
                    img.src = cmd.dataUrl;
                });
                break;
            }

            default: break;
        }

        if (cmd.cmd !== 'clear' && cmd.cmd !== 'undo') {
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
        /** Capture a region of the canvas as base64 PNG (no data: prefix) */
        getCanvasSnapshot(x, y, w, h) {
            const canvas = canvasRef.current;
            const userCanvas = userCanvasRef.current;
            if (!canvas) return null;
            const dpr = window.devicePixelRatio || 1;
            // Clamp to canvas bounds
            const sx = Math.max(0, Math.floor(x * dpr));
            const sy = Math.max(0, Math.floor(y * dpr));
            const sw = Math.min(canvas.width - sx, Math.floor(w * dpr));
            const sh = Math.min(canvas.height - sy, Math.floor(h * dpr));
            if (sw <= 0 || sh <= 0) return null;
            const tmpCanvas = document.createElement('canvas');
            tmpCanvas.width = sw;
            tmpCanvas.height = sh;
            const tmpCtx = tmpCanvas.getContext('2d');
            // Draw main canvas
            tmpCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
            // Draw user drawing canvas on top
            if (userCanvas) {
                tmpCtx.drawImage(userCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
            }
            // Return base64 without data: prefix
            return tmpCanvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
        },
        getCanvasEl() { return canvasRef.current; },
        clearUserDrawing() {
            const uCanvas = userCanvasRef.current;
            if (uCanvas) {
                const uCtx = uCanvas.getContext('2d');
                uCtx.clearRect(0, 0, width, height);
            }
        }
    }), [enqueue, width, height]);

    // ── User Drawing Logic ─────────────────────────────────────────────────
    const isDrawingRef = useRef(false);
    const lastPosRef = useRef(null);

    const getPos = useCallback((e) => {
        const rect = userCanvasRef.current.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }, []);

    const handlePointerDown = useCallback((e) => {
        if (activeTool !== 'Pen' && activeTool !== 'Eraser') return;
        isDrawingRef.current = true;
        lastPosRef.current = getPos(e);
        if (onDrawStart) onDrawStart();

        const uCtx = userCanvasRef.current.getContext('2d');
        uCtx.beginPath();
        uCtx.moveTo(lastPosRef.current.x, lastPosRef.current.y);
        uCtx.lineTo(lastPosRef.current.x, lastPosRef.current.y);

        if (activeTool === 'Eraser') {
            uCtx.globalCompositeOperation = 'destination-out';
            uCtx.strokeStyle = 'rgba(0,0,0,1)';
            uCtx.lineWidth = 20;
        } else {
            uCtx.globalCompositeOperation = 'source-over';
            uCtx.strokeStyle = penColor;
            uCtx.lineWidth = 3;
        }
        uCtx.stroke();
    }, [activeTool, penColor, onDrawStart, getPos]);

    const handlePointerMove = useCallback((e) => {
        if (!isDrawingRef.current) return;
        const pos = getPos(e);
        const uCtx = userCanvasRef.current.getContext('2d');

        uCtx.lineTo(pos.x, pos.y);
        uCtx.stroke();

        // Smooth out the line by resetting the path to continue from here
        uCtx.beginPath();
        uCtx.moveTo(pos.x, pos.y);

        lastPosRef.current = pos;
    }, [getPos]);

    const handlePointerUp = useCallback(() => {
        isDrawingRef.current = false;
        lastPosRef.current = null;
    }, []);

    return (
        <div className="relative w-full h-full">
            {/* Hidden text to force browser to preload fonts before canvas draws */}
            <div style={{ fontFamily: 'Cairo', position: 'absolute', opacity: 0, pointerEvents: 'none', userSelect: 'none' }}>
                preloading arabic font cairo مجانا
            </div>
            <div style={{ fontFamily: 'Patrick Hand', position: 'absolute', opacity: 0, pointerEvents: 'none', userSelect: 'none' }}>
                preloading patrick hand
            </div>
            <canvas
                ref={canvasRef}
                style={{ display: 'block', borderRadius: '14px', background: C.bg }}
            />
            {/* User Drawing Overlay */}
            <canvas
                ref={userCanvasRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerOut={handlePointerUp}
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    display: 'block',
                    borderRadius: '14px',
                    pointerEvents: (activeTool === 'Pen' || activeTool === 'Eraser') ? 'auto' : 'none',
                    touchAction: 'none'
                }}
            />
        </div>
    );
});

export default Whiteboard;
