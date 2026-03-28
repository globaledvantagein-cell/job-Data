import fetch from 'node-fetch';
import { StripHtml } from '../utils.js'

function normalizeArray(values) {
  return [...new Set((values || []).filter(Boolean).map(v => String(v).trim()).filter(Boolean))];
}

function normalizeWorkplaceType(value) {
  if (!value) return 'Unspecified';
  const lower = String(value).toLowerCase();
  if (lower === 'remote') return 'Remote';
  if (lower === 'hybrid') return 'Hybrid';
  if (lower === 'onsite' || lower === 'on-site') return 'Onsite';
  if (lower === 'unspecified') return 'Unspecified';
  if (lower.includes('remote')) return 'Remote';
  if (lower.includes('hybrid')) return 'Hybrid';
  if (lower.includes('onsite') || lower.includes('on-site')) return 'Onsite';
  return 'Unspecified';
}

function mapCommitmentToEmploymentType(value) {
  if (!value) return null;
  const lower = String(value).toLowerCase();
  if (lower.includes('full')) return 'FullTime';
  if (lower.includes('part')) return 'PartTime';
  if (lower.includes('intern')) return 'Intern';
  if (lower.includes('temp')) return 'Temporary';
  if (lower.includes('contract')) return 'Contract';
  return null;
}

/**
 * LEVER CONFIGURATION - EXPANDED VERSION
 * 
 * This version includes more companies that are likely to have jobs.
 * These are verified to work with Lever's API.
 */

const LEVER_BASE_URL = 'https://api.lever.co/v0/postings';

/**
 * Verified working companies (tested and confirmed)
 * 
 * Start with these - they're known to use Lever and have active job postings
 */
const companySiteNames = [
  // Tech companies with frequent job postings
 'welocalize',
 // --- BEGIN APPENDED ENTRIES ---
 'veeva',
 'crytek',
 'sonarsource',
 'agicap',
//  'coupa','qonto','pipedrive','brevo','spotify','contentsquare','bazaarvoice','didomi','sophos',
 // --- END APPENDED ENTRIES ---
  

];

// German cities for filtering
const germanCities = [
  'berlin', 'munich', 'münchen', 'hamburg', 'cologne', 'köln', 
  'frankfurt', 'stuttgart', 'düsseldorf', 'dusseldorf', 'dortmund',
  'essen', 'leipzig', 'bremen', 'dresden', 'hanover', 'hannover',
  'nuremberg', 'nürnberg', 'duisburg', 'bochum', 'wuppertal',
  'bielefeld', 'bonn', 'münster', 'karlsruhe', 'mannheim',
  'augsburg', 'wiesbaden', 'mönchengladbach', 'gelsenkirchen',
  'aachen', 'braunschweig', 'kiel', 'chemnitz', 'halle',
  'magdeburg', 'freiburg', 'krefeld', 'mainz', 'lübeck',
];

const germanyKeywords = ['germany', 'deutschland', 'de', 'deu'];

/**
 * Check if job has Germany location
 */
/**
 * Check if job has Germany location
 * FIXED VERSION - More strict filtering
 */
function hasGermanyLocation(job) {
  try {
    // 1. CHECK COUNTRY CODE FIRST (MOST RELIABLE!)
    if (job.country) {
      const countryCode = job.country.toLowerCase().trim();
      // Only accept 'de' or 'deu'
      if (countryCode === 'de' || countryCode === 'deu') {
        return true;
      }
      // If country is set but NOT Germany, reject immediately
      if (countryCode !== 'de' && countryCode !== 'deu') {
        return false;
      }
    }

    // 2. Check primary location
    if (job.categories?.location) {
      const locationLower = job.categories.location.toLowerCase().trim();
      
      // Exact match for Germany keywords
      if (germanyKeywords.some(keyword => {
        return locationLower === keyword || 
               locationLower.includes(`, ${keyword}`) ||
               locationLower.includes(`${keyword},`) ||
               locationLower.startsWith(`${keyword} `) ||
               locationLower.endsWith(` ${keyword}`);
      })) {
        return true;
      }
      
      // Check for German cities
      if (germanCities.some(city => {
        return locationLower === city ||
               locationLower.includes(`, ${city}`) ||
               locationLower.startsWith(`${city},`);
      })) {
        return true;
      }
    }

    // 3. Check all locations array
    if (job.categories?.allLocations && Array.isArray(job.categories.allLocations)) {
      for (const location of job.categories.allLocations) {
        const locationLower = location.toLowerCase().trim();
        
        // Exact Germany match
        if (germanyKeywords.some(keyword => {
          return locationLower === keyword || 
                 locationLower.includes(`, ${keyword}`) ||
                 locationLower.includes(`${keyword},`);
        })) {
          return true;
        }
        
        // German cities
        if (germanCities.some(city => {
          return locationLower === city ||
                 locationLower.includes(`, ${city}`);
        })) {
          return true;
        }
      }
    }

    // 4. Remote jobs - ONLY if explicitly mentions Germany
    if (job.workplaceType === 'remote') {
      const descriptionLower = (job.descriptionPlain || '').toLowerCase();
      
      // Look for explicit "remote in germany" or "remote - germany"
      if (descriptionLower.includes('remote in germany') ||
          descriptionLower.includes('remote - germany') ||
          descriptionLower.includes('germany remote')) {
        return true;
      }
    }

    // DEFAULT: Not a Germany job
    return false;
    
  } catch (error) {
    console.error('Error checking Germany location:', error);
    return false;
  }
}

/**
 * Lever Configuration - Compatible with existing architecture
 */
const leverConfig = {
  siteName: 'Lever Jobs',
  
  // No session needed (public API)
  needsSession: false,
  
  // Use GET method
  method: 'GET',
  
  // Each "page" = one company
  limit: 1,
  
  // ✅ FIX: Lever's company listing API returns only a short intro snippet.
  // Setting this to true triggers processor.js to call getDetails() for the full description.
  needsDescriptionScraping: true,

  /**
   * Fetches the full job details from the Lever per-job API.
   * URL format: https://api.lever.co/v0/postings/{company}/{jobId}
   * This returns the complete description including all sections (lists, additional info, etc.)
   */
  async getDetails(rawJob, _sessionHeaders) {
    try {
      // Extract company slug and job ID from the hosted URL
      // e.g. https://jobs.lever.co/spotify/abc-def-ghi
      let companySlug = null;
      let jobId = rawJob.id;

      if (rawJob.hostedUrl) {
        try {
          const urlParts = new URL(rawJob.hostedUrl).pathname.split('/').filter(Boolean);
          // pathname = ['spotify', 'abc-def-ghi']
          if (urlParts.length >= 2) {
            companySlug = urlParts[0];
          }
        } catch (_) {
          // ignore parse errors
        }
      }

      if (!companySlug || !jobId) {
        console.warn(`[Lever] Could not determine company slug or jobId for job: ${rawJob.text}`);
        return null;
      }

      const detailUrl = `${LEVER_BASE_URL}/${companySlug}/${jobId}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);

      let data;
      try {
        const res = await fetch(detailUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
          signal: controller.signal,
        });
        if (!res.ok) {
          console.warn(`[Lever] Detail API returned ${res.status} for ${detailUrl}`);
          return null;
        }
        data = await res.json();
      } finally {
        clearTimeout(timeoutId);
      }

      // Lever detail API returns a single job object.
      // description = intro HTML, lists = array of {text, content} sections, additional = closing HTML
      const parts = [];

      if (data.description) {
        parts.push(StripHtml(data.description));
      }

      if (Array.isArray(data.lists)) {
        for (const section of data.lists) {
          if (section.text) parts.push(`\n${section.text}:`);
          if (section.content) parts.push(StripHtml(section.content));
        }
      }

      if (data.additional) {
        parts.push(StripHtml(data.additional));
      }

      const fullDescription = parts.join('\n').replace(/\s{3,}/g, '\n\n').trim();

      if (!fullDescription || fullDescription.length < 50) {
        console.warn(`[Lever] Detail API returned empty/short description for: ${rawJob.text}`);
        return null;
      }

      console.log(`[Lever] ✅ Got full description (${fullDescription.length} chars) for: ${String(rawJob.text || '').substring(0, 50)}`);
      return { Description: fullDescription };

    } catch (error) {
      console.error(`[Lever] getDetails error for "${rawJob.text}": ${error.message}`);
      return null;
    }
  },
  
  // Base URL
  baseUrl: LEVER_BASE_URL,
  
  /**
   * Build URL for current company
   */
  buildPageUrl: (offset, limit) => {
    const companyIndex = offset;
    
    if (companyIndex >= companySiteNames.length) {
      console.log(`[Lever] ✅ Finished checking all ${companySiteNames.length} companies`);
      return null;
    }
    
    const siteName = companySiteNames[companyIndex];
    const url = `${LEVER_BASE_URL}/${siteName}?mode=json`;
    
    console.log(`\n[Lever] 🔍 Company ${companyIndex + 1}/${companySiteNames.length}: ${siteName}`);
    
    return url;
  },
  
  /**
   * Extract and filter jobs from API response
   * 
   * DEBUGGING ENABLED: Shows what we receive from API
   */
  getJobs: (data) => {
    // DEBUG: Log what we received
    if (!data) {
      console.log(`       ❌ No data received from API`);
      return [];
    }
    
    const allJobs = Array.isArray(data) ? data : [];
    
    // DEBUG: Log job count
    console.log(`       📊 Received ${allJobs.length} total jobs`);
    
    if (allJobs.length === 0) {
      console.log(`       ⊘  No jobs found for this company`);
      return [];
    }
    
    // DEBUG: Log first job structure (helps diagnose issues)
    if (allJobs.length > 0) {
      const firstJob = allJobs[0];
      console.log(`       🔍 Sample job fields:`, {
        id: firstJob.id ? '✓' : '✗',
        text: firstJob.text ? '✓' : '✗',
        country: firstJob.country || 'none',
        location: firstJob.categories?.location || 'none',
        allLocations: firstJob.categories?.allLocations?.length || 0
      });
    }
    
    // Filter for Germany
    const germanyJobs = allJobs.filter(hasGermanyLocation);
    
    if (germanyJobs.length > 0) {
      console.log(`       ✅ Found ${germanyJobs.length} Germany jobs!`);
    } else {
      console.log(`       ⊘  No Germany jobs (checked ${allJobs.length} jobs)`);
    }
    
    return germanyJobs;
  },
  
  /**
   * Extract unique job ID
   */
  extractJobID: (job) => {
    return `lever_${job.id}`;
  },

  /**
   * Extract job title
   */
  extractJobTitle: (job) => {
    return job.text || 'Untitled Position';
  },

  /**
   * Extract company name
   */
  extractCompany: (job) => {
    if (job.hostedUrl) {
      try {
        const url = new URL(job.hostedUrl);
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts.length > 0) {
          return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
        }
      } catch (e) {
        // Fall through
      }
    }
    
    return 'Company via Lever';
  },

  /**
   * Extract location(s)
   */
  extractLocation: (job) => {
    const locations = [];
    
    if (job.categories && job.categories.location) {
      locations.push(job.categories.location);
    }
    
    if (job.categories && job.categories.allLocations && Array.isArray(job.categories.allLocations)) {
      for (const loc of job.categories.allLocations) {
        if (!locations.includes(loc)) {
          locations.push(loc);
        }
      }
    }
    
    if (job.workplaceType && job.workplaceType !== 'unspecified' && job.workplaceType !== 'on-site') {
      const workplaceLabel = job.workplaceType.charAt(0).toUpperCase() + job.workplaceType.slice(1);
      locations.push(workplaceLabel);
    }
    
    return locations.length > 0 ? locations.join(', ') : 'Location not specified';
  },

  /**
   * Extract description from the list API response.
   * Note: This will typically be a short intro only — getDetails() fetches the full version.
   */
  extractDescription: (job) => {
    // descriptionPlain is sometimes available on the list endpoint
    if (job.descriptionPlain && job.descriptionPlain.length > 100) {
      return StripHtml(job.descriptionPlain);
    }
    if (job.description && job.description.length > 100) {
      return StripHtml(job.description);
    }
    // Return empty string so needsDescriptionScraping triggers getDetails()
    return '';
  },

  /**
   * Extract URL
   */
  extractURL: (job) => {
    if (job.hostedUrl) {
      return job.hostedUrl;
    }
    
    if (job.applyUrl) {
      return job.applyUrl;
    }
    
    return null;
  },

  /**
   * Extract posting date
   */
  extractPostedDate: (job) => {
    return job.createdAt || null;
  },

  extractDepartment: (job) => {
    return job.categories?.department || 'N/A';
  },

  extractTeam: (job) => {
    return job.categories?.team || null;
  },

  extractOffice: (job) => {
    return job.categories?.location || null;
  },

  extractAllLocations: (job) => {
    return normalizeArray(job.categories?.allLocations || []);
  },

  extractEmploymentType: (job) => {
    return mapCommitmentToEmploymentType(job.categories?.commitment);
  },

  extractWorkplaceType: (job) => {
    return normalizeWorkplaceType(job.workplaceType);
  },

  extractIsRemote: (job) => {
    const workplace = normalizeWorkplaceType(job.workplaceType);
    return workplace === 'Remote' || workplace === 'Hybrid';
  },

  extractCountry: (job) => {
    if (!job.country) return null;
    const country = String(job.country).trim();
    if (country.length === 2) return country.toUpperCase();
    if (country.toLowerCase() === 'germany' || country.toLowerCase() === 'deutschland') return 'DE';
    return country;
  },

  extractTags: (job) => {
    return Array.isArray(job.tags) ? job.tags : [];
  },

  extractDirectApplyURL: (job) => {
    return job.applyUrl || null;
  },

  extractSalaryMin: (job) => {
    return Number.isFinite(job.salaryRange?.min) ? job.salaryRange.min : null;
  },

  extractSalaryMax: (job) => {
    return Number.isFinite(job.salaryRange?.max) ? job.salaryRange.max : null;
  },

  extractSalaryCurrency: (job) => {
    return job.salaryRange?.currency || null;
  },

  extractSalaryInterval: (job) => {
    return job.salaryRange?.interval || null;
  },

  extractATSPlatform: () => {
    return 'lever';
  },
};

export { leverConfig };