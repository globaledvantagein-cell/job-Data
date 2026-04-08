# Codebase Map — job-Data Backend

## Architecture Overview

Node.js/Express backend using MongoDB (native driver + Mongoose). Runs scheduled cron jobs to scrape ATS platforms, filters jobs through pre-AI checks, analyzes via Gemini AI, and serves results through a REST API.

---

## Folder Structure

```
src/
├── server.js              # Express entry point + cron scheduling
├── config.js              # SITES_CONFIG array (which scrapers to run)
├── env.js                 # Environment variables & secrets
├── utils.js               # Shared helpers (StripHtml, fingerprinting, dedup)
│
├── api/                   # Express route handlers
│   ├── analytics.routes.js
│   ├── auth.routes.js
│   ├── feedback.routes.js
│   ├── jobs.routes.js     # Main jobs API (CRUD, review, reanalysis)
│   └── users.routes.js
│
├── company-configs/       # ATS platform configurations
│   ├── ashbyConfig.js
│   ├── greenhouseConfig.js
│   ├── leverConfig.js
│   ├── recruiteeConfig.js
│   ├── workableConfig.js
│   ├── workdayConfig.js
│   └── index.js           # Barrel exports
│
├── core/                  # Scraping engine
│   ├── scraperEngine.js   # Main loop: paginate → filter → process → save
│   ├── network.js         # HTTP fetch + session management
│   ├── pagination.js      # Page-size logic
│   ├── processJob.js      # Per-job pipeline: extract → filter → AI → save
│   ├── jobExtractor.js    # Field mapping + domain classification
│   ├── locationPrefilters.js  # Germany location detection + normalizers
│   └── index.js
│
├── cron/                  # Scheduled tasks
│   ├── runScraper.js      # Orchestrates scraping all SITES_CONFIG
│   ├── runValidator.js    # Checks active job URLs for 404s
│   ├── runMatcher.js      # Matches jobs to subscribed users → email
│   └── index.js
│
├── db/                    # Database layer
│   ├── connection.js      # MongoClient + Mongoose connection
│   ├── jobQueries.js      # Job CRUD, review, cleanup, apply clicks
│   ├── userQueries.js     # Auth, subscribers, matching
│   ├── feedbackQueries.js # Feedback CRUD + stats
│   └── index.js           # Barrel re-exports all DB functions
│
├── filters/               # Pre-AI rejection filters
│   ├── citizenshipFilter.js
│   ├── germanTitleFilter.js
│   ├── nonEnglishFilter.js
│   ├── otherLanguageFilter.js
│   └── index.js
│
├── gemini/                # AI analysis via Google Gemini
│   ├── analyzeJob.js      # Prompt + API call + rate limiting
│   ├── keyManager.js      # Round-robin API key rotation
│   ├── snippetExtractor.js # Extract relevant description snippets
│   └── index.js
│
├── middleware/
│   └── authMiddleware.js  # JWT verify + admin check
│
├── models/                # Data shape definitions
│   ├── analyticsModel.js  # Mongoose schema for daily analytics
│   ├── feedbackModel.js   # Feedback document factory
│   ├── jobModel.js        # Job document factory
│   ├── jobTestLogModel.js # Test log factory
│   ├── userModel.js       # User document factory
│   └── index.js
│
├── utils/
│   ├── emailManager.js    # AWS SES email sending
│   └── index.js           # Barrel: combines emailManager + ../utils.js
│
├── tests/                 # Integration test scripts
│   ├── test-auto-deletion.js
│   ├── test-dedup.js
│   ├── test-validator-and-cleanup.js
│   └── test-workable.js
│
└── migrations/
    └── cleanup-thumbs.js
```

## Data Flow

```
Cron Trigger → runScraper.js
  → For each SITES_CONFIG entry:
    → scraperEngine.js (paginate via network.js)
      → processJob.js (per job):
        1. jobExtractor.js — map ATS fields to standard schema
        2. filters/ — reject German titles, non-English, citizenship
        3. gemini/ — AI analysis (German required? confidence score)
        4. db/jobQueries.js — save to MongoDB
```

## Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| Folders | kebab-case | `company-configs/` |
| Files | camelCase | `jobQueries.js` |
| Functions | camelCase | `deriveExperienceFromTitle()` |
| Constants | UPPER_SNAKE_CASE | `TECHNICAL_KEYWORDS` |
| Classes | PascalCase | `Job`, `User` |
