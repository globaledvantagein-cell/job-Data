// ─── Pre-AI Non-English Description Detection ────────────────────────────────
// Catches obviously non-English descriptions (fully French, Spanish, etc.)
// BEFORE calling the AI. Saves tokens for clear-cut cases like SumUp France x7.
//
// Strategy: count high-frequency French/Spanish/Italian/Dutch words in the
// first 600 chars. If they exceed a threshold → it's not English.
// Conservative: only catches descriptions that are CLEARLY non-English.
//

export const NON_ENGLISH_MARKERS = {
    french: [
        // Words that almost never appear in English job descriptions
        'nous', 'vous', 'sont', 'avec', 'pour', 'dans', 'votre', 'notre',
        'être', 'avoir', 'cette', 'aussi', 'mais', 'chez', 'depuis',
        'toutes', 'leurs', 'comme', 'après', 'entre', 'fait', 'très',
        'peut', 'plus', 'tout', 'elle', 'aux', 'ces', 'ses', 'une',
        'des', 'les', 'sur', 'par', 'qui', 'que', 'est', 'ont',
    ],
    spanish: [
        'para', 'como', 'está', 'tiene', 'puede', 'todos', 'esta',
        'desde', 'cuando', 'entre', 'donde', 'hacia', 'según', 'sobre',
        'nuestro', 'nuestra', 'también', 'porque', 'empresa', 'trabajo',
    ],
    dutch: [
        'voor', 'zijn', 'worden', 'naar', 'hebben', 'onze', 'deze',
        'maar', 'ook', 'niet', 'bij', 'jouw', 'jij', 'wij', 'ons',
    ],
    italian: [
        'sono', 'della', 'questo', 'anche', 'essere', 'questo',
        'nella', 'delle', 'nostro', 'nostra', 'lavoro', 'ogni',
    ],
    polish: [
        'jest', 'oraz', 'jako', 'przez', 'będzie', 'które', 'więcej',
        'nasz', 'pracy', 'może', 'tylko', 'jeśli', 'bardzo',
    ],
};

export function detectNonEnglishDescription(description) {
    if (!description || description.length < 100) return null;

    const sample = description.substring(0, 600).toLowerCase();
    const words = sample.split(/\s+/);
    if (words.length < 20) return null;

    for (const [language, markers] of Object.entries(NON_ENGLISH_MARKERS)) {
        let hits = 0;
        for (const marker of markers) {
            // Match whole words only
            const regex = new RegExp(`\\b${marker}\\b`, 'g');
            const matches = sample.match(regex);
            if (matches) hits += matches.length;
        }
        // If >15% of words in the sample are non-English markers → flag it
        const ratio = hits / words.length;
        if (ratio > 0.15) {
            return { language, ratio: Math.round(ratio * 100) };
        }
    }
    return null;
}
