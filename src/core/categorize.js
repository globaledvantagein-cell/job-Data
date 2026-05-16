/**
 * Job category classifier — 6 buckets total.
 *
 * Top-level:    Technical | Non-Technical
 * Sub-buckets:
 *   Technical:     software | data | product_tech | other_tech
 *   Non-Technical: product_nontech | other_nontech
 *
 * Cascade order (first match wins):
 *   1. OVERRIDES — manual patches for known leaks
 *   2. TITLE keywords — strongest signal (Non-Tech/Marketing checked BEFORE Product,
 *      Data checked BEFORE Software, Software checked BEFORE Product)
 *   3. SUBDOMAIN keywords — backup when title is vague
 *   4. DOMAIN field — coarse fallback
 *   5. PRODUCT split — if a job lands in Product, split into product_tech vs
 *      product_nontech using Domain + SubDomain + Tags
 *
 * Pure function. Run once at scrape time, store result in MongoDB Category field.
 */

export const CATEGORY_LABELS = {
    software:        'Software Engineering',
    data:            'Data / AI',
    product_tech:    'Product (Tech)',
    other_tech:      'Other Technical',
    product_nontech: 'Product (Non-Tech)',
    other_nontech:   'Other Non-Technical',
};

export const CATEGORY_ORDER = [
    'software',
    'data',
    'product_tech',
    'other_tech',
    'product_nontech',
    'other_nontech',
];

export const ALL_CATEGORIES = Object.keys(CATEGORY_LABELS);

// ─── LAYER 1: Manual overrides ─────────────────────────────────────────
// When you spot a misclassified job in production, add a substring → category
// here. The classifier checks this FIRST, so one line beats all keyword rules.
const OVERRIDES = [
    // examples — add real ones as you find leaks
    // { pattern: 'deployed engineer', category: 'software' },
];

// ─── LAYER 2: Title keywords ───────────────────────────────────────────

// Non-tech roles — checked FIRST so "Product Marketing Manager" → other_nontech.
const NONTECH_TITLE_KW = [
    // sales
    'account executive', 'account manager', 'account director',
    'sales manager', 'sales director', 'sales rep', 'sales development',
    'business development', ' bdr', ' sdr', 'revenue manager',
    // marketing (BEFORE product so "Product Marketing" → non-tech)
    'marketing manager', 'marketing director', 'marketing specialist',
    'growth manager', 'brand manager', 'content manager',
    'product marketing', 'email marketing', 'digital marketing',
    'field marketing', 'social media',
    // customer success / support
    'customer success', 'cs manager', 'customer experience', 'cx manager',
    'customer support', 'customer service', 'customer care', 'community manager',
    // hr / people
    'recruiter', 'recruiting', 'talent acquisition', 'talent partner', 'sourcing',
    'people partner', 'people manager', 'hr manager', 'people & culture',
    'hr business', 'human resources',
    // finance / legal / compliance
    'finance manager', 'financial controller', 'accountant', 'accounting',
    'controller', 'auditor', 'audit ', 'tax manager', 'treasury',
    'legal counsel', 'attorney', 'paralegal', 'compliance officer',
    'compliance', 'risk manager', 'risk controller', 'risk analyst',
    // operations
    'procurement', 'purchasing', 'category manager',
    'supply chain', 'logistics', 'warehouse', 'fulfillment',
    'operations manager', 'ops manager', 'business operations',
    'strategic operations',
    // misc non-tech
    'office manager', 'admin assistant', 'executive assistant',
    'partner manager', 'channel partner',
    'consultant', 'business consultant',
    'training manager', 'product trainer',
    'translator', 'clinical', 'dietitian',
];

// Data/AI — checked BEFORE Software to catch "Data Engineer" / "ML Engineer".
const DATA_TITLE_KW = [
    'data scientist', 'data analyst', 'data engineer', 'data architect',
    'data steward', 'data lead', 'data manager',
    'analytics engineer', 'analytics manager', 'analytics lead',
    'growth analytics',
    'machine learning', 'ml engineer', 'mlops', 'ml ops', 'ml researcher',
    'ai engineer', 'ai researcher', 'ai scientist', 'ai/ml', 'ai/bi',
    'genai', 'gen ai', 'llm engineer', 'llm developer',
    'llm pre-training', 'llm post-training', 'llm training', 'prompt engineer',
    'deep learning', 'computer vision', 'nlp engineer',
    'bi engineer', 'bi analyst', 'bi developer', 'business intelligence',
    'data platform', 'data infrastructure', 'data ops', 'dataops',
    'algorithm engineer', 'algorithms engineer',
    'research engineer (llm', 'research scientist',
];

// Software — checked BEFORE Product so "Product Engineer" → software.
const SOFTWARE_TITLE_KW = [
    // pure engineers
    'software engineer', 'software developer', 'software architect',
    'backend', 'back-end', 'back end',
    'frontend', 'front-end', 'front end',
    'fullstack', 'full-stack', 'full stack',
    'devops', 'dev ops', 'sre', 'site reliability',
    'platform engineer', 'infrastructure engineer', 'cloud engineer',
    'ios developer', 'ios engineer', 'android developer', 'android engineer',
    'mobile engineer', 'web developer', 'web engineer',
    'security engineer', 'application security', 'appsec',
    'qa engineer', 'qa automation', 'test engineer', 'sdet', 'test automation',
    'release engineer', 'build engineer',
    'integration engineer', 'developer tools',
    'staff engineer', 'principal engineer',
    'engineering manager', 'engineering director', 'engineering lead',
    'head of engineering', 'director of engineering',
    'tech lead', 'technical lead',
    'firmware', 'embedded',
    'hardware engineer', 'robotics engineer', 'mechatronic',
    'systems engineer', 'system engineer',
    'automation engineer',
    'r&d engineer',
    'salesforce developer', 'salesforce engineer',
    'sap developer', 'sap engineer', 'sap solution architect', 'sap consultant',
    'application engineer', 'applications engineer', 'application owner',
    'product engineer',
    'research engineer',
    'deployed engineer',
    'forward deployed', 'forward deploy',
    'solutions engineer', 'solution engineer',
    'solutions architect', 'solution architect',
    'enterprise architect', 'domain architect',
    'customer engineer', 'field engineer',
    // generic developer
    ' developer ', ' developer (', ' developer,',
    'developer (f/', 'developer (m/',
    'senior developer', 'junior developer', 'lead developer',
    // language-specific engineers
    'c++ engineer', 'rust engineer', 'go engineer', 'java engineer',
    'python engineer', 'javascript engineer', 'typescript engineer',
    'kotlin engineer', 'swift engineer', 'scala engineer',
    'browser engineer', 'compiler engineer', 'kernel engineer',
    'graphics engineer', 'rendering engineer', 'game engineer',
    'gameplay engineer', 'engine engineer',
    // IT but engineering
    'it engineer', 'it support', 'it administrator', 'it application',
    'unix', 'linux engineer',
    'data center', 'datacenter',
    'production engineer',
    'electrical engineer',
    // German gendered title patterns
    'engineer (m/f', 'engineer (f/m', 'engineer (all',
    'engineer m/f', 'engineer (m/w', 'engineer (d/f', 'engineer (f/d',
];

// Product (PMs / Designers / POs) — checked LAST so Engineer/Marketing catch first.
const PRODUCT_TITLE_KW = [
    'product manager', 'product owner', 'product lead',
    'program manager', 'program lead',
    'project manager', 'project lead',
    'chief product', 'head of product', 'vp product', 'vp of product',
    'group product', 'lead product',
    'product director', 'director of product',
    'product designer', 'product design manager', 'product design lead',
    'ux designer', 'ui designer',
];

// ─── LAYER 3: SubDomain keywords ───────────────────────────────────────
const DATA_SUBDOMAIN_KW = [
    'machine learning', 'ml ', 'ai/bi', 'ai/ml',
    'data platform', 'data office', 'data infrastructure',
    'analytics', 'business intelligence',
    'jcp core machine learning', 'ai group',
];

const SOFTWARE_SUBDOMAIN_KW = [
    'software engineering', 'engineering',
    'platform engineering', 'infrastructure',
    'devops', 'sre',
    'backend', 'frontend', 'mobile',
    'security', 'qa',
    'deployed engineering',
    'jcp core', 'kotlin', 'python ecosystem', 'c/c++', '.net',
];

const PRODUCT_SUBDOMAIN_KW = [
    'product management', 'product design',
    'program management',
];

// ─── Helpers ───────────────────────────────────────────────────────────

function lower(s) {
    return (s ?? '').toString().toLowerCase();
}

function pad(s) {
    return ` ${s} `;
}

function anyMatch(haystack, keywords) {
    for (const kw of keywords) {
        if (haystack.includes(kw)) return true;
    }
    return false;
}

/**
 * Classify one job into one of the 6 Category buckets.
 *
 * Expected fields on the job (all optional except domain hint):
 *   JobTitle, Department, SubDomain, Domain ('Technical'|'Non-Technical'), Tags
 *
 * Returns: one of CATEGORY_ORDER values, never null/undefined.
 */
export function categorizeJob(job) {
    if (!job) return 'other_nontech';

    const title = pad(lower(job.JobTitle));
    const subdomain = pad(lower(job.SubDomain));
    const department = pad(lower(job.Department));

    // ── LAYER 1: Manual overrides ──
    for (const ov of OVERRIDES) {
        if (title.includes(ov.pattern.toLowerCase())) {
            return ov.category;
        }
    }

    // ── LAYER 2: Title keywords ──
    if (anyMatch(title, NONTECH_TITLE_KW)) return 'other_nontech';
    if (anyMatch(title, DATA_TITLE_KW))    return 'data';
    if (anyMatch(title, SOFTWARE_TITLE_KW)) return 'software';
    if (anyMatch(title, PRODUCT_TITLE_KW)) return splitProduct(job);

    // ── LAYER 3: SubDomain keywords ──
    if (anyMatch(subdomain, DATA_SUBDOMAIN_KW))     return 'data';
    if (anyMatch(subdomain, SOFTWARE_SUBDOMAIN_KW)) return 'software';
    if (anyMatch(subdomain, PRODUCT_SUBDOMAIN_KW))  return splitProduct(job);

    // Also try Department field as a last keyword check
    if (anyMatch(department, SOFTWARE_SUBDOMAIN_KW)) return 'software';
    if (anyMatch(department, DATA_SUBDOMAIN_KW))     return 'data';

    // ── LAYER 4: Domain fallback ──
    return job.Domain === 'Technical' ? 'other_tech' : 'other_nontech';
}

/**
 * Decide if a Product role is Tech-PM or Non-Tech-PM.
 */
function splitProduct(job) {
    if (job.Domain === 'Technical')     return 'product_tech';
    if (job.Domain === 'Non-Technical') return 'product_nontech';

    // Domain missing — check SubDomain for tech hints
    const subdomain = lower(job.SubDomain);
    if (anyMatch(subdomain, SOFTWARE_SUBDOMAIN_KW.concat(DATA_SUBDOMAIN_KW))) {
        return 'product_tech';
    }

    // Last resort — check tags
    const tagsStr = (Array.isArray(job.Tags) ? job.Tags : []).join(' ').toLowerCase();
    if (anyMatch(tagsStr, ['engineering', 'software', 'cloud', 'platform', 'data', 'ai'])) {
        return 'product_tech';
    }

    return 'product_nontech';
}