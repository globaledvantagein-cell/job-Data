/**
 * Pre-AI rejection helper. The processJob() pipeline has 4 different
 * pre-AI filter stages (title-German, non-English description,
 * citizenship requirement, other-language required). All of them save
 * a "rejected" test log with the same shape — only the rejection reason
 * and evidence text differ. This helper deduplicates that pattern.
 *
 * Behavior is byte-for-byte identical to the inline code that used to
 * live in processJob.js. Only the structure changed.
 */
import { createJobTestLog } from '../../models/jobTestLogModel.js';
import { saveJobTestLog } from '../../db/index.js';
import { generateJobFingerprint } from '../../utils.js';
import { deriveDomain } from '../jobExtractor.js';

/**
 * Save a "rejected pre-AI" test log entry and log a console message.
 *
 * @param {object} mappedJob       — current mapped job
 * @param {object} siteConfig      — site config (needed for siteName)
 * @param {object} args
 * @param {boolean} args.germanRequired   — flag to store on the test log
 * @param {string}  args.evidence         — text stored under Evidence.german_reason
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

    const testLogData = {
        ...mappedJob,
        GermanRequired: germanRequired,
        Domain: deriveDomain(mappedJob.Department, mappedJob.JobTitle),
        SubDomain: mappedJob.Department || 'Other',
        ConfidenceScore: 1.0,
        Evidence: { german_reason: evidence },
        FinalDecision: 'rejected',
        RejectionReason: rejectionReason,
        Status: 'rejected',
        fingerprint,
    };

    const jobTestLog = createJobTestLog(testLogData, siteConfig.siteName);
    await saveJobTestLog(jobTestLog);
    console.log(`📝 [Test Log] Saved rejected job: ${mappedJob.JobTitle}`);
}
