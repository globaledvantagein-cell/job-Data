/**
 * Discover companies with at least one job LOCATED IN GERMANY, across the ATS
 * platforms the main scraper supports.
 *
 *   node src/scripts/discover-german-companies.js               # core variants (fast)
 *   node src/scripts/discover-german-companies.js --full        # all variants (mop-up)
 *   node src/scripts/discover-german-companies.js --no-dict     # skip the wordlist
 *   node src/scripts/discover-german-companies.js --retry-empty # re-check 0-job boards
 *   node src/scripts/discover-german-companies.js --only=greenhouse,ashby
 *
 * Germany is the ONLY filter that matters here: a job must be located in
 * Germany. Where the company is headquartered is irrelevant — a US company
 * hiring in Berlin counts, a German company hiring only in Austria does not.
 *
 * ── Method ────────────────────────────────────────────────────────────────
 * 1. Candidate pool from four sources (see buildCandidates):
 *      curated names · Y Combinator API · English wordlist · verified seeds
 * 2. Two-stage probe: cheap HEAD existence check, then GET to read jobs.
 *      A 200 does NOT mean the board is worth keeping — boards with 0 jobs
 *      are recorded as 'empty' so they never cost a request again.
 * 3. probed-cache.json remembers every dead/empty slug, so growing the corpus
 *      only ever costs the NEW candidates.
 *
 * ── HEAD safety (verified with one real + one fake slug per platform) ─────
 *   greenhouse / ashby / lever / recruitee → HEAD 200 vs 404: safe
 *   smartrecruiters → returns 200 for a NONSENSE slug on both HEAD and GET.
 *      Status codes carry no signal; only the body's `content` array does.
 *   teamtailor → GET only, per field experience of HEAD rejecting live boards.
 *   personio → XML feed, GET only.
 * Re-run that check before trusting any new platform. It is the single
 * cheapest way to avoid a run that is silently 100% wrong.
 *
 * No new dependencies: global fetch + AbortSignal.timeout (Node 18+).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { allCandidateNames } from './german-company-candidates.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// When --only names exactly ONE platform the run gets its own state + cache
// files, so several single-platform processes can run in parallel without
// clobbering each other's writes. merge-discovered-slugs.js folds the shards
// back into the main file. (Two processes sharing one JSON silently destroys
// results — the second saver overwrites the first's findings.)
const SHARD = (() => {
    const f = process.argv.slice(2).find(a => a.startsWith('--only='));
    if (!f) return null;
    const list = f.split('=')[1].split(',').map(s => s.trim()).filter(Boolean);
    return list.length === 1 ? list[0] : null;
})();
const OUT_FILE = path.join(__dirname, SHARD ? `german-companies-${SHARD}.json` : 'german-companies-discovered.json');
const CACHE_FILE = path.join(__dirname, SHARD ? `probed-cache-${SHARD}.json` : 'probed-cache.json');
const YC_CACHE_FILE = path.join(__dirname, 'yc-companies.json');
const REMOTE_SCRAPER_DIR = path.resolve(__dirname, '../../../ejg-remote-scraper');
const CONFIG_DIR = path.resolve(__dirname, '../company-configs');

const YC_URL = 'https://yc-oss.github.io/api/companies/all.json';
// Populated by loadYCNames(): real slugs/domains probed verbatim, never through
// the variant generator.
let ycVerbatimSlugs = [];
const WORDLIST_URL = 'https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-usa.txt';
const DE_WORDLIST_URL = 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/de/de_50k.txt';

// ── Flags ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const FULL_VARIANTS = args.includes('--full');
const NO_DICT = args.includes('--no-dict');
const NO_YC = args.includes('--no-yc');
const RETRY_EMPTY = args.includes('--retry-empty');
const ONLY = (() => {
    const f = args.find(a => a.startsWith('--only='));
    return f ? f.split('=')[1].split(',').map(s => s.trim()) : null;
})();

// Per-process worker count. 15 is a safe default against a single API, but
// Personio in particular is latency-bound rather than throughput-bound (two
// sequential URLs per candidate, each up to a 20s timeout), so a much higher
// worker count there costs the API little and cuts wall-clock enormously.
// Different platforms are different hosts, so raising this on one shard does
// not add load to any other.
const CONCURRENCY = (() => {
    const f = process.argv.slice(2).find(a => a.startsWith('--concurrency='));
    const n = f ? parseInt(f.split('=')[1], 10) : 15;
    return Number.isFinite(n) && n > 0 && n <= 100 ? n : 15;
})();
const BATCH_DELAY_MS = 50;
const PROGRESS_EVERY = 100;

// ── Germany detection ───────────────────────────────────────────────────────
// Word-boundary matched: naive substring checks fire on "Denver" (DE),
// "Delicatessen" (Essen), "New Berlin, WI".
const GERMANY_TERMS = [
    'germany', 'deutschland', 'berlin', 'munich', 'münchen', 'muenchen',
    'hamburg', 'frankfurt', 'stuttgart', 'düsseldorf', 'duesseldorf', 'dusseldorf',
    'cologne', 'köln', 'koeln', 'dresden', 'leipzig', 'hannover', 'hanover',
    'nuremberg', 'nürnberg', 'nuernberg', 'dortmund', 'essen', 'bremen',
    'heidelberg', 'karlsruhe', 'mannheim', 'bonn', 'aachen', 'potsdam',
    'wolfsburg', 'ingolstadt', 'darmstadt', 'freiburg', 'münster', 'muenster',
    'augsburg', 'bielefeld', 'bochum', 'wiesbaden', 'mainz', 'erlangen',
    'regensburg', 'ulm', 'kiel', 'jena', 'walldorf',
];
const GERMANY_RE = new RegExp(`\\b(${GERMANY_TERMS.join('|')})\\b`, 'i');
const DE_CODE_RE = /(^|[\s,(\/|-])DE([\s,)\/|-]|$)/;
// DACH is deliberately excluded: it covers AT and CH too, so it cannot prove a
// job is in Germany. Strictly-Germany is the whole point of this pipeline.
const isGermanLocation = t => !!t && (GERMANY_RE.test(String(t)) || DE_CODE_RE.test(String(t)));

// ── HTTP ────────────────────────────────────────────────────────────────────
const UA = 'Mozilla/5.0 (compatible; EJG-Discovery/2.0)';

async function head(url, timeoutMs) {
    try {
        const res = await fetch(url, {
            method: 'HEAD', signal: AbortSignal.timeout(timeoutMs),
            headers: { 'User-Agent': UA }, redirect: 'follow',
        });
        return res.status;
    } catch { return 0; }
}

/**
 * @param {boolean} redirectIsDead  Treat any 3xx as "board does not exist" and
 *   return null without following it. Personio needs this: a non-existent
 *   subdomain answers 307 to a marketing page rather than failing DNS, so with
 *   redirect:'follow' every dead candidate cost a full page fetch, failed the
 *   <position> check, and then repeated the whole thing against the .com TLD —
 *   ~4s and 2 requests to learn nothing. Reading the 307 directly makes a dead
 *   candidate a single ~1.8s request.
 */
async function getBody(url, timeoutMs, redirectIsDead = false) {
    try {
        const res = await fetch(url, {
            signal: AbortSignal.timeout(timeoutMs),
            headers: { 'User-Agent': UA, 'Accept': 'application/json,text/xml,*/*' },
            redirect: redirectIsDead ? 'manual' : 'follow',
        });
        if (redirectIsDead && res.status >= 300 && res.status < 400) return null;
        if (!res.ok) return null;
        return await res.text();
    } catch { return null; }
}

function parseJson(text) {
    if (!text || text.trim().startsWith('<')) return null;
    try { return JSON.parse(text); } catch { return null; }
}

/** Counter-based semaphore: N workers sharing one cursor. */
async function runConcurrent(items, worker, onTick) {
    let cursor = 0, done = 0;
    const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
        while (cursor < items.length && !stopping) {
            const item = items[cursor++];
            try { await worker(item); } catch { /* one bad probe never kills the run */ }
            done++;
            if (onTick && done % 300 === 0) onTick(done, items.length);
            if (BATCH_DELAY_MS) await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
        }
    });
    await Promise.all(runners);
    if (onTick) onTick(done, items.length);
}

// ── Platform table ──────────────────────────────────────────────────────────
// headSafe:false means the status code is meaningless — go straight to GET and
// judge on the body. timeout is per-platform: Recruitee legitimately answers in
// 3–18s, so a 15s ceiling aborts live boards and reports them as dead.
const PLATFORMS = {
    greenhouse: {
        headSafe: true, timeout: 15000,
        url: s => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`,
        locations: text => {
            const jobs = parseJson(text)?.jobs;
            return Array.isArray(jobs) ? jobs.map(j => j?.location?.name || '') : null;
        },
    },
    ashby: {
        headSafe: true, timeout: 15000,
        url: s => `https://api.ashbyhq.com/posting-api/job-board/${s}`,
        locations: text => {
            const jobs = parseJson(text)?.jobs;
            return Array.isArray(jobs) ? jobs.map(j => j?.location || j?.locationName || '') : null;
        },
    },
    lever: {
        headSafe: true, timeout: 15000,
        url: s => `https://api.lever.co/v0/postings/${s}?mode=json`,
        locations: text => {
            const d = parseJson(text);
            return Array.isArray(d) ? d.map(j => j?.categories?.location || '') : null;
        },
    },
    recruitee: {
        headSafe: true, timeout: 30000, // 3–18s responses are normal here
        url: s => `https://${s}.recruitee.com/api/offers/`,
        locations: text => {
            const offers = parseJson(text)?.offers;
            return Array.isArray(offers)
                ? offers.map(o => o?.location || [o?.city, o?.country].filter(Boolean).join(', '))
                : null;
        },
    },
    smartrecruiters: {
        // A nonsense slug returns HTTP 200 on HEAD *and* GET. Only `content` tells the truth.
        headSafe: false, timeout: 15000,
        url: s => `https://api.smartrecruiters.com/v1/companies/${s}/postings?limit=100`,
        locations: text => {
            const content = parseJson(text)?.content;
            if (!Array.isArray(content)) return null;
            return content.map(j => {
                const l = j?.location || {};
                return [l.city, l.region, l.country].filter(Boolean).join(', ');
            });
        },
    },
    teamtailor: {
        headSafe: false, timeout: 15000,
        url: s => `https://${s}.teamtailor.com/jobs.json`,
        // JSON Feed: postings under `items`; location under the schema.org
        // `_jobposting.jobLocation` ARRAY (not an object — reading `.address`
        // straight off it yields undefined for every job).
        locations: text => {
            const d = parseJson(text);
            const items = d?.items || (Array.isArray(d) ? d : d?.jobs);
            if (!Array.isArray(items)) return null;
            const out = [];
            for (const item of items) {
                const places = item?._jobposting?.jobLocation;
                for (const p of (Array.isArray(places) ? places : [places]).filter(Boolean)) {
                    const a = p.address || {};
                    out.push([a.addressLocality, a.addressRegion, a.addressCountry].filter(Boolean).join(', '));
                }
            }
            return out;
        },
    },
    personio: {
        // German-native ATS — the highest-value platform for this pipeline.
        // XML, not JSON; each posting is a <position> block.
        headSafe: false, timeout: 20000, multiUrl: true, redirectIsDead: true,
        urls: s => [`https://${s}.jobs.personio.de/xml`, `https://${s}.jobs.personio.com/xml`],
        locations: text => {
            if (!text || !text.includes('<position')) return null;
            return [...text.matchAll(/<(?:office|city|location)>([\s\S]*?)<\/(?:office|city|location)>/gi)]
                .map(m => m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim());
        },
    },
};
const ALL_ATS = Object.keys(PLATFORMS);

// ── Probe cache ─────────────────────────────────────────────────────────────
// { platform: { slug: 'dead' | 'empty' | 'hit' } }
let cache = {};
function loadCache() {
    // A fresh shard inherits the main cache, otherwise it would re-probe every
    // slug the shared runs already ruled out.
    const source = fs.existsSync(CACHE_FILE)
        ? CACHE_FILE
        : path.join(__dirname, 'probed-cache.json');
    if (!fs.existsSync(source)) { cache = Object.fromEntries(ALL_ATS.map(a => [a, {}])); return; }
    try { cache = JSON.parse(fs.readFileSync(source, 'utf8')); }
    catch { cache = {}; }
    for (const a of ALL_ATS) cache[a] = cache[a] || {};
}
function saveCache() { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); }

function isSkippable(ats, slug) {
    const status = cache[ats][slug];
    if (!status) return false;
    if (status === 'dead') return true;
    if (status === 'empty') return !RETRY_EMPTY;
    return true; // 'hit' — already recorded
}

// ── The probe ───────────────────────────────────────────────────────────────
async function probe(ats, slug) {
    const p = PLATFORMS[ats];

    // Stage 1 — existence. Kills ~97% of candidates for one header-only request.
    if (p.headSafe) {
        const status = await head(p.url(slug), p.timeout);
        if (status !== 200) { cache[ats][slug] = 'dead'; return null; }
    }

    // Stage 2 — read the board and judge on the body.
    const urls = p.multiUrl ? p.urls(slug) : [p.url(slug)];
    for (const url of urls) {
        const text = await getBody(url, p.timeout, p.redirectIsDead === true);
        if (!text) continue;
        const locations = p.locations(text);
        if (locations === null) continue;      // not a real board / wrong shape
        if (locations.length === 0) { cache[ats][slug] = 'empty'; return null; }

        const german = locations.filter(isGermanLocation);
        if (german.length === 0) { cache[ats][slug] = 'empty'; return null; }

        cache[ats][slug] = 'hit';
        const hit = {
            slug, ats,
            germanJobCount: german.length,
            totalJobCount: locations.length,
            sampleLocations: [...new Set(german)].slice(0, 3),
        };
        if (ats === 'personio') hit.tld = url.includes('.personio.de') ? 'de' : 'com';
        return hit;
    }
    cache[ats][slug] = 'dead';
    return null;
}

// ── Candidate sources ───────────────────────────────────────────────────────

/**
 * Slug variants for a company NAME. Measured on a prior corpus: the joined and
 * hyphenated forms account for ~90% of all hits, which is why they're the
 * default. --full adds the long tail for a mop-up pass.
 */
export function slugVariants(name, full = FULL_VARIANTS) {
    const cleaned = String(name).trim().toLowerCase()
        .replace(/[.,''`®™]/g, '')
        .replace(/&/g, ' and ')
        .replace(/\b(gmbh|ag|se|kgaa|co kg|kg|mbh|inc|ltd|llc|plc|bv|nv|sa|as|oy|ab)\b/g, ' ')
        .replace(/\s+/g, ' ').trim();
    if (!cleaned) return [];

    const joined = cleaned.replace(/[^a-z0-9]/g, '');
    const hyphen = cleaned.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const out = new Set([joined, hyphen]);

    if (full) {
        out.add(cleaned.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
        out.add(joined + 'jobs');
        out.add(`${hyphen}-jobs`);
        out.add(joined + 'careers');
        out.add(`${hyphen}-careers`);
        const words = cleaned.split(' ');
        if (words.length > 1) out.add(words.slice(0, -1).join('').replace(/[^a-z0-9]/g, ''));
    }
    return [...out].filter(s => s.length >= 2 && s.length <= 60);
}

/**
 * Plain English words. The single highest-yield source: a large number of job
 * boards are one ordinary word (make, later, route, fleet, axis, salt, bloom,
 * proof) and no curated company list will ever contain those.
 *
 * Probed VERBATIM — never through slugVariants(), because "makejobs" is noise.
 */
async function loadDictionary() {
    if (NO_DICT) return [];
    const words = new Set();

    const en = await getBody(WORDLIST_URL, 30000);
    if (en) {
        for (const w of en.split('\n')) {
            const word = w.trim().toLowerCase();
            if (/^[a-z]{4,14}$/.test(word)) words.add(word);
        }
        console.log(`[Discovery] Source: EN wordlist → ${words.size} words (probed verbatim)`);
    } else {
        console.log('[Discovery] EN wordlist fetch failed — continuing without it.');
    }

    // German frequency list. A German-native board is plausibly a German word,
    // and the EN list can never contain those. Umlauts are dropped rather than
    // transliterated because slugs are ASCII: only the already-ASCII words are
    // usable as-is (a "ü→ue" pass produced no additional hits worth the volume).
    const beforeDe = words.size;
    const de = await getBody(DE_WORDLIST_URL, 45000);
    if (de) {
        for (const line of de.split('\n')) {
            const word = (line.split(/\s+/)[0] || '').trim().toLowerCase();
            if (/^[a-z]{4,14}$/.test(word)) words.add(word);
        }
        console.log(`[Discovery] Source: DE wordlist → +${words.size - beforeDe} new words`);
    } else {
        console.log('[Discovery] DE wordlist fetch failed — continuing without it.');
    }

    return [...words];
}

/**
 * Y Combinator's public company API (free, no auth). Kept for the small set of
 * YC companies that hire in Germany; the region filter is NOT applied, because
 * this pipeline cares where the JOBS are, not where the company is based — a
 * US-HQ'd YC company with a Berlin opening is exactly what we want.
 */
async function loadYCNames() {
    if (NO_YC) return [];

    // The payload is ~10 MB and takes ~10s on a good link, so it's cached on
    // disk after the first fetch — a transient timeout here silently costs the
    // run its single largest name source, which is exactly what happened once.
    let text = null;
    if (fs.existsSync(YC_CACHE_FILE)) {
        text = fs.readFileSync(YC_CACHE_FILE, 'utf8');
    } else {
        for (const attempt of [1, 2]) {
            text = await getBody(YC_URL, 120000);
            if (text) { fs.writeFileSync(YC_CACHE_FILE, text); break; }
            console.log(`[Discovery] YC fetch attempt ${attempt} failed${attempt === 1 ? ', retrying...' : ''}`);
        }
    }
    const data = parseJson(text);
    if (!Array.isArray(data)) {
        console.log('[Discovery] YC API unavailable — continuing without it.');
        return [];
    }
    const active = data.filter(c => c?.name && String(c.status || '').toLowerCase() !== 'inactive');
    console.log(`[Discovery] Source: Y Combinator → ${data.length} companies, ${active.length} active`);

    // Real identifiers beat generated variants. Each record carries YC's own
    // slug and the company website; the domain label is very often the exact
    // ATS board slug ("moderntreasury.com" → moderntreasury). former_names
    // catches companies that rebranded after setting up their board.
    const verbatim = new Set();
    for (const c of active) {
        if (c.slug) verbatim.add(String(c.slug).toLowerCase());
        if (c.website) {
            try {
                const host = new URL(c.website).hostname.replace(/^www\./, '');
                const label = host.split('.')[0].toLowerCase();
                if (/^[a-z0-9][a-z0-9-]{1,40}$/.test(label)) verbatim.add(label);
            } catch { /* malformed URL — skip */ }
        }
        for (const former of c.former_names || []) {
            for (const v of slugVariants(former, false)) verbatim.add(v);
        }
    }
    ycVerbatimSlugs = [...verbatim];
    console.log(`[Discovery] Source: YC identifiers → ${ycVerbatimSlugs.length} verbatim slugs (slug + domain + former names)`);

    return active.map(c => c.name);
}

/** Slugs already proven to work: the remote scraper's caches + our own configs. */
function loadSeeds() {
    const byAts = {};
    const add = (ats, slug) => {
        if (!slug || typeof slug !== 'string') return;
        (byAts[ats] = byAts[ats] || new Set()).add(slug.trim().toLowerCase());
    };

    if (fs.existsSync(REMOTE_SCRAPER_DIR)) {
        for (const file of fs.readdirSync(REMOTE_SCRAPER_DIR)) {
            if (!file.endsWith('.json') || !/^disc|^discovered/.test(file)) continue;
            try {
                const data = JSON.parse(fs.readFileSync(path.join(REMOTE_SCRAPER_DIR, file), 'utf8'));
                for (const [ats, list] of Object.entries(data)) {
                    if (Array.isArray(list)) list.forEach(s => add(ats.toLowerCase(), s));
                }
            } catch { /* skip malformed */ }
        }
        const atsDir = path.join(REMOTE_SCRAPER_DIR, 'src/ats');
        if (fs.existsSync(atsDir)) {
            for (const file of fs.readdirSync(atsDir)) {
                if (!file.endsWith('.js')) continue;
                const ats = path.basename(file, '.js').toLowerCase();
                const src = fs.readFileSync(path.join(atsDir, file), 'utf8');
                for (const m of src.matchAll(/^\s*'([a-zA-Z0-9._-]+)',/gm)) add(ats, m[1]);
            }
        }
    }

    // Our own configs: already-known-good German boards, useful as cross-platform seeds.
    const CONFIG_ARRAYS = {
        greenhouse: 'companyBoardTokens', ashby: 'companyBoardNames', lever: 'companySiteNames',
        recruitee: 'companySubdomains', smartrecruiters: 'companyIdentifiers', teamtailor: 'companyBoardNames',
    };
    for (const [ats, key] of Object.entries(CONFIG_ARRAYS)) {
        const file = path.join(CONFIG_DIR, `${ats === 'smartrecruiters' ? 'smartRecruiters' : ats}Config.js`);
        if (!fs.existsSync(file)) continue;
        const src = fs.readFileSync(file, 'utf8');
        const i = src.indexOf(key);
        if (i < 0) continue;
        const start = src.indexOf('[', i);
        let d = 0, end = -1;
        for (let j = start; j < src.length; j++) {
            if (src[j] === '[') d++;
            else if (src[j] === ']') { d--; if (d === 0) { end = j; break; } }
        }
        if (end > 0) for (const m of src.slice(start, end).matchAll(/'([^']+)'/g)) add(ats, m[1]);
    }
    return byAts;
}

async function buildCandidates() {
    const seeds = loadSeeds();
    const seedTotal = Object.values(seeds).reduce((n, s) => n + s.size, 0);
    console.log(`[Discovery] Source: verified seeds → ${seedTotal} slugs`);

    const curated = allCandidateNames();
    console.log(`[Discovery] Source: curated names → ${curated.length}`);

    const [ycNames, words] = await Promise.all([loadYCNames(), loadDictionary()]);

    // Names → variants. Words → verbatim, no variants.
    const fromNames = new Set();
    for (const name of [...curated, ...ycNames]) {
        for (const v of slugVariants(name)) fromNames.add(v);
    }
    console.log(`[Discovery] ${curated.length + ycNames.length} names → ${fromNames.size} slug variants (${FULL_VARIANTS ? 'full' : 'core'})`);

    // Words and YC identifiers are probed exactly as-is — running them through
    // the variant generator only manufactures noise ("makejobs", "stripe-careers").
    const shared = [...new Set([...fromNames, ...words, ...ycVerbatimSlugs])];

    // Externally harvested candidates (e.g. harvest-arbeitnow-companies.js).
    // `all` applies to every platform; a platform key targets just that one,
    // which is where CONFIRMED board slugs scraped from apply URLs belong.
    let extraAll = [];
    const extraByAts = {};
    const extraFile = path.join(__dirname, 'german-company-candidates.extra.json');
    if (fs.existsSync(extraFile)) {
        try {
            const extra = JSON.parse(fs.readFileSync(extraFile, 'utf8'));
            extraAll = (extra.all || []).map(s => String(s).toLowerCase());
            for (const ats of ALL_ATS) {
                if (Array.isArray(extra[ats])) extraByAts[ats] = extra[ats].map(s => String(s).toLowerCase());
            }
            const perAtsCount = Object.values(extraByAts).reduce((n, a) => n + a.length, 0);
            console.log(`[Discovery] Source: extra file → ${extraAll.length} shared + ${perAtsCount} platform-specific slugs`);
        } catch { console.log('[Discovery] extra candidates file is malformed — skipped'); }
    }

    // ORDER MATTERS. Candidates are probed in array order, and a long run is
    // often stopped part-way, so the highest expected-value candidates go
    // first. Measured yields:
    //   platform-specific extras (real board URLs from Common Crawl) — highest;
    //     these slugs are known to exist, only their German-job status is open
    //   verified seeds — already-working boards
    //   name variants / wordlists — a few percent at best
    //   shared extras (bulk harvested names) — lowest per probe, but high volume
    const perAts = {};
    for (const ats of ALL_ATS) {
        if (ONLY && !ONLY.includes(ats)) { perAts[ats] = []; continue; }
        perAts[ats] = [...new Set([
            ...(extraByAts[ats] || []), ...(seeds[ats] || []), ...shared, ...extraAll,
        ])].filter(s => !isSkippable(ats, s));
    }
    const queued = ALL_ATS.reduce((n, a) => n + perAts[a].length, 0);
    console.log(`[Discovery] Queued ${queued} probes (cache skipped the rest)\n`);
    return perAts;
}

// ── State ───────────────────────────────────────────────────────────────────
const state = { found: {}, stats: { totalProbed: 0, totalFound: 0, timestamp: null } };
let stopping = false;
let lastMark = 0;

function loadState() {
    for (const a of ALL_ATS) state.found[a] = [];
    // Same inheritance rule as the cache: a fresh shard starts from whatever the
    // main file already knows about its platform.
    const source = fs.existsSync(OUT_FILE)
        ? OUT_FILE
        : path.join(__dirname, 'german-companies-discovered.json');
    if (!fs.existsSync(source)) return;
    try {
        const prev = JSON.parse(fs.readFileSync(source, 'utf8'));
        for (const a of ALL_ATS) if (Array.isArray(prev[a])) state.found[a] = prev[a];
        state.stats = prev.stats || state.stats;
        const n = ALL_ATS.reduce((t, a) => t + state.found[a].length, 0);
        lastMark = n;
        console.log(`[Discovery] Carrying forward ${n} previously discovered companies`);
    } catch { /* start fresh */ }
}

function saveState() {
    state.stats.totalFound = ALL_ATS.reduce((n, a) => n + state.found[a].length, 0);
    state.stats.timestamp = new Date().toISOString();
    const out = { ...Object.fromEntries(ALL_ATS.map(a => [a, state.found[a]])), stats: state.stats };
    fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
    saveCache();
}

async function main() {
    const t0 = Date.now();
    console.log('=== German company discovery (strictly jobs located in Germany) ===\n');
    loadCache();
    loadState();

    const candidates = await buildCandidates();

    for (const ats of ALL_ATS) {
        if (stopping) break;
        const list = candidates[ats];
        if (!list?.length) continue;

        const known = new Set(state.found[ats].map(h => h.slug));
        console.log(`[${ats}] probing ${list.length} candidates...`);

        await runConcurrent(list, async slug => {
            const hit = await probe(ats, slug);
            state.stats.totalProbed++;
            // Flush periodically: state only used to be written when a whole
            // platform finished, so killing a long sweep threw away every
            // cache entry it had earned.
            if (state.stats.totalProbed % 500 === 0) saveState();
            if (hit && !known.has(hit.slug)) {
                known.add(hit.slug);
                state.found[ats].push(hit);
                const total = ALL_ATS.reduce((n, a) => n + state.found[a].length, 0);
                if (total - lastMark >= PROGRESS_EVERY) {
                    lastMark = total;
                    console.log(`\n[Discovery] Progress: ${total}/1200 companies found...`);
                }
            }
        }, (done, total) => {
            process.stdout.write(`\r[${ats}] ${done}/${total} probed, ${state.found[ats].length} found   `);
        });

        process.stdout.write('\n');
        saveState();
    }

    saveState();
    const elapsed = Math.round((Date.now() - t0) / 1000);
    const total = state.stats.totalFound;
    console.log(`\n=== Done in ${elapsed}s ===`);
    console.log(`Discovered ${total} companies with German jobs: ${ALL_ATS.map(a => `${state.found[a].length} on ${a}`).join(', ')}`);
    console.log(`Probed ${state.stats.totalProbed} this run → ${(100 * total / Math.max(state.stats.totalProbed, 1)).toFixed(2)}% cumulative hit rate`);
    console.log(`Results: ${OUT_FILE}`);
    console.log(`Cache:   ${CACHE_FILE}`);
}

process.on('SIGINT', () => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log('\n[Discovery] Ctrl+C — saving progress + cache...');
    saveState();
    setTimeout(() => process.exit(0), 400);
});

main().catch(err => { console.error('[Discovery] Fatal:', err); saveState(); process.exit(1); });
