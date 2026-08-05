import fetch from 'node-fetch';
import { XMLParser } from 'fast-xml-parser';
import { StripHtml, SanitizeHtml } from '../utils.js';
import { isGermanyString, normalizeWorkplaceType, normalizeEmploymentType } from '../core/locationPrefilters.js';
import { normalizeArray } from '../core/jobExtractor.js';

// ─── Seniority mapping (Personio → your ExperienceLevel taxonomy) ─────────
const SENIORITY_MAP = {
    'student':       'Entry',
    'entry-level':   'Entry',
    'experienced':   'Mid',
    'lead':          'Senior',
    'senior':        'Senior',
    'manager':       'Senior',
    'director':      'Director',
    'executive':     'Executive',
};

// ─── Schedule mapping ─────────────────────────────────────────────────────
const SCHEDULE_MAP = {
    'full-time': 'FullTime',
    'part-time': 'PartTime',
};

// ─── XML parser config ────────────────────────────────────────────────────
// Personio quirk: a feed with 1 job returns <position> as object, multi-job
// returns an array. Same for jobDescription. Force these to always be arrays.
const xmlParser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,    // keep numbers as strings, we coerce later
    trimValues: true,
    isArray: (name) => ['position', 'jobDescription'].includes(name),
});

// ─── Description assembly ────────────────────────────────────────────────
// Personio splits descriptions into named sections (Intro / Your tasks /
// Your profile / Benefits). We concatenate them with section headers
// preserved so the AI analyzer + frontend get the full context.
function assembleDescription(jobDescriptionsBlock, asHtml) {
    const sections = jobDescriptionsBlock?.jobDescription || [];
    if (!Array.isArray(sections) || sections.length === 0) return '';

    if (asHtml) {
        return sections
            .map(s => `<h3>${s.name || ''}</h3>${s.value || ''}`)
            .join('\n');
    }
    return sections
        .map(s => `${s.name || ''}\n${StripHtml(s.value || '')}`)
        .join('\n\n');
}

export const personioConfig = {
    siteName: "Personio Jobs",
    baseUrl: null, // not used — each company has its own subdomain

    // Each entry: { subdomain, tld } — tld is 'de' or 'com' depending on
    // the customer. Verify the live URL before adding here.
    // Format: https://{subdomain}.jobs.personio.{tld}/xml?language=en

companyTargets: [
    { subdomain: 'workidentity',         tld: 'de' },
    { subdomain: 'agile-robots-se',      tld: 'de' },
    { subdomain: 'miles-mobility',       tld: 'de' },
    { subdomain: 'peter-park',           tld: 'de' },
    { subdomain: 'trg',                  tld: 'de' },
    { subdomain: 'unternehmertum',       tld: 'de' },
    { subdomain: 'impower',              tld: 'de' },
    { subdomain: 'carbmee',              tld: 'com' },
    { subdomain: 'yoummday-gmbh',        tld: 'de' },
    { subdomain: 'aiya-europe',          tld: 'de' },
    { subdomain: 'data4life',            tld: 'de' },
    { subdomain: 'zdf-digital',          tld: 'de' },
    { subdomain: 'pitch',                tld: 'de' },
    { subdomain: 'altagramgroup',        tld: 'de' },
    { subdomain: 'bliq',                 tld: 'de' },
    { subdomain: 'anton',                tld: 'com' },
    { subdomain: 'kemmler-kemmler-gmbh', tld: 'de' },
    { subdomain: 'zipmend',              tld: 'de' },
    { subdomain: 'certivity',            tld: 'de' },
    { subdomain: 'everience',            tld: 'de' },
    { subdomain: 'studysmarter',         tld: 'de' },
    { subdomain: 'tech11',               tld: 'de' },
    { subdomain: 'pm-team',              tld: 'de' },
    { subdomain: 'ht-ventures-gmbh',     tld: 'de' },
    { subdomain: 'epages-gmbh',          tld: 'de' },
    { subdomain: 'hafencity-hamburg',    tld: 'de' },
    { subdomain: 'azeti',                tld: 'de' },
    { subdomain: 'berlin-bytes',         tld: 'de' },
    { subdomain: 'socialhub',            tld: 'de' },
    { subdomain: 'aignostics',           tld: 'de' },
    { subdomain: 'robco',                tld: 'de' },
    // --- GERMAN EXPANSION 2026-08-04 ---
    // Verified: board reachable AND >=1 job located in Germany.
    { subdomain: 'stark', tld: 'de' },  // 135 DE / 185 total
    { subdomain: 'thermondo', tld: 'de' },  // 84 DE / 231 total
    { subdomain: 'westwing', tld: 'de' },  // 64 DE / 75 total
    { subdomain: 'mbition', tld: 'de' },  // 43 DE / 50 total
    { subdomain: 'egym', tld: 'com' },  // 37 DE / 44 total
    { subdomain: 'holidu', tld: 'de' },  // 36 DE / 67 total
    { subdomain: 'jedox', tld: 'de' },  // 34 DE / 40 total
    { subdomain: 'chrono24', tld: 'de' },  // 30 DE / 36 total
    { subdomain: 'urbansportsclub', tld: 'com' },  // 25 DE / 33 total
    { subdomain: 'merantix', tld: 'de' },  // 23 DE / 38 total
    { subdomain: 'kertos', tld: 'de' },  // 21 DE / 23 total
    { subdomain: 'holy', tld: 'de' },  // 19 DE / 40 total
    { subdomain: 'cloover', tld: 'de' },  // 16 DE / 16 total
    { subdomain: 'atmosfair', tld: 'de' },  // 15 DE / 16 total
    { subdomain: 'varm', tld: 'de' },  // 15 DE / 19 total
    { subdomain: 'mercanis', tld: 'de' },  // 14 DE / 20 total
    { subdomain: 'shyftplan', tld: 'de' },  // 12 DE / 12 total
    { subdomain: 'alasco', tld: 'de' },  // 11 DE / 11 total
    { subdomain: 'gematik', tld: 'de' },  // 11 DE / 11 total
    { subdomain: 'gocomo', tld: 'de' },  // 11 DE / 19 total
    { subdomain: 'voiio', tld: 'de' },  // 11 DE / 12 total
    { subdomain: 'lanch', tld: 'de' },  // 10 DE / 20 total
    { subdomain: 'entrix', tld: 'de' },  // 9 DE / 16 total
    { subdomain: 'wunderflats', tld: 'de' },  // 9 DE / 9 total
    { subdomain: 'tanso', tld: 'de' },  // 8 DE / 8 total
    { subdomain: 'knime', tld: 'de' },  // 7 DE / 24 total
    { subdomain: 'ottonova', tld: 'de' },  // 6 DE / 6 total
    { subdomain: 'humanoo', tld: 'de' },  // 5 DE / 7 total
    { subdomain: 'vivira', tld: 'de' },  // 5 DE / 6 total
    { subdomain: 'exec', tld: 'com' },  // 5 DE / 6 total
    { subdomain: 'everphone', tld: 'de' },  // 4 DE / 5 total
    { subdomain: 'wandelbots', tld: 'de' },  // 4 DE / 7 total
    { subdomain: 'proglove', tld: 'de' },  // 4 DE / 11 total
    { subdomain: 'bounti', tld: 'de' },  // 4 DE / 5 total
    { subdomain: 'silvernova', tld: 'de' },  // 4 DE / 4 total
    { subdomain: 'resolve', tld: 'com' },  // 4 DE / 4 total
    { subdomain: 'clark', tld: 'de' },  // 3 DE / 4 total
    { subdomain: 'finoa', tld: 'de' },  // 3 DE / 7 total
    { subdomain: 'traviangames', tld: 'de' },  // 3 DE / 3 total
    { subdomain: '7learnings', tld: 'de' },  // 3 DE / 7 total
    { subdomain: 'buildingminds', tld: 'de' },  // 3 DE / 5 total
    { subdomain: 'deeploi', tld: 'de' },  // 3 DE / 3 total
    { subdomain: 'elearnio', tld: 'de' },  // 3 DE / 3 total
    { subdomain: 'goodcarbon', tld: 'de' },  // 3 DE / 6 total
    { subdomain: 'juna-ai', tld: 'de' },  // 3 DE / 3 total
    { subdomain: 'ratepay', tld: 'de' },  // 3 DE / 3 total
    { subdomain: 'tandem', tld: 'de' },  // 3 DE / 4 total
    { subdomain: 'personio', tld: 'com' },  // 2 DE / 2 total
    { subdomain: 'blickfeld', tld: 'de' },  // 2 DE / 2 total
    { subdomain: 'webasto', tld: 'de' },  // 2 DE / 3 total
    { subdomain: 'edgeless-systems', tld: 'de' },  // 2 DE / 2 total
    { subdomain: 'forward-earth', tld: 'de' },  // 2 DE / 3 total
    { subdomain: 'freshflow', tld: 'de' },  // 2 DE / 3 total
    { subdomain: 'friendsurance', tld: 'de' },  // 2 DE / 6 total
    { subdomain: 'latana', tld: 'de' },  // 2 DE / 3 total
    { subdomain: 'lumoview', tld: 'de' },  // 2 DE / 2 total
    { subdomain: 'xolife', tld: 'de' },  // 2 DE / 7 total
    { subdomain: 'buena', tld: 'de' },  // 2 DE / 3 total
    { subdomain: 'ygo', tld: 'de' },  // 2 DE / 3 total
    { subdomain: 'homeday', tld: 'de' },  // 1 DE / 1 total
    { subdomain: 'scalablecapital', tld: 'de' },  // 1 DE / 1 total
    { subdomain: 'bigpoint', tld: 'de' },  // 1 DE / 2 total
    { subdomain: 'userlane', tld: 'de' },  // 1 DE / 6 total
    { subdomain: 'retresco', tld: 'de' },  // 1 DE / 1 total
    { subdomain: 'workpath', tld: 'de' },  // 1 DE / 1 total
    { subdomain: 'assistme', tld: 'de' },  // 1 DE / 2 total
    { subdomain: 'banxware', tld: 'de' },  // 1 DE / 1 total
    { subdomain: 'foodforecast', tld: 'de' },  // 1 DE / 4 total
    { subdomain: 'peeriot', tld: 'de' },  // 1 DE / 3 total
    { subdomain: 'quantica', tld: 'de' },  // 1 DE / 4 total
    { subdomain: 'vara', tld: 'de' },  // 1 DE / 2 total
    { subdomain: 'doinstruct', tld: 'com' },  // 1 DE / 3 total
    { subdomain: 'voize', tld: 'com' },  // 1 DE / 2 total
    // --- GERMAN EXPANSION 2026-08-05 ---
    // Verified: board reachable AND >=1 job located in Germany.
    { subdomain: 'yoshi', tld: 'de' },  // 6 DE / 7 total
    { subdomain: 'wos', tld: 'de' },  // 6 DE / 40 total
    // --- GERMAN EXPANSION 2026-08-05 ---
    // Verified: board reachable AND >=1 job located in Germany.
    { subdomain: 'sam', tld: 'de' },  // 5 DE / 6 total
    { subdomain: 'yuma', tld: 'de' },  // 2 DE / 2 total
    { subdomain: 'ten', tld: 'de' },  // 2 DE / 3 total
    { subdomain: 'verso', tld: 'de' },  // 2 DE / 3 total
    { subdomain: 'beglaubigt', tld: 'de' },  // 2 DE / 3 total
    // --- GERMAN EXPANSION 2026-08-05 ---
    // Verified: board reachable AND >=1 job located in Germany.
    { subdomain: 'gus-germany', tld: 'de' },  // 115 DE / 144 total
    { subdomain: 'deltavision', tld: 'de' },  // 25 DE / 25 total
    { subdomain: 'homeserve', tld: 'de' },  // 19 DE / 184 total
    { subdomain: 'tonies', tld: 'de' },  // 17 DE / 19 total
    { subdomain: 'q-energy', tld: 'de' },  // 15 DE / 16 total
    { subdomain: 'klickpiloten', tld: 'de' },  // 12 DE / 13 total
    { subdomain: 'hygh', tld: 'de' },  // 12 DE / 13 total
    { subdomain: 'kalo-vor-ort', tld: 'de' },  // 8 DE / 11 total
    { subdomain: 'maltego', tld: 'de' },  // 7 DE / 9 total
    { subdomain: 'cipsoft', tld: 'de' },  // 5 DE / 6 total
    { subdomain: 'lrz', tld: 'de' },  // 5 DE / 5 total
    { subdomain: 'aleno', tld: 'de' },  // 3 DE / 3 total
    { subdomain: 'deepslate', tld: 'de' },  // 2 DE / 3 total
    { subdomain: 'pergolux', tld: 'de' },  // 1 DE / 5 total
    { subdomain: 'limehome', tld: 'de' },  // 1 DE / 1 total
    // --- GERMAN EXPANSION 2026-08-05 ---
    // Verified: board reachable AND >=1 job located in Germany.
    { subdomain: 'xitaso', tld: 'de' },  // 103 DE / 118 total
    { subdomain: 'nexia', tld: 'de' },  // 86 DE / 105 total
    { subdomain: 'dornier-group', tld: 'de' },  // 36 DE / 57 total
    { subdomain: 'krankenhaus-waldfriede', tld: 'de' },  // 35 DE / 39 total
    { subdomain: 'lush', tld: 'de' },  // 35 DE / 49 total
    { subdomain: 'policum-berlin', tld: 'de' },  // 15 DE / 15 total
    { subdomain: 'orderbird', tld: 'de' },  // 14 DE / 19 total
    { subdomain: 'smartbroker', tld: 'de' },  // 9 DE / 14 total
    { subdomain: 'dampsoft', tld: 'de' },  // 8 DE / 11 total
    { subdomain: 'bettercallpaul', tld: 'de' },  // 6 DE / 12 total
    { subdomain: 'ijgd', tld: 'de' },  // 5 DE / 6 total
    { subdomain: 'rebike-mobility', tld: 'de' },  // 4 DE / 20 total
    { subdomain: 'remind-me', tld: 'de' },  // 4 DE / 5 total
    { subdomain: 'eon-home', tld: 'de' },  // 4 DE / 6 total
    { subdomain: 'anextour', tld: 'de' },  // 2 DE / 2 total
    { subdomain: 'aok-connect', tld: 'de' },  // 2 DE / 2 total
    { subdomain: 'forum-berufsbildung', tld: 'de' },  // 2 DE / 25 total
    { subdomain: 'eam-trusted-advisor', tld: 'de' },  // 1 DE / 4 total
    // --- GERMAN EXPANSION 2026-08-05 ---
    // Verified: board reachable AND >=1 job located in Germany.
    { subdomain: 'codecentric', tld: 'de' },  // 205 DE / 267 total
    { subdomain: 'zollsoft', tld: 'de' },  // 174 DE / 903 total
    { subdomain: 'scalian-germany', tld: 'de' },  // 131 DE / 163 total
    { subdomain: 'apoprojekt', tld: 'de' },  // 107 DE / 115 total
    { subdomain: 'ommax', tld: 'de' },  // 102 DE / 178 total
    { subdomain: '1sp-agency', tld: 'de' },  // 80 DE / 190 total
    { subdomain: 'acture-germany', tld: 'de' },  // 80 DE / 80 total
    { subdomain: 'novotergum', tld: 'de' },  // 52 DE / 173 total
    { subdomain: 'dataciders', tld: 'de' },  // 50 DE / 83 total
    { subdomain: 'communardo', tld: 'de' },  // 44 DE / 107 total
    { subdomain: 'logsol', tld: 'de' },  // 37 DE / 44 total
    { subdomain: 'vantis', tld: 'de' },  // 35 DE / 37 total
    { subdomain: 'meierhofer', tld: 'de' },  // 30 DE / 44 total
    { subdomain: 'meindentist', tld: 'de' },  // 28 DE / 28 total
    { subdomain: 'encoviva', tld: 'de' },  // 26 DE / 32 total
    { subdomain: 'solactive', tld: 'de' },  // 24 DE / 31 total
    { subdomain: 'hedikitas', tld: 'de' },  // 23 DE / 26 total
    { subdomain: 'carbyte', tld: 'de' },  // 22 DE / 52 total
    { subdomain: 'konfetti', tld: 'de' },  // 21 DE / 21 total
    { subdomain: 'secida', tld: 'de' },  // 21 DE / 31 total
    { subdomain: 'dpa', tld: 'de' },  // 20 DE / 22 total
    { subdomain: 'dymatrix', tld: 'de' },  // 20 DE / 21 total
    { subdomain: 'attempto', tld: 'de' },  // 18 DE / 19 total
    { subdomain: '42watt', tld: 'de' },  // 18 DE / 22 total
    { subdomain: 'entroservice', tld: 'de' },  // 17 DE / 28 total
    { subdomain: 'doctarigroup', tld: 'de' },  // 16 DE / 18 total
    { subdomain: 'legalhero', tld: 'de' },  // 15 DE / 28 total
    { subdomain: 'allane', tld: 'de' },  // 15 DE / 24 total
    { subdomain: 'grandir', tld: 'de' },  // 15 DE / 19 total
    { subdomain: 'lautsprecherteufel', tld: 'de' },  // 14 DE / 15 total
    { subdomain: 'odonnell-moonshine', tld: 'de' },  // 13 DE / 15 total
    { subdomain: 'driving-sales-group', tld: 'de' },  // 13 DE / 23 total
    { subdomain: 'nscon', tld: 'de' },  // 12 DE / 19 total
    { subdomain: 'proliance', tld: 'de' },  // 12 DE / 16 total
    { subdomain: 'contabo', tld: 'de' },  // 12 DE / 14 total
    { subdomain: 'dnsnet', tld: 'de' },  // 11 DE / 17 total
    { subdomain: 'aer-group', tld: 'de' },  // 11 DE / 11 total
    { subdomain: 'peak-one', tld: 'de' },  // 11 DE / 11 total
    { subdomain: 'airmo', tld: 'de' },  // 10 DE / 14 total
    { subdomain: 'seniovo', tld: 'de' },  // 10 DE / 14 total
    { subdomain: 'valuenet-group', tld: 'de' },  // 10 DE / 34 total
    { subdomain: 'funkeworks', tld: 'de' },  // 9 DE / 9 total
    { subdomain: 'dgf', tld: 'de' },  // 9 DE / 11 total
    { subdomain: 'green-flexibility', tld: 'de' },  // 9 DE / 32 total
    { subdomain: 'ckm-group', tld: 'de' },  // 8 DE / 11 total
    { subdomain: 'syseleven', tld: 'de' },  // 8 DE / 8 total
    { subdomain: 'saeki', tld: 'de' },  // 8 DE / 12 total
    { subdomain: 'jobrad-loop', tld: 'de' },  // 8 DE / 43 total
    { subdomain: 'kompetenz-jugendhilfe', tld: 'de' },  // 7 DE / 9 total
    { subdomain: 'promodata', tld: 'de' },  // 7 DE / 25 total
    { subdomain: 'vdwbayern', tld: 'de' },  // 6 DE / 9 total
    { subdomain: 'gustavogusto', tld: 'de' },  // 6 DE / 17 total
    { subdomain: 'kinderwelt-hamburg', tld: 'de' },  // 6 DE / 22 total
    { subdomain: 'demecan', tld: 'de' },  // 5 DE / 6 total
    { subdomain: 'nordsee', tld: 'de' },  // 5 DE / 6 total
    { subdomain: 'tauw', tld: 'de' },  // 5 DE / 6 total
    { subdomain: 'invia', tld: 'de' },  // 5 DE / 6 total
    { subdomain: 'ftapi', tld: 'de' },  // 5 DE / 5 total
    { subdomain: 'ambrock', tld: 'de' },  // 5 DE / 6 total
    { subdomain: 'hiq', tld: 'de' },  // 5 DE / 5 total
    { subdomain: 'noventive', tld: 'de' },  // 5 DE / 9 total
    { subdomain: 'navax-software', tld: 'de' },  // 5 DE / 5 total
    { subdomain: 'dmcgroup', tld: 'de' },  // 5 DE / 6 total
    { subdomain: 'assenagon', tld: 'de' },  // 5 DE / 6 total
    { subdomain: 'enernovix', tld: 'de' },  // 5 DE / 5 total
    { subdomain: 'kaiserwetter', tld: 'de' },  // 5 DE / 5 total
    { subdomain: 'autorola', tld: 'de' },  // 5 DE / 5 total
    { subdomain: 'aroundhome', tld: 'de' },  // 4 DE / 5 total
    { subdomain: 'timify', tld: 'de' },  // 4 DE / 4 total
    { subdomain: 'univativ-group', tld: 'de' },  // 4 DE / 4 total
    { subdomain: 'darkside', tld: 'de' },  // 4 DE / 4 total
    { subdomain: 'mavig', tld: 'de' },  // 4 DE / 4 total
    { subdomain: 'qaware', tld: 'de' },  // 4 DE / 5 total
    { subdomain: 'ubilabs', tld: 'de' },  // 4 DE / 4 total
    { subdomain: 'novomind', tld: 'de' },  // 4 DE / 11 total
    { subdomain: 'bring-labs', tld: 'de' },  // 3 DE / 6 total
    { subdomain: 'publiccloudgroup', tld: 'de' },  // 3 DE / 6 total
    { subdomain: 'dedicom', tld: 'de' },  // 3 DE / 3 total
    { subdomain: 'btelligent', tld: 'de' },  // 3 DE / 3 total
    { subdomain: 'ryd', tld: 'de' },  // 3 DE / 5 total
    { subdomain: 'frommer-legal', tld: 'de' },  // 3 DE / 3 total
    { subdomain: 'conet', tld: 'de' },  // 2 DE / 3 total
    { subdomain: 'stiftung-spi', tld: 'de' },  // 2 DE / 3 total
    { subdomain: 'cybercurriculum', tld: 'de' },  // 2 DE / 3 total
    { subdomain: 'gustavepple', tld: 'de' },  // 2 DE / 2 total
    { subdomain: 'pta', tld: 'de' },  // 2 DE / 3 total
    { subdomain: 'euro-trainings-centre-etc-ggmbh', tld: 'de' },  // 2 DE / 3 total
    { subdomain: 'fellowpro', tld: 'de' },  // 2 DE / 3 total
    { subdomain: '59engineers', tld: 'de' },  // 2 DE / 2 total
    { subdomain: 'pdv', tld: 'de' },  // 2 DE / 3 total
    { subdomain: 'urari', tld: 'de' },  // 1 DE / 6 total
    { subdomain: 'mindeight', tld: 'de' },  // 1 DE / 2 total
    { subdomain: 'wbg-friedrichshain', tld: 'de' },  // 1 DE / 1 total
    { subdomain: 'greenit', tld: 'de' },  // 1 DE / 1 total
    { subdomain: 'bidt', tld: 'de' },  // 1 DE / 1 total
    { subdomain: 'pramlgroup', tld: 'de' },  // 1 DE / 26 total
    { subdomain: 'ebp-consulting', tld: 'de' },  // 1 DE / 1 total
    { subdomain: 'yer-deutschland', tld: 'de' },  // 1 DE / 1 total
    { subdomain: 'optikhallmann', tld: 'de' },  // 1 DE / 14 total
    { subdomain: 'welearn', tld: 'de' },  // 1 DE / 2 total
    // --- GERMAN EXPANSION 2026-08-05 ---
    // Verified: board reachable AND >=1 job located in Germany.
    { subdomain: '1komma5grad', tld: 'de' },  // 527 DE / 1796 total
    { subdomain: 'ambior-gmbh', tld: 'de' },  // 72 DE / 96 total
    { subdomain: 'academia-holding-gmbh', tld: 'de' },  // 42 DE / 80 total
    { subdomain: 'armira-beteiligungen-gmbh-co-kg', tld: 'de' },  // 10 DE / 10 total
    { subdomain: 'adsquare', tld: 'de' },  // 9 DE / 16 total
    { subdomain: 'atgde', tld: 'de' },  // 8 DE / 8 total
    { subdomain: 'amplio', tld: 'de' },  // 6 DE / 10 total
    { subdomain: 'adragos-leipzig', tld: 'de' },  // 5 DE / 5 total
    { subdomain: 'amnesty-international-deutschland', tld: 'de' },  // 4 DE / 4 total
    { subdomain: 'aktivbank', tld: 'de' },  // 2 DE / 2 total
    { subdomain: 'antenne-deutschland', tld: 'de' },  // 2 DE / 2 total
    { subdomain: '55birchstreet', tld: 'de' },  // 1 DE / 1 total
    { subdomain: 'abcfinlab', tld: 'de' },  // 1 DE / 2 total
    { subdomain: 'ams-technologies-ag', tld: 'de' },  // 1 DE / 1 total
    { subdomain: 'anybill', tld: 'de' },  // 1 DE / 1 total
    { subdomain: 'aserto', tld: 'de' },  // 1 DE / 1 total
    { subdomain: 'audi-business-innovation-gmbh', tld: 'de' },  // 1 DE / 1 total
    // --- GERMAN EXPANSION 2026-08-05 ---
    // Verified: board reachable AND >=1 job located in Germany.
    { subdomain: 'bauer-elektroanlagen', tld: 'de' },  // 89 DE / 209 total
    { subdomain: 'project-a', tld: 'de' },  // 48 DE / 48 total
    { subdomain: 'hornetsecurity', tld: 'de' },  // 39 DE / 116 total
    { subdomain: 'bergmanclinics', tld: 'de' },  // 33 DE / 64 total
    { subdomain: 'autohaus-royal', tld: 'de' },  // 33 DE / 33 total
    { subdomain: 'autohaus-bleker-gmbh', tld: 'de' },  // 29 DE / 104 total
    { subdomain: 'meteocontrol', tld: 'de' },  // 28 DE / 47 total
    { subdomain: 'artnight-gmbh', tld: 'de' },  // 25 DE / 45 total
    { subdomain: 'undkrauss', tld: 'de' },  // 23 DE / 25 total
    { subdomain: 'moore-tk', tld: 'de' },  // 20 DE / 68 total
    { subdomain: 'carpus', tld: 'de' },  // 17 DE / 19 total
    { subdomain: 'okapiorbits', tld: 'de' },  // 16 DE / 18 total
    { subdomain: 'autarcenergy', tld: 'de' },  // 15 DE / 15 total
    { subdomain: 'finetech', tld: 'de' },  // 15 DE / 15 total
    { subdomain: 'auxmoney-gmbh', tld: 'de' },  // 14 DE / 16 total
    { subdomain: 'asg', tld: 'de' },  // 14 DE / 15 total
    { subdomain: 'p3-security', tld: 'de' },  // 14 DE / 27 total
    { subdomain: 'homaris', tld: 'de' },  // 13 DE / 14 total
    { subdomain: 'ba-tax-gmbh', tld: 'de' },  // 12 DE / 12 total
    { subdomain: 'raible', tld: 'de' },  // 12 DE / 22 total
    { subdomain: 'maxsolar', tld: 'de' },  // 12 DE / 20 total
    { subdomain: 'berlinhaus-verwaltung-gmbh', tld: 'de' },  // 11 DE / 23 total
    { subdomain: 'steadforce', tld: 'de' },  // 11 DE / 11 total
    { subdomain: 'bell-flavors-fragrances-gmbh', tld: 'de' },  // 10 DE / 11 total
    { subdomain: 'greenwind-group', tld: 'de' },  // 10 DE / 35 total
    { subdomain: 'timpla', tld: 'de' },  // 9 DE / 29 total
    { subdomain: 'asellerate-gmbh', tld: 'de' },  // 8 DE / 9 total
    { subdomain: 'albaberlin', tld: 'de' },  // 8 DE / 8 total
    { subdomain: 'dornier-medtech', tld: 'de' },  // 8 DE / 8 total
    { subdomain: 'crozdach', tld: 'de' },  // 8 DE / 17 total
    { subdomain: 'bralebau', tld: 'de' },  // 7 DE / 15 total
    { subdomain: 'norsan', tld: 'de' },  // 7 DE / 8 total
    { subdomain: 'mehr-ampere', tld: 'de' },  // 7 DE / 9 total
    { subdomain: 'gel-express-logistik', tld: 'de' },  // 6 DE / 22 total
    { subdomain: 'ifg', tld: 'de' },  // 6 DE / 9 total
    { subdomain: 'softdoor', tld: 'de' },  // 6 DE / 18 total
    { subdomain: 'solareins', tld: 'de' },  // 5 DE / 16 total
    { subdomain: 'klebl', tld: 'de' },  // 5 DE / 6 total
    { subdomain: 'tng', tld: 'de' },  // 5 DE / 6 total
    { subdomain: 'tum', tld: 'de' },  // 5 DE / 6 total
    { subdomain: 'ass', tld: 'de' },  // 4 DE / 4 total
    { subdomain: 'aw-algorithmwatch-ggmbh', tld: 'de' },  // 4 DE / 5 total
    { subdomain: 'bauer-kirch', tld: 'de' },  // 3 DE / 3 total
    { subdomain: 'scrapbees', tld: 'de' },  // 3 DE / 11 total
    { subdomain: 'honest-catch', tld: 'de' },  // 3 DE / 3 total
    { subdomain: 'aventus', tld: 'de' },  // 2 DE / 4 total
    { subdomain: 'bfgroup', tld: 'de' },  // 2 DE / 10 total
    { subdomain: 'ampere', tld: 'de' },  // 2 DE / 5 total
    { subdomain: 'aparts', tld: 'de' },  // 2 DE / 3 total
    { subdomain: 'landenberg-medical-institute', tld: 'de' },  // 2 DE / 3 total
    { subdomain: 'yepp', tld: 'de' },  // 2 DE / 2 total
    { subdomain: 'personal-partner', tld: 'de' },  // 2 DE / 3 total
    { subdomain: 'gti-elektroanlagen', tld: 'de' },  // 2 DE / 3 total
    { subdomain: 'fair-parken', tld: 'de' },  // 2 DE / 3 total
    { subdomain: 'flowprime', tld: 'de' },  // 2 DE / 5 total
    { subdomain: 'ghcsolutions', tld: 'de' },  // 2 DE / 3 total
    { subdomain: 'gutachterix', tld: 'de' },  // 2 DE / 3 total
    { subdomain: 'baeuerle', tld: 'de' },  // 1 DE / 3 total
    { subdomain: 'com-in', tld: 'de' },  // 1 DE / 1 total
    { subdomain: 'swiss-sense', tld: 'de' },  // 1 DE / 1 total
],

    // Internal state
    _allJobsQueue: [],
    _initialized: false,

    // ─── Initialize: fetch all XML feeds upfront ──────────────────────────
    async initialize() {
        if (this._initialized) return;

        console.log(`[Personio] Fetching jobs from ${this.companyTargets.length} companies...`);

        let successCount = 0;
        let failCount = 0;

        for (const target of this.companyTargets) {
            const { subdomain, tld } = target;
            const url = `https://${subdomain}.jobs.personio.${tld}/xml?language=en`;

            try {
                const response = await fetch(url, {
                    headers: { 'Accept': 'application/xml,text/xml' },
                });

                if (!response.ok) {
                    failCount++;
                    console.log(`[Personio] ❌ ${subdomain}: HTTP ${response.status}`);
                    continue;
                }

                const xmlText = await response.text();
                const parsed = xmlParser.parse(xmlText);
                const positions = parsed?.['workzag-jobs']?.position || [];

                if (positions.length === 0) {
                    continue;
                }

                // Filter to Germany jobs only — checks office + additionalOffices
                const germanyJobs = positions
                    .filter(job => this.isGermanyJob(job))
                    .map(job => ({
                        ...job,
                        _subdomain: subdomain,
                        _tld: tld,
                    }));

                if (germanyJobs.length > 0) {
                    console.log(`[Personio] ✅ ${subdomain}: ${germanyJobs.length} jobs in Germany (${positions.length} total)`);
                    this._allJobsQueue.push(...germanyJobs);
                    successCount++;
                }

                // Be polite — 500ms between companies
                await new Promise(resolve => setTimeout(resolve, 500));

            } catch (error) {
                failCount++;
                console.error(`[Personio] ❌ ${subdomain}: ${error.message}`);
            }
        }

        console.log(`[Personio] 📊 Summary: ${successCount} companies with Germany jobs, ${failCount} failed`);
        console.log(`[Personio] 💼 Total jobs found: ${this._allJobsQueue.length}`);
        this._initialized = true;
    },

    // ─── Required by scraperEngine ────────────────────────────────────────
    async fetchPage(offset, limit) {
        if (!this._initialized) await this.initialize();
        const jobs = this._allJobsQueue.slice(offset, offset + limit);
        return { jobs, total: this._allJobsQueue.length };
    },

    getJobs(data) { return data.jobs || []; },
    getTotal(data) { return data.total || 0; },

    // ─── Germany detection ────────────────────────────────────────────────
    // Checks primary office + every additionalOffices entry.
    isGermanyJob(job) {
        const offices = this.collectAllOffices(job);
        return offices.some(loc => isGermanyString(loc));
    },

    isGermanyLocation(location) {
        return isGermanyString(location);
    },

    // ─── Helpers ──────────────────────────────────────────────────────────
    collectAllOffices(job) {
        const offices = [];
        if (job.office) offices.push(job.office);
        const extras = job.additionalOffices?.office;
        if (Array.isArray(extras)) {
            offices.push(...extras);
        } else if (typeof extras === 'string' && extras) {
            offices.push(extras);
        }
        return offices;
    },

    // ─── Field extractors ─────────────────────────────────────────────────
    extractJobID(job) {
        return `personio_${job._subdomain}_${job.id}`;
    },

    extractJobTitle(job) {
        return job.name || '';
    },

    extractCompany(job) {
        // Prefer subcompany if present (the legal entity Personio shows)
        if (job.subcompany) return job.subcompany;
        // Fallback: format the subdomain into a readable name
        return String(job._subdomain || '')
            .split(/[-_]/)
            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
    },

    extractLocation(job) {
        return job.office || 'Germany';
    },

    extractAllLocations(job) {
        return normalizeArray(this.collectAllOffices(job));
    },

    extractCountry(job) {
        // Personio offices are city-only ("Berlin", not "Berlin, Germany").
        // Use isGermanyString helper which knows German city names.
        const offices = this.collectAllOffices(job);
        if (offices.some(loc => isGermanyString(loc))) return 'DE';
        return null;
    },

    extractDescription(job) {
        return assembleDescription(job.jobDescriptions, false);
    },

    extractDescriptionHtml(job) {
        return SanitizeHtml(assembleDescription(job.jobDescriptions, true));
    },

    extractURL(job) {
        // Personio doesn't ship a direct URL in the feed. Construct it from
        // {subdomain}.jobs.personio.{tld}/job/{id}?language=en.
        return `https://${job._subdomain}.jobs.personio.${job._tld}/job/${job.id}?language=en`;
    },

    extractDirectApplyURL(job) {
        // Same URL — Personio's job page IS the apply page (in-page form).
        return `https://${job._subdomain}.jobs.personio.${job._tld}/job/${job.id}?language=en`;
    },

    extractPostedDate(job) {
        return job.createdAt || null;
    },

    extractDepartment(job) {
        return job.department || job.recruitingCategory || 'N/A';
    },

    extractTeam(job) {
        return job.department || null;
    },

    extractOffice(job) {
        return job.office || null;
    },

    extractEmploymentType(job) {
        return normalizeEmploymentType(job.employmentType);
    },

    extractContractType(job) {
        const sched = String(job.schedule || '').toLowerCase();
        return SCHEDULE_MAP[sched] || job.schedule || null;
    },

    extractWorkplaceType(job) {
        // Office string sometimes contains "Remote Berlin" — infer from there.
        const offices = this.collectAllOffices(job).join(' ').toLowerCase();
        if (offices.includes('remote')) return 'Remote';
        if (offices.includes('hybrid')) return 'Hybrid';
        return normalizeWorkplaceType('Unspecified');
    },

    extractIsRemote(job) {
        const offices = this.collectAllOffices(job).join(' ').toLowerCase();
        return offices.includes('remote');
    },

    extractExperienceLevel(job) {
        const sen = String(job.seniority || '').toLowerCase();
        return SENIORITY_MAP[sen] || 'N/A';
    },

    extractTags(job) {
        if (!job.keywords) return [];
        return normalizeArray(
            String(job.keywords).split(',').map(t => t.trim()).filter(Boolean)
        );
    },

    // ─── Salary (Personio gives this directly, no text parsing needed!) ──
    extractSalaryMin(job) {
        const raw = job.salaryInformation?.min;
        const num = Number(raw);
        return Number.isFinite(num) && num > 0 ? num : null;
    },

    extractSalaryMax(job) {
        const raw = job.salaryInformation?.max;
        const num = Number(raw);
        return Number.isFinite(num) && num > 0 ? num : null;
    },

    extractSalaryCurrency(job) {
        return job.salaryInformation?.currencyCode || null;
    },

    extractSalaryInterval(job) {
        const type = String(job.salaryInformation?.type || '').toLowerCase();
        if (type === 'yearly')  return 'per-year-salary';
        if (type === 'monthly') return 'per-month-salary';
        if (type === 'hourly')  return 'per-hour-wage';
        return null;
    },

    // ─── Personio-specific extras (NEW fields on the job document) ────────
    extractYearsOfExperience(job) {
        return job.yearsOfExperience || null;
    },

    extractOccupation(job) {
        return job.occupation || null;
    },

    extractOccupationCategory(job) {
        return job.occupationCategory || null;
    },

    extractRecruitingCategory(job) {
        return job.recruitingCategory || null;
    },

    extractATSPlatform() {
        return 'personio';
    },
};
