/**
 * lib/validator.js — V7  (Steps-based)
 *
 * Validates the new steps[] lesson plan format.
 * Each section has steps: [{ speech, cmd }]
 * No more script/cues/parseSegments.
 */

const ALLOWED_CMDS = new Set([
    // Core text
    'title', 'heading', 'subheading', 'write', 'numbered',
    // Highlights & shapes
    'box', 'arrow', 'underline', 'equation', 'formula_block',
    'callout', 'circle', 'list', 'check', 'cross',
    // Layout
    'divider', 'chart', 'table', 'clear', 'newline',
    // Rich blocks
    'tree', 'bracket', 'example', 'practice', 'summary',
    // Interactive
    'quiz',
    // Math/Science
    'graph', 'triangle',
    // New V7 commands
    'highlight', 'definition', 'comparison', 'timeline', 'flow',
    'badge', 'icon_label', 'note', 'quote', 'code_block',
    'step_block', 'progress', 'label', 'vs_block', 'process',
    // V8: image
    'image',
]);

const MAX_SECTIONS = 6;
const MAX_STEPS_PER_SECTION = 24;

function truncStr(s, max) {
    return typeof s === 'string' && s.length > max ? s.slice(0, max) : s;
}

function validateCommand(cmd) {
    if (!cmd || typeof cmd !== 'object') return null;
    if (!ALLOWED_CMDS.has(cmd.cmd)) return null;

    // Global truncations
    if (cmd.text && typeof cmd.text === 'string') cmd.text = truncStr(cmd.text, 500);
    if (cmd.label && typeof cmd.label === 'string') cmd.label = truncStr(cmd.label, 100);
    if (cmd.title && typeof cmd.title === 'string') cmd.title = truncStr(cmd.title, 100);

    switch (cmd.cmd) {
        // ── Text commands ────────────────────────────────────────────────
        case 'title':
        case 'heading':
        case 'subheading':
        case 'write':
        case 'underline':
        case 'emphasis':
            if (typeof cmd.text !== 'string') return null;
            break;

        // ── Math commands ────────────────────────────────────────────────
        case 'equation':
        case 'formula_block':
            if (typeof cmd.text !== 'string') return null;
            break;

        // ── Styled text commands ─────────────────────────────────────────
        case 'callout':
            if (typeof cmd.text !== 'string') return null;
            if (cmd.style && !['highlight', 'default', 'important'].includes(cmd.style)) cmd.style = 'default';
            break;
        case 'circle':
            if (typeof cmd.text !== 'string') return null;
            break;
        case 'box':
            if (typeof cmd.text !== 'string') return null;
            if (cmd.style && !['highlight', 'formula', 'important', 'default'].includes(cmd.style)) cmd.style = 'default';
            break;

        // ── Arrow / connector ────────────────────────────────────────────
        case 'arrow':
            break;

        // ── Data viz ─────────────────────────────────────────────────────
        case 'chart':
            if (!Array.isArray(cmd.data)) return null;
            cmd.data = cmd.data.slice(0, 8);
            break;
        case 'table':
            if (!Array.isArray(cmd.headers)) return null;
            cmd.headers = cmd.headers.slice(0, 6);
            cmd.rows = (cmd.rows || []).slice(0, 8);
            break;

        // ── Math / Science ───────────────────────────────────────────────
        case 'graph':
            if (!['direct', 'inverse', 'bell', 'exponential', 'quadratic'].includes(cmd.type)) return null;
            cmd.xAxis = truncStr(cmd.xAxis || '', 30);
            cmd.yAxis = truncStr(cmd.yAxis || '', 30);
            break;
        case 'triangle':
            if (!cmd.top || typeof cmd.top !== 'string') return null;
            if (!cmd.bottomLeft || typeof cmd.bottomLeft !== 'string') return null;
            if (!cmd.bottomRight || typeof cmd.bottomRight !== 'string') return null;
            cmd.top = truncStr(cmd.top, 12);
            cmd.bottomLeft = truncStr(cmd.bottomLeft, 12);
            cmd.bottomRight = truncStr(cmd.bottomRight, 12);
            break;

        // ── List commands ────────────────────────────────────────────────
        case 'numbered':
            if (!Array.isArray(cmd.items)) return null;
            cmd.items = cmd.items.slice(0, 12);
            break;
        case 'tree':
            if (!Array.isArray(cmd.children)) return null;
            cmd.children = cmd.children.slice(0, 8);
            break;
        case 'bracket':
            if (!Array.isArray(cmd.items)) return null;
            cmd.items = cmd.items.slice(0, 8);
            break;
        case 'list':
            if (!Array.isArray(cmd.items)) return null;
            cmd.items = cmd.items.slice(0, 10);
            break;

        // ── Rich blocks ──────────────────────────────────────────────────
        case 'example':
        case 'practice':
        case 'summary':
        case 'note':
            if (typeof cmd.text !== 'string') return null;
            break;

        // ── V7 New commands ──────────────────────────────────────────────
        case 'highlight':
            if (typeof cmd.text !== 'string') return null;
            if (cmd.color && !['yellow', 'green', 'blue', 'red', 'orange', 'pink'].includes(cmd.color)) cmd.color = 'yellow';
            break;
        case 'definition':
            if (typeof cmd.term !== 'string' || typeof cmd.meaning !== 'string') return null;
            cmd.term = truncStr(cmd.term, 40);
            cmd.meaning = truncStr(cmd.meaning, 200);
            break;
        case 'comparison':
        case 'vs_block':
            if (typeof cmd.left !== 'string' || typeof cmd.right !== 'string') return null;
            cmd.left = truncStr(cmd.left, 40);
            cmd.right = truncStr(cmd.right, 40);
            break;
        case 'timeline':
            if (!Array.isArray(cmd.points)) return null;
            cmd.points = cmd.points.slice(0, 6);
            break;
        case 'flow':
        case 'process':
            if (!Array.isArray(cmd.items)) return null;
            cmd.items = cmd.items.slice(0, 6);
            break;
        case 'badge':
        case 'label':
            if (typeof cmd.text !== 'string') return null;
            cmd.text = truncStr(cmd.text, 20);
            break;
        case 'icon_label':
            if (typeof cmd.icon !== 'string' || typeof cmd.text !== 'string') return null;
            cmd.icon = cmd.icon.slice(0, 4); // emoji
            cmd.text = truncStr(cmd.text, 40);
            break;
        case 'quote':
            if (typeof cmd.text !== 'string') return null;
            cmd.author = truncStr(cmd.author || '', 30);
            break;
        case 'code_block':
            if (typeof cmd.text !== 'string') return null;
            break;
        case 'step_block':
            if (typeof cmd.title !== 'string' || typeof cmd.text !== 'string') return null;
            cmd.number = Number(cmd.number) || 1;
            break;
        case 'progress':
            cmd.value = Math.max(0, Math.min(100, Number(cmd.value) || 0));
            break;
        case 'check':
        case 'cross':
            break;

        // ── Quiz ─────────────────────────────────────────────────────────
        case 'quiz':
            if (typeof cmd.question !== 'string') return null;
            if (!Array.isArray(cmd.options) || cmd.options.length < 2) return null;
            break;

        // ── Layout ───────────────────────────────────────────────────────
        case 'clear':
        case 'newline':
        case 'divider':
            break;

        // ── Image ────────────────────────────────────────────────────────
        case 'image':
            if (typeof cmd.query !== 'string' || !cmd.query.trim()) return null;
            cmd.query = truncStr(cmd.query, 100);
            if (cmd.caption) cmd.caption = truncStr(cmd.caption, 60);
            break;
    }
    return cmd;
}

export function validateLessonPlan(raw) {
    if (!raw || typeof raw !== 'object') return { success: false, error: 'Plan is not an object' };
    if (!raw.title || typeof raw.title !== 'string') return { success: false, error: 'Missing title' };
    if (!Array.isArray(raw.sections) || raw.sections.length === 0) return { success: false, error: 'No sections' };
    if (raw.sections.length > MAX_SECTIONS) raw.sections = raw.sections.slice(0, MAX_SECTIONS);

    for (let i = 0; i < raw.sections.length; i++) {
        const s = raw.sections[i];
        s.id = i + 1;
        if (!s.title || typeof s.title !== 'string') return { success: false, error: `Section ${i + 1}: missing title` };

        // ── V7: steps[] validation ──────────────────────────────────────
        if (!Array.isArray(s.steps) || s.steps.length === 0) {
            // Backward compat: if old script+cues format, reject
            return { success: false, error: `Section ${i + 1}: missing steps array` };
        }

        if (s.steps.length > MAX_STEPS_PER_SECTION) {
            s.steps = s.steps.slice(0, MAX_STEPS_PER_SECTION);
        }

        // Validate each step
        const validSteps = [];
        for (let j = 0; j < s.steps.length; j++) {
            const step = s.steps[j];
            if (!step || typeof step !== 'object') continue;

            // Normalize speech
            if (typeof step.speech !== 'string') step.speech = '';
            if (step.speech.length > 300) step.speech = step.speech.slice(0, 300);

            // Validate cmd (can be null for speech-only steps)
            if (step.cmd) {
                const validated = validateCommand(step.cmd);
                if (!validated) {
                    console.warn(`[validator] Removing invalid cmd in section ${i + 1}, step ${j + 1}: ${step.cmd?.cmd}`);
                    step.cmd = null; // Demote to speech-only instead of dropping the step
                }
            }

            // Only add steps that have at least speech or a cmd
            if (step.speech.trim() || step.cmd) {
                validSteps.push(step);
            }
        }
        s.steps = validSteps;
    }

    return { success: true, plan: raw };
}

/**
 * Strip cue markers from script (backward compat, no longer primary).
 */
export function stripCueMarkers(script) {
    return (script || '').replace(/\[C\d+\]\s*/g, '').trim();
}
