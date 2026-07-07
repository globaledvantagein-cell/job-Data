import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import he from 'he';
import { SanitizeHtml } from '../utils/htmlUtils.js';

// Setup dotenv to run standalone
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const MONGO_URI = process.env.MONGO_URI;

// Extract DB name from URI or fallback to default
let DB_NAME = 'job-scraper';
if (MONGO_URI) {
    try {
        const url = new URL(MONGO_URI);
        const dbPath = url.pathname.replace(/^\//, '');
        if (dbPath) {
            DB_NAME = dbPath;
        }
    } catch (e) {
        // ignore parse errors, use default
    }
}

async function run() {
    console.log('🚀 Starting DescriptionHtml sanitization migration (with HTML entity decoding)...\n');

    if (!MONGO_URI) {
        throw new Error('MONGO_URI is not defined in environment variables');
    }

    const client = new MongoClient(MONGO_URI);
    await client.connect();
    const db = client.db(DB_NAME);

    console.log('--- Step 1: Fetching jobs with DescriptionHtml ---');
    const jobsCollection = db.collection('jobs');

    const jobs = await jobsCollection.find({
        DescriptionHtml: { $exists: true, $ne: null, $ne: "" }
    }).toArray();

    console.log(`Found ${jobs.length} jobs to process.`);

    let updatedCount = 0;
    
    for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        
        try {
            // Some ATS systems returned HTML that was entity-encoded (e.g. &lt;div&gt; instead of <div>).
            // When the previous migration ran, it treated these as text nodes and wrapped them in <p>, 
            // resulting in <p>&lt;div class="content-intro"&gt;...</p>.
            // By using he.decode(), we convert it back into raw HTML before passing it to SanitizeHtml,
            // which allows SanitizeHtml to correctly parse, strip the .content-intro divs, and format it.
            let decoded = job.DescriptionHtml;
            decoded = he.decode(decoded); // Decode once
            decoded = he.decode(decoded); // Decode twice just in case of double-encoding

            const newHtml = SanitizeHtml(decoded);
            
            // Only update if it actually changed
            if (newHtml !== job.DescriptionHtml) {
                await jobsCollection.updateOne(
                    { _id: job._id },
                    { $set: { DescriptionHtml: newHtml } }
                );
                updatedCount++;
            }
        } catch (error) {
            console.error(`❌ Error processing job ${job._id}:`, error);
        }
        
        if ((i + 1) % 100 === 0) {
            console.log(`Processed ${i + 1} / ${jobs.length}`);
        }
    }

    console.log('\n========================================');
    console.log('🎉 Migration complete!');
    console.log('========================================');
    console.log(`Total jobs processed: ${jobs.length}`);
    console.log(`Jobs updated: ${updatedCount}`);
    console.log('========================================\n');
    console.log('✅ Safe to delete this file now.');

    await client.close();
    process.exit(0);
}

run().catch(async err => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
});
