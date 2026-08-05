/**
 * Count the company slugs actually configured in each ATS config.
 *
 *   node src/scripts/count-config-companies.js
 *   node src/scripts/count-config-companies.js --dupes   # list duplicates
 *
 * The authoritative count. Naive `grep -c "'"` over a config file is wrong —
 * it picks up quoted strings from the extractor functions that surround the
 * slug array. This locates the array literal by bracket matching, ignores
 * commented-out entries, and de-duplicates case-insensitively.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.resolve(__dirname, '../company-configs');
const SHOW_DUPES = process.argv.includes('--dupes');

const TARGETS = {
    greenhouse:      ['greenhouseConfig.js',      'companyBoardTokens', 'string'],
    ashby:           ['ashbyConfig.js',           'companyBoardNames',  'string'],
    lever:           ['leverConfig.js',           'companySiteNames',   'string'],
    workday:         ['workdayConfig.js',         'companyBoards',      'object'],
    recruitee:       ['recruiteeConfig.js',       'companySubdomains',  'string'],
    personio:        ['personioConfig.js',        'companyTargets',     'object'],
    smartrecruiters: ['smartRecruitersConfig.js', 'companyIdentifiers', 'string'],
    teamtailor:      ['teamtailorConfig.js',      'companyBoardNames',  'string'],
    workable:        ['workableConfig.js',        null,                 null],
};

function arrayBody(src, key) {
    const m = new RegExp(`${key}\\s*[:=]\\s*\\[`).exec(src);
    if (!m) return null;
    const open = src.indexOf('[', m.index);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '[') depth++;
        else if (src[i] === ']') { depth--; if (depth === 0) return src.slice(open + 1, i); }
    }
    return null;
}

let total = 0;
const dupeReport = [];

for (const [ats, [file, key, kind]] of Object.entries(TARGETS)) {
    if (!key) { console.log(`${ats.padEnd(16)}    -   (aggregator API — no slug array)`); continue; }
    const filePath = path.join(CONFIG_DIR, file);
    if (!fs.existsSync(filePath)) { console.log(`${ats.padEnd(16)}    ?   (${file} missing)`); continue; }

    const body = arrayBody(fs.readFileSync(filePath, 'utf8'), key);
    if (body === null) { console.log(`${ats.padEnd(16)}    ?   (${key}[] not found)`); continue; }

    // Comments stripped per line: a stray quote in a comment would otherwise
    // desynchronize quote-pairing and corrupt the count.
    const live = body.split('\n')
        .map(l => l.replace(/\/\/.*$/, '').trim())
        .filter(Boolean);
    const commentedOut = body.split('\n').filter(l => /^\s*\/\//.test(l) && /'[^']+'/.test(l)).length;

    let entries = [];
    if (kind === 'object') {
        // { subdomain: 'x', tld: 'de' } / { company: 'x', instance: ... }
        for (const line of live) {
            const m = line.match(/\{\s*(?:subdomain|company)\s*:\s*'([^']+)'/);
            if (m) entries.push(m[1].toLowerCase());
        }
    } else {
        for (const line of live) {
            for (const m of line.matchAll(/'([^']+)'|"([^"]+)"/g)) entries.push((m[1] || m[2]).toLowerCase());
        }
    }

    const unique = new Set(entries);
    const dupes = entries.filter((s, i) => entries.indexOf(s) !== i);
    if (dupes.length) dupeReport.push({ ats, dupes: [...new Set(dupes)] });

    total += unique.size;
    const dupeNote = dupes.length ? `  ⚠ ${dupes.length} duplicate(s)` : '';
    const outNote = commentedOut ? `  (${commentedOut} commented out)` : '';
    console.log(`${ats.padEnd(16)} ${String(unique.size).padStart(4)}${outNote}${dupeNote}`);
}

console.log('='.repeat(30));
console.log(`${'GRAND TOTAL'.padEnd(16)} ${String(total).padStart(4)} unique companies`);

if (SHOW_DUPES && dupeReport.length) {
    console.log('\nDuplicates:');
    for (const r of dupeReport) console.log(`  ${r.ats}: ${r.dupes.join(', ')}`);
}
