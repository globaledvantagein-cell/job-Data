// Keyword lists used by categorizeJob().
// Kept separate from logic so they're easy to scan and update.

// Non-tech roles — checked FIRST so "Product Marketing Manager" → other_nontech.
export const NONTECH_TITLE_KW = [
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
export const DATA_TITLE_KW = [
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
export const SOFTWARE_TITLE_KW = [
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
    ' developer ', ' developer (', ' developer,',
    'developer (f/', 'developer (m/',
    'senior developer', 'junior developer', 'lead developer',
    'c++ engineer', 'rust engineer', 'go engineer', 'java engineer',
    'python engineer', 'javascript engineer', 'typescript engineer',
    'kotlin engineer', 'swift engineer', 'scala engineer',
    'browser engineer', 'compiler engineer', 'kernel engineer',
    'graphics engineer', 'rendering engineer', 'game engineer',
    'gameplay engineer', 'engine engineer',
    'it engineer', 'it support', 'it administrator', 'it application',
    'unix', 'linux engineer',
    'data center', 'datacenter',
    'production engineer',
    'electrical engineer',
    'engineer (m/f', 'engineer (f/m', 'engineer (all',
    'engineer m/f', 'engineer (m/w', 'engineer (d/f', 'engineer (f/d',
];

// Product (PMs / Designers / POs) — checked LAST so Engineer/Marketing catch first.
export const PRODUCT_TITLE_KW = [
    'product manager', 'product owner', 'product lead',
    'program manager', 'program lead',
    'project manager', 'project lead',
    'chief product', 'head of product', 'vp product', 'vp of product',
    'group product', 'lead product',
    'product director', 'director of product',
    'product designer', 'product design manager', 'product design lead',
    'ux designer', 'ui designer',
];

// SubDomain keywords (fallback when title is vague)
export const DATA_SUBDOMAIN_KW = [
    'machine learning', 'ml ', 'ai/bi', 'ai/ml',
    'data platform', 'data office', 'data infrastructure',
    'analytics', 'business intelligence',
    'jcp core machine learning', 'ai group',
];

export const SOFTWARE_SUBDOMAIN_KW = [
    'software engineering', 'engineering',
    'platform engineering', 'infrastructure',
    'devops', 'sre',
    'backend', 'frontend', 'mobile',
    'security', 'qa',
    'deployed engineering',
    'jcp core', 'kotlin', 'python ecosystem', 'c/c++', '.net',
];

export const PRODUCT_SUBDOMAIN_KW = [
    'product management', 'product design',
    'program management',
];

// Manual overrides — when a leak is spotted, add `pattern → category` here.
// The classifier checks these FIRST.
export const OVERRIDES = [
    // examples — add real ones as you find leaks
    // { pattern: 'deployed engineer', category: 'software' },
];
