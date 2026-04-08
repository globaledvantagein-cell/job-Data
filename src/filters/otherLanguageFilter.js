// ─── Pre-AI Other Language Requirement Detection ─────────────────────────────
// "Dutch C2 required" / "French native speaker" / "fluent in Polish"
// These are NOT English-language jobs even if they're in Berlin.
// Catches Jobs 32, 33, 143, 165 from the report.
//
// Returns { matched: true, language: "...", phrase: "..." } or null
//

export const OTHER_LANGUAGES = [
    'french', 'dutch', 'polish', 'turkish', 'spanish', 'italian',
    'portuguese', 'czech', 'hungarian', 'romanian', 'danish',
    'swedish', 'norwegian', 'finnish', 'greek', 'arabic',
    'russian', 'ukrainian', 'japanese', 'chinese', 'mandarin',
    'cantonese', 'korean', 'hindi', 'hebrew',
];

export const OTHER_LANG_PATTERNS = OTHER_LANGUAGES.map(lang => ({
    language: lang,
    patterns: [
        new RegExp(`\\b(?:fluent|fluency|native|proficient|proficiency)\\s+(?:in\\s+)?${lang}\\b`, 'i'),
        new RegExp(`\\b${lang}\\s+(?:required|mandatory|essential|fluent|native|proficiency)\\b`, 'i'),
        new RegExp(`\\b${lang}\\s+(?:c[12]|b2)\\b`, 'i'),
        new RegExp(`\\b(?:c[12]|b2)\\s+(?:level\\s+)?(?:in\\s+)?${lang}\\b`, 'i'),
        new RegExp(`\\b${lang}\\s+(?:native\\s+)?speaker\\b`, 'i'),
        new RegExp(`\\bnative[\\s-]+(?:level\\s+)?${lang}\\b`, 'i'),
    ],
}));

export function detectOtherLanguageRequired(description) {
    if (!description) return null;
    const text = String(description);

    for (const { language, patterns } of OTHER_LANG_PATTERNS) {
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                return { matched: true, language, phrase: match[0] };
            }
        }
    }
    return null;
}
