// ─── Pre-AI Citizenship / Nationality Detection ──────────────────────────────
// "German citizenship is mandatory" is NOT a language requirement — the AI
// correctly returns german_required=false. But the job should still be rejected
// because it excludes most of our international audience.
//
// Returns { matched: true, phrase: "..." } or null
//

export const CITIZENSHIP_PATTERNS = [
    // English — German citizenship
    /\bgerman\s+(?:citizenship|nationality)\s+(?:is\s+)?(?:required|mandatory|essential|necessary|needed)\b/i,
    /\b(?:require[sd]?|must\s+have|must\s+hold|must\s+possess)\s+german\s+(?:citizenship|nationality)\b/i,
    /\bmust\s+be\s+a\s+german\s+citizen\b/i,
    /\bgerman\s+(?:citizen|national)\s+(?:only|required)\b/i,
    /\b(?:no|not)\s+dual\s+citizenship\b/i,
    /\bdual\s+citizenship\s+(?:is\s+)?not\s+(?:allowed|accepted|permitted)\b/i,

    // English — EU/EEA citizenship (still excludes non-EU internationals)
    /\b(?:eu|eea)\s+(?:citizenship|nationality|work\s+(?:permit|authorization))\s+(?:is\s+)?(?:required|mandatory|essential)\b/i,
    /\b(?:require[sd]?|must\s+have|must\s+hold)\s+(?:eu|eea)\s+(?:citizenship|nationality)\b/i,
    /\bmust\s+be\s+(?:an?\s+)?(?:eu|eea)\s+(?:citizen|national|resident)\b/i,

    // German language — citizenship/nationality
    /\bStaatsbürgerschaft\s+erforderlich\b/i,
    /\bdeutsche\s+Staats(?:bürgerschaft|angehörigkeit)\b/i,
    /\bdeutsche[rn]?\s+(?:Pass|Ausweis)\s+erforderlich\b/i,
];

export function detectCitizenshipRequirement(description) {
    if (!description) return null;
    const text = String(description);

    for (const pattern of CITIZENSHIP_PATTERNS) {
        const match = text.match(pattern);
        if (match) {
            return { matched: true, phrase: match[0] };
        }
    }
    return null;
}
