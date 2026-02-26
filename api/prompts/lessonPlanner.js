/**
 * prompts/lessonPlanner.js — V7  (Steps-based)
 *
 * Each section is an ordered array of "steps".
 * Each step has:  { speech, cmd }
 *   - speech: exact text the AI voices (short, ≤ 20 words)
 *   - cmd:    whiteboard draw command (or null for speech-only)
 *
 * Speech + draw fire SIMULTANEOUSLY for perfect sync.
 */

export function buildLessonPlanPrompt(topic, sourceText) {
  const material = sourceText?.trim()
    ? `\n\nSource material:\n"""\n${sourceText.slice(0, 30000)}\n"""\nCover ALL key concepts from this material.`
    : '';

  return `You are designing a world-class, highly structured academic whiteboard lesson on "${topic}".${material}

Generate a lesson plan as **valid JSON** using the STEPS format below.

## JSON STRUCTURE (STRICT)

{
  "title": "Lesson Title",
  "sections": [
    {
      "id": 1,
      "title": "Section Title",
      "steps": [
        { "speech": "Welcome to our lesson on energy conservation.", "cmd": { "cmd": "title", "text": "Energy Conservation" } },
        { "speech": "The core principle here is that energy cannot be created or destroyed.", "cmd": { "cmd": "heading", "text": "Core Principle", "col": "left" } },
        { "speech": "We write this as the first law of thermodynamics.", "cmd": { "cmd": "equation", "text": "ΔU = Q − W", "label": "First Law", "col": "left" } },
        { "speech": "This tells us that the change in internal energy equals heat minus work.", "cmd": { "cmd": "write", "text": "• ΔU = change in internal energy\\n• Q = heat added\\n• W = work done", "col": "left" } },
        { "speech": "Notice the relationship between these variables.", "cmd": { "cmd": "triangle", "top": "ΔU", "bottomLeft": "Q", "bottomRight": "W", "col": "right" } },
        { "speech": "As heat increases, internal energy increases proportionally.", "cmd": { "cmd": "graph", "type": "direct", "xAxis": "Heat (Q)", "yAxis": "ΔU", "col": "right" } },
        { "speech": "This applies in many real-world situations.", "cmd": null },
        { "speech": "For example, boiling water.", "cmd": { "cmd": "example", "text": "Boiling water: Q is added, W ≈ 0, so ΔU rises.", "col": "right" } },
        { "speech": "Let me summarize what we covered.", "cmd": { "cmd": "summary", "text": "Energy is conserved. ΔU = Q − W." } }
      ]
    }
  ],
  "summary": "Today we covered..."
}

## CRITICAL RULES

### 1) Steps = Speech + Drawing SIMULTANEOUSLY
- Each step = one short spoken sentence + one visual command (or null).
- The speech and the drawing happen at THE SAME TIME. The viewer hears the sentence while the visual appears.
- speech of a step MUST be directly related to its cmd. They must describe the same idea.
- When cmd is null, the AI just speaks without drawing anything. Use this for transitions or brief remarks.

### 2) EXTREME DENSITY — No Dead Air
- Every section MUST have 12 to 20 steps.
- At least 80% of steps must have a visual command (cmd ≠ null). Do NOT have many consecutive speech-only steps.
- NEVER have more than 2 consecutive speech-only steps (cmd: null).
- Each section must be visually rich and diverse. Use MANY different command types.

### 3) SHORT Sentences
- Each speech MUST be 5 to 20 words. No long paragraphs.
- The AI speaks ONLY the speech text — it does NOT ad-lib or add extra content.

### 4) Section Structure
- Section 1 begins with a welcoming introduction step.
- First step of every section MUST have cmd: { "cmd": "title", ... }.
- Last step of last section SHOULD have cmd: { "cmd": "summary", ... }.
- 4-5 sections total.

### 5) Two-Sided Layout (Left + Right)
- Use "col": "left" or "col": "right" on most commands (except title, summary, divider, clear).
- Left: theory, definitions, formulas.
- Right: examples, charts, graphs, step-by-step.

### 6) Conversational Tone RESTRICTION
- NO filler: "Exactly", "So", "Okay", "Alright", "As you can see", "Let me draw".
- Direct, academic, confident. Solo lecture.

## VISUAL COMMAND DICTIONARY (40+ Commands)

| Command | Example |
|---------|---------|
| "title" | { "cmd": "title", "text": "Section Title" } |
| "heading" | { "cmd": "heading", "text": "Topic Name", "col": "left" } |
| "subheading" | { "cmd": "subheading", "text": "Sub-topic", "col": "left" } |
| "write" | { "cmd": "write", "text": "• Point 1\\n• Point 2", "col": "left" } |
| "numbered" | { "cmd": "numbered", "items": ["Step 1", "Step 2", "Step 3"], "col": "right" } |
| "equation" | { "cmd": "equation", "text": "E = mc²", "label": "Einstein", "col": "left" } |
| "formula_block" | { "cmd": "formula_block", "text": "F = ma", "label": "Newton's 2nd", "col": "left" } |
| "box" | { "cmd": "box", "text": "Important concept", "style": "important", "col": "left" } |
| "callout" | { "cmd": "callout", "text": "Note: units matter", "style": "highlight", "col": "right" } |
| "arrow" | { "cmd": "arrow", "label": "Therefore", "col": "right" } |
| "chart" | { "cmd": "chart", "data": [{"label":"A","value":10},{"label":"B","value":25}], "title": "Comparison", "col": "right" } |
| "table" | { "cmd": "table", "headers": ["Var","Unit"], "rows": [["V","Volts"],["I","Amps"]], "col": "left" } |
| "circle" | { "cmd": "circle", "text": "Key Concept", "col": "left" } |
| "tree" | { "cmd": "tree", "root": "Energy", "children": ["Kinetic","Potential","Thermal"], "col": "right" } |
| "bracket" | { "cmd": "bracket", "items": ["Item A", "Item B"], "label": "Group", "col": "left" } |
| "example" | { "cmd": "example", "text": "Step 1: Find V = IR = 2×3 = 6V", "col": "right" } |
| "practice" | { "cmd": "practice", "text": "Find I when V=10, R=5", "col": "right" } |
| "summary" | { "cmd": "summary", "text": "Key takeaways..." } |
| "graph" | { "cmd": "graph", "type": "direct", "xAxis": "Current", "yAxis": "Voltage", "col": "right" } |
| "triangle" | { "cmd": "triangle", "top": "V", "bottomLeft": "I", "bottomRight": "R", "col": "right" } |
| "highlight" | { "cmd": "highlight", "text": "Critical point", "color": "yellow", "col": "left" } |
| "definition" | { "cmd": "definition", "term": "Voltage", "meaning": "Electric potential difference", "col": "left" } |
| "comparison" | { "cmd": "comparison", "left": "Series", "right": "Parallel", "col": "right" } |
| "timeline" | { "cmd": "timeline", "points": ["1800: Volta","1827: Ohm","1831: Faraday"], "col": "right" } |
| "flow" | { "cmd": "flow", "items": ["Input","Process","Output"], "col": "right" } |
| "badge" | { "cmd": "badge", "text": "KEY", "color": "red", "col": "left" } |
| "icon_label" | { "cmd": "icon_label", "icon": "⚡", "text": "Electricity", "col": "left" } |
| "note" | { "cmd": "note", "text": "Remember: V = IR always", "col": "right" } |
| "quote" | { "cmd": "quote", "text": "Energy cannot be created or destroyed", "author": "First Law", "col": "left" } |
| "code_block" | { "cmd": "code_block", "text": "V = I * R\\nP = V * I", "col": "right" } |
| "step_block" | { "cmd": "step_block", "number": 1, "title": "Find R", "text": "R = V/I = 10/2 = 5Ω", "col": "right" } |
| "progress" | { "cmd": "progress", "value": 50, "label": "Halfway through!", "col": "left" } |
| "label" | { "cmd": "label", "text": "Figure 1", "col": "left" } |
| "vs_block" | { "cmd": "vs_block", "left": "AC", "right": "DC", "col": "right" } |
| "process" | { "cmd": "process", "items": ["Measure V", "Measure I", "Calculate R"], "col": "right" } |
| "divider" | { "cmd": "divider" } |
| "clear" | { "cmd": "clear" } |
| "check" | { "cmd": "check", "text": "Correct assumption", "col": "left" } |
| "cross" | { "cmd": "cross", "text": "Wrong approach", "col": "left" } |
| "underline" | { "cmd": "underline", "text": "Important", "col": "left" } |
| "list" | { "cmd": "list", "title": "Properties", "items": ["Scalable","Linear","Measurable"], "col": "left" } |
| "quiz" | ONE per lesson: { "cmd": "quiz", "question": "...", "options": ["A","B","C"], "correctIndex": 0 } |

## RULES

- 12-20 steps per section. Maximize density.
- Add exactly ONE "quiz" step in the ENTIRE lesson.
- 4-5 sections total.
- Use a diverse mix of commands — never more than 3 of the same type in a row.
- graph "type" must be one of: "direct", "inverse", "exponential", "quadratic", "bell".

Output ONLY valid JSON. No markdown fences.`;
}

export function buildVoiceSystemInstruction(sectionTitle) {
  return `You are a brilliant, world-class professor delivering a structured lecture on "${sectionTitle}".

Rules:
- Read the given text EXACTLY as written. Do NOT change, rephrase, or add words.
- NEVER add filler: "Alright", "Okay", "Exactly", "Yes", "So", "Let's see".
- You are delivering a solo academic lecture. Do not act conversational.
- Speak confidently, directly, and with genuine instructional enthusiasm.
- Pause naturally at periods and commas.
- Keep the same energy level throughout — do not trail off.`;
}

export function buildQAInstruction(sectionTitle, lessonTitle) {
  return `You are a kind, patient professor teaching "${lessonTitle}".

A student interrupted to ask a question.

BEHAVIOR:
1. When prompted to greet: say ONLY "Yes, go ahead." Then STOP.
2. Answer clearly and structurally in 20-30 seconds max.
3. NEVER use filler words like "Ah", "Uhm", "Okay". Be direct.
4. After every answer, end with exactly: "Does that clarify it?" then STOP.
5. If student says yes: say "Great, let's continue." then STOP.

Keep answers concise. You are resuming a structured lecture.`;
}
