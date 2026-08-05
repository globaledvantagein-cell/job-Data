/**
 * Merge discovered German companies into the main pipeline's ATS configs.
 *
 *   node src/scripts/add-german-companies.js            # write changes
 *   node src/scripts/add-german-companies.js --dry-run  # preview only
 *
 * Reads german-companies-discovered.json, then for each ATS finds the slug
 * array inside src/company-configs/<ats>Config.js, drops anything already
 * present (case-insensitive, including commented-out entries so a previously
 * disabled company is never silently re-enabled), and appends the rest under a
 * dated "GERMAN EXPANSION" banner.
 *
 * Edits ONLY the slug arrays — never the extractor functions around them.
 * Every config gets a .bak copy before it's rewritten.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.resolve(__dirname, '../company-configs');
const IN_FILE = path.join(__dirname, 'german-companies-discovered.json');
const DRY_RUN = process.argv.includes('--dry-run');

/**
 * Where each ATS keeps its slugs. `kind` drives how a new entry is rendered:
 *   'string' → 'slug',
 *   'personio' → { subdomain: 'slug', tld: 'de' },
 *
 * workday is absent on purpose: its URLs need a per-tenant instance + site name
 * that can't be probed, so discovery never produces workday entries.
 * workable is absent too — that config queries the jobs.workable.com aggregator
 * with location=Germany and has no per-company slug array to extend.
 */
const TARGETS = {
    greenhouse:      { file: 'greenhouseConfig.js',      array: 'companyBoardTokens',  kind: 'string' },
    ashby:           { file: 'ashbyConfig.js',           array: 'companyBoardNames',   kind: 'string' },
    lever:           { file: 'leverConfig.js',           array: 'companySiteNames',    kind: 'string' },
    recruitee:       { file: 'recruiteeConfig.js',       array: 'companySubdomains',   kind: 'string' },
    smartrecruiters: { file: 'smartRecruitersConfig.js', array: 'companyIdentifiers',  kind: 'string' },
    teamtailor:      { file: 'teamtailorConfig.js',      array: 'companyBoardNames',   kind: 'string' },
    personio:        { file: 'personioConfig.js',        array: 'companyTargets',      kind: 'personio' },
};

/** Locate `arrayName`'s literal and return its [start, end] bracket offsets. */
function findArraySpan(src, arrayName) {
    const declRe = new RegExp(`${arrayName}\\s*[:=]\\s*\\[`);
    const m = declRe.exec(src);
    if (!m) return null;
    const open = src.indexOf('[', m.index);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '[') depth++;
        else if (src[i] === ']') {
            depth--;
            if (depth === 0) return { open, close: i };
        }
    }
    return null;
}

/**
 * Strip trailing `// ...` comments from each line.
 *
 * Scanning the raw body with a global quote regex is NOT safe: a single stray
 * apostrophe or quote anywhere in a comment desynchronizes the quote pairing
 * and silently swallows the entries after it. That is not hypothetical — it
 * caused this script to miss most of the SmartRecruiters array and append 20
 * duplicates on a second run. Parsing line-by-line with comments removed makes
 * the extraction independent of anything that appears in a comment.
 */
function codeLines(body) {
    return body.split('\n')
        .map(line => line.replace(/\/\/.*$/, '').trim())
        .filter(Boolean);
}

/** Every slug already in the array — including commented-out ones. */
function existingSlugs(body) {
    const found = new Set();
    // Commented-out entries count too: a company disabled on purpose must not
    // be silently re-enabled by a later discovery run.
    for (const line of body.split('\n')) {
        for (const m of line.matchAll(/'([^']+)'|"([^"]+)"/g)) {
            const slug = (m[1] || m[2] || '').trim().toLowerCase();
            if (slug) found.add(slug);
        }
    }
    return found;
}

function countActive(body, kind) {
    const live = codeLines(body).join('\n');
    if (kind === 'personio') return (live.match(/\{[^}]*\}/g) || []).length;
    const out = new Set();
    for (const m of live.matchAll(/'([^']+)'|"([^"]+)"/g)) out.add((m[1] || m[2]).toLowerCase());
    return out.size;
}

function renderEntry(hit, kind, indent) {
    if (kind === 'personio') {
        const tld = hit.tld === 'com' ? 'com' : 'de';
        return `${indent}{ subdomain: '${hit.slug}', tld: '${tld}' },`;
    }
    return `${indent}'${hit.slug}',`;
}

function main() {
    if (!fs.existsSync(IN_FILE)) {
        console.error(`No discovery results at ${IN_FILE}. Run discover-german-companies.js first.`);
        process.exit(1);
    }
    const discovered = JSON.parse(fs.readFileSync(IN_FILE, 'utf8'));
    const stamp = new Date().toISOString().slice(0, 10);

    let grandTotal = 0;
    let grandAdded = 0;
    const summary = [];

    for (const [ats, target] of Object.entries(TARGETS)) {
        const hits = Array.isArray(discovered[ats]) ? discovered[ats] : [];
        const filePath = path.join(CONFIG_DIR, target.file);
        if (!fs.existsSync(filePath)) {
            console.warn(`[Add] ${ats}: ${target.file} not found — skipped`);
            continue;
        }

        const src = fs.readFileSync(filePath, 'utf8');
        const span = findArraySpan(src, target.array);
        if (!span) {
            console.warn(`[Add] ${ats}: could not locate ${target.array}[] — skipped`);
            continue;
        }

        const body = src.slice(span.open + 1, span.close);
        const already = existingSlugs(body);
        const before = countActive(body, target.kind);

        // Dedupe against the config AND within this batch.
        const seen = new Set();
        const fresh = hits.filter(h => {
            const slug = String(h.slug || '').trim().toLowerCase();
            if (!slug || already.has(slug) || seen.has(slug)) return false;
            seen.add(slug);
            return true;
        // Highest German job count first, so the most valuable boards lead.
        }).sort((a, b) => (b.germanJobCount || 0) - (a.germanJobCount || 0));

        const after = before + fresh.length;
        grandTotal += after;
        grandAdded += fresh.length;
        summary.push({ ats, added: fresh.length, total: after });

        if (fresh.length === 0) continue;

        // Match the indentation of the array's existing entries.
        const indentMatch = body.match(/\n(\s+)\S/);
        const indent = indentMatch ? indentMatch[1] : '    ';

        const lines = [
            '',
            `${indent}// --- GERMAN EXPANSION ${stamp} ---`,
            `${indent}// Verified: board reachable AND >=1 job located in Germany.`,
            ...fresh.map(h => {
                const note = `  // ${h.germanJobCount} DE / ${h.totalJobCount} total`;
                return renderEntry(h, target.kind, indent) + note;
            }),
            '',
        ].join('\n');

        // Ensure the previous entry ends with a comma before appending.
        const head = src.slice(0, span.close);
        const trimmedHead = head.replace(/[\s,]*$/, '');
        const needsComma = /['"\}\]]$/.test(trimmedHead) && !trimmedHead.endsWith(',');
        const updated = trimmedHead + (needsComma ? ',' : '') + lines + src.slice(span.close);

        if (!DRY_RUN) {
            fs.writeFileSync(filePath + '.bak', src);
            fs.writeFileSync(filePath, updated);
        }
    }

    console.log(DRY_RUN ? '\n=== DRY RUN (nothing written) ===\n' : '\n=== Config files updated ===\n');
    for (const s of summary) {
        console.log(`Added ${String(s.added).padStart(4)} new companies to ${s.ats.padEnd(16)} (total: ${s.total})`);
    }
    console.log(`\nAdded ${grandAdded} total. Slug-array grand total across configs: ${grandTotal}`);
    console.log('Note: workday (unpredictable tenant URLs) and workable (aggregator API, no slug list) are not extendable this way.');
}

main();
