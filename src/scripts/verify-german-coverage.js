/**
 * Re-check every company in german-companies-discovered.json against its live
 * board and report how many German jobs it actually contributes right now.
 *
 *   node src/scripts/verify-german-coverage.js
 *   node src/scripts/verify-german-coverage.js --resume
 *   node src/scripts/verify-german-coverage.js --prune   # rewrite the JSON without dead entries
 *
 * Discovery and the next scrape are separated in time, and job postings expire
 * fast — a company found on Monday can be at zero German jobs by Friday. This
 * script does the same fetch + Germany filter the scraper would (no AI, no DB
 * writes) so dead weight can be pruned before it costs a scrape cycle.
 *
 * Writes german-coverage-report.json and prints the zero-yield companies.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IN_FILE = path.join(__dirname, 'german-companies-discovered.json');
const OUT_FILE = path.join(__dirname, 'german-coverage-report.json');

const args = process.argv.slice(2);
const RESUME = args.includes('--resume');
const PRUNE = args.includes('--prune');

const CONCURRENCY = 15;
const BATCH_DELAY_MS = 50;
const REQUEST_TIMEOUT_MS = 12000;

// Same detection the discovery script uses — kept identical on purpose so a
// company can't pass one stage and fail the other for definitional reasons.
const GERMANY_TERMS = [
    'germany', 'deutschland', 'berlin', 'munich', 'münchen', 'muenchen',
    'hamburg', 'frankfurt', 'stuttgart', 'düsseldorf', 'duesseldorf', 'dusseldorf',
    'cologne', 'köln', 'koeln', 'dresden', 'leipzig', 'hannover', 'hanover',
    'nuremberg', 'nürnberg', 'nuernberg', 'dortmund', 'essen', 'bremen',
    'heidelberg', 'karlsruhe', 'mannheim', 'bonn', 'aachen', 'potsdam',
    'wolfsburg', 'ingolstadt', 'darmstadt', 'freiburg', 'münster', 'muenster',
    'augsburg', 'bielefeld', 'bochum', 'wiesbaden', 'mainz', 'erlangen',
    'regensburg', 'ulm', 'kiel', 'jena', 'walldorf', 'dach',
];
const GERMANY_RE = new RegExp(`\\b(${GERMANY_TERMS.join('|')})\\b`, 'i');
const DE_CODE_RE = /(^|[\s,(\/|-])DE([\s,)\/|-]|$)/;
const isGermanLocation = t => !!t && (GERMANY_RE.test(String(t)) || DE_CODE_RE.test(String(t)));

async function getJson(url) {
    try {
        const res = await fetch(url, {
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EJG-Verify/1.0)', 'Accept': 'application/json' },
            redirect: 'follow',
        });
        if (!res.ok) return null;
        const text = await res.text();
        if (!text || text.trim().startsWith('<')) return null;
        return JSON.parse(text);
    } catch { return null; }
}

async function getText(url) {
    try {
        const res = await fetch(url, {
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EJG-Verify/1.0)' },
            redirect: 'follow',
        });
        return res.ok ? await res.text() : null;
    } catch { return null; }
}

/** ats → fetch the board and return the list of job location strings (or null). */
const FETCHERS = {
    async greenhouse(slug) {
        const d = await getJson(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`);
        return Array.isArray(d?.jobs) ? d.jobs.map(j => j?.location?.name || '') : null;
    },
    async ashby(slug) {
        const d = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${slug}`);
        return Array.isArray(d?.jobs) ? d.jobs.map(j => j?.location || j?.locationName || '') : null;
    },
    async lever(slug) {
        const d = await getJson(`https://api.lever.co/v0/postings/${slug}?mode=json`);
        return Array.isArray(d) ? d.map(j => j?.categories?.location || '') : null;
    },
    async smartrecruiters(slug) {
        const d = await getJson(`https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100`);
        return Array.isArray(d?.content)
            ? d.content.map(j => [j?.location?.city, j?.location?.region, j?.location?.country].filter(Boolean).join(', '))
            : null;
    },
    async workable(slug) {
        const d = await getJson(`https://apply.workable.com/api/v1/widget/accounts/${slug}?details=true`);
        return Array.isArray(d?.jobs) ? d.jobs.map(j => j?.location || '') : null;
    },
    async recruitee(slug) {
        const d = await getJson(`https://${slug}.recruitee.com/api/offers/`);
        return Array.isArray(d?.offers) ? d.offers.map(j => j?.location || [j?.city, j?.country].filter(Boolean).join(', ')) : null;
    },
    async personio(slug, entry) {
        const xml = await getText(`https://${slug}.jobs.personio.${entry?.tld || 'de'}/xml`);
        if (!xml) return null;
        return [...xml.matchAll(/<(?:office|city|location)>([\s\S]*?)<\/(?:office|city|location)>/gi)]
            .map(m => m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim());
    },
    // JSON Feed: postings under `items`, location under the schema.org
    // `_jobposting.jobLocation` ARRAY. See the note in the discovery script.
    async teamtailor(slug) {
        const d = await getJson(`https://${slug}.teamtailor.com/jobs.json`);
        const items = d?.items || (Array.isArray(d) ? d : d?.jobs);
        if (!Array.isArray(items)) return null;
        const out = [];
        for (const item of items) {
            const places = item?._jobposting?.jobLocation;
            for (const place of (Array.isArray(places) ? places : [places]).filter(Boolean)) {
                const a = place.address || {};
                out.push([a.addressLocality, a.addressRegion, a.addressCountry].filter(Boolean).join(', '));
            }
        }
        return out;
    },
};

let stopping = false;
const report = { verified: [], zeroYield: [], unreachable: [], stats: {} };

function save() {
    report.stats = {
        verified: report.verified.length,
        zeroYield: report.zeroYield.length,
        unreachable: report.unreachable.length,
        timestamp: new Date().toISOString(),
    };
    fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2));
}

async function runConcurrent(items, worker, onBatch) {
    for (let i = 0; i < items.length; i += CONCURRENCY) {
        if (stopping) break;
        await Promise.all(items.slice(i, i + CONCURRENCY).map(it => worker(it).catch(() => null)));
        if (onBatch) onBatch(Math.min(i + CONCURRENCY, items.length), items.length);
        if (i + CONCURRENCY < items.length) await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
}

async function main() {
    if (!fs.existsSync(IN_FILE)) {
        console.error(`No discovery results at ${IN_FILE}. Run discover-german-companies.js first.`);
        process.exit(1);
    }
    const discovered = JSON.parse(fs.readFileSync(IN_FILE, 'utf8'));

    let done = new Set();
    if (RESUME && fs.existsSync(OUT_FILE)) {
        const prev = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
        for (const key of ['verified', 'zeroYield', 'unreachable']) {
            if (Array.isArray(prev[key])) {
                report[key] = prev[key];
                prev[key].forEach(e => done.add(`${e.ats}:${e.slug}`));
            }
        }
        console.log(`[Verify] --resume: ${done.size} already checked`);
    }

    const queue = [];
    for (const [ats, list] of Object.entries(discovered)) {
        if (!FETCHERS[ats] || !Array.isArray(list)) continue;
        for (const entry of list) {
            if (entry?.slug && !done.has(`${ats}:${entry.slug}`)) queue.push({ ats, entry });
        }
    }
    console.log(`[Verify] Re-checking ${queue.length} companies...\n`);

    await runConcurrent(queue, async ({ ats, entry }) => {
        const locations = await FETCHERS[ats](entry.slug, entry);
        if (locations === null) {
            report.unreachable.push({ ats, slug: entry.slug, discoveredGermanJobs: entry.germanJobCount });
            return;
        }
        const german = locations.filter(isGermanLocation);
        const row = {
            ats, slug: entry.slug,
            germanJobCount: german.length,
            totalJobCount: locations.length,
            discoveredGermanJobs: entry.germanJobCount,
            sampleLocations: [...new Set(german)].slice(0, 3),
        };
        (german.length > 0 ? report.verified : report.zeroYield).push(row);
    }, (n, total) => {
        if (n % 150 === 0 || n === total) {
            process.stdout.write(`\r[Verify] ${n}/${total} checked — ${report.verified.length} still have German jobs   `);
        }
    });

    save();

    const totalChecked = report.verified.length + report.zeroYield.length + report.unreachable.length;
    console.log(`\n\n=== Coverage report ===`);
    console.log(`Still yielding German jobs : ${report.verified.length}`);
    console.log(`Now zero German jobs       : ${report.zeroYield.length}`);
    console.log(`Board unreachable          : ${report.unreachable.length}`);
    console.log(`Checked                    : ${totalChecked}`);

    const totalDeJobs = report.verified.reduce((n, r) => n + r.germanJobCount, 0);
    console.log(`German jobs across verified companies: ${totalDeJobs}`);

    const top = [...report.verified].sort((a, b) => b.germanJobCount - a.germanJobCount).slice(0, 15);
    if (top.length) {
        console.log('\nTop contributors:');
        for (const r of top) console.log(`  ${String(r.germanJobCount).padStart(4)} DE  ${r.ats.padEnd(16)} ${r.slug}`);
    }

    const dead = [...report.zeroYield, ...report.unreachable];
    if (dead.length) {
        console.log(`\nZero-yield / unreachable (${dead.length}) — safe to prune:`);
        for (const r of dead.slice(0, 40)) console.log(`  ${r.ats.padEnd(16)} ${r.slug}`);
        if (dead.length > 40) console.log(`  ...and ${dead.length - 40} more (see ${path.basename(OUT_FILE)})`);
    }

    if (PRUNE) {
        const keep = new Set(report.verified.map(r => `${r.ats}:${r.slug}`));
        const pruned = { ...discovered };
        for (const ats of Object.keys(FETCHERS)) {
            if (Array.isArray(pruned[ats])) pruned[ats] = pruned[ats].filter(e => keep.has(`${ats}:${e.slug}`));
        }
        fs.writeFileSync(IN_FILE + '.bak', JSON.stringify(discovered, null, 2));
        fs.writeFileSync(IN_FILE, JSON.stringify(pruned, null, 2));
        console.log(`\n[Verify] --prune: rewrote ${path.basename(IN_FILE)} with only verified companies.`);
    }

    console.log(`\nReport: ${OUT_FILE}`);
}

process.on('SIGINT', () => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log('\n[Verify] Ctrl+C — saving progress (re-run with --resume)...');
    save();
    setTimeout(() => process.exit(0), 300);
});

main().catch(err => { console.error('[Verify] Fatal:', err); save(); process.exit(1); });
