/**
 * Server-rendered HTML for the SEO landing pages.
 *
 * These are plain Express-rendered pages, NOT React routes — crawlers get real
 * markup in the initial response with no JS execution required.
 *
 * Deliberately NOT rendered here: job descriptions. They are gated behind
 * /api/jobs/:id/full and must never leak into crawlable HTML or JSON-LD.
 */
import { CANONICAL_CITIES } from './cities.js';
import { CATEGORY_LABELS, CATEGORY_ORDER } from '../core/categorize.js';
import { SITE_URL } from '../env.js';

/** Escapes text for safe interpolation into HTML text nodes and attributes. */
export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Escapes a string for embedding inside a <script type="application/ld+json">
 * block. JSON.stringify alone is not enough — a literal "</script>" inside any
 * value would terminate the block early and allow HTML injection.
 */
export function serializeJsonLd(data) {
    return JSON.stringify(data).replace(/</g, '\\u003c');
}

// Brand design system, inline (SSR — no external stylesheet). Colours and the
// warm "Paper + Ink" cream match the React app so crossing from the SPA to a
// city page never feels like a different site. Shared by the career-guide
// templates too (they import PAGE_STYLE), so this is the single source of truth.
export const PAGE_STYLE = `
  :root {
    color-scheme: light dark;
    --brand: #059669;
    --brand-dark: #047857;
    --brand-soft: #ecfdf5;
    --text: #1a1a1a;
    --muted: #5f6b66;
    --bg: #f9f6f1;
    --card: #ffffff;
    --border: #e7e2d9;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --brand: #34d399; --brand-dark: #10b981; --brand-soft: #0e2a20;
      --text: #ececec; --muted: #a3a89f; --bg: #14120f; --card: #1c1a16; --border: #2e2a23;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
         background: var(--bg); color: var(--text); line-height: 1.6; -webkit-font-smoothing: antialiased; }
  a { color: var(--brand); }

  /* Header + footer chrome */
  .site-header { border-bottom: 1px solid var(--border); background: var(--card); }
  .site-header .bar, .site-footer .bar { max-width: 1200px; margin: 0 auto; padding: 14px 20px;
         display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
  .logo { font-weight: 800; font-size: 1.15rem; letter-spacing: -0.02em; color: var(--text); text-decoration: none; }
  .logo b { color: var(--brand); font-weight: 800; }
  .site-header .navlinks a { color: var(--muted); text-decoration: none; font-size: 0.88rem; font-weight: 600; margin-left: 20px; }
  .site-header .navlinks a:hover { color: var(--text); }
  .site-footer { border-top: 1px solid var(--border); background: var(--card); margin-top: 56px; }
  .site-footer .bar { font-size: 0.82rem; color: var(--muted); }
  .site-footer a { color: var(--muted); text-decoration: none; margin-left: 16px; }
  .site-footer a:hover { color: var(--text); }

  .wrap { max-width: 1200px; margin: 0 auto; padding: 44px 20px 24px; }

  /* Hero */
  .hero { margin: 0 0 24px; }
  h1 { font-size: clamp(1.7rem, 4vw, 2.6rem); line-height: 1.15; letter-spacing: -0.02em; margin: 0 0 8px; color: var(--text); }
  .count { color: var(--muted); margin: 0; font-size: 1.05rem; }

  /* Job card grid — 3 / 2 / 1 columns */
  .job-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin: 28px 0 32px; }
  .job-card { display: flex; flex-direction: column; gap: 8px; min-height: 118px;
         background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 16px;
         text-decoration: none; color: inherit;
         transition: border-color 0.16s ease, box-shadow 0.16s ease; }
  .job-card:hover { border-color: var(--brand); box-shadow: 0 4px 16px rgba(0,0,0,0.06); }
  .job-card .title { font-weight: 700; font-size: 0.98rem; line-height: 1.35; color: var(--text); }
  .job-card .company { font-size: 0.85rem; color: var(--muted); }
  .badge { align-self: flex-start; margin-top: auto; font-size: 0.72rem; font-weight: 600;
         padding: 3px 10px; border-radius: 999px; background: var(--brand-soft); color: var(--brand-dark); }

  .cta { display: inline-block; background: var(--brand); color: #fff; text-decoration: none;
         padding: 12px 22px; border-radius: 10px; font-weight: 700; font-size: 0.95rem;
         transition: background-color 0.16s ease; }
  .cta:hover { background: var(--brand-dark); }
  .meta { color: var(--muted); font-size: 0.86rem; margin: 4px 0 0; }
  .empty { color: var(--muted); }

  /* Cross-link pills */
  nav.links { margin-top: 44px; border-top: 1px solid var(--border); padding-top: 24px; }
  nav.links h2 { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 0 0 10px; }
  nav.links a { display: inline-block; margin: 0 8px 8px 0; font-size: 0.85rem; color: var(--muted);
         text-decoration: none; border: 1px solid var(--border); border-radius: 999px; padding: 4px 12px;
         transition: border-color 0.16s ease, color 0.16s ease; }
  nav.links a:hover { border-color: var(--brand); color: var(--brand); }

  @media (max-width: 900px) { .job-grid { grid-template-columns: repeat(2, 1fr); } }
  @media (max-width: 600px) { .job-grid { grid-template-columns: 1fr; } .wrap { padding: 28px 16px 16px; } }
`;

/** Shared brand header bar — logo links home, plus the main nav for crawl paths. */
export function renderHeader() {
    return `<header class="site-header"><div class="bar">
  <a class="logo" href="${SITE_URL}/">English <b>Jobs</b></a>
  <nav class="navlinks">
    <a href="${SITE_URL}/jobs">Browse Jobs</a>
    <a href="${SITE_URL}/directory">Companies</a>
    <a href="${SITE_URL}/career-guide">Career Guide</a>
  </nav>
</div></header>`;
}

/** Shared brand footer — copyright + legal/contact links. */
export function renderFooter() {
    const year = new Date().getFullYear();
    return `<footer class="site-footer"><div class="bar">
  <span>&copy; ${year} English Jobs in Germany</span>
  <nav>
    <a href="${SITE_URL}/legal?tab=privacy">Privacy</a>
    <a href="${SITE_URL}/legal?tab=terms">Terms</a>
    <a href="mailto:support@englishjobsgermany.com">Contact</a>
  </nav>
</div></footer>`;
}

/**
 * Shared page skeleton — head tags, OG/Twitter cards, canonical, JSON-LD.
 */
function renderShell({ title, description, canonicalPath, heading, countLine, jobs, totalCount, ctaHref, ctaLabel, jsonLd }) {
    const canonicalUrl = `${SITE_URL}${canonicalPath}`;

    // The list is capped, but the count reflects the real total — so say so
    // rather than silently implying these are all of them.
    const moreHtml = totalCount > jobs.length
        ? `<p class="meta" style="margin: 0 0 24px">Showing ${jobs.length} of ${totalCount} jobs. <a href="${escapeHtml(ctaHref)}">See all ${totalCount}</a>.</p>`
        : '';

    const jobsHtml = jobs.length === 0
        ? `<p class="empty">No open roles here right now. New jobs are added every day — <a href="${SITE_URL}/jobs">browse all English-speaking jobs</a>.</p>`
        : `<div class="job-grid">${jobs.map(job => {
            const catLabel = job.Category && CATEGORY_LABELS[job.Category] ? CATEGORY_LABELS[job.Category] : null;
            const badge = catLabel ? `<span class="badge">${escapeHtml(catLabel)}</span>` : '';
            const company = job.Location
                ? `${escapeHtml(job.Company)} &middot; ${escapeHtml(job.Location)}`
                : escapeHtml(job.Company);
            return `
    <a class="job-card" href="${SITE_URL}/jobs/${escapeHtml(job._id)}">
      <span class="title">${escapeHtml(job.JobTitle)}</span>
      <span class="company">${company}</span>
      ${badge}
    </a>`;
        }).join('')}
  </div>${moreHtml}`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonicalUrl)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="English Jobs Germany">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(canonicalUrl)}">
<meta property="og:image" content="${SITE_URL}/logo.jpeg">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${SITE_URL}/logo.jpeg">
<style>${PAGE_STYLE}</style>
<script type="application/ld+json">${serializeJsonLd(jsonLd)}</script>
</head>
<body>
${renderHeader()}
<main class="wrap">
  <section class="hero">
    <h1>${escapeHtml(heading)}</h1>
    <p class="count">${escapeHtml(countLine)}</p>
  </section>
  ${jobsHtml}
  <a class="cta" href="${escapeHtml(ctaHref)}">${escapeHtml(ctaLabel)}</a>
  ${renderCrossLinks()}
</main>
${renderFooter()}
</body>
</html>`;
}

/**
 * Footer cross-links. Gives crawlers a path from any landing page to every
 * other one, so discovery doesn't depend on the sitemap alone.
 */
function renderCrossLinks() {
    const cityLinks = CANONICAL_CITIES
        .map(city => `<a href="${SITE_URL}/city/${city.slug}">${escapeHtml(city.label)}</a>`)
        .join('');

    const categoryLinks = CATEGORY_ORDER
        .map(cat => `<a href="${SITE_URL}/category/${cat}">${escapeHtml(CATEGORY_LABELS[cat])}</a>`)
        .join('');

    return `<nav class="links">
    <h2>Jobs by City</h2>
    ${cityLinks}
    <h2 style="margin-top:16px">Jobs by Category</h2>
    ${categoryLinks}
    <h2 style="margin-top:16px">More</h2>
    <a href="${SITE_URL}/">Home</a><a href="${SITE_URL}/jobs">All jobs</a><a href="${SITE_URL}/directory">Company directory</a>
  </nav>`;
}

/**
 * ItemList JSON-LD — the correct schema for a listing page.
 *
 * NOT JobPosting: that requires a `description`, which is gated content, and
 * Google expects full JobPosting markup on a single-job page rather than a
 * list. ItemList points crawlers at the individual job URLs instead.
 */
function buildItemList(jobs, name) {
    return {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name,
        numberOfItems: jobs.length,
        itemListElement: jobs.map((job, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: `${job.JobTitle} — ${job.Company}`,
            url: `${SITE_URL}/jobs/${job._id}`,
        })),
    };
}

/**
 * Renders GET /city/:cityName
 *
 * `jobs` is the capped display slice; `totalCount` is the true match count.
 * They are separate on purpose — deriving the count from jobs.length would
 * make every large city claim exactly MAX_JOBS_PER_PAGE roles.
 */
export function renderCityPage(city, jobs, totalCount) {
    const title = `English Jobs in ${city.label} — No German Required`;
    const countLine = `${totalCount} English-speaking ${totalCount === 1 ? 'job' : 'jobs'} in ${city.label}`;
    const description = `Browse ${totalCount} English-speaking ${totalCount === 1 ? 'job' : 'jobs'} in ${city.label}, Germany. No German language required — every role is checked before it is listed.`;

    return renderShell({
        title,
        description,
        canonicalPath: `/city/${city.slug}`,
        heading: title,
        countLine,
        jobs,
        totalCount,
        // No ?location= filter exists — ?search= already matches the Location field.
        ctaHref: `${SITE_URL}/jobs?search=${encodeURIComponent(city.slug)}`,
        ctaLabel: `Browse all ${city.label} jobs`,
        jsonLd: buildItemList(jobs, title),
    });
}

/** Renders GET /category/:categoryName — see renderCityPage on jobs vs totalCount. */
export function renderCategoryPage(category, jobs, totalCount) {
    const label = CATEGORY_LABELS[category];
    const title = `English ${label} Jobs in Germany — No German Required`;
    const countLine = `${totalCount} English-speaking ${label} ${totalCount === 1 ? 'job' : 'jobs'} in Germany`;
    const description = `Browse ${totalCount} English-speaking ${label} ${totalCount === 1 ? 'role' : 'roles'} across Germany. No German language required — every role is checked before it is listed.`;

    return renderShell({
        title,
        description,
        canonicalPath: `/category/${category}`,
        heading: title,
        countLine,
        jobs,
        totalCount,
        ctaHref: `${SITE_URL}/jobs?category=${encodeURIComponent(category)}`,
        ctaLabel: `Browse all ${label} jobs`,
        jsonLd: buildItemList(jobs, title),
    });
}

/**
 * Renders GET /sitemap.xml — static pages, every city and job category, plus
 * the career guide hub, its non-empty categories, and every published article.
 *
 * Async because the career-guide entries come from MongoDB (cities/categories
 * are static). Callers must await it.
 *
 * `guideCategories` is the getCategories() shape [{ slug, count }] — zero-count
 * categories are skipped so we don't submit empty pages.
 * `guideArticles` is the published article list.
 */
export function renderSitemap({ guideCategories = [], guideArticles = [] } = {}) {
    const today = new Date().toISOString().split('T')[0];

    const entry = (path, changefreq, priority, lastmod = today) => `  <url>
    <loc>${SITE_URL}${path}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;

    const isoDay = (value) => {
        if (!value) return today;
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? today : d.toISOString().split('T')[0];
    };

    const urls = [
        entry('/', 'daily', '1.0'),
        entry('/jobs', 'daily', '0.9'),
        entry('/directory', 'weekly', '0.8'),
        entry('/alerts', 'monthly', '0.7'),
        entry('/legal', 'monthly', '0.3'),
        ...CATEGORY_ORDER.map(cat => entry(`/category/${cat}`, 'daily', '0.8')),
        ...CANONICAL_CITIES.map(city => entry(`/city/${city.slug}`, 'daily', '0.7')),
        entry('/career-guide', 'weekly', '0.8'),
        ...guideCategories
            .filter(c => c.count > 0)
            .map(c => entry(`/career-guide/${c.slug}`, 'weekly', '0.7')),
        // Articles change rarely — lastmod reflects the real edit date so
        // crawlers only re-fetch what actually changed.
        ...guideArticles.map(a => entry(
            `/career-guide/${a.category}/${a.slug}`,
            'monthly',
            '0.6',
            isoDay(a.updatedAt || a.publishedAt),
        )),
    ];

    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;
}
