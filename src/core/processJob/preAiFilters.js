/**
 * Pre-AI rejection helper. The processJob() pipeline has 4 different
 * pre-AI filter stages (title-German, non-English description,
 * citizenship requirement, other-language required). All of them record
 * the same "rejected" verdict — only the rejection reason and evidence
 * text differ. This helper deduplicates that pattern.
 *
 * The verdict goes to the lean aiResultCache (fingerprint + 4 fields), not
 * the old jobTestLogs copy of the entire job.
 */
import { saveAiResult } from '../../cache/aiResultCache.js';
import { generateJobFingerprint } from '../../utils.js';
import { deriveDomain } from '../jobExtractor.js';

/**
 * Save a "rejected pre-AI" test log entry and log a console message.
 *
 * @param {object} mappedJob       — current mapped job
 * @param {object} siteConfig      — site config (kept for call-site symmetry)
 * @param {object} args
 * @param {boolean} args.germanRequired   — verdict to cache
 * @param {string}  args.evidence         — human-readable reason, logged only
 * @param {string}  args.rejectionReason  — short reason string
 * @param {string}  args.logLabel         — label for the console line ("Title Reject", etc.)
 * @param {string}  args.logSuffix        — short tail of the console log
 */
export async function rejectPreAi(mappedJob, siteConfig, {
    germanRequired,
    evidence,
    rejectionReason,
    logLabel,
    logSuffix,
}) {
    console.log(`${logLabel} "${mappedJob.JobTitle}" — ${logSuffix} — skipping AI`);

    const fingerprint = generateJobFingerprint(
        mappedJob.JobTitle,
        mappedJob.Company,
        mappedJob.Description,
    );

    // Confidence 1.0: a pre-AI filter matched a literal phrase, so there is no
    // model uncertainty to record. `evidence` and `rejectionReason` are console
    // output only now — the lean cache stores the verdict, not the paper trail.
    await saveAiResult({
        fingerprint,
        germanRequired,
        confidence: 1.0,
        domain: deriveDomain(mappedJob.Department, mappedJob.JobTitle),
        subDomain: mappedJob.Department || 'Other',
    });
    console.log(`📝 [AI Cache] Stored pre-AI rejection (${rejectionReason}): ${mappedJob.JobTitle} — ${evidence}`);
}
