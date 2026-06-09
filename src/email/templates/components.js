// Thin re-export hub. Actual implementations live in email/templates/components/.
// Existing imports like `import { renderJobCard } from './components.js'` keep working.
export {
    escapeHtml,
    formatPostedDate,
    formatEmploymentType,
    formatSalary,
    formatLocation,
    workplaceLabel,
} from './components/formatters.js';

export { companyLogoUrl } from './components/branding.js';
export { renderJobCard } from './components/jobCard.js';
export {
    renderCategoryHeading,
    renderSummary,
    renderHeaderBanner,
    renderFooter,
} from './components/layout.js';
