// ─── Title-Based German Detection (skips AI entirely) ────────────────────────
// If the job TITLE already says "German Speaking" or similar, we reject immediately
// without calling the AI. Saves tokens, cost, and ~2 seconds per job.
//
// Returns { matched: true, phrase: "..." } or null
//

export const GERMAN_TITLE_PATTERNS = [
    // English patterns
    /\bgerman[\s-]*speak(?:ing|er)\b/i,          // "German Speaking", "German-speaking", "German Speaker"
    /\bgerman[\s-]*fluent\b/i,                    // "German fluent"
    /\bfluent[\s-]*german\b/i,                    // "Fluent German"
    /\bgerman[\s-]*native\b/i,                    // "German native"
    /\bnative[\s-]*german\b/i,                    // "Native German"
    /\bgerman[\s-]*(?:required|mandatory)\b/i,    // "German required", "German mandatory"
    /\bgerman[\s-]*(?:c[12]|b[12])\b/i,           // "German C1", "German B2"
    /\b(?:c[12]|b[12])[\s-]*german\b/i,           // "C1 German", "B2 German"

    // German-language patterns in titles
    /\bdeutschsprachig(?:e[rn]?)?\b/i,            // "Deutschsprachig", "Deutschsprachiger"
    /\bmuttersprachler(?:in)?\b/i,                // "Muttersprachler", "Muttersprachlerin"
    /\bflie[ßs]end[\s-]*deutsch\b/i,              // "fließend Deutsch", "fliessend Deutsch"
    /\bdeutschkenntnisse\b/i,                     // "Deutschkenntnisse"
];

export function detectGermanRequiredFromTitle(title) {
    if (!title) return null;
    const titleStr = String(title);

    for (const pattern of GERMAN_TITLE_PATTERNS) {
        const match = titleStr.match(pattern);
        if (match) {
            return { matched: true, phrase: match[0] };
        }
    }
    return null;
}
