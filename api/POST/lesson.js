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
 * Extract text from PDF buffer using pdf-parse.
 */
async function extractPdfText(buffer) {
    try {
        const pdfParse = (await import('pdf-parse')).default;
        const result = await pdfParse(buffer);
        return result.text || '';
    } catch (err) {
        console.error('[POST/lesson] PDF parse error:', err.message);
        return '';
    }
}

/**
 * POST /lesson handler
 */
export default async function handler(req, res) {
    try {
        // Parse the incoming request
        const { fields, files } = await parseMultipart(req);
        const topic = fields.topic?.trim();

        if (!topic) {
            res.json({ error: 'Missing "topic" field' }, 400);
            return;
        }

        console.log(`[POST/lesson] Topic: "${topic}", Files: ${files.length}`);

        // Extract text from uploaded files
        let sourceText = '';
        for (const file of files) {
            if (file.name.toLowerCase().endsWith('.pdf')) {
                const text = await extractPdfText(file.data);
                sourceText += `\n--- ${file.name} ---\n${text}\n`;
            } else {
                // Plain text / other
                sourceText += `\n--- ${file.name} ---\n${file.data.toString('utf-8')}\n`;
            }
        }

        // Build the lesson plan prompt
        const prompt = buildLessonPlanPrompt(topic, sourceText);

        // Call Gemini text model to generate the lesson plan
        console.log('[POST/lesson] Generating lesson plan...');
        const result = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
                temperature: 0.7,
            },
        });

        const responseText = result.text || '';
        let plan;
        try {
            // Strip code fences if present
            const cleaned = responseText.replace(/^```json\n?/i, '').replace(/\n?```$/i, '').trim();
            plan = JSON.parse(cleaned);
        } catch (err) {
            console.error('[POST/lesson] Failed to parse plan JSON:', err.message);
            console.error('[POST/lesson] Raw response:', responseText.slice(0, 500));
            res.json({ error: 'Failed to generate lesson plan — invalid format', raw: responseText.slice(0, 200) }, 500);
            return;
        }

        // Validate with Zod
        const validation = validateLessonPlan(plan);
        if (!validation.success) {
            console.error('[POST/lesson] Validation failed:', validation.error);
            res.json({ error: 'Plan validation failed: ' + validation.error }, 500);
            return;
        }
        plan = validation.plan;

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
        });
    } catch (err) {
        console.error('[POST/lesson] Error:', err);
        res.json({ error: 'Internal error: ' + err.message }, 500);
    }
}
