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

export const PAGE_STYLE = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
         background: #fff; color: #14171a; line-height: 1.6; }
  .wrap { max-width: 860px; margin: 0 auto; padding: 40px 20px 64px; }
  a { color: #1f6feb; }
  h1 { font-size: clamp(1.6rem, 4vw, 2.3rem); line-height: 1.2; margin: 0 0 8px; }
  .count { color: #57606a; margin: 0 0 28px; font-size: 1rem; }
  ul.jobs { list-style: none; padding: 0; margin: 0 0 32px; }
  ul.jobs li { border: 1px solid #d8dee4; border-radius: 10px; padding: 12px 14px; margin-bottom: 8px; }
  ul.jobs a { font-weight: 600; text-decoration: none; }
  ul.jobs a:hover { text-decoration: underline; }
  .meta { color: #57606a; font-size: 0.86rem; margin-top: 2px; }
  .cta { display: inline-block; background: #1f6feb; color: #fff; text-decoration: none;
         padding: 10px 18px; border-radius: 8px; font-weight: 600; }
  nav.links { margin-top: 40px; border-top: 1px solid #d8dee4; padding-top: 20px; }
  nav.links h2 { font-size: 0.95rem; margin: 0 0 8px; }
  nav.links a { display: inline-block; margin: 0 10px 6px 0; font-size: 0.86rem; }
  .empty { color: #57606a; }
  @media (prefers-color-scheme: dark) {
    body { background: #0d1117; color: #e6edf3; }
    ul.jobs li { border-color: #30363d; }
    .count, .meta, .empty { color: #8b949e; }
    nav.links { border-color: #30363d; }
  }
`;

/**
 * Shared page skeleton — head tags, OG/Twitter cards, canonical, JSON-LD.
 */
function renderShell({ title, description, canonicalPath, heading, countLine, jobs, totalCount, ctaHref, ctaLabel, jsonLd }) {
    const canonicalUrl = `${SITE_URL}${canonicalPath}`;

    // The list is capped, but the count reflects the real total — so say so
    // rather than silently implying these are all of them.
    const moreHtml = totalCount > jobs.length
        ? `<p class="meta">Showing the ${jobs.length} newest of ${totalCount}. <a href="${escapeHtml(ctaHref)}">See all ${totalCount}</a>.</p>`
        : '';

    const jobsHtml = jobs.length === 0
        ? `<p class="empty">No open roles here right now. New jobs are added every day — <a href="${SITE_URL}/jobs">browse all English-speaking jobs</a>.</p>`
        : `<ul class="jobs">${jobs.map(job => `
    <li>
      <a href="${SITE_URL}/jobs/${escapeHtml(job._id)}">${escapeHtml(job.JobTitle)}</a>
      <div class="meta">${escapeHtml(job.Company)}${job.Location ? ` &middot; ${escapeHtml(job.Location)}` : ''}</div>
    </li>`).join('')}
  </ul>${moreHtml}`;

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
<div class="wrap">
  <h1>${escapeHtml(heading)}</h1>
  <p class="count">${escapeHtml(countLine)}</p>
  ${jobsHtml}
  <a class="cta" href="${escapeHtml(ctaHref)}">${escapeHtml(ctaLabel)}</a>
  ${renderCrossLinks()}
</div>
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
