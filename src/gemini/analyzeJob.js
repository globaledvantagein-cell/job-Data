import { buildDescriptionSnippet } from './snippetExtractor.js';
import { callGeminiWithCascade } from './geminiClient.js';

// ─── Main AI Analyzer ─────────────────────────────────────────────────────────

/**
 * Analyzes a job description for German language requirements.
 *
 * The model is chosen by the client's cascade — best tier that still has daily
 * budget, dropping down as tiers are spent. No model is named here.
 * Function name kept as analyzeJobWithGroq for backward compatibility.
 *
 * Key selection, rotation, cooldowns and retries all live in the shared
 * src/gemini/geminiClient.js + keyManager.js pair, so this analyzer and Smart
 * Match draw from the same coordinated key pool.
 */
export async function analyzeJobWithGroq(jobTitle, description) {
    if (!description || description.length < 50) return null;

    // ── Build the prompt snippet ──────────────────────────────────────────────
    const descriptionSnippet = buildDescriptionSnippet(description);

    const prompt = `Analyze this job posting. Is German language REQUIRED?

${descriptionSnippet}

german_required = true if the description contains ANY of these:
- fluent/fluency in German, fluent German, German (fluent), fluent/native in German
- German required/mandatory/essential, German is essential
- German native speaker, native-level German, native German level
- Muttersprachler, Muttersprachlerin
- any CEFR German level: A1, A2, B1, B2, C1, C2 (including "B2+", "min. B1", "C1/C2")
- Deutschkenntnisse, exzellente Deutschkenntnisse, Verhandlungssicheres Deutsch, Verhandlungssichere Deutschkenntnisse
- fließend Deutsch, fließend Deutsch und Englisch, Du sprichst fließend Deutsch
- communication in German and English, communication skills in German
- German language proficiency, proficient in German, strong proficiency in German
- good German language skills, good English and German language skills
- entire text is written in German, or more than 40% of the text is German sentences

IMPORTANT — OR-conditions: If German is listed as one option among alternatives (e.g. "German or French", "either German or Dutch", "fluency in German or another European language"), STILL set german_required = true. For jobs in Germany, being able to substitute another language does not remove the German requirement.

IMPORTANT — Bilingual descriptions: If the description mixes German and English text, and the German portions contain language requirements (e.g. "Du verfügst über Deutschkenntnisse"), set german_required = true. Do NOT ignore German-language sections.

IMPORTANT — Conditional headings: If German fluency appears under "You'll thrive if", "Nice to have", "Great if you have", or "Preferred" BUT the fluency level is C1/C2/native AND the role's core function requires German (e.g. selling to German customers, managing German accounts, coaching German workers), set german_required = true.

german_required = false ONLY if: German is not mentioned at all, OR German appears only as a country/region name (not a language), OR German is listed as genuinely optional with no specific level (e.g. "German is a plus" without any CEFR level).

evidence.german_reason: If german_required=true, copy the exact phrase from the text. If false: "No German language requirement found in description"

Return ONLY this JSON, no other text:
{"german_required":bool,"confidence":0.0-1.0,"evidence":{"german_reason":"exact quote"}}`;

    try {
        const { content } = await callGeminiWithCascade({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            label: String(jobTitle).substring(0, 30),
            generationConfig: { temperature: 0 },
        });

        if (!content) throw new Error('Empty response from Gemini');

        const data = JSON.parse(content);

        const normalizedData = {
            german_required: data.german_required === true || data.german_required === "true",
            domain: "Unclear",
            sub_domain: "Other",
            confidence: Number(data.confidence) || 0,
            evidence: data.evidence || { german_reason: "No reason provided" },
        };

        console.log(`[AI] ✅ ${String(jobTitle).substring(0, 30)}... | GermanReq: ${normalizedData.german_required} | Conf: ${normalizedData.confidence}`);
        return normalizedData;

    } catch (err) {
        console.warn(`[AI] Analysis failed for "${String(jobTitle).substring(0, 40)}": ${err?.message || err}`);
        return null;
    }
}

export async function isGermanRequired(description, jobTitle) {
    const result = await analyzeJobWithGroq(jobTitle, description);
    return result ? result.german_required : true;
}
