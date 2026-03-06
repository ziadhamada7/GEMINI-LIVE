/**
 * POST/lesson.js
 * Accepts a lesson topic + optional file uploads.
 * Uses Gemini text model to generate a structured lesson plan with draw commands.
 *
 * Request: multipart/form-data
 *   - topic: string (required)
 *   - files: uploaded PDFs/text files (optional)
 *
 * Response: { lessonId, plan }
 */

import crypto from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import { buildLessonPlanPrompt } from '../prompts/lessonPlanner.js';
import { validateLessonPlan } from '../lib/validator.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

/**
 * Parse multipart/form-data body manually (lightweight, no dependencies).
 * For production, you'd use busboy/multer, but we keep it simple here.
 */
async function parseMultipart(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
            const body = Buffer.concat(chunks);
            const contentType = req.headers['content-type'] || '';

            // Handle JSON body
            if (contentType.includes('application/json')) {
                try {
                    resolve({ fields: JSON.parse(body.toString()), files: [] });
                } catch {
                    resolve({ fields: {}, files: [] });
                }
                return;
            }

            // Handle multipart
            const boundaryMatch = contentType.match(/boundary=(.+)/);
            if (!boundaryMatch) {
                // Fallback: try as URL-encoded or plain text
                try {
                    resolve({ fields: JSON.parse(body.toString()), files: [] });
                } catch {
                    resolve({ fields: { topic: body.toString() }, files: [] });
                }
                return;
            }

            const boundary = boundaryMatch[1];
            const parts = body.toString('latin1').split(`--${boundary}`);
            const fields = {};
            const files = [];

            for (const part of parts) {
                if (part.trim() === '' || part.trim() === '--') continue;
                const [headerSection, ...contentParts] = part.split('\r\n\r\n');
                const content = contentParts.join('\r\n\r\n').replace(/\r\n$/, '');
                const nameMatch = headerSection.match(/name="([^"]+)"/);
                const filenameMatch = headerSection.match(/filename="([^"]+)"/);

                if (nameMatch) {
                    if (filenameMatch) {
                        files.push({ name: filenameMatch[1], data: Buffer.from(content, 'latin1') });
                    } else {
                        fields[nameMatch[1]] = content;
                    }
                }
            }
            resolve({ fields, files });
        });
        req.on('error', reject);
    });
}

/**
 * POST /lesson handler
 */
export default async function handler(req, res) {
    try {
        // Parse the incoming request
        const { fields, files } = await parseMultipart(req);
        let topic = fields.topic?.trim() || '';
        const language = fields.language?.trim() || 'en';

        // Separate PDF files (sent as inline data to Gemini) from text files
        const pdfParts = [];   // { inlineData: { mimeType, data } }
        let sourceText = '';   // text extracted from non-PDF files

        for (const file of files) {
            if (file.name.toLowerCase().endsWith('.pdf')) {
                console.log(`[POST/lesson] Attaching PDF for Gemini: ${file.name} (${file.data.length} bytes)`);
                pdfParts.push({
                    inlineData: {
                        mimeType: 'application/pdf',
                        data: file.data.toString('base64'),
                    },
                });

                // If no topic was provided, use the first PDF's filename without extension
                if (!topic) {
                    topic = file.name.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ');
                    console.log(`[POST/lesson] Derived topic from PDF: "${topic}"`);
                }
            } else {
                // Plain text / other
                sourceText += `\n--- ${file.name} ---\n${file.data.toString('utf-8')}\n`;
            }
        }

        if (!topic && files.length === 0) {
            res.json({ error: 'Missing "topic" field and no files uploaded' }, 400);
            return;
        }

        console.log(`[POST/lesson] Topic: "${topic}", PDFs: ${pdfParts.length}, Text files length: ${sourceText.length} chars, Language: ${language}`);

        // Build the lesson plan prompt text
        const hasPdfAttachments = pdfParts.length > 0;
        const promptText = buildLessonPlanPrompt(topic, sourceText, hasPdfAttachments, language);

        // Build multimodal contents: PDF parts + text prompt
        const contents = [
            ...pdfParts,
            { text: promptText },
        ];

        // Call Gemini model to generate the lesson plan
        console.log(`[POST/lesson] Generating lesson plan (${hasPdfAttachments ? 'with PDF attachments' : 'text only'})...`);
        let result;
        try {
            result = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: contents,
                config: {
                    responseMimeType: 'application/json',
                    temperature: 0.7,
                },
            });
        } catch (apiErr) {
            console.error('[POST/lesson] Gemini API call failed:', apiErr.message);
            res.json({ error: 'Gemini API error: ' + apiErr.message }, 500);
            return;
        }

        // Extract text — try multiple paths for robustness
        let responseText = '';
        if (typeof result?.text === 'string') {
            responseText = result.text;
        } else if (result?.candidates?.[0]?.content?.parts?.[0]?.text) {
            responseText = result.candidates[0].content.parts[0].text;
        } else {
            console.error('[POST/lesson] Could not extract text from result. Keys:', Object.keys(result || {}));
            console.error('[POST/lesson] Result snapshot:', JSON.stringify(result, null, 2).slice(0, 800));
            res.json({ error: 'Gemini returned no text content' }, 500);
            return;
        }
        console.log(`[POST/lesson] Raw response length: ${responseText.length}`);
        console.log(`[POST/lesson] Raw response (first 300): ${responseText.slice(0, 300)}`);

        let plan;
        try {
            // Strategy 1: Direct parse (works when responseMimeType='application/json' is respected)
            plan = JSON.parse(responseText);
        } catch {
            try {
                // Strategy 2: Strip markdown code fences
                const cleaned = responseText
                    .replace(/^```(?:json)?\s*\n?/i, '')
                    .replace(/\n?\s*```\s*$/i, '')
                    .trim();
                plan = JSON.parse(cleaned);
            } catch {
                try {
                    // Strategy 3: Extract first { ... } JSON block
                    const start = responseText.indexOf('{');
                    const end = responseText.lastIndexOf('}');
                    if (start >= 0 && end > start) {
                        plan = JSON.parse(responseText.slice(start, end + 1));
                    } else {
                        throw new Error('No JSON object found in response');
                    }
                } catch (err) {
                    console.error('[POST/lesson] All parsing strategies failed:', err.message);
                    console.error('[POST/lesson] Full raw response:', responseText.slice(0, 1000));
                    res.json({ error: 'Failed to generate lesson plan — invalid format', raw: responseText.slice(0, 300) }, 500);
                    return;
                }
            }
        }

        // Validate with Zod
        const validation = validateLessonPlan(plan);
        if (!validation.success) {
            console.error('[POST/lesson] Validation failed:', validation.error);
            res.json({ error: 'Plan validation failed: ' + validation.error }, 500);
            return;
        }
        plan = validation.plan;

        // ── Post-process: ensure at least 2 image commands exist ──────────
        const allCmds = plan.sections.flatMap(s => (s.steps || []).map(st => st.cmd?.cmd)).filter(Boolean);
        const imageCount = allCmds.filter(c => c === 'image').length;
        if (imageCount < 2) {
            console.log(`[POST/lesson] Only ${imageCount} image commands found, injecting...`);
            const topic = plan.title || '';
            // Inject into sections 1 and 3 (or last) at position 3 (after intro steps)
            const targets = [0, Math.min(2, plan.sections.length - 1)];
            for (const si of targets) {
                const sec = plan.sections[si];
                if (!sec || !sec.steps) continue;
                // Don't double-inject
                if (sec.steps.some(s => s.cmd?.cmd === 'image')) continue;
                const query = `${topic} ${sec.title} educational diagram illustration`.trim();
                const imageStep = {
                    speech: `Look at this visual illustration here. This diagram helps us understand ${sec.title.toLowerCase()}...`,
                    cmd: {
                        cmd: 'image',
                        query: query,
                        caption: sec.title,
                        col: 'right',
                    },
                };
                // Insert after the 3rd step (after title + heading + first content)
                const insertAt = Math.min(3, sec.steps.length);
                sec.steps.splice(insertAt, 0, imageStep);
                console.log(`[POST/lesson] Injected image into section ${si + 1}: "${query}"`);
            }
        }

        // Debug: log step counts per section
        for (let i = 0; i < plan.sections.length; i++) {
            const sec = plan.sections[i];
            const stepCount = (sec.steps || []).length;
            const cmds = (sec.steps || []).filter(s => s.cmd).map(s => s.cmd.cmd).join(', ');
            console.log(`[POST/lesson] Section ${i + 1} "${sec.title}": ${stepCount} steps [${cmds}]`);
        }

        const lessonId = crypto.randomUUID();
        console.log(`[POST/lesson] Plan generated: ${plan.sections.length} sections, ID: ${lessonId}`);

        res.json({
            lessonId,
            plan,
            language,
        });
    } catch (err) {
        console.error('[POST/lesson] Error:', err);
        res.json({ error: 'Internal error: ' + err.message }, 500);
    }
}
