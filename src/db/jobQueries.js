// Thin re-export hub. The actual implementations live in db/jobs/.
// This file exists so external imports like `import { saveJobs } from './jobQueries.js'`
// continue working unchanged.
export * from './jobs/index.js';
