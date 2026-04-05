#!/usr/bin/env node

/**
 * ============================================================================
 * RECRUITEE CAREER SITE DISCOVERY — GERMANY EDITION
 * ============================================================================
 *
 * Usage:   node discoverRecruitee.js
 * Output:  Copy-paste subdomain list ready for recruiteeConfig.js
 *
 * ── HOW RECRUITEE WORKS ─────────────────────────────────────────────────────
 *
 * Recruitee is a hosted ATS where each company gets a subdomain.
 * Every company's public job feed is accessible at:
 *
 *   GET https://{subdomain}.recruitee.com/api/offers/
 *
 * Returns JSON:
 *   {
 *     offers: [
 *       {
 *         id, title, slug, status, description, requirements,
 *         company_name, department, employment_type_code,
 *         experience_code, education_code, category_code,
 *         remote, on_site, hybrid,
 *         city, country, country_code, location,
 *         locations: [ { id, city, country, country_code, state, ... } ],
 *         careers_url, careers_apply_url,
 *         tags: [ ... ],
 *         salary: { min, max, currency, period },
 *         published_at, created_at, updated_at, close_at,
 *         min_hours, max_hours
 *       }
 *     ]
 *   }
 *
 * Key points:
 *   - No auth, no API key, completely free & public
 *   - All published jobs returned in one response (no pagination needed)
 *   - `locations` array has structured data: city, country, country_code per location
 *   - `remote`, `on_site`, `hybrid` are separate boolean flags
 *   - `country_code` uses ISO 2-letter codes ("DE" for Germany)
 *   - `employment_type_code` = "fulltime", "parttime", "contract", etc.
 *   - `experience_code` = "entry_level", "mid_level", "senior_level", etc.
 *   - 404 means the subdomain doesn't exist or company doesn't use Recruitee
 *   - `description` and `requirements` are HTML — need stripping for analysis
 *
 * ── HOW TO FIND SUBDOMAINS ──────────────────────────────────────────────────
 *
 * 1. Visit a company's careers page
 * 2. If they use Recruitee, the URL will be like {subdomain}.recruitee.com/...
 * 3. The subdomain IS the slug: "solaris.recruitee.com" → subdomain = "solaris"
 * 4. Check job listings on LinkedIn — Recruitee apply URLs expose the subdomain
 * 5. Just guess: try "{companyname}" or "{company-name}" — 404 if wrong
 * 6. Some companies use custom domains but the API still works on the subdomain
 *
 * ── DIFFERENCE FROM WORKABLE DISCOVERY ──────────────────────────────────────
 *
 *  WHAT CHANGED           WORKABLE                    RECRUITEE
 *  ─────────────────────  ──────────────────────────  ──────────────────────────
 *  URL pattern            .../accounts/{slug}         {slug}.recruitee.com/api/offers/
 *  Slug placement         Path parameter              Subdomain
 *  Response root          { name, jobs: [...] }       { offers: [...] }
 *  Company name field     data.name                   offer.company_name
 *  Country field          job.country (full name)     locations[].country_code ("DE")
 *  City field             job.city                    locations[].city
 *  Remote field           job.telecommuting (bool)    offer.remote (bool)
 *  Pagination             None (all in one)           None (all in one)
 *  Description            Included with ?details=true Always included (HTML)
 *
 * ============================================================================
 */

// ─── Config ───────────────────────────────────────────────────────────────────

const ATS_NAME       = 'Recruitee';
const CONCURRENCY    = 6;      // Parallel requests — Recruitee is tolerant but be polite
const BATCH_DELAY_MS = 500;    // Delay between batches (ms)
const TIMEOUT_MS     = 15000;  // Per-request timeout (ms)

// ─── Already integrated — skip these ─────────────────────────────────────────
// Add any subdomain you've already confirmed and added to recruiteeConfig.js.
// Prevents re-testing known subdomains on future runs.
const ALREADY_INTEGRATED = new Set([
    // From recruiteeConfig.js initial list:
    // (paste your existing subdomains here as you add them)
]);

// ─── Germany detection ────────────────────────────────────────────────────────
//
// Recruitee gives us STRUCTURED data — much more reliable than Workable.
//
// Priority order:
//   1. locations[].country_code === "DE"    (most reliable — ISO code from Recruitee's DB)
//   2. locations[].country === "Germany"    (human-readable fallback)
//   3. locations[].city matches German city (for sloppy data entry)
//   4. Flat fields: country_code, country, city (detail endpoint format)
//   5. location string field               (last resort)
//
// NOTE: Unlike Workable where job.country is the ONLY reliable field,
// Recruitee has a proper locations[] array with structured objects.
// Each location has its own country_code — so a multi-location job like
// "Berlin + Amsterdam" will have two location objects, and we check each one.

const GERMAN_CITIES = [
    'berlin', 'munich', 'münchen', 'hamburg', 'frankfurt', 'cologne', 'köln',
    'stuttgart', 'düsseldorf', 'dusseldorf', 'dortmund', 'essen', 'leipzig',
    'bremen', 'dresden', 'hanover', 'hannover', 'nuremberg', 'nürnberg',
    'duisburg', 'bochum', 'wuppertal', 'bielefeld', 'bonn', 'münster', 'munster',
    'karlsruhe', 'mannheim', 'augsburg', 'wiesbaden', 'mönchengladbach',
    'gelsenkirchen', 'braunschweig', 'chemnitz', 'kiel', 'aachen', 'halle',
    'magdeburg', 'freiburg', 'krefeld', 'lübeck', 'lubeck', 'oberhausen',
    'erfurt', 'mainz', 'rostock', 'kassel', 'hagen', 'potsdam', 'leverkusen',
    'oldenburg', 'heidelberg', 'darmstadt', 'regensburg', 'ingolstadt',
    'wolfsburg', 'göttingen', 'gottingen', 'heilbronn', 'ulm', 'erlangen',
    'ludwigshafen', 'konstanz', 'bayreuth', 'paderborn', 'reutlingen',
    'jena', 'schwerin', 'flensburg', 'esslingen', 'ludwigsburg',
    'tübingen', 'tubingen',
];

function hasGermany(offer) {
    // ── 1. Structured locations array (MOST RELIABLE for Recruitee) ──────────
    // This is the key difference from Workable — Recruitee gives us an array
    // of location objects, each with its own country_code, country, city, etc.
    if (Array.isArray(offer.locations) && offer.locations.length > 0) {
        for (const loc of offer.locations) {
            // 1a. ISO country code — most reliable
            if (loc.country_code && String(loc.country_code).toUpperCase() === 'DE') return true;

            // 1b. Country name
            const country = String(loc.country || '').toLowerCase().trim();
            if (country === 'germany' || country === 'deutschland') return true;

            // 1c. City name fallback
            const city = String(loc.city || '').toLowerCase().trim();
            if (city && GERMAN_CITIES.some(gc => city.includes(gc))) return true;
        }
    }

    // ── 2. Flat country_code field (some responses use this instead) ─────────
    if (offer.country_code && String(offer.country_code).toUpperCase() === 'DE') return true;

    // ── 3. Flat country field ────────────────────────────────────────────────
    const country = String(offer.country || '').toLowerCase().trim();
    if (country === 'germany' || country === 'deutschland') return true;
    // If a non-Germany country is explicitly set, reject
    if (country.length > 0) return false;

    // ── 4. Flat city field ──────────────────────────────────────────────────
    const city = String(offer.city || '').toLowerCase().trim();
    if (city && GERMAN_CITIES.some(gc => city.includes(gc))) return true;

    // ── 5. Location string field (least reliable) ────────────────────────────
    const locationStr = String(offer.location || '').toLowerCase();
    if (locationStr.includes('germany') || locationStr.includes('deutschland')) return true;
    if (GERMAN_CITIES.some(gc => locationStr.includes(gc))) return true;

    return false;
}

// ─── Core fetch function ──────────────────────────────────────────────────────
//
// WHAT CHANGED FROM WORKABLE:
//
// Workable:   GET https://www.workable.com/api/accounts/{slug}?details=true
//             → slug goes in the PATH
//             → returns { name: "Company", jobs: [...] }
//
// Recruitee:  GET https://{slug}.recruitee.com/api/offers/
//             → slug goes in the SUBDOMAIN
//             → returns { offers: [...] }
//             → company_name is INSIDE each offer object, not at the top level
//
// This is the #1 thing you change when adapting for a new ATS.

function buildUrl(subdomain) {
    return `https://${subdomain}.recruitee.com/api/offers/`;
}

async function fetchJobs(subdomain) {
    const url  = buildUrl(subdomain);
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

    try {
        const res = await fetch(url, {
            method:  'GET',
            signal:  ctrl.signal,
            headers: {
                'Accept':     'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            },
        });
        clearTimeout(tid);

        if (!res.ok) return null;  // 404 = not on Recruitee

        const data = await res.json();

        // ── KEY DIFFERENCE: Recruitee wraps jobs in "offers" not "jobs" ──────
        if (!data.offers || !Array.isArray(data.offers)) return null;

        // ── KEY DIFFERENCE: company_name is per-offer, not top-level ─────────
        // We grab it from the first offer. If no offers, fall back to subdomain.
        const companyName = data.offers.length > 0
            ? (data.offers[0].company_name || subdomain)
            : subdomain;

        // Filter to only published offers
        const publishedOffers = data.offers.filter(o => !o.status || o.status === 'published');

        return {
            companyName,
            jobs: publishedOffers,
        };
    } catch {
        clearTimeout(tid);
        return null;
    }
}

// ─── Subdomain list ───────────────────────────────────────────────────────────
//
// HOW TO BUILD THIS LIST:
//
// 1. Visit company careers pages — look for ".recruitee.com" in the URL
// 2. Check LinkedIn job postings — Recruitee apply URLs contain the subdomain
// 3. Google: site:recruitee.com "Germany" OR "Berlin" OR "Munich"
// 4. Try common patterns: company name, company-name, companyname
// 5. Wrong subdomains just 404 — no cost to trying
//
// SLUG FORMAT:
//   - Always lowercase
//   - Hyphens for spaces: "trade-republic" not "traderepublic"
//   - Sometimes has suffixes: "billie1", "adjust1", "moss1" (when base name is taken)
//   - No trailing slashes needed

const companySubdomains = [

    // ══════════════════════════════════════════════════════════════════════════
    //  A — GERMAN STARTUPS & SCALE-UPS (most likely to have Germany jobs)
    // ══════════════════════════════════════════════════════════════════════════

    // ── Berlin Fintech ──────────────────────────────────────────────────────
    'solaris', 'solarisgroup', 'solarisbank',
    'n26', 'n26-tech',
    'trade-republic', 'traderepublic',
    'raisin', 'raisin-ds', 'weltsparen',
    'moonfare',
    'billie', 'billie1', 'billie-io',
    'penta', 'penta-banking',
    'kontist',
    'smava',
    'auxmoney',
    'liqid',
    'ginmon',
    'fincompare',
    'bonify',
    'creditshelf',
    'companisto',
    'exporo',
    'scalable', 'scalable-capital',
    'vivid', 'vivid-money',
    'mondu',
    'banxware',
    'upvest',
    'lemon-markets',
    'moss', 'moss1', 'getmoss',

    // ── Berlin / Germany E-commerce & Marketplaces ──────────────────────────
    'aboutyou', 'aboutyou-group', 'about-you',
    'grover', 'grover-group', 'grover-de',
    'rebuy',
    'momox', 'momox-de',
    'home24',
    'westwing', 'westwing-de',
    'outfittery',
    'mytheresa',
    'flaconi', 'flaconi-de',
    'catawiki', 'catawiki-de',
    'vinted', 'vinted-de',
    'backmarket', 'backmarket-de',
    'idealo', 'idealo-de',

    // ── Berlin / Germany Travel & Mobility ──────────────────────────────────
    'omio', 'omio-de',
    'getyourguide', 'getyourguide-tech',
    'hometogo', 'hometogo-de',
    'comtravo',
    'tourlane',
    'flixbus', 'flixmobility', 'flix-tech',
    'door2door', 'door2door-de',
    'freenow', 'freenow-de',
    'miles', 'miles-mobility',
    'tier', 'tier-mobility', 'tiermobility',
    'sixt', 'sixt-se',
    'roadsurfer',
    'holidu',
    'limehome', 'limehome-de',
    'numa', 'numa-de',
    'volocopter',
    'lilium',

    // ── Berlin / Germany HR & Recruiting Tech ───────────────────────────────
    'personio', 'personio-de',
    'kenjo',
    'honeypot',
    'softgarden',
    'circula',
    'leapsome', 'leapsome-de',
    'small-improvements',
    'workpath',
    'perdoo',
    'factorial', 'factorial-de',
    'hibob', 'hibob-de',
    'coachhub',
    'sharpist',
    'masterplan', 'masterplan-de',
    'speexx',
    'chatterbug',

    // ── Berlin / Germany SaaS & DevTools ────────────────────────────────────
    'contentful', 'contentful-de',
    'celonis', 'celonis-ai', 'celonis-ems',
    'signavio', 'signavio-de',
    'staffbase', 'staffbase-de',
    'usercentrics', 'usercentrics-de',
    'leanix',
    'pitch', 'pitch-de',
    'productsup',
    'movingimage',
    'jimdo',
    'eyeo',
    'adjust', 'adjust1', 'adjust-2',
    'appsflyer-de',
    'braze-de',

    // ── Berlin / Germany AI & DeepTech ──────────────────────────────────────
    'merantix', 'merantix-ai',
    'aleph-alpha', 'alephalpha', 'aleph-alpha-de',
    'deepl',
    'cognigy', 'cognigy-de',
    'rasa', 'rasa-de',
    'parloa', 'parloa-de',
    'mostly-ai',
    'understand-ai',
    'fernride',
    'twaice', 'twaice-de',
    'compredict',
    'konux', 'konux-de',
    'navvis',
    'riskmethods',
    'neuroflash',

    // ── Berlin / Germany Health & Biotech ────────────────────────────────────
    'kaia', 'kaia-health', 'kaia-health-de',
    'ada-health', 'ada',
    'clue', 'clue-app', 'clue-app-de',
    'teleclinic', 'teleclinic-de',
    'doctolib', 'doctolib-de',
    'ottonova',
    'medbelle', 'medbelle-de',
    'avi-medical',
    'brainlab', 'brainlab-de',
    'amboss', 'amboss-medical',
    'smartpatient',

    // ── Berlin / Germany Energy & CleanTech ──────────────────────────────────
    'enpal', 'enpal-solar',
    'zolar',
    'thermondo',
    '1komma5', '1komma5grad', 'one-komma-five',
    'sonnen', 'sonnen-de',
    'gridx',
    'envelio',
    'solarwatt',
    'next-kraftwerke',
    'ecoligo',
    'infarm',

    // ── Berlin / Germany PropTech ────────────────────────────────────────────
    'homeday',
    'mcmakler',
    'scoperty',
    'planradar',
    'pricehubble',
    'homepilot',
    'apaleo', 'apaleo-de',

    // ── Berlin / Germany Gaming ──────────────────────────────────────────────
    'innogames',
    'goodgamestudios', 'goodgame',
    'kolibriGames', 'kolibri-games',
    'wooga', 'wooga-de',
    'bigpoint',
    'crytek', 'crytek-de',
    'inkitt',

    // ── Hamburg / Munich / Other German Cities ───────────────────────────────
    'babbel', 'babbel-tech',
    'blinkist', 'blinkist-tech',
    'ecosia', 'ecosia-de',
    'komoot',
    'onefootball', 'onefootball-de',
    'tonies',
    'yfood',
    'soundcloud', 'soundcloud-de',
    'trivago',
    'scout24',
    'check24', 'check24-tech',
    'verivox', 'verivox-de',
    'immobilienscout24', 'immowelt',
    'meinestadt',
    'stepstone', 'stepstone-de',
    'xing', 'xing-tech', 'new-work', 'newwork',
    'freeletics',
    'egym', 'egym-de',
    'gini', 'gini-de',
    'zenjob', 'zenjob-de',
    'coyo', 'coyo-de',
    'demodesk',
    'omr',
    'friendsurance',
    'wefox',
    'clark',
    'getsafe',
    'heydata',
    'localyze',
    'talkwalker',
    'yieldlab',
    'uberall',
    'applike', 'applike-group',
    'gastrofix',
    'medwing',
    'senacor',
    'atoss',
    'hubject',
    'eagle-eye-networks',

    // ── German IT Consulting & Enterprise ────────────────────────────────────
    'adesso',
    'msg', 'msg-group',
    'valantic',
    'exxeta',
    'maibornwolff', 'maibornwolff-de',
    'bechtle',
    'cancom',
    'computacenter',
    'ntt-data-de',
    'gft', 'gft-technologies',

    // ── German Automotive & Industrial ───────────────────────────────────────
    'bmw', 'bmw-group', 'bmwgroup',
    'porsche', 'porsche-ag', 'porsche-digital',
    'audi', 'audi-ag',
    'mercedes', 'mercedes-benz', 'mercedesbenz',
    'volkswagen', 'volkswagen-ag',
    'continental', 'continental-ag',
    'zf', 'zf-group',
    'schaeffler',
    'bosch', 'bosch-group',
    'siemens', 'siemens-ag', 'siemens-energy',
    'moia', 'moia-mobility',
    'cariad', 'cariad-se',

    // ── German Pharma / Chemicals ───────────────────────────────────────────
    'bayer', 'bayer-ag',
    'basf',
    'covestro',
    'merck', 'merck-group',
    'boehringer', 'boehringeringelheim',
    'fresenius', 'fresenius-kabi',
    'biontech', 'biontech-ag',
    'curevac', 'curevac-ag',
    'sartorius', 'sartorius-ag',
    'eppendorf', 'eppendorf-ag',

    // ── German Banking & Insurance ──────────────────────────────────────────
    'commerzbank', 'commerzbank-ag',
    'deutsche-bank', 'deutschebank',
    'allianz', 'allianz-se', 'allianz-technology',
    'munich-re', 'munichre',
    'ergo', 'ergo-group', 'ergo-digital',

    // ── German Logistics & Transport ────────────────────────────────────────
    'sennder', 'sennder-tech',
    'forto',
    'instafreight',
    'seven-senders',
    'parcellab',
    'deutsche-bahn', 'db', 'db-systel',
    'dhl', 'deutsche-post',
    'lufthansa', 'lufthansa-group',

    // ── German Retail & Consumer ────────────────────────────────────────────
    'otto', 'otto-group', 'otto-tech',
    'adidas', 'adidas-group',
    'puma',
    'hugo-boss', 'hugoboss',
    'dm', 'dm-drogerie',
    'rewe', 'rewe-digital', 'rewe-group',
    'lidl', 'schwarz-group',
    'aldi', 'aldi-sued',

    // ══════════════════════════════════════════════════════════════════════════
    //  B — EUROPEAN COMPANIES WITH GERMANY OFFICES
    // ══════════════════════════════════════════════════════════════════════════

    // ── Dutch / Benelux ─────────────────────────────────────────────────────
    'recruitee', 'tellent',
    'messagebird',
    'mollie', 'mollie-de',
    'adyen', 'adyen-de',
    'picnic',
    'sendcloud',
    'catawiki',
    'channable',
    'effectory',
    'bynder',
    'monta',
    'teamleader',
    'showpad',

    // ── French ──────────────────────────────────────────────────────────────
    'spendesk', 'spendesk-de',
    'qonto', 'qonto-de',
    'contentsquare',
    'dataiku',
    'blablacar',
    'alan', 'alan-insurance',
    'deezer',
    'docplanner',
    'agicap', 'agicap-de',
    'swile',
    'openclassrooms',

    // ── Nordic / Danish / Swedish ────────────────────────────────────────────
    'pleo', 'pleo-de',
    'trustpilot',
    'templafy',
    'spotify', 'spotify-de',
    'klarna', 'klarna-de',
    'wise', 'wise-de',

    // ── UK / Irish ──────────────────────────────────────────────────────────
    'hotjar',
    'revolut', 'revolut-de',
    'checkout', 'checkout-com',

    // ── Swiss / Austrian ────────────────────────────────────────────────────
    'frontify',
    'yokoy', 'yokoy-de',
    'payhawk', 'payhawk-de',
    'planradar',

    // ══════════════════════════════════════════════════════════════════════════
    //  C — US / GLOBAL TECH WITH GERMANY OFFICES
    // ══════════════════════════════════════════════════════════════════════════

    // ── Big Tech ────────────────────────────────────────────────────────────
    'google', 'google-de',
    'meta', 'facebook',
    'apple', 'apple-de',
    'microsoft', 'microsoft-de',
    'amazon', 'amazon-de',
    'netflix', 'netflix-de',
    'uber', 'uber-de',
    'airbnb', 'airbnb-de',
    'twitter', 'x-corp',
    'palantir', 'palantir-de',
    'salesforce', 'salesforce-de',
    'oracle', 'oracle-de',
    'sap', 'sap-de',

    // ── US SaaS / Cloud ─────────────────────────────────────────────────────
    'stripe', 'stripe-de',
    'shopify', 'shopify-de',
    'datadog', 'datadog-de',
    'snowflake', 'snowflake-de',
    'confluent', 'confluent-de',
    'databricks', 'databricks-de',
    'elastic', 'elastic-de',
    'mongodb', 'mongodb-de',
    'cloudflare', 'cloudflare-de',
    'hashicorp', 'hashicorp-de',
    'twilio', 'twilio-de',
    'zendesk', 'zendesk-de',
    'hubspot', 'hubspot-de',
    'atlassian', 'atlassian-de',
    'github', 'github-de',
    'gitlab', 'gitlab-de',
    'notion', 'notion-de',

    // ── US Fintech ──────────────────────────────────────────────────────────
    'plaid', 'plaid-de',
    'sumup',
    'brex', 'brex-de',

    // ── US Security ─────────────────────────────────────────────────────────
    'crowdstrike', 'crowdstrike-de',
    'okta', 'okta-de',
    'snyk', 'snyk-de',
    'veracode', 'veracode-de',

    // ── US HR / Recruiting ──────────────────────────────────────────────────
    'workday', 'workday-de',
    'smartrecruiters',
    'beamery',

    // ══════════════════════════════════════════════════════════════════════════
    //  D — WILDCARD GUESSES (common German company names)
    // ══════════════════════════════════════════════════════════════════════════
    'delivery-hero', 'deliveryhero',
    'hellofresh', 'hellofresh-tech',
    'zalando', 'zalando-se',
    'rocket-internet',
    'auto1', 'auto1-tech',
    'heycar', 'heycar-de',
    'wolt', 'wolt-de',
    'gorillas', 'gorillas-tech',
    'flink', 'flink-de',
    'getir', 'getir-de',
    'taxfix',
    'n26',
    'sennder',
    'jobs',  // Recruitee/Tellent themselves
    'lingoda', 'lingoda-de',
    'babbel',
];

// ─── Discovery engine ─────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function testSubdomain(subdomain) {
    if (ALREADY_INTEGRATED.has(subdomain.toLowerCase())) return null;

    const result = await fetchJobs(subdomain);
    if (!result) return null;

    const { companyName, jobs } = result;
    if (jobs.length === 0) return null;

    const germanyJobs = jobs.filter(hasGermany);

    // Build a location summary for logging
    const locationSample = germanyJobs.slice(0, 3).map(j => {
        if (Array.isArray(j.locations) && j.locations.length > 0) {
            const loc = j.locations.find(l => String(l.country_code || '').toUpperCase() === 'DE') || j.locations[0];
            return `${loc.city || '?'}, ${loc.country || '?'}`;
        }
        return j.city || j.location || '?';
    });

    return {
        subdomain,
        companyName,
        total:          jobs.length,
        germany:        germanyJobs.length,
        germanyJobs:    germanyJobs.slice(0, 3),
        locationSample,
        url:            buildUrl(subdomain),
        // Extra Recruitee-specific data we can log
        hasRemote:      germanyJobs.some(j => j.remote === true),
        hasSalary:      germanyJobs.some(j => j.salary && (j.salary.min || j.salary.max)),
        departments:    [...new Set(germanyJobs.map(j => j.department).filter(Boolean))].slice(0, 5),
    };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const uniqueSubdomains = [...new Set(companySubdomains.map(s => s.toLowerCase()))]
        .filter(s => !ALREADY_INTEGRATED.has(s));

    const skipped   = companySubdomains.length - uniqueSubdomains.length;
    const startTime = Date.now();

    console.log(`\n🇩🇪 ${ATS_NAME.toUpperCase()} GERMANY DISCOVERY — Testing ${uniqueSubdomains.length} subdomains`);
    console.log(`   Skipped ${skipped} already-integrated / duplicates`);
    console.log(`   Concurrency: ${CONCURRENCY} | Timeout: ${TIMEOUT_MS}ms\n`);

    const allFound    = [];  // every board that returned offers (any country)
    const withGermany = [];  // boards with ≥1 Germany offer
    let tested = 0;

    for (let i = 0; i < uniqueSubdomains.length; i += CONCURRENCY) {
        const batch   = uniqueSubdomains.slice(i, i + CONCURRENCY);
        const results = await Promise.all(batch.map(testSubdomain));

        for (const r of results) {
            if (!r) continue;
            allFound.push(r);
            if (r.germany > 0) {
                withGermany.push(r);
                const remoteFlag = r.hasRemote ? ' 🏠' : '';
                const salaryFlag = r.hasSalary ? ' 💰' : '';
                console.log(`  ✅ ${r.subdomain} (${r.companyName}): ${r.germany} 🇩🇪 / ${r.total} total${remoteFlag}${salaryFlag}`);
            }
        }

        tested = Math.min(i + CONCURRENCY, uniqueSubdomains.length);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        process.stdout.write(
            `\r  [${tested}/${uniqueSubdomains.length}] ${elapsed}s | Boards: ${allFound.length} | 🇩🇪 Germany: ${withGermany.length}   `
        );

        if (i + CONCURRENCY < uniqueSubdomains.length) await sleep(BATCH_DELAY_MS);
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

    // ── Results ──────────────────────────────────────────────────────────────

    console.log(`\n\n${'═'.repeat(80)}`);
    console.log(`📊 ${ATS_NAME.toUpperCase()} GERMANY DISCOVERY (${totalTime}s)`);
    console.log(`   ${uniqueSubdomains.length} subdomains tested | ${allFound.length} boards found | ${withGermany.length} with Germany jobs`);
    console.log(`${'═'.repeat(80)}`);

    if (withGermany.length === 0) {
        console.log(`\n  No Germany jobs found. Try adding more subdomains.\n`);
        return;
    }

    const sorted = [...withGermany].sort((a, b) => b.germany - a.germany);

    // ── Ranked table ────────────────────────────────────────────────────────
    console.log(`\n🇩🇪 BOARDS WITH GERMANY JOBS (${sorted.length}) — sorted by count:`);
    console.log(`${'─'.repeat(80)}`);
    for (const r of sorted) {
        const pad = ' '.repeat(Math.max(1, 30 - r.subdomain.length));
        const flags = [
            r.hasRemote ? '🏠' : '',
            r.hasSalary ? '💰' : '',
        ].filter(Boolean).join(' ');
        console.log(`  ${r.subdomain}${pad}${r.companyName.padEnd(28)} 🇩🇪 ${String(r.germany).padStart(4)} / ${r.total} total  ${flags}`);
    }

    // ── Copy-paste config ────────────────────────────────────────────────────
    console.log(`\n${'═'.repeat(80)}`);
    console.log(`📋 COPY-PASTE → recruiteeConfig.js companySubdomains:`);
    console.log(`${'═'.repeat(80)}\n`);
    console.log(`    // ── Auto-discovered ${new Date().toISOString().slice(0, 10)} ──`);
    for (const r of sorted) {
        const pad = ' '.repeat(Math.max(1, 30 - r.subdomain.length - 2));
        console.log(`    '${r.subdomain}',${pad}// ${r.companyName} — ${r.germany} DE / ${r.total} total`);
    }

    // ── All found (including non-Germany) ─────────────────────────────────────
    if (allFound.length > withGermany.length) {
        console.log(`\n${'═'.repeat(80)}`);
        console.log(`📋 ALL BOARDS FOUND (including zero Germany) — ${allFound.length} total:`);
        console.log(`${'─'.repeat(80)}`);
        const sortedAll = [...allFound].sort((a, b) => b.total - a.total);
        for (const r of sortedAll) {
            const flag = r.germany > 0 ? `🇩🇪 ${String(r.germany).padStart(4)}` : `   none`;
            const pad  = ' '.repeat(Math.max(1, 30 - r.subdomain.length));
            console.log(`  ${r.subdomain}${pad}${flag} / ${r.total} total`);
        }
    }

    // ── Sample Germany jobs ──────────────────────────────────────────────────
    console.log(`\n${'═'.repeat(80)}`);
    console.log(`🔍 SAMPLE GERMANY JOBS (top 20, up to 3 per company):`);
    console.log(`${'═'.repeat(80)}`);
    for (const r of sorted.slice(0, 20)) {
        console.log(`\n  📌 ${r.subdomain} (${r.companyName}) — ${r.germany} Germany jobs:`);
        if (r.departments.length > 0) {
            console.log(`     Departments: ${r.departments.join(', ')}`);
        }
        for (let idx = 0; idx < r.germanyJobs.length; idx++) {
            const j = r.germanyJobs[idx];

            // ── KEY DIFFERENCE: Recruitee has more structured data than Workable ──
            // We can show employment type, experience level, remote/hybrid flags, salary
            const locStr = r.locationSample[idx] || '?';
            const empType = j.employment_type_code || '';
            const remote = j.remote ? '🏠 Remote' : j.hybrid ? '🔄 Hybrid' : '🏢 Onsite';
            const salary = (j.salary && (j.salary.min || j.salary.max))
                ? ` | ${j.salary.currency || '€'}${j.salary.min || '?'}-${j.salary.max || '?'}`
                : '';

            console.log(`     • ${j.title}`);
            console.log(`       ${locStr} | ${empType} | ${remote}${salary}`);
        }
    }

    // ── Department breakdown ─────────────────────────────────────────────────
    console.log(`\n${'═'.repeat(80)}`);
    console.log(`🏢 DEPARTMENT BREAKDOWN (across all Germany jobs):`);
    console.log(`${'─'.repeat(80)}`);
    const deptCounts = {};
    for (const r of withGermany) {
        for (const j of r.germanyJobs) {
            const dept = j.department || 'Unknown';
            deptCounts[dept] = (deptCounts[dept] || 0) + 1;
        }
    }
    const deptSorted = Object.entries(deptCounts).sort((a, b) => b[1] - a[1]);
    for (const [dept, count] of deptSorted.slice(0, 20)) {
        console.log(`  ${String(count).padStart(4)}  ${dept}`);
    }

    // ── Final summary ────────────────────────────────────────────────────────
    const totalGermanyJobs = withGermany.reduce((s, r) => s + r.germany, 0);
    const withSalary = withGermany.filter(r => r.hasSalary).length;
    const withRemote = withGermany.filter(r => r.hasRemote).length;

    console.log(`\n${'═'.repeat(80)}`);
    console.log(`📊 FINAL SUMMARY`);
    console.log(`${'─'.repeat(80)}`);
    console.log(`  Subdomains tested:    ${uniqueSubdomains.length}`);
    console.log(`  Skipped (existing):   ${skipped}`);
    console.log(`  Boards found:         ${allFound.length}`);
    console.log(`  With Germany jobs:    ${withGermany.length}`);
    console.log(`  Total Germany jobs:   ${totalGermanyJobs}`);
    console.log(`  With salary info:     ${withSalary} companies`);
    console.log(`  With remote roles:    ${withRemote} companies`);
    console.log(`  Time:                 ${totalTime}s`);
    console.log(`${'═'.repeat(80)}\n`);
}

main();