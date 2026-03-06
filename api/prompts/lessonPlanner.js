/**
 * prompts/lessonPlanner.js — V8  (Natural Teaching)
 *
 * Each section is an ordered array of "steps".
 * Each step has:  { speech, cmd }
 *   - speech: teaching note / bullet point the AI explains naturally
 *   - cmd:    whiteboard draw command (or null for speech-only)
 *
 * Speech + draw fire SIMULTANEOUSLY for perfect sync.
 */

// Language display name mapping for prompt instructions
const LANG_NAMES = {
  'en': 'English',
  'ar-eg': 'Egyptian Arabic (اللهجة المصرية)',
  'ar-sa': 'Saudi Arabic (اللهجة السعودية)',
  'fr': 'French',
  'es': 'Spanish',
  'de': 'German',
};

export function buildLessonPlanPrompt(topic, sourceText, hasPdfAttachments = false, language = 'en') {
  const langName = LANG_NAMES[language] || 'English';
  const isArabic = language.startsWith('ar');

  let material = '';

  if (hasPdfAttachments) {
    // PDFs are attached as inline data — Gemini reads them directly
    const extraTextNote = sourceText?.trim()
      ? `\n\nAdditionally, the following text files were provided:\n"""\n${sourceText.slice(0, 30000)}\n"""`
      : '';
    material = `\n\n========== CRITICAL SOURCE MATERIAL ==========
🚨 PDF document(s) are attached to this message as inline data. READ THEM DIRECTLY.${extraTextNote}
==============================================

🚨 CRITICAL RULES FOR SOURCE MATERIAL:
1. You MUST build this entire lesson STRICTLY and EXCLUSIVELY based on the attached PDF document(s).
2. Your absolute primary goal is to teach the EXACT CONTENT of these documents to the student.
3. DO NOT invent general knowledge, hallucinate concepts, or pull in outside information. 
4. Extract the exact definitions, specific examples, and structural arguments directly from the PDF(s).
5. If a concept is not mentioned in the source material, DO NOT teach it.
6. Adapt the whiteboard drawings to visually represent the hierarchies, data, or processes described in the documents.`;
  } else if (sourceText?.trim()) {
    material = `\n\n========== CRITICAL SOURCE MATERIAL ==========\n"""\n${sourceText.slice(0, 45000)}\n"""\n==============================================\n
🚨 CRITICAL RULES FOR SOURCE MATERIAL:
1. You MUST build this entire lesson STRICTLY and EXCLUSIVELY based on the provided Source Material above.
2. Your absolute primary goal is to teach THIS EXACT DOCUMENT to the student.
3. DO NOT invent general knowledge, hallucinate concepts, or pull in outside information. 
4. Extract the exact definitions, specific examples, and structural arguments directly from the text provided.
5. If a concept is not mentioned in the source material, DO NOT teach it.
6. Adapt the whiteboard drawings to visually represent the hierarchies, data, or processes described in the text.`;
  }

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
        { "speech": "welcome — energy conservation lesson", "cmd": { "cmd": "title", "text": "Energy Conservation" } },
        { "speech": "core principle: energy cannot be created or destroyed", "cmd": { "cmd": "heading", "text": "Core Principle", "col": "left" } },
        { "speech": "look at this diagram of a power plant. notice how energy transforms from heat to mechanical to electrical...", "cmd": { "cmd": "image", "query": "thermal power plant energy transformation diagram", "caption": "Energy Transformation in Power Plants", "col": "right" } },
        { "speech": "first law of thermodynamics: ΔU = Q − W", "cmd": { "cmd": "equation", "text": "ΔU = Q − W", "label": "First Law", "col": "left" } },
        { "speech": "explain each variable: ΔU = internal energy, Q = heat, W = work", "cmd": { "cmd": "write", "text": "• ΔU = change in internal energy\\n• Q = heat added\\n• W = work done", "col": "left" } },
        { "speech": "triangle relationship between ΔU, Q, and W", "cmd": { "cmd": "triangle", "top": "ΔU", "bottomLeft": "Q", "bottomRight": "W", "col": "right" } },
        { "speech": "direct relationship: more heat → more internal energy", "cmd": { "cmd": "graph", "type": "direct", "xAxis": "Heat (Q)", "yAxis": "ΔU", "col": "right" } },
        { "speech": "real-world applications of this law", "cmd": null },
        { "speech": "example: boiling water — Q added, W ≈ 0, so ΔU rises", "cmd": { "cmd": "example", "text": "Boiling water: Q is added, W ≈ 0, so ΔU rises.", "col": "right" } },
        { "speech": "summary: energy is conserved, ΔU = Q − W", "cmd": { "cmd": "summary", "text": "Energy is conserved. ΔU = Q − W." } }
      ]
    }
  ],
  "summary": "Today we covered..."
}

## CRITICAL RULES

### 1) Steps = Speech + Drawing SIMULTANEOUSLY
- Each step = one teaching note + one visual command (or null).
- The speech and the drawing happen at THE SAME TIME.
- speech of a step MUST be directly related to its cmd. They must describe the same idea.
- When cmd is null, the AI just speaks without drawing anything. Use this for transitions.

### 2) EXTREME DENSITY — No Dead Air
- Every section MUST have 12 to 20 steps.
- At least 80% of steps must have a visual command (cmd ≠ null). Do NOT have many consecutive speech-only steps.
- NEVER have more than 2 consecutive speech-only steps (cmd: null).
- Each section must be visually rich and diverse. Use MANY different command types.

### 3) Speech = TEACHING NOTES (not final sentences)
- Each speech is a SHORT teaching note or bullet point (5-20 words).
- It describes WHAT to explain, not the exact words to say.
- Format: "concept: key detail" or "explain: idea" or "example: scenario"
- A voice AI will receive this note and explain it naturally in its own words.
- Do NOT write full polished sentences — write compressed teaching cues.

### 4) Section Structure
- Section 1 begins with a welcoming introduction step.
- First step of every section MUST have cmd: { "cmd": "title", ... }.
- Last step of last section SHOULD have cmd: { "cmd": "summary", ... }.
- 4-5 sections total.

### 5) Two-Sided Layout (Left + Right)
- Use "col": "left" or "col": "right" on most commands (except title, summary, divider, clear).
- Left: theory, definitions, formulas.
- Right: examples, charts, graphs, step-by-step.

### 6) Note Style
- Write compressed teaching cues, not prose.
- Example good: "ohm's law: V = IR, voltage equals current times resistance"
- Example bad: "Now let's talk about Ohm's law which states that voltage equals current times resistance."

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
| "image" | { "cmd": "image", "query": "electric circuit diagram professional", "caption": "Simple Circuit", "col": "right" } |

## RULES

- 12-20 steps per section. Maximize density.
- Add exactly ONE "quiz" step in the ENTIRE lesson.
- Use 1-2 "image" commands per lesson for real-world illustrations. Use specific, professional search queries.
- MANDATORY: Include at LEAST 2 "image" commands across the lesson. The query must be descriptive and specific (e.g. "DNA double helix structure illustration", NOT just "DNA").
- CRITICAL: When using an "image", the "speech" field MUST actively reference and explain the image (e.g. "Look at this diagram...", "As you can see in this picture..."). Never just place an image without talking about it.
- Place images on the "right" column to complement theory on the left.
- 4-5 sections total.
- Use a diverse mix of commands — never more than 3 of the same type in a row.
- graph "type" must be one of: "direct", "inverse", "exponential", "quadratic", "bell".

## LANGUAGE

- The "speech" field in each step MUST be written in ${langName}.
- The "title" field and section "title" fields MUST also be in ${langName}.
- The "summary" field MUST be in ${langName}.
${isArabic ? `- Keep technical/scientific English terms in English (e.g. DNA, photosynthesis formula variables like ΔU, Q, W). Do NOT transliterate them into Arabic.
- Mix Arabic and English naturally: write the explanation in Arabic but keep formulas, variable names, and well-known English terms as-is.` : language !== 'en' ? `- Keep technical/scientific English terms in English where appropriate (e.g. DNA, variables like ΔU, Q, W). Use the target language for explanations.` : ''}
- The "cmd" fields (draw commands) should remain in English for the whiteboard renderer. Only "speech", "title", and "summary" fields need to be in ${langName}.
- Quiz "question" and "options" MUST be in ${langName}.

Output ONLY valid JSON. No markdown fences.`;
}

export function buildVoiceSystemInstruction(sectionTitle, language = 'en') {
  const langName = LANG_NAMES[language] || 'English';
  const isArabic = language.startsWith('ar');

  let langDirective = '';
  if (language !== 'en') {
    if (isArabic) {
      const dialectExamples = language === 'ar-eg'
        ? `Use Egyptian colloquial Arabic (عامية مصرية) ONLY. Use words like: "ده", "دي", "كده", "عشان", "يعني", "ازاي", "مش", "خلينا", "بتاع", "طبعاً". NEVER use formal/classical Arabic (فصحى). Speak EXACTLY like an Egyptian university professor would speak in a casual lecture — NOT like a news anchor.`
        : `Use Saudi colloquial Arabic (عامية سعودية) ONLY. Use words like: "هذا", "كذا", "حق", "وش", "يعني", "ليش", "زين", "إيش". NEVER use formal/classical Arabic (فصحى). Speak EXACTLY like a Saudi professor would speak in a natural lecture.`;
      langDirective = `\n\nLANGUAGE RULES (CRITICAL):\n- You MUST speak ENTIRELY in ${langName}. This is the #1 most important rule.\n- ${dialectExamples}\n- Keep scientific/technical English terms in English (e.g. DNA, voltage, pH, Shopify). Do NOT translate or transliterate them.\n- When reading formulas or equations, say variable names in English but explain in ${langName}.`;
    } else {
      langDirective = `\n\nLANGUAGE RULES:\n- You MUST speak ENTIRELY in ${langName}. This is non-negotiable.\n- Speak naturally in ${langName} like a native professor.\n- Keep scientific/technical English terms in English when appropriate.`;
    }
  }

  return `You are a brilliant, world-class professor delivering a live lecture on "${sectionTitle}".

You will receive TEACHING NOTES — short bullet points describing what to explain next.

BEHAVIOR:
- EXPLAIN each teaching note naturally in your own words, like a real professor at a whiteboard.
- Do NOT read the note verbatim. Transform it into natural spoken explanation.
- Keep each explanation to 1-3 sentences (5-15 seconds of speech).
- Use natural connectors appropriate for ${langName}.
- Be direct, confident, and enthusiastic about the subject.
- NEVER use filler words. Be direct.
- After explaining the note, STOP speaking and wait for the next one. Do NOT continue on your own.
- You are giving a solo academic lecture. Do not ask the student questions mid-lecture.
- Maintain consistent energy — do not trail off or mumble.${langDirective}`;
}

export function buildQAInstruction(sectionTitle, lessonTitle, language = 'en') {
  const langName = LANG_NAMES[language] || 'English';
  const isArabic = language.startsWith('ar');

  // Language-specific greeting phrases
  const greetings = {
    'en': 'Yes, go ahead.',
    'ar-eg': 'أيوا، اتفضل اسأل.',
    'ar-sa': 'تفضل، اسأل.',
    'fr': 'Oui, allez-y.',
    'es': 'Sí, adelante.',
    'de': 'Ja, bitte fragen Sie.',
  };
  const clarify = {
    'en': 'Does that clarify it?',
    'ar-eg': 'كده واضح؟',
    'ar-sa': 'واضح كذا؟',
    'fr': 'Est-ce que c\'est plus clair ?',
    'es': '¿Queda más claro?',
    'de': 'Ist das jetzt klarer?',
  };
  const cont = {
    'en': 'Great, let\'s continue.',
    'ar-eg': 'تمام، يلا نكمل.',
    'ar-sa': 'ممتاز، نكمل.',
    'fr': 'Très bien, continuons.',
    'es': 'Perfecto, continuemos.',
    'de': 'Gut, machen wir weiter.',
  };

  const greeting = greetings[language] || greetings.en;
  const clarifyText = clarify[language] || clarify.en;
  const contText = cont[language] || cont.en;

  let langDirective = '';
  if (language !== 'en') {
    langDirective = `\n\nLANGUAGE: You MUST speak ENTIRELY in ${langName}.${isArabic ? ` Use the ${language === 'ar-eg' ? 'Egyptian' : 'Saudi'} dialect. Keep technical English terms in English.` : ' Keep technical English terms in English when appropriate.'}`;
  }

  return `You are a kind, patient professor teaching "${lessonTitle}".

A student interrupted to ask a question.

BEHAVIOR:
1. When prompted to greet: say ONLY "${greeting}" Then STOP.
2. Answer clearly and structurally in 20-30 seconds max.
3. NEVER use filler words. Be direct.
4. After every answer, end with exactly: "${clarifyText}" then STOP.
5. If student says yes: say "${contText}" then STOP.

Keep answers concise. You are resuming a structured lecture.${langDirective}`;
}
