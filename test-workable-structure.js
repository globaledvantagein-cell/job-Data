import fetch from 'node-fetch';

// The WORKING API: jobs.workable.com — Germany job search
const url = 'https://jobs.workable.com/api/v1/jobs?query=&location=Germany&pageSize=3';
const res = await fetch(url, {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
    }
});
const data = await res.json();

console.log('=== Response top-level keys ===');
console.log(Object.keys(data));
console.log('totalSize:', data.totalSize);
console.log('nextPageToken:', data.nextPageToken);
console.log('autoAppliedFilters:', data.autoAppliedFilters);

console.log('\n=== First job (full structure) ===');
const job = data.jobs[0];
console.log(JSON.stringify(job, null, 2));

console.log('\n=== Second job (full structure) ===');
console.log(JSON.stringify(data.jobs[1], null, 2));

// Also test: does the old per-company slug API actually redirect?
console.log('\n\n=== Checking redirect behavior of old API ===');
const oldRes = await fetch('https://www.workable.com/api/accounts/personio?details=true', {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
    redirect: 'manual'
});
console.log('Old API status:', oldRes.status);
console.log('Old API Location header:', oldRes.headers.get('location'));
