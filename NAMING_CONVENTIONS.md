# Naming Conventions

Standards for all code in this project. Follow these when adding new files, functions, or variables.

---

## Files & Folders

| Type | Convention | Example |
|------|-----------|---------|
| Folders | `kebab-case` | `company-configs/`, `core/` |
| JS files | `camelCase.js` | `jobQueries.js`, `scraperEngine.js` |
| Route files | `camelCase.routes.js` | `jobs.routes.js`, `auth.routes.js` |
| Model files | `camelCase.js` with `Model` suffix | `jobModel.js`, `userModel.js` |
| Config files | `camelCase.js` with `Config` suffix | `greenhouseConfig.js`, `workdayConfig.js` |
| Barrel exports | `index.js` | Every folder gets one |
| Docs | `UPPER_SNAKE_CASE.md` | `CODEBASE_MAP.md`, `NAMING_CONVENTIONS.md` |

---

## Variables & Parameters

| Type | Convention | Example |
|------|-----------|---------|
| Local variables | `camelCase` | `germanyJobs`, `totalFetched`, `pageCount` |
| Boolean variables | `is`/`has`/`needs` prefix | `isRemote`, `hasGermanyLocation`, `needsSession` |
| Counters | descriptive `…Count` | `successCount`, `failCount`, `deletedCount` |
| Timestamps | descriptive `…At`/`…Date` | `createdAt`, `scrapedAt`, `PostedDate` |
| Maps/Sets | plural noun | `existingIDsMap`, `crossEntityKeys` |
| Arrays | plural noun | `companyBoards`, `germanyJobs`, `sentJobIds` |
| Indexes | `i`, `j` or descriptive | `companyIndex`, `offset` |

---

## Functions

| Type | Convention | Example |
|------|-----------|---------|
| General functions | `camelCase` verb-first | `saveJobs()`, `fetchPage()`, `trackApplyClick()` |
| Query functions | `get`/`find`/`load` prefix | `getJobsPaginated()`, `findJobById()`, `loadAllExistingIDs()` |
| Boolean functions | `is`/`has`/`should` prefix | `isGermanyString()`, `hasGermanyLocation()`, `shouldContinuePaging()` |
| Create/factory | `create` prefix | `createJobModel()`, `createFeedback()` |
| Transform | `derive`/`normalize`/`extract` prefix | `deriveDomain()`, `normalizeArray()`, `extractJobTitle()` |
| Delete/cleanup | `delete`/`clean`/`remove` prefix | `deleteOldJobs()`, `cleanAllDescriptions()` |
| ATS extractors | `extract` + field name | `extractJobID()`, `extractLocation()`, `extractSalaryMin()` |

---

## Constants

| Type | Convention | Example |
|------|-----------|---------|
| Global constants | `UPPER_SNAKE_CASE` | `TECHNICAL_KEYWORDS`, `BANNED_ROLES`, `GERMAN_CITIES` |
| Config constants | `UPPER_SNAKE_CASE` | `MONGO_URI`, `JWT_SECRET`, `API_BASE` |
| Local constants | `camelCase` (if scoped to a function) | `const limit = 20` |

---

## Database Fields (MongoDB)

| Type | Convention | Example |
|------|-----------|---------|
| Schema fields | `PascalCase` (matches frontend) | `JobTitle`, `ApplicationURL`, `GermanRequired` |
| System fields | `camelCase` | `createdAt`, `updatedAt`, `scrapedAt` |
| Boolean fields | `PascalCase` or `is` prefix | `GermanRequired`, `IsRemote`, `isEntryLevel` |
| Collection names | `camelCase` | `jobs`, `users`, `jobTestLogs`, `applyClicks` |

> **Why PascalCase for schema fields?** The frontend consumes these directly as JSON. PascalCase distinguishes business fields (`JobTitle`) from system metadata (`createdAt`).

---

## Exports & Imports

| Rule | Example |
|------|---------|
| Named exports only (no default) | `export function saveJobs()` |
| Exception: ATS configs use default | `export default greenhouseConfig` |
| Barrel `index.js` for every folder | `export { saveJobs } from './jobQueries.js'` |
| Import from barrel when possible | `import { saveJobs } from '../db/index.js'` |
| Direct import for utils.js | `import { StripHtml } from '../utils.js'` |

---

## ATS Company Configs

Each config file must export an object with these standard methods:

```
initialize()         — Fetch + filter all jobs from the ATS API
fetchPage(offset, limit) — Return paginated slice of pre-fetched jobs
getJobs(data)        — Extract jobs array from API response
getTotal(data)       — Extract total count from API response
extractJobID(job)    — Return unique ID string: `{platform}_{company}_{id}`
extractJobTitle(job)
extractCompany(job)
extractLocation(job)
extractDescription(job)
extractURL(job)
extractPostedDate(job)
extractDepartment(job)
extractWorkplaceType(job)
extractEmploymentType(job)
extractATSPlatform() — Return platform name: 'greenhouse', 'ashby', etc.
```

Optional methods: `extractSalaryMin`, `extractSalaryMax`, `extractSalaryCurrency`, `extractSalaryInterval`, `extractTags`, `extractTeam`, `extractOffice`, `extractAllLocations`, `extractCountry`, `extractIsRemote`, `extractDirectApplyURL`, `getDetails`.

---

## Quick Reference

```
folder-name/           ← kebab-case
  fileName.js          ← camelCase
    CONSTANT_NAME      ← UPPER_SNAKE_CASE
    localVariable      ← camelCase
    functionName()     ← camelCase, verb-first
    SchemaField        ← PascalCase (DB fields)
    isBoolean          ← is/has/should prefix
```
