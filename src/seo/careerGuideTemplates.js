/**
 * Server-rendered HTML for the Germany Career Guide.
 *
 * Follows the same pattern as templates.js (the /city and /category pages):
 * same head/meta/OG approach, same escaping rules, same JSON-LD serialisation.
 * PAGE_STYLE and the escape helpers are imported rather than duplicated.
 *
 * Article body HTML is the ONLY string interpolated unescaped — it has already
 * been through marked + sanitize-html in careerGuide.routes.js.
 */
import { CAREER_GUIDE_CATEGORY_LABELS } from '../db/careerGuide.js';
import { escapeHtml, serializeJsonLd, PAGE_STYLE } from './templates.js';
import { SITE_URL } from '../env.js';

const GUIDE_NAME = 'Germany Career Guide';

// Typography for rendered markdown, plus the breadcrumb/CTA chrome. Appended to
// PAGE_STYLE so the guide inherits the same base look as the other SEO pages.
const GUIDE_STYLE = `
  .crumbs { font-size: 0.82rem; color: #57606a; margin: 0 0 20px; }
  .crumbs a { text-decoration: none; }
  .crumbs span { margin: 0 6px; opacity: 0.5; }
  .cats { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; margin: 0 0 40px; }
  .cat { border: 1px solid #d8dee4; border-radius: 10px; padding: 16px; text-decoration: none; display: block; color: inherit; }
  .cat strong { display: block; font-size: 1rem; margin-bottom: 2px; }
  .cat span { font-size: 0.82rem; color: #57606a; }
  .article-body { margin: 28px 0 36px; }
  .article-body h2 { font-size: 1.35rem; margin: 32px 0 10px; line-height: 1.3; }
  .article-body h3 { font-size: 1.1rem; margin: 24px 0 8px; }
  .article-body p { margin: 0 0 14px; }
  .article-body ul, .article-body ol { margin: 0 0 14px; padding-left: 22px; }
  .article-body li { margin-bottom: 6px; }
  .article-body img { max-width: 100%; height: auto; border-radius: 8px; }
  .article-body pre { background: #f6f8fa; padding: 12px 14px; border-radius: 8px; overflow-x: auto; }
  .article-body code { background: #f6f8fa; padding: 1px 5px; border-radius: 4px; font-size: 0.88em; }
  .article-body pre code { background: none; padding: 0; }
  .article-body blockquote { margin: 0 0 14px; padding: 2px 0 2px 14px; border-left: 3px solid #d8dee4; color: #57606a; }
  .article-body table { border-collapse: collapse; width: 100%; margin: 0 0 14px; display: block; overflow-x: auto; }
  .article-body th, .article-body td { border: 1px solid #d8dee4; padding: 6px 10px; text-align: left; }
  .byline { color: #57606a; font-size: 0.86rem; margin: 0 0 4px; }
  .cta-box { border: 1px solid #d8dee4; border-radius: 12px; padding: 20px; margin: 32px 0; }
  .cta-box p { margin: 10px 0 0; font-size: 0.88rem; }
  .tags { margin: 0 0 24px; }
  .tags span { display: inline-block; font-size: 0.74rem; color: #57606a; border: 1px solid #d8dee4;
               border-radius: 999px; padding: 2px 10px; margin: 0 6px 6px 0; }
  @media (prefers-color-scheme: dark) {
    .crumbs, .cat span, .byline, .article-body blockquote, .tags span { color: #8b949e; }
    .cat, .cta-box, .tags span { border-color: #30363d; }
    .article-body pre, .article-body code { background: #161b22; }
    .article-body th, .article-body td, .article-body blockquote { border-color: #30363d; }
  }
`;

/** Breadcrumb trail. `trail` is [{ label, path|null }] — last item has no link. */
function renderCrumbs(trail) {
    return `<nav class="crumbs" aria-label="Breadcrumb">${trail.map((item, i) => {
        const sep = i > 0 ? '<span>/</span>' : '';
        return item.path
            ? `${sep}<a href="${SITE_URL}${item.path}">${escapeHtml(item.label)}</a>`
            : `${sep}${escapeHtml(item.label)}`;
    }).join('')}</nav>`;
}

/** BreadcrumbList JSON-LD mirroring the visible crumbs. */
function buildBreadcrumbLd(trail) {
    return {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: trail.map((item, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            name: item.label,
            ...(item.path ? { item: `${SITE_URL}${item.path}` } : {}),
        })),
    };
}

/** Both CTAs, shown after article content and on the hub/category pages. */
function renderCtas() {
    return `<div class="cta-box">
    <a class="cta" href="${SITE_URL}/jobs">Browse English-speaking jobs &rarr;</a>
    <p><a href="${SITE_URL}/login">Create a free account</a> for personalised matches.</p>
  </div>`;
}

function renderShell({ title, description, canonicalPath, jsonLd, body }) {
    const canonicalUrl = `${SITE_URL}${canonicalPath}`;
    const ldBlocks = (Array.isArray(jsonLd) ? jsonLd : [jsonLd])
        .map(ld => `<script type="application/ld+json">${serializeJsonLd(ld)}</script>`)
        .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonicalUrl)}">
<meta property="og:site_name" content="English Jobs Germany">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(canonicalUrl)}">
<meta property="og:image" content="${SITE_URL}/logo.jpeg">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${SITE_URL}/logo.jpeg">
<style>${PAGE_STYLE}${GUIDE_STYLE}</style>
${ldBlocks}
</head>
<body>
<div class="wrap">
${body}
</div>
</body>
</html>`;
}

/** Article list used by both the hub and the category pages. */
function renderArticleList(articles, { showCategory = false } = {}) {
    if (articles.length === 0) {
        return `<p class="empty">No articles here yet — <a href="${SITE_URL}/career-guide">back to the guide</a>.</p>`;
    }
    return `<ul class="jobs">${articles.map(a => `
    <li>
      <a href="${SITE_URL}/career-guide/${escapeHtml(a.category)}/${escapeHtml(a.slug)}">${escapeHtml(a.title)}</a>
      <div class="meta">${showCategory ? `${escapeHtml(CAREER_GUIDE_CATEGORY_LABELS[a.category] || a.category)} &middot; ` : ''}${escapeHtml(formatDate(a.publishedAt))}</div>
      ${a.description ? `<div class="meta">${escapeHtml(a.description)}</div>` : ''}
    </li>`).join('')}
  </ul>`;
}

function formatDate(value) {
    if (!value) return '';
    return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** GET /career-guide — hub: all categories with counts + 6 most recent articles. */
export function renderGuideHub(categories, recentArticles) {
    const title = `${GUIDE_NAME} — Working in Germany Without German`;
    const description = 'Practical guides on finding English-speaking jobs in Germany: visas, salaries, companies, and settling in. Written for internationals.';
    const trail = [{ label: 'Home', path: '/' }, { label: 'Career Guide', path: null }];

    const catCards = categories.map(c => `
    <a class="cat" href="${SITE_URL}/career-guide/${escapeHtml(c.slug)}">
      <strong>${escapeHtml(c.label)}</strong>
      <span>${c.count} ${c.count === 1 ? 'article' : 'articles'}</span>
    </a>`).join('');

    const body = `${renderCrumbs(trail)}
  <h1>${escapeHtml(GUIDE_NAME)}</h1>
  <p class="count">${escapeHtml(description)}</p>
  <div class="cats">${catCards}</div>
  <h2 style="font-size:1.2rem;margin:0 0 12px">Latest articles</h2>
  ${renderArticleList(recentArticles, { showCategory: true })}
  ${renderCtas()}`;

    return renderShell({
        title,
        description,
        canonicalPath: '/career-guide',
        jsonLd: buildBreadcrumbLd(trail),
        body,
    });
}

/** GET /career-guide/:category — all published articles in one category. */
export function renderGuideCategory(category, articles) {
    const label = CAREER_GUIDE_CATEGORY_LABELS[category];
    const title = `${label} — ${GUIDE_NAME}`;
    const description = `${articles.length} ${articles.length === 1 ? 'guide' : 'guides'} on ${label.toLowerCase()} for English speakers in Germany.`;
    const trail = [
        { label: 'Home', path: '/' },
        { label: 'Career Guide', path: '/career-guide' },
        { label, path: null },
    ];

    const body = `${renderCrumbs(trail)}
  <h1>${escapeHtml(label)}</h1>
  <p class="count">${escapeHtml(description)}</p>
  ${renderArticleList(articles)}
  ${renderCtas()}`;

    return renderShell({
        title,
        description,
        canonicalPath: `/career-guide/${category}`,
        jsonLd: buildBreadcrumbLd(trail),
        body,
    });
}

/**
 * GET /career-guide/:category/:slug — full article.
 * `contentHtml` MUST already be sanitised; it is injected unescaped.
 */
export function renderGuideArticle(article, contentHtml) {
    const label = CAREER_GUIDE_CATEGORY_LABELS[article.category] || article.category;
    const title = `${article.title} — ${GUIDE_NAME}`;
    const description = article.description || `${article.title} — a practical guide for English speakers working in Germany.`;
    const trail = [
        { label: 'Home', path: '/' },
        { label: 'Career Guide', path: '/career-guide' },
        { label, path: `/career-guide/${article.category}` },
        { label: article.title, path: null },
    ];

    const articleLd = {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: article.title,
        description,
        author: { '@type': 'Organization', name: article.author || 'English Jobs Germany' },
        publisher: {
            '@type': 'Organization',
            name: 'English Jobs Germany',
            logo: { '@type': 'ImageObject', url: `${SITE_URL}/logo.jpeg` },
        },
        datePublished: article.publishedAt ? new Date(article.publishedAt).toISOString() : undefined,
        dateModified: article.updatedAt ? new Date(article.updatedAt).toISOString() : undefined,
        mainEntityOfPage: { '@type': 'WebPage', '@id': `${SITE_URL}/career-guide/${article.category}/${article.slug}` },
    };

    const tagsHtml = (article.tags || []).length > 0
        ? `<div class="tags">${article.tags.map(t => `<span>${escapeHtml(t)}</span>`).join('')}</div>`
        : '';

    const body = `${renderCrumbs(trail)}
  <article>
    <h1>${escapeHtml(article.title)}</h1>
    <p class="byline">${escapeHtml(article.author || 'English Jobs Germany')} &middot; ${escapeHtml(formatDate(article.publishedAt))}${article.updatedAt && article.publishedAt && new Date(article.updatedAt) > new Date(article.publishedAt) ? ` &middot; updated ${escapeHtml(formatDate(article.updatedAt))}` : ''}</p>
    ${tagsHtml}
    <div class="article-body">${contentHtml}</div>
  </article>
  ${renderCtas()}
  <nav class="links">
    <a href="${SITE_URL}/career-guide/${escapeHtml(article.category)}">&larr; More in ${escapeHtml(label)}</a>
    <a href="${SITE_URL}/career-guide">All guides</a>
  </nav>`;

    return renderShell({
        title,
        description,
        canonicalPath: `/career-guide/${article.category}/${article.slug}`,
        jsonLd: [buildBreadcrumbLd(trail), articleLd],
        body,
    });
}
