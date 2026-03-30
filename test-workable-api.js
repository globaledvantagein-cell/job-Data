import fetch from 'node-fetch';

// Test the old API endpoint (what we currently use)
async function testOldApi(slug) {
    const url = `https://www.workable.com/api/accounts/${slug}?details=true`;
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Accept': 'application/json' }
        });
        const data = await res.json();
        console.log(`[OLD API] ${slug}: status=${res.status}, jobs=${(data.jobs || []).length}`);
    } catch (e) {
        console.log(`[OLD API] ${slug}: ERROR - ${e.message}`);
    }
}

// Test the new jobs.workable.com job search API
async function testJobsApi(slug) {
    const url = `https://jobs.workable.com/api/v1/jobs?query=&location=Germany&company=${slug}`;
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/json' }
        });
        const data = await res.json();
        console.log(`[JOBS API] ${slug}: status=${res.status}, totalSize=${data.totalSize}, results=${(data.results || []).length}`);
        if (data.results && data.results.length > 0) {
            const j = data.results[0];
            console.log(`  Sample job keys: ${Object.keys(j).join(', ')}`);
            console.log(`  Sample: "${j.title}" at ${j.company?.name || 'N/A'} in ${j.location?.city || 'N/A'}, ${j.location?.country || 'N/A'}`);
        }
    } catch (e) {
        console.log(`[JOBS API] ${slug}: ERROR - ${e.message}`);
    }
}

// Test the apply.workable.com board API (per-company board)
async function testBoardApi(slug) {
    const url = `https://apply.workable.com/api/v1/widget/accounts/${slug}`;
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/json' }
        });
        const data = await res.json();
        console.log(`[BOARD API] ${slug}: status=${res.status}, jobs=${(data.jobs || []).length}, name=${data.name || 'N/A'}`);
        if (data.jobs && data.jobs.length > 0) {
            const j = data.jobs[0];
            console.log(`  Sample job keys: ${Object.keys(j).join(', ')}`);
            console.log(`  Sample: "${j.title}" city=${j.city}, country=${j.country}`);
        }
    } catch (e) {
        console.log(`[BOARD API] ${slug}: ERROR - ${e.message}`);
    }
}

const slugs = ['personio', 'constructor', 'mLabs', 'NIPPON EXPRESS', 'Arbonics', 'Sastrify', 'SORACOM', 'Hadley Designs'];

console.log('=== Testing all 3 Workable API endpoints ===\n');

for (const slug of slugs) {
    console.log(`\n--- ${slug} ---`);
    await testOldApi(slug);
    await testBoardApi(slug);
    // Small delay
    await new Promise(r => setTimeout(r, 300));
}

// Also test the jobs.workable.com approach (search by location only)
console.log('\n\n=== Testing jobs.workable.com Germany search ===');
const url = 'https://jobs.workable.com/api/v1/jobs?query=&location=Germany&pageSize=5';
const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/json' }
});
const data = await res.json();
console.log(`Total Germany jobs on Workable: ${data.totalSize}`);
console.log(`Response keys: ${Object.keys(data).join(', ')}`);
if (data.results && data.results.length > 0) {
    console.log(`\nSample result structure:`);
    console.log(JSON.stringify(data.results[0], null, 2));
}
