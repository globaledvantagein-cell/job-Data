#!/usr/bin/env node

/**
 * ============================================================================
 * WORKABLE CAREER SITE DISCOVERY — GERMANY EDITION
 * ============================================================================
 *
 * Usage:   node discoverWorkable.js
 * Output:  Copy-paste slug list ready for workableConfig.js
 *
 * ── HOW WORKABLE WORKS ──────────────────────────────────────────────────────
 *
 * Workable is a hosted ATS where each company gets a subdomain.
 * Every company's public job board is accessible at:
 *
 *   GET https://www.workable.com/api/accounts/{slug}?details=true
 *
 * Returns JSON:
 *   {
 *     name: "Company Name",
 *     description: "...",
 *     jobs: [ { title, country, city, department, telecommuting, ... } ]
 *   }
 *
 * Key points:
 *   - No auth, no API key, completely public
 *   - ?details=true adds `description`, `industry`, `function`, `experience`, `education`
 *   - `country` = full name like "Germany" (not a country code)
 *   - `telecommuting` = boolean (true = remote)
 *   - 404 means the company doesn't use Workable or their slug is different
 *   - No pagination — all jobs returned in one response
 *
 * ── HOW TO FIND SLUGS ───────────────────────────────────────────────────────
 *
 * 1. Visit a company's careers page
 * 2. If they use Workable, the URL will contain `.workable.com` or redirect there
 * 3. The subdomain IS the slug: `celonis.workable.com` → slug = `celonis`
 * 4. Also check job listings on LinkedIn — Workable apply URLs expose the slug
 * 5. Just try guessing: `{companyname}` or `{company-name}` — 404 if wrong
 *
 * ── HOW TO ADAPT THIS SCRIPT FOR OTHER ATS PLATFORMS ────────────────────────
 *
 * This discovery script follows a universal pattern. To port it to a new ATS:
 *
 * STEP 1: Find the public API endpoint
 *   - Every ATS has a public job feed. Find it by:
 *     a) Checking developer docs
 *     b) Opening DevTools → Network tab on the company's careers page
 *     c) Looking for XHR/fetch calls that return job JSON
 *   - Pattern examples:
 *       Greenhouse:  GET  https://boards-api.greenhouse.io/v1/boards/{slug}/jobs
 *       Lever:       GET  https://api.lever.co/v0/postings/{slug}?mode=json
 *       Recruitee:   GET  https://{slug}.recruitee.com/api/offers
 *       SmartRecruiters: GET https://api.smartrecruiters.com/v1/companies/{slug}/postings
 *
 * STEP 2: Identify the slug format
 *   - Is it a subdomain? ({slug}.workable.com)  → replace SLUG in URL
 *   - Is it a path param? (boards-api.../boards/{slug}/...) → replace SLUG in path
 *   - Does it need combos? (Workday needs instance+site tested) → see discoverWorkdayGermany.js
 *
 * STEP 3: Identify the Germany filter field
 *   - Workable:    job.country === 'Germany'
 *   - Greenhouse:  job.location.name includes 'Germany' or German city
 *   - Lever:       job.country === 'de' or job.categories.location includes Germany
 *   - Recruitee:   job.location includes 'Germany'
 *   - SmartRec:    job.location.country === 'DE'
 *
 * STEP 4: Update these constants in this file:
 *   - ATS_NAME          → human-readable name for logs
 *   - buildUrl(slug)    → returns the API URL for a slug
 *   - fetchJobs(slug)   → fetches and returns { companyName, jobs }
 *   - hasGermany(job)   → returns true if job is Germany-based
 *   - companySlugs      → your list of slugs to test
 *
 * STEP 5: Run and collect results
 *   node discoverWorkable.js 2>&1 | tee results.txt
 *
 * ============================================================================
 */

// ─── Config ───────────────────────────────────────────────────────────────────

const ATS_NAME       = 'Workable';
const CONCURRENCY    = 8;      // Parallel requests — keep ≤10 to avoid 429s
const BATCH_DELAY_MS = 600;    // Delay between batches (ms)
const TIMEOUT_MS     = 12000;  // Per-request timeout (ms)

// ─── Already integrated — skip these ─────────────────────────────────────────
// Add any slug you've already confirmed and added to workableConfig.js here.
// This prevents re-testing known slugs on future runs.
const ALREADY_INTEGRATED = new Set([
  // From workableConfig.js initial list:
  'personio','celonis','taxfix','raisin','sennder','idealo','staffbase',
  'flaconi','grover','billie','pleo','forto','home24','westwing','comtravo',
  'apaleo','kenjo','circula','candis','zeitgold','moonfare','auxmoney',
  'smava','finanzguru','kontist','exporo','rebuy','momox','inkitt','limehome',
  'gastrofix','lovoo','wooga','innogames','goodgame','coachhub','sharpist',
  'masterplan','speexx','chatterbug','door2door','tier','miles','compredict',
  'twaice','navvis','konux','roboception','magazino','heycar','finanzcheck',
  'verivox','check24','meinestadt','immowelt','mcmakler','homeday','maklaro',
  'scoperty','planradar','capmo','brainlab','clue','kaia-health','medbelle',
  'numa','roadsurfer','holidu','egym','freeletics','gini','mondu','banxware',
  'upvest','lemon-markets','nuri','creditshelf','companisto','exporo','scalable',
  'quirion','elinvar','fincite','whitebox','nextmarkets','naga','getyourguide',
  'hometogo','omio','aboutyou','outfittery','mytheresa','vinted','catawiki',
  'adyen','mollie','messagebird','tink','trustly','klarna','wise','revolut',
  'monzo','bunq','qonto','agicap','spendesk','yokoy','payhawk','sumup',
  'contentsquare','dataiku','blablacar','deezer','uipath','camunda','rasa',
  'cognigy','parloa','deepl','aleph-alpha','merantix','appliedai','mostly-ai',
  'statice','understand-ai','fernride','enpal','thermondo','zolar',
  'one-komma-five','sonnen','has-to-be','gridx','envelio',
]);

// ─── Germany detection ────────────────────────────────────────────────────────
//
// Workable gives us structured fields:
//   job.country = "Germany" (full English name)
//   job.city    = "Berlin"
//   job.state   = "Berlin" (German Bundesland)
//
// Strategy: check country first (most reliable), then fall back to city.
// For remote jobs (telecommuting=true), check if location text mentions Germany.

const GERMAN_CITIES = [
  'berlin','munich','münchen','hamburg','frankfurt','cologne','köln',
  'stuttgart','düsseldorf','dusseldorf','dortmund','essen','leipzig',
  'bremen','dresden','hanover','hannover','nuremberg','nürnberg',
  'duisburg','bochum','wuppertal','bielefeld','bonn','münster','munster',
  'karlsruhe','mannheim','augsburg','wiesbaden','mönchengladbach',
  'gelsenkirchen','braunschweig','chemnitz','kiel','aachen','halle',
  'magdeburg','freiburg','krefeld','lübeck','lubeck','oberhausen',
  'erfurt','mainz','rostock','kassel','hagen','potsdam','leverkusen',
  'oldenburg','heidelberg','darmstadt','regensburg','ingolstadt',
  'wolfsburg','göttingen','gottingen','heilbronn','ulm','erlangen',
  'ludwigshafen','konstanz','bayreuth','paderborn','reutlingen',
];

function hasGermany(job) {
  // 1. Country field is most reliable — Workable uses full English country names
  if (job.country) {
    const c = job.country.toLowerCase().trim();
    if (c === 'germany' || c === 'deutschland') return true;
    // If a non-Germany country is explicitly set, reject immediately
    // (avoids false-positives from city name matches in other countries)
    if (c.length > 0) return false;
  }

  // 2. City field
  if (job.city) {
    const city = job.city.toLowerCase().trim();
    if (GERMAN_CITIES.some(gc => city.includes(gc))) return true;
  }

  // 3. State field (German Bundesländer)
  if (job.state) {
    const state = job.state.toLowerCase().trim();
    const germanStates = [
      'bavaria','bayarn','berlin','hamburg','hesse','hessen',
      'north rhine-westphalia','nordrhein-westfalen','nrw',
      'lower saxony','niedersachsen','saxony','sachsen',
      'rhineland-palatinate','rheinland-pfalz','thuringia','thüringen',
      'saxony-anhalt','sachsen-anhalt','mecklenburg','schleswig-holstein',
      'saarland','bremen','brandenburg','baden-württemberg','baden-wurttemberg',
    ];
    if (germanStates.some(s => state.includes(s))) return true;
  }

  // 4. Remote jobs: only count if location explicitly mentions Germany
  if (job.telecommuting === true) {
    const loc = `${job.city || ''} ${job.country || ''} ${job.state || ''}`.toLowerCase();
    if (loc.includes('germany') || loc.includes('deutschland') ||
        GERMAN_CITIES.some(gc => loc.includes(gc))) return true;
  }

  return false;
}

// ─── Core fetch function ───────────────────────────────────────────────────────
//
// TO ADAPT FOR ANOTHER ATS: Replace this function.
// It must return: { companyName: string, jobs: array } | null
//
// For ATS with multiple URL combos to try (like Workday), loop through combos
// and return on first success. See discoverWorkdayGermany.js for that pattern.

function buildUrl(slug) {
  // ?details=true adds: description, industry, function, experience, education
  return `https://www.workable.com/api/accounts/${slug}?details=true`;
}

async function fetchJobs(slug) {
  const url  = buildUrl(slug);
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

    if (!res.ok) return null;  // 404 = not on Workable, 429 = rate limited

    const data = await res.json();
    if (!data.jobs || !Array.isArray(data.jobs)) return null;

    return {
      companyName: data.name || slug,
      jobs:        data.jobs,
    };
  } catch {
    clearTimeout(tid);
    return null;
  }
}

// ─── Slug list ────────────────────────────────────────────────────────────────
//
// How to build this list:
//   - Start with known companies that use Workable (LinkedIn, their careers page)
//   - Try the company name as-is, with hyphens for spaces
//   - Common patterns: "n26" / "trade-republic" / "hellofresh"
//   - Wrong slugs just 404 — no cost to trying

const companySlugs = [

  // ── German startups / scale-ups ───────────────────────────────────────────
  'pitch',           // Berlin presentation tool
  'blinkist',        // Berlin book summaries
  'ecosia',          // Berlin green search
  'komoot',          // Berlin route planner
  'vivid-money',     // Berlin neobank
  'getmoss',         // Berlin spend management
  'liqid',           // Berlin digital wealth
  'ginmon',          // Frankfurt robo-advisor
  'weltsparen',      // Berlin savings
  'deposit-solutions', // Berlin savings marketplace
  'zinsbaustein',    // Berlin real estate
  'bergfuerst',      // Berlin crowdinvesting
  'backmarket',      // Paris/Berlin refurb devices
  'grover-de',       // Berlin tech rental
  'rebuy',           // Berlin recommerce
  'momox-de',        // Berlin secondhand
  'aboutyou-group',  // Hamburg fashion tech
  'fashionette',     // Düsseldorf fashion
  'stylight',        // Munich fashion aggregator
  'lovescout24',     // Berlin dating
  'onefootball',     // Berlin football app
  'kaia',            // Munich digital health
  'selfapy',         // Berlin mental health
  'mindable',        // Berlin mental health
  'ottonova',        // Munich digital health insurer
  'teleclinic',      // Munich telehealth
  'mednow',          // Berlin digital pharmacy
  'zava',            // London/Berlin telehealth
  'instafreight',    // Berlin logistics
  'sennder-de',      // Berlin freight (alternate slug)
  'timocom',         // Düsseldorf logistics platform
  'freighthub',      // Berlin freight
  'shipmonk',        // Berlin fulfillment
  'parcellab',       // Munich post-purchase
  'sendcloud',       // Eindhoven/DE parcel
  'seven-senders',   // Berlin parcel delivery
  'zenjob',          // Berlin flexible staffing
  'coyo',            // Hamburg employee comms
  'usercentrics',    // Munich consent mgmt
  'didomi-de',       // Paris/Berlin consent
  'onetrust',        // Atlanta/Berlin privacy
  'collibra',        // Brussels/Berlin data governance
  'celonis-munich',  // Munich process mining (alt)
  'signavio-de',     // Berlin process mgmt
  'leanix',          // Bonn enterprise arch
  'aris',            // Saarbrücken process mgmt
  'symbio',          // Munich PLM
  'centric',         // Netherlands/DE software
  'adito',           // Rosenheim CRM
  'scopevisio',      // Bonn ERP
  'weclapp',         // Frankfurt ERP
  'xentral',         // Augsburg ERP
  'actindo',         // Dortmund e-commerce ERP
  'plentymarkets',   // Kassel e-commerce
  'shopware',        // Schöppingen e-commerce
  'novalnet',        // Munich payments
  'heidelpay',       // Heidelberg payments
  'computop',        // Bamberg payments
  'payone',          // Frankfurt payments
  'unzer',           // Heidelberg payments
  'concardis',       // Frankfurt payments
  'elavon-de',       // Cork/DE payments
  'payworks',        // Munich POS payments
  'orderbird',       // Berlin POS
  'gastromatic',     // Hamburg HR software
  'personizer',      // Freiburg HR
  'rexx-systems',    // Hamburg HR
  'umantis',         // Konstanz HR
  'haufe-umantis',   // Konstanz HR
  'cegid',           // Lyon/Berlin HR
  'sage-de',         // Newcastle/Berlin HR
  'bmdc',            // Berlin marketing
  'facelift',        // Hamburg social media mgmt
  'emplifi',         // Prague/Berlin social
  'brandwatch',      // Brighton/Berlin social analytics
  'talkwalker',      // Luxembourg/Berlin analytics
  'mention',         // Paris/Berlin monitoring
  'uberall',         // Berlin local marketing
  'yext-de',         // NYC/Berlin listings
  'searchmetrics',   // Berlin SEO
  'sistrix',         // Bonn SEO
  'ryte',            // Munich website intelligence
  'uptain',          // Hamburg e-commerce opt.
  'econda',          // Karlsruhe analytics
  'etracker',        // Hamburg analytics
  'webtrekk',        // Berlin analytics (acquired by Mapp)
  'mapp-de',         // San Diego/Berlin analytics
  'intelliad',       // Erlangen attribution
  'adtriba',         // Hamburg attribution
  'exactag',         // Hamburg attribution
  'crossengage',     // Berlin customer data
  'xtremepush',      // Dublin/Berlin push
  'optilyz',         // Berlin direct mail
  'mailingwork',     // Limbach-O. email
  'cleverreach',     // Rastede email
  'rapidmail',       // Freiburg email
  'newsletter2go',   // Berlin email
  'klicktipp',       // Leipzig email
  'artegic',         // Bonn digital marketing
  'evalanche',       // Grasbrunn marketing auto
  'sc-networks',     // Grasbrunn email auto
  'mautic-de',       // Berlin open source mktg
  'hubspot-de',      // Cambridge/Berlin CRM (alt)
  'zammad',          // Munich help desk
  'serview',         // Bad Homburg ITSM
  'matrix42-de',     // Frankfurt ITSM
  'baramundi-de',    // Augsburg endpoint mgmt
  'docuware-de',     // Germering DMS
  'd-velop',         // Gescher DMS
  'windream',        // Bochum ECM
  'easy-software',   // Mülheim ECM
  'fabasoft',        // Linz/Munich ECM
  'ceyoniq',         // Bielefeld ECM
  'optimal-systems', // Berlin ECM
  'intrexx',         // Freiburg low-code
  'bpanda',          // Berlin BPM
  'signavio-low-code', // Berlin BPM
  'fluxus',          // Berlin low-code
  'axon-ivy',        // Zurich/DE BPM
  'finanzplaner',    // Munich fintech
  'ginlo',           // Munich secure messaging
  'idnow-de',        // Munich identity (alt)
  'authada',         // Darmstadt identity
  'webid',           // Berlin identity
  'veriff-de',       // Tallinn/Berlin identity
  'onfido-de',       // London/Berlin identity
  'jumio-de',        // Scotts Valley/Berlin identity
  'fourthline',      // Amsterdam/Berlin KYC
  'comply-advantage', // London/Berlin AML
  'riskified-de',    // Tel Aviv/Berlin fraud
  'forter-de',       // Tel Aviv/Berlin fraud
  'signifyd-de',     // San Jose/Berlin fraud
  'kount-de',        // Boise/Berlin fraud
  'seon-de',         // Budapest/Berlin fraud
  'nethone',         // Warsaw/Berlin fraud
  'ravelin-de',      // London/Berlin fraud
  'fraugster',       // Berlin fraud (AI)
  'risk-ident',      // Hamburg fraud
  'tonbeller',       // Darmstadt compliance
  'pwc-de',          // Frankfurt consulting
  'kpmg-de',         // Frankfurt consulting
  'ey-de',           // Frankfurt consulting
  'deloitte-de',     // Düsseldorf consulting
  'accenture-de',    // Frankfurt consulting
  'mck-de',          // Düsseldorf consulting
  'bcg-de',          // Munich consulting

  // ── European companies with Germany offices ───────────────────────────────
  'revolut-de',      // London fintech (alt)
  'n26-tech',        // Berlin neobank (alt)
  'paysend',         // London transfers
  'curve',           // London card aggregator
  'izettle',         // Stockholm payments
  'bambora',         // Stockholm payments
  'nets-de',         // Copenhagen payments
  'nexi-de',         // Milan payments
  'worldline',       // Bezons payments
  'concardis-de',    // Frankfurt payments
  'wirecard-de',     // Munich payments
  'paypal-de',       // San Jose/Berlin
  'braintree-de',    // Chicago/Berlin
  'stripe-de',       // San Francisco/Berlin
  'checkout-de',     // London/Berlin
  'adyen-de',        // Amsterdam (alt)
  'mollie-de',       // Amsterdam (alt)
  'qonto-de',        // Paris (alt)
  'agicap-de',       // Lyon (alt)
  'spendesk-de',     // Paris (alt)
  'yokoy-de',        // Zurich (alt)
  'payhawk-de',      // Sofia (alt)
  'pleo-de',         // Copenhagen (alt)
  'moss-de',         // Berlin (already Ashby but trying workable alt)
  'soldo-de',        // London spend mgmt
  'equals-de',       // London spend mgmt
  'paycircle',       // Mannheim payroll
  'personio-payroll', // Munich payroll alt
  'datev-lodas',     // Nuremberg payroll
  'lexware-de',      // Freiburg payroll
  'sage-payroll-de', // payroll
  'lohnfix',         // Berlin payroll
  'payfit-de',       // Paris payroll
  'bitkom',          // Berlin IT association
  'giga-group',      // Berlin tech
  'arlanis',         // Hamburg Salesforce consulting
  'sinkm',           // Hannover Salesforce
  'te-systems',      // Bonn Salesforce
  'pikon',           // Saarbrücken SAP consulting
  'convista',        // Cologne SAP
  'natuvion',        // Walldorf SAP
  'clarivo',         // Frankfurt SAP
  'accsense',        // Hamburg SAP
  'itelligence',     // Bielefeld SAP
  'ntt-data-business-solutions', // Bielefeld SAP
  'steelcase-de',    // Grand Rapids/Munich furniture
  'nespresso-de',    // Lausanne/DE
  'hugo-boss',       // Metzingen fashion
  'tamaris',         // Düsseldorf shoes
  'deichmann',       // Essen shoes
  'esprit-de',       // Düsseldorf fashion
  's-oliver',        // Rottendorf fashion
  'gerry-weber',     // Halle/Westfalen fashion
  'betty-barclay',   // Wiesloch fashion
  'brax',            // Herford fashion
  'bausback',        // Heidelberg fashion

  // ── US tech companies with Germany offices ────────────────────────────────
  'mongodb-de',
  'elastic-de',
  'confluent-de',
  'databricks-de',
  'snowflake-de',
  'datadog-de',
  'splunk-de',
  'dynatrace-de',
  'newrelic-de',
  'sumoLogic-de',
  'pagerduty-de',
  'launchdarkly-de',
  'amplitude-de',
  'mixpanel-de',
  'segment-de',
  'braze-de',
  'iterable-de',
  'klaviyo-de',
  'sendgrid-de',
  'mailgun-de',
  'twilio-de',
  'zendesk-de',
  'hubspot-careers',
  'intercom-de',
  'freshdesk-de',
  'freshworks-de',
  'salesforce-de',
  'servicenow-de',
  'workday-de',
  'sap-de',
  'oracle-de',
  'ibm-de',
  'microsoft-de',
  'google-de',
  'amazon-de',
  'meta-de',
  'apple-de',
  'netflix-de',
  'spotify-de',
  'uber-de',
  'airbnb-de',
  'palantir-de',
  'atlassian-de',
  'github-de',
  'gitlab-de',
  'jetbrains-de',
  'hashicorp-de',
  'cloudflare-de',
  'okta-de',
  'crowdstrike-de',
  'sentinelone-de',
  'paloalto-de',
  'fortinet-de',
  'checkpoint-de',
  'rapid7-de',
  'tenable-de',
  'qualys-de',
  'cyberark-de',
  'sailpoint-de',
  'varonis-de',
  'proofpoint-de',
  'mimecast-de',
  'knowbe4-de',
  'darktrace-de',
  'snyk-de',
  'veracode-de',
  'checkmarx-de',
  'sonatype-de',
  'jfrog-de',
  'aquasecurity',
  'lacework-de',
  'orca-de',
  'wiz-de',
  'sysdig-de',
  'noname-security',
  'salt-security',
  'wallarm',
  'signal-sciences',
  'fastly-de',
  'akamai-de',
  'cloudfront-de',
  'imperva-de',
  'f5-de',
  'radware-de',
  'netscout-de',
  'gigamon-de',
  'extrahop-de',
  'darktrace',
  'vectra-de',
  'exabeam-de',
  'securonix-de',
  'logrhythm-de',
  'ibm-qradar',
  'splunk-soar',
  'chronicle-de',
  'siemplify',
  'palo-alto-cortex',
  'microsoft-sentinel',
  'aws-security',
  'google-chronicle',
  'fireeye-de',
  'mandiant-de',
  'crowdstrike-falcon',

  // ── More German Mittelstand / scale-ups ───────────────────────────────────
  'sievert',         // Osnabrück materials
  'goldbeck',        // Bielefeld construction
  'max-boegl',       // Neumarkt construction
  'züblin',          // Stuttgart construction
  'ed-züblin',       // Stuttgart construction
  'hochtief-de',     // Essen construction
  'bilfinger-de',    // Mannheim engineering
  'implenia-de',     // Zürich/DE construction
  'peri-formwork',   // Weißenhorn formwork
  'doka-de',         // Amstetten/DE formwork
  'harsco-de',       // Camp Hill/DE industrial
  'metallbau-de',    // steel construction
  'rwe-de',          // Essen energy
  'eon-de',          // Essen energy
  'enbw-de',         // Karlsruhe energy
  'vattenfall',      // Stockholm/Berlin energy
  'uniper-de',       // Düsseldorf energy
  'wintershall-dea', // Hamburg oil gas
  'sbm-offshore-de', // Amsterdam/Hamburg offshore
  'vopak-de',        // Rotterdam/Hamburg terminals
  'rhenus-de',       // Holzwickede logistics
  'dachser-de',      // Kempten logistics
  'hellmann-de',     // Osnabrück logistics
  'fiege-de',        // Greven logistics
  'noerpel',         // Ulm logistics
  'fercam-de',       // Bolzano/DE logistics
  'senator-international', // Hamburg freight
  'ahlers-de',       // Hamburg forwarding
  'kn-de',           // Schindellegi/DE forwarding
  'dsv-de',          // Hedehusene/DE forwarding
  'dhl-de',          // Bonn parcel
  'ups-de',          // Atlanta/DE parcel
  'fedex-de',        // Memphis/DE express
  'hermes-de',       // Hamburg parcel
  'gls-de',          // Brussels/DE parcel
  'dpd-de',          // Aschaffenburg parcel
  'db-schenker-de',  // Frankfurt freight
  'bmw-group',       // Munich auto
  'audi-jobs',       // Ingolstadt auto
  'porsche-jobs',    // Stuttgart auto
  'volkswagen-jobs', // Wolfsburg auto
  'mercedes-jobs',   // Stuttgart auto
  'ford-de',         // Cologne auto
  'opel',            // Rüsselsheim auto
  'honda-de',        // Offenbach auto
  'toyota-de',       // Cologne auto
  'hyundai-de',      // Offenbach auto
  'kia-de',          // Frankfurt auto
  'stellantis-de',   // Amsterdam/DE auto
  'renault-de',      // Brühl auto
  'peugeot-de',      // Köln auto
  'volvo-de',        // Gothenburg/Hamburg auto
  'scania-de',       // Södertälje/Koblenz trucks
  'iveco-de',        // Turin/Ulm trucks
  'daf-trucks-de',   // Eindhoven/DE trucks
  'wabco-de',        // Brussels/Hannover commercial
  'knorr-bremse-de', // Munich brakes
  'haldex-de',       // Landskrona/DE brakes
  'continental-de',  // Hannover tires/auto
  'michelin-de',     // Clermont-Ferrand/DE
  'pirelli-de',      // Milan/DE tires
  'goodyear-de',     // Akron/DE tires
  'dunlop-de',       // Hanau tires
  'bridgestone-de',  // Tokyo/DE tires
    'wacker','wacker-chemie','evonik-industries','saltigo','currenta',
  'altana','altana-ag','merck','merck-group','emd','emdsigma',
  'brenntag','brenntag-ag','clariant','clariant-ag',
  'h-c-starck','hcstarck','schlenk','schlenk-metallic',
  'fuchs','fuchs-petrolub','fuchs-oil',

  // ── Engineering / Machinery ───────────────────────────────────────────────
  'kuka','duerr','duerr-ag','voith','voith-group',
  'gea','gea-group','krones','krones-ag',
  'heidelberger','manz','aixtron','suss-microtec',
  'trumpf','festo','sick','beckhoff','wago',
  'phoenix-contact','lapp','murrelektronik','turck','harting',
  'weidmuller','rittal','eaton','eaton-de','atlas-copco','atlas-copco-de',
  'smc','smc-de','parker','parker-hannifin',
  'hella','hella-de','knorr-bremse','brose','webasto',
  'continental','continental-ag','zf','zf-group','schaeffler',
  'mahle','mahle-group','brose-group',
  'reinz','victor-reinz','dana','dana-de',
  'grob','chiron','dmg-mori','rational','rational-ag','brita',

  // ── Automotive OEM / EV ───────────────────────────────────────────────────
  'bmw','bmwgroup','porsche','porsche-ag',
  'audi','audi-ag','mercedes','mercedes-benz','mercedesbenz',
  'volkswagen','volkswagen-ag',
  'man','man-truck','man-truckbus','daimler',
  'traton','traton-group','moia-mobility',
  'cariad','cariad-se','etas','etas-de',
  'porsche-digital','porscheconsulting','mhp','mhp-consulting',
  'e-go','sono-motors','sono','sono-group',
  'electric-brands','electricbrands',

  // ── Electronics / Semiconductor ───────────────────────────────────────────
  'siemens','siemens-ag','siemens-energy','siemens-mobility',
  'siemens-healthineers','osram','ams-osram','osram-gmbh',
  'carl-zeiss','zeiss','zeiss-group',
  'rohde-schwarz','rohdeschwarz',
  'bosch','bosch-group','bosch-rexroth',

  // ── Telecom / Media / IT ──────────────────────────────────────────────────
  'deutsche-telekom','telekom','t-systems','t-systems-de',
  'united-internet','1und1','drillisch','freenet',
  'otto-group','otto','otto-tech',
  'axel-springer','axelspringer','springer-nature','springernature',
  'bertelsmann','bertelsmann-ag','rtlgroup','rtl',
  'prosiebensat1','prosiebensat1media',
  'xing','new-work','newwork','kununu',
  'bechtle','cancom','computacenter','ntt-data-de',
  'adesso','msg-group','msg','gft','gft-technologies',
  'valantic','exxeta','maibornwolff','maibornwolff-de',
  'blue-yonder','blueyonder','sap-fioneer',
  'software-ag','softwareag','nemetschek','nemetschek-group',
  'datev','datev-eg','addison','haufe','haufe-group',
  'lexware','buhl','sevdesk','weclapp','xentral',
  'scopevisio','weclapp-de','actindo',
  'd-velop','dvelop','docuware','windream',
  'matrix42','baramundi',

  // ── Banking / Finance ─────────────────────────────────────────────────────
  'commerzbank','commerzbank-ag','deutsche-bank','deutschebank',
  'dz-bank','dzbank','lbbw','helaba','bayernlb','nord-lb','nordlb',
  'kfw','kfw-group','deka','dekabank','union-investment',
  'dws','dws-group','allianz','allianz-se','allianz-technology',
  'munich-re','munichre','ergo','ergo-group','ergo-digital',
  'hannover-re','hannoverrre','talanx','hdi-group','signal-iduna',
  'gothaer','debeka','huk-coburg','lvm','devk','vhv',
  'provinzial','sparkassen-versicherung','sv-versicherung',
  'barmenia','concordia','volkswohl-bund','cosmosdirekt',
  'axa-de','generali-de','zurich-de','swiss-life-de',
  'clark-insurance','wefox','getsafe','friday-insurance',
  'element-insurance',

  // ── Pharma / MedTech / Life Sciences ──────────────────────────────────────
  'boehringer','boehringeringelheim',
  'fresenius','fresenius-kabi','fresenius-medical-care',
  'stryker-de','bbraun','b-braun','b-braun-melsungen',
  'ottobock','ottobock-se','draeger','draeger-werk',
  'eppendorf','eppendorf-ag','sartorius','sartorius-ag',
  'biotronik','biotronik-de','qiagen','qiagen-de',
  'evotec','evotec-ag','curevac','curevac-ag','biontech','biontech-ag',
  'immatics','miltenyi','miltenyi-biotec',
  'siemens-healthineers-de','ge-healthcare-de','philips-de',
  'biotest','biotest-ag','allergopharma',
  'nordmark','nordmark-pharma','bionorica','stada','stada-arzneimittel',
  'roche-de','novartis-de',

  // ── Energy / Utilities / CleanTech ────────────────────────────────────────
  'eon','rwe','enbw','vattenfall-de','uniper','wintershall',
  'eon-se','rwe-group','enbw-group',
  'enphase-de','vestas-de','nordex','nordex-ag','enercon',
  'sunfire','1komma5grad','1komma5','enpal-solar',
  'thermondo','zolar','memodo','dz4',
  'gridx','envelio','octopus-energy-de',
  'siemens-gamesa','siemens-energy-renewables',
  'varta','varta-ag','akasol','akasol-ag',
  'instagrid','intilion','tesvolt',

  // ── Logistics / Transport ─────────────────────────────────────────────────
  'deutsche-bahn','db','db-systel','db-netz','db-cargo',
  'dhl','deutsche-post','dp-dhl','dpd','gls',
  'hellmann','rhenus','dachser','schenker','db-schenker',
  'kuehne-nagel','kuehnenagel','fiege','fiege-group',
  'hermes-de','hermes-germany','six-group',
  'fraport','fraport-ag','lufthansa','lufthansa-group',
  'eurowings','condor','tui','tui-group',
  'sixt','sixt-se','freenow-de','miles-mobility',
  'flixmobility','flixbus-de',
  'transdev-de','abellio',

  // ── Retail / Consumer / Food ──────────────────────────────────────────────
  'schwarz-group','lidl','kaufland','aldi','aldi-sued','aldi-nord',
  'rewe','rewe-digital','rewe-group','metro','metro-ag',
  'adidas','puma','hugo-boss','hugoboss','birkenstock',
  'douglas','dm-drogerie','rossmann','ceconomy',
  'mediamarkt','saturn-de',
  'about-you','aboutyou','otto-fashion',
  'home24','westwing','westwing-de','mytheresa',
  'outfittery','aboutyou-group',
  'lieferando','takeaway-de',
  'rewe-tech','kaufland-ecommerce',

  // ── PropTech / ConTech ────────────────────────────────────────────────────
  'vonovia','deutsche-wohnen','leg-immobilien',
  'immobilienscout24','immowelt','meinestadt','mcmakler',
  'homeday','maklaro','scoperty',
  'bilfinger','bilfinger-se','hochtief','strabag','goldbeck',
  'peri','peri-group','implenia','max-boegl',

  // ── Defense / Security ────────────────────────────────────────────────────
  'rheinmetall','rheinmetall-ag','hensoldt','diehl',
  'secunet','genua','myra-security','dracoon',
  'bundeswehr-it','bwi','dataport','dataport-de',
  'rohde-schwarz-cybersecurity',

  // ── German Digital Health ─────────────────────────────────────────────────
  'ada-health','clue-app','kaia-health','teleclinic',
  'kry-de','ottonova','alley-health','vivy-health',
  'caresyntax','brainlab-de','intraoperative',
  'amboss-medical','thieme','elsevier-health-de',
  'medbelle','numa','limehome',

  // ── German AI / DeepTech ──────────────────────────────────────────────────
  'aleph-alpha','alephalpha-de','merantix','merantix-ai',
  'twenty-first-de','quantco','quantco-de',
  'deepset','deepset-ai','kern-ai',
  'mostly-ai','statice','aircloak',
  'appliedai','appliedai-institute',
  'twaice','twaice-de','compredict',
  'understand-ai','fernride',

  // ══════════════════════════════════════════════════════════════════════════
  //  B — INTERNATIONAL: BIG TECH WITH GERMANY OFFICES
  // ══════════════════════════════════════════════════════════════════════════

  // ── US Big Tech ───────────────────────────────────────────────────────────
  'google','alphabet','googledeepmind',
  'meta','facebook',
  'apple',
  'microsoft',
  'netflix',
  'nvidia','nvidiacareers',
  'twitter','x-corp',
  'uber','lyft',
  'airbnb-tech',
  'palantir',
  'servicenow',
  'twilio',
  'atlassian',

  // ── US Enterprise Software ────────────────────────────────────────────────
  'workday','workday-de',
  'sap-ariba','sap-concur','sap-fieldglass',
  'oracle-de',
  'salesforce-de',
  'adobe-de',
  'vmware-de',
  'redhat','redhat-de',
  'suse','canonical',
  'citrix','citrix-de','parallels',
  'opentext','opentext-de',
  'micro-focus','microfocus',
  'verint','verint-de',
  'nice-systems','genesys','genesys-de',
  'talkdesk','ringcentral','ringcentral-de',
  'mitel','mitel-de',

  // ── US SaaS / DevTools ────────────────────────────────────────────────────
  'monday','mondaydotcom',
  'clickup','coda',
  'freshworks',
  'surveymonkey',
  'hotjar','fullstory','heap',
  'iterable','sendgrid','mailgun',
  'zenloop','medallia','medallia-de',
  'posthog',
  'linear-app',
  'retool',
  'loom','loomcareers',
  'notion-de','coda-de',
  'basecamp','basecamp-de',
  'github-de','gitlab-de',
  'circleci','harness',
  'jfrog-de','sonatype',
  'sentry','sentry-de',
  'grafana-de','logzio','coralogix',
  'pulumi','env0','spacelift',

  // ── US Cloud / Infra ──────────────────────────────────────────────────────
  'digitalocean','rackspace-de',
  'fastly','akamai',
  'fly-io','render','railway',
  'supabase-de','planetscale-de',
  'upstash',
  'cockroachdb','timescale','questdb','clickhouse-de',
  'pinecone','weaviate','qdrant',
  'confluent-de','rabbitmq','solace-de',
  'elastic-de','opensearch',

  // ── US Security / Cyber ───────────────────────────────────────────────────
  'sentinelone','cyberark','sailpoint',
  'rapid7','tenable',
  'proofpoint','mimecast','recordedfuture',
  'checkpoint','checkpointsw',
  'crowdstrike','paloaltonetworks','fortinet',
  'f5','f5-de',

  // ── US Fintech ────────────────────────────────────────────────────────────
  'stripe-de',
  'klarna','klarna-de','wise','wise-de',
  'revolut','checkout-com',
  'plaid','marqeta','affirm',
  'brex','ramp-com',
  'coinbase','kraken','binance-de',
  'ripple','circle-internet','fireblocks-de',
  'billdotcom','tipalti','tipalti-de',
  'solaris-bank','mambu-de',
  'thought-machine','10x-banking',
  'finastra','finastra-de','temenos','temenos-de',
  'worldpay-de',

  // ── US HR / Recruiting ────────────────────────────────────────────────────
  'workday-hr','successfactors',
  'cornerstone','cornerstoneondemand',
  'smartrecruiters','beamery',
  'eightfold','eightfold-ai','phenom','phenompeople',
  'jobvite','teamtailor','breezyhr',
  'peakon','betterworks',

  // ── US E-commerce / Marketplace ───────────────────────────────────────────
  'shopify-de','bigcommerce','magento-de',
  'spryker-de','commercetools-de',
  'contentful-de','storyblok',
  'algolia-de','constructor-io','bloomreach-de',
  'emarsys','dotdigital','ometria',
  'yotpo','shippo','easypost','parcellab','sendcloud',
  'aftership','seven-senders',
  'ebay','ebay-de','wayfair-de',
  'tripadvisor-de',

  // ══════════════════════════════════════════════════════════════════════════
  //  C — EUROPEAN TECH WITH GERMANY PRESENCE
  // ══════════════════════════════════════════════════════════════════════════

  // ── European Scale-ups ────────────────────────────────────────────────────
  'n26-tech','traderepublic-de',
  'getir-de','gorillas-tech','flink-de',
  'tier-mobility','tiermobility',
  'door2door','door2door-de',
  'getyourguide-tech','hometogo-de',
  'hellofresh-tech',
  'delivery-hero-tech',
  'sennder-tech',
  'auto1-tech','heycar-de',
  'flixmobility-tech',
  'omio-de','rome2rio',
  'check24-tech','verivox-de',
  'immobilienscout-tech','autoscout-tech',
  'idealo-de','ladenzeile-de',
  'stepstone-de','jobbörse-de',
  'xing-tech',

  // ── Nordic / Benelux with DE offices ──────────────────────────────────────
  'spotify-de','king','kahoot','mentimeter',
  'tobii','voi','einride',
  'northvolt','h2greensteel',
  'ikea-de','hmgroup-de',
  'randstad','wolterskluwer','dsv',
  'asml','stmicro','stmicroelectronics',
  'signify','tomtom','here-technologies',
  'ing-de','rabobank-de','nordea-de',
  'nets','nexi-de',
  'ubs-de','swisscom-de',
  'roche-careers','novartis-careers',
  'abb-de','schneider-electric','schneiderelectric',
  'holcim',

  // ── French Tech with DE offices ───────────────────────────────────────────
  'ovhcloud','scaleway',
  'alan-insurance','deezer','blablacar',
  'ubisoft-de','gameloft-de',
  'capgemini','capgeminicareer',
  'atos','atos-de',
  'airbus','airbus-de',
  'safran','dassault','dassaultsystemes',
  'michelin-de','totalenergies-de',
  'bnpparibas-de','axa-careers','sanofi-de',
  'sanofi','sanoficareers',
  'loreal-de','danone-de',

  // ── UK Tech with DE offices ───────────────────────────────────────────────
  'improbable','darktrace','graphcore',
  'sophos-de',
  'baesystems','rolls-royce','rollsroyce-de',
  'vodafone-de',
  'hsbc-de','barclays-de',
  'astrazeneca-de',
  'pearson-de','relx','elsevier',
  'experian','experian-de',

  // ── Swiss / Austrian ──────────────────────────────────────────────────────
  'roche','novartis',
  'ubs','credit-suisse','creditsuisse',
  'temenos','avaloq','temenos-banking',
  'swisscom',

  // ══════════════════════════════════════════════════════════════════════════
  //  D — US FORTUNE 500 WITH GERMANY ENGINEERING / MANUFACTURING
  // ══════════════════════════════════════════════════════════════════════════

  // ── Semiconductor / Hardware ──────────────────────────────────────────────
  'amd','amdcareers',
  'qualcomm','qualcomm-de',
  'broadcom','broadcom-de',
  'texas-instruments','ti-de',
  'arm','arm-de',
  'cadence',
  'synopsys',
  'keysight','teradyne','kla',
  'appliedmaterials','lamresearch',
  'western-digital','westerndigital-de',
  'seagate','seagate-de','netapp-de',
  'juniper','junipernetworks',
  'arista','aristanetworks',
  'marvell','marvelltech',
  'microchip','microchiptechnology',

  // ── Enterprise / Cloud ────────────────────────────────────────────────────
  'hpe','hpecareers',
  'ibm-de',
  'dell-de',
  'lenovo','lenovo-de',
  'nttdata','ntt-de',
  'fujitsu','fujitsu-de',
  'unisys-de',
  'cgi','cgicareers',
  'dxctechnology','dxc-de',

  // ── Consulting ────────────────────────────────────────────────────────────
  'mckinsey',
  'bcg','bostonconsulting',
  'bain','bainandcompany',
  'deloitte','deloitteglobal',
  'ey','eyglobal',
  'pwc','pwcglobal',
  'kpmg','kpmgglobal',
  'accenture',
  'cognizant','cognizant-de',
  'oliverwyman',
  'rolandberger','roland-berger',
  'simonkucher','simon-kucher',
  'bearingpoint','bearing-point',
  'horvath','horvath-de',
  'epam','epam-de','thoughtworks','thoughtworks-de',

  // ── Healthcare / Pharma / MedTech ─────────────────────────────────────────
  'pfizer-de','johnsoncareers','jnj-de',
  'abbvie-de','amgen-de',
  'merck-de','msd-de',
  'lilly-de','bms-de',
  'gilead-de','regeneron-de',
  'medtronic-de','stryker-de',
  'becton-de','bd-de',
  'bostonscientific-de','edwardslifesciences-de',
  'zimmerbiomet-de','intuitive-de',
  'illumina-de','danaher-de',
  'thermofisher-de','thermofisherscientific-de',
  'perkinelmer-de','revvity',
  'agilent-de','waters-de',
  'iqvia','iqvia-de','certara','certara-de',

  // ── Aerospace / Defense ───────────────────────────────────────────────────
  'leidos','leidos-de','saic',
  'lockheedmartin','northropgrumman',
  'raytheon','rtx','generaldynamics',
  'l3harris','textron',
  'jacobs','jacobscareers','aecom','aecom-de',
  'fluor','kbr',

  // ── Industrial / Manufacturing ────────────────────────────────────────────
  'honeywell',
  'emerson',
  'ge','gecareers','gevernova',
  'caterpillar','cat',
  'deere','johndeere',
  'rockwellautomation','rockwell',
  'johnsoncontrols','jci',
  'carrier','carrierglobal',
  'otis','otisworldwide',
  '3m','3mcareers',
  'ecolab','ecolab-de',
  'linde-de','airliquide','air-liquide',
  'saint-gobain','saint-gobain-de',
  'ppg','ppg-de',
  'corning','corning-de',
  'eastman','eastman-de',
  'dow','dow-de',
  'mettler-toledo','mettler',
  'sartorius-stedim','sartorius-careers',
  'bruker','bruker-de',
  'hamilton-de',
  'endress-hauser','endress-hauser-de',

  // ── Automotive Suppliers ──────────────────────────────────────────────────
  'aptiv','aptiv-de',
  'lear','lear-de',
  'magna','magna-de',
  'denso','denso-de',
  'borgwarner','borgwarner-de',

  // ── Energy ────────────────────────────────────────────────────────────────
  'shell','shell-de',
  'bp-de','totalenergies',
  'exxonmobil-de',
  'schlumberger','slb','halliburton-de',
  'bakerhughes-de',
  'nextera-de',
  'enphase-de',

  // ── Finance / Banking ──────────────────────────────────────────────────────
  'goldmansachs','gs-de',
  'morganstanley-de',
  'jpmorgan','jpmc-de',
  'citigroup','citi-de',
  'blackrock-de','vanguard-de','statestreet-de',
  'fidelity-de','invesco-de','amundi',
  'visa-de','mastercard-de',
  'zurichinsurance','generali-group',
  'swissre','munichre-group',
  'fiserv-de','fis-de','worldpay',

  // ── Retail / Consumer ─────────────────────────────────────────────────────
  'amazon-de',
  'nike-de','adidas-group',
  'loreal','loreal-careers',
  'proctergamble','pg-de',
  'colgate-de','reckitt-de',
  'nestle-de','danone',
  'diageo-de','heineken-de',
  'unilever-de',
  'ferrero','ferrero-de',

  // ── Logistics ─────────────────────────────────────────────────────────────
  'ups-de','fedex-de',
  'maersk','maerskcareer',
  'xpo','xpo-de',
  'ceva-logistics','ceva-de',

  // ── Real Estate / Infrastructure ──────────────────────────────────────────
  'cbre','cbre-de',
  'jll','jll-de',
  'cushmanwakefield-de','colliers-de',
  'brookfield-de','prologis-de',
  'digitalrealty-de','ironmountain-de',

  // ── Telecom ───────────────────────────────────────────────────────────────
  'ericsson','ericsson-de',
  'nokia','nokia-de',
  'telefonica-de','o2-de',
  'orange-de','bt-de',
  'ntt-communications',

  // ── Media / Streaming ────────────────────────────────────────────────────
  'disney-de','wbd-de','paramountglobal',
  'sky-de','sky-deutschland',
  'dazn','dazn-de',

  // ── Gaming / Entertainment ────────────────────────────────────────────────
  'ea-de','electronicarts-de',
  'activisionblizzard-de',
  'ubisoft-careers',
  'roblox-de','unity-de',
  'take2-de','taketwo-de',
  'supercell-de',

  // ── Education / Publishing ────────────────────────────────────────────────
  'coursera-de','udemy-de','pluralsight-de',
  'duolingo-de',
  'pearson-careers','mcgrawhill-de',
  'wiley-de','elsevier-de',
  'relx-de','springer',
  'gartner-de','idc-de',

  // ══════════════════════════════════════════════════════════════════════════
  //  E — MORE GERMAN / EUROPEAN STARTUPS & SCALE-UPS
  // ══════════════════════════════════════════════════════════════════════════

  // ── Berlin / Hamburg / Munich Startups ────────────────────────────────────
  'pitch-de','babbel-tech','blinkist-tech','ecosia-de',
  'komoot','smava','auxmoney','billie-de',
  'penta-bank','vivid-money','getmoss',
  'spendesk','celonis-ai','signavio-process',
  'flaconi-de','home24-de','westwing-tech',
  'flix-tech',
  'soundcloud-de',
  'wooga-de','innogames','goodgame',
  'bigpoint','crytek-de',
  'onefootball-de','clue-app-de',
  'doctolib-de','teleclinic-de',
  'aleph-alpha-de',
  'staffbase-de','usercentrics-de',
  'appsflyer-de','braze-de',
  'deposit-solutions','weltsparen',
  'liqid-de','ginmon','finanzguru','kontist',
  'banxware','mondu-de','exporo','creditshelf',
  'grover-de','rebuy','backmarket-de',
  'catawiki-de','vinted-de','momox',
  'inkitt','medbelle-de','numa-de','limehome-de',
  'apaleo-de','gastrofix','comtravo',
  'zeitgold','candis','circula','yokoy','payhawk-de',
  'kenjo','factorial-de','hibob-de','leapsome-de',
  'small-improvements','workpath','perdoo',
  'gtmhub','quantive','coachhub','sharpist','masterplan-de',
  'speexx','chatterbug','lingoda-de',
  'lovoo','kaia-health-de','mindable','selfapy',
  'neuroflash',
  'wonder-platform','hopin','hubilo',
  'locoia','tray-io',
  'cross-engage','xtremepush',
  'zenjob','zenjob-de','coyo','coyo-de',
  'freeletics','egym-de',
  'magazino','roboception',
  'atoss','softgarden','roadsurfer',
  'gini-de','sensape',
  'proxima-solutions','thinxnet',
  'mobility-house','has-to-be','chargepilot',
  'sonnen-de','one-komma-five',
  'konux-de','riskmethods',
  'celonis-ems','minit','lana-labs',
  'process-gold','aris-de',
  'abbyy-de','kofax-de',
  'automation-hero','workfusion',
  'parlamind','cognigy','cognigy-de',
  'rasa-de','botfriends','e-bot7',
  'parloa-de','solvemate',
  'novomind','bsi-software',
  'emarsys-de','qualtrics-de',
  'medallia-mopinion',
  'dynamic-yield','kameleoon','ab-tasty',
  'gainsight-de','totango-de','planhat',
  'churnzero',

  // ── Dutch / Nordic / Swiss scale-ups ──────────────────────────────────────
  'messagebird',
  'tink','trustly','bambora',
  'unity-de','kahoot-de',
  'voi-technology','einride-de',
  'polestar-de',
  'nxp-careers',
  'signify-de',
  'tomtom-de',

  // ══════════════════════════════════════════════════════════════════════════
  //  F — ADDITIONAL US / GLOBAL (frequently expand to Germany)
  // ══════════════════════════════════════════════════════════════════════════
  'ansys','ansys-de','ptc','ptc-de',
  'siemens-plm','siemens-sw',
  'dassault-de','msc-software',
  'altair','altair-de','hexagon-de','hexagon-ab',
  'leica-geosystems','trimble-de',
  'garmin-de','tomtom-careers',
  'esri','esri-de',
  'bentley','bentley-systems',
  'autodesk-de',
  'procore-de',
  'servicenow-de',
  'salesforce-tableau','tableau-de',
  'mulesoft','mulesoft-de',
  'boomi','boomi-de','jitterbit',
  'tibco','tibco-de','informatica-de',
  'opentext-de','micro-focus-de',
  'ibm-sterling','ibm-maximo',
  'sap-analytics-cloud','sap-datasphere',
  'celonis-process',
  'uipath-de',
  'automation-anywhere-de','blue-prism-de',
  'nice-de','genesys-cloud',
  'five9-de',
  'vonage-de',
  'avaya','avaya-de',
  'cisco-de',
  'palo-alto-de','checkpoint-de',
  'fortinet-de','sophos-de','tanium-de',
  'beyondtrust-de','cyberark-de',
  'varonis-de','sailpoint-de',
  'okta-de',
  'ping-identity','pingidentity',
  'one-identity',
  'sailpoint',
  'saviynt',
  'delinea','thycotic',
  'beyond-security',
  'securonix','exabeam',
  'logrhythm','sumo-logic-de',
  'devo','humio',
  'lacework','orca-security',
  'wiz','snyk-de',
  'checkmarx','mend','whitesource',
  'veracode-de',
  'sonarqube',
  'jfrog-de',
  'aqua-security','twistlock',
  'prisma-cloud',
  'hashicorp-de',
  'terraform','vagrant',
  'chef-de','puppet-de','ansible-de',
  'redhat-ansible',
  'rancher-de','suse-de',
  'canonical-de',
  'nutanix','nutanix-de',
  'pure-storage','purestorage-de',
  'netapp','netapp-de',
  'veeam','veeam-de',
  'cohesity','cohesity-de',
  'rubrik','rubrik-de',
  'commvault','commvault-de',
  'veritas','veritas-de',

];

// ─── Discovery engine ─────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function testSlug(slug) {
  if (ALREADY_INTEGRATED.has(slug.toLowerCase())) return null;

  const result = await fetchJobs(slug);
  if (!result) return null;

  const { companyName, jobs } = result;
  if (jobs.length === 0) return null;

  const germanyJobs = jobs.filter(hasGermany);

  return {
    slug,
    companyName,
    total:       jobs.length,
    germany:     germanyJobs.length,
    germanyJobs: germanyJobs.slice(0, 3), // sample only
    url:         buildUrl(slug),
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const uniqueSlugs = [...new Set(companySlugs)]
    .filter(s => !ALREADY_INTEGRATED.has(s.toLowerCase()));

  const skipped   = companySlugs.length - uniqueSlugs.length;
  const startTime = Date.now();

  console.log(`\n🇩🇪 ${ATS_NAME.toUpperCase()} GERMANY DISCOVERY — Testing ${uniqueSlugs.length} slugs`);
  console.log(`   Skipped ${skipped} already-integrated`);
  console.log(`   Concurrency: ${CONCURRENCY} | Timeout: ${TIMEOUT_MS}ms\n`);

  const allFound    = [];  // every board that returned jobs (any country)
  const withGermany = [];  // boards with ≥1 Germany job
  let tested = 0;

  for (let i = 0; i < uniqueSlugs.length; i += CONCURRENCY) {
    const batch   = uniqueSlugs.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(testSlug));

    for (const r of results) {
      if (!r) continue;
      allFound.push(r);
      if (r.germany > 0) {
        withGermany.push(r);
        console.log(`  ✅ ${r.slug} (${r.companyName}): ${r.germany} 🇩🇪 / ${r.total} total`);
      }
    }

    tested = Math.min(i + CONCURRENCY, uniqueSlugs.length);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    process.stdout.write(
      `\r  [${tested}/${uniqueSlugs.length}] ${elapsed}s | Boards: ${allFound.length} | 🇩🇪 Germany: ${withGermany.length}   `
    );

    if (i + CONCURRENCY < uniqueSlugs.length) await sleep(BATCH_DELAY_MS);
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  // ── Results ────────────────────────────────────────────────────────────────

  console.log(`\n\n${'═'.repeat(80)}`);
  console.log(`📊 ${ATS_NAME.toUpperCase()} GERMANY DISCOVERY (${totalTime}s)`);
  console.log(`   ${uniqueSlugs.length} slugs tested | ${allFound.length} boards found | ${withGermany.length} with Germany jobs`);
  console.log(`${'═'.repeat(80)}`);

  if (withGermany.length === 0) {
    console.log(`\n  No Germany jobs found. Try adding more slugs to companySlugs.\n`);
    return;
  }

  const sorted = [...withGermany].sort((a, b) => b.germany - a.germany);

  // ── Ranked table ──────────────────────────────────────────────────────────
  console.log(`\n🇩🇪 BOARDS WITH GERMANY JOBS (${sorted.length}) — sorted by count:`);
  console.log(`${'─'.repeat(80)}`);
  for (const r of sorted) {
    const pad = ' '.repeat(Math.max(1, 30 - r.slug.length));
    console.log(`  ${r.slug}${pad}${r.companyName.padEnd(28)} 🇩🇪 ${String(r.germany).padStart(4)} / ${r.total} total`);
  }

  // ── Copy-paste config ──────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`📋 COPY-PASTE → workableConfig.js companySlugs:`);
  console.log(`${'═'.repeat(80)}\n`);
  console.log(`  // ── Auto-discovered ${new Date().toISOString().slice(0, 10)} ──`);
  for (const r of sorted) {
    const pad = ' '.repeat(Math.max(1, 30 - r.slug.length - 2));
    console.log(`  '${r.slug}',${pad}// ${r.companyName} — ${r.germany} DE / ${r.total} total`);
  }

  // ── All found (including non-Germany) ─────────────────────────────────────
  if (allFound.length > withGermany.length) {
    console.log(`\n${'═'.repeat(80)}`);
    console.log(`📋 ALL FOUND (including zero Germany) — ${allFound.length} total:`);
    console.log(`${'─'.repeat(80)}`);
    const sortedAll = [...allFound].sort((a, b) => b.total - a.total);
    for (const r of sortedAll) {
      const flag = r.germany > 0 ? `🇩🇪 ${String(r.germany).padStart(4)}` : `   none`;
      const pad  = ' '.repeat(Math.max(1, 30 - r.slug.length));
      console.log(`  ${r.slug}${pad}${flag} / ${r.total} total`);
    }
  }

  // ── Sample Germany jobs ────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`🔍 SAMPLE GERMANY JOBS (top 20, up to 3 per company):`);
  console.log(`${'═'.repeat(80)}`);
  for (const r of sorted.slice(0, 20)) {
    console.log(`\n  📌 ${r.slug} (${r.companyName}) — ${r.germany} Germany jobs:`);
    for (const j of r.germanyJobs) {
      console.log(`     • ${j.title}`);
      console.log(`       ${j.city || ''}${j.city && j.country ? ', ' : ''}${j.country || ''} | ${j.employment_type || ''} | ${j.telecommuting ? '🏠 Remote' : '🏢 Onsite'}`);
    }
  }

  // ── Final summary ──────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`📊 FINAL SUMMARY`);
  console.log(`${'─'.repeat(80)}`);
  console.log(`  Slugs tested:       ${uniqueSlugs.length}`);
  console.log(`  Skipped (existing): ${skipped}`);
  console.log(`  Boards found:       ${allFound.length}`);
  console.log(`  With Germany jobs:  ${withGermany.length}`);
  console.log(`  Total Germany jobs: ${withGermany.reduce((s, r) => s + r.germany, 0)}`);
  console.log(`  Time:               ${totalTime}s`);
  console.log(`${'═'.repeat(80)}\n`);
}

main();