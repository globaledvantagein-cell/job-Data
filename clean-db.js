import { MongoClient } from 'mongodb';

async function clean() {
    console.log("🧹 Connecting to MongoDB...");
    const client = new MongoClient("mongodb://localhost:27017");
    await client.connect();
    
    const db = client.db("job-scraper");
    
    console.log("🗑️  Dropping 'jobs' collection...");
    await db.collection("jobs").deleteMany({});
    
    console.log("🗑️  Dropping 'jobTestLogs' collection...");
    await db.collection("jobTestLogs").deleteMany({});

    console.log("✅ Database cleaning complete. Restart your server if needed.");
    await client.close();
}

clean().catch(console.error);
